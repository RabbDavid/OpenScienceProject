/** Curate a small starting set from primary arXiv metadata and actual bibliography entries.
 * No global citation counts are supplied by arXiv; store null rather than inventing zeros.
 * Run: npx tsx scripts/collect-mechinterp.ts. Other fields remain unchanged. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { Literature, Paper } from '../shared/types.ts';

const selected = [
  ['2209.10652', 'Toy Models of Superposition'],
  [
    '2211.00593',
    'Interpretability in the Wild: a Circuit for Indirect Object Identification in GPT-2 small',
  ],
  ['2309.08600', 'Sparse Autoencoders Find Highly Interpretable Features in Language Models'],
  [
    '2309.16042',
    'Towards Best Practices of Activation Patching in Language Models: Metrics and Methods',
  ],
  ['2304.14997', 'Towards Automated Circuit Discovery for Mechanistic Interpretability'],
  ['2301.05217', 'Progress measures for grokking via mechanistic interpretability'],
  ['2406.04093', 'Scaling and evaluating sparse autoencoders'],
  ['2012.14913', 'Transformer Feed-Forward Layers Are Key-Value Memories'],
];
const decode = (text: string) =>
  text
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#x27;|&apos;/g, "'");
const norm = (text: string) =>
  decode(text)
    .replace(/<[^>]*>/g, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
const cache = new URL('../.local/mechinterp-sources/', import.meta.url);
mkdirSync(cache, { recursive: true });
const papers: Paper[] = [];
for (const [id, expected] of selected) {
  const response = await fetch(`https://arxiv.org/abs/${id}`);
  if (!response.ok) throw new Error(`arXiv metadata ${id}: ${response.status}`);
  const html = await response.text();
  writeFileSync(new URL(`${id}-metadata.html`, cache), html);
  const values = (key: string) =>
    [...html.matchAll(new RegExp(`<meta name="citation_${key}" content="([^"]*)"`, 'g'))].map(
      (match) => decode(match[1]),
    );
  const title = values('title')[0];
  if (!title || norm(title) !== norm(expected)) throw new Error(`Title mismatch for ${id}`);
  const authors = values('author').map((author) => author.split(',')[0]);
  const date = values('date')[0];
  if (!date || !authors.length) throw new Error(`Incomplete metadata for ${id}`);
  const paper: Paper = {
    id: `arxiv-${id}`,
    fieldId: 'mechinterp',
    title,
    authors: authors.length > 3 ? `${authors.slice(0, 3).join(', ')}, et al.` : authors.join(', '),
    year: Number(date.slice(0, 4)),
    venue: 'arXiv',
    doi: `https://doi.org/10.48550/arXiv.${id}`,
    url: `https://arxiv.org/abs/${id}`,
    openAccess: true,
    citedBy: null,
    metadataSource: 'arXiv',
    seed: true,
    references: [],
  };
  const fullTextPath = html.match(
    new RegExp(`href="(?:https://arxiv\\.org)?(/html/${id.replace('.', '\\.')}v\\d+)"`),
  )?.[1];
  if (fullTextPath) {
    const fullTextUrl = `https://arxiv.org${fullTextPath}`;
    const fullText = await fetch(fullTextUrl);
    if (!fullText.ok) throw new Error(`arXiv full text ${id}: ${fullText.status}`);
    const text = await fullText.text();
    writeFileSync(new URL(`${id}-paper.html`, cache), text);
    const bibliography = text.match(
      /<section[^>]*class="[^"]*ltx_bibliography[^"]*"[\s\S]*?<\/section>/,
    )?.[0];
    if (bibliography) {
      const entries = [
        ...bibliography.matchAll(/<li[^>]*class="[^"]*ltx_bibitem[^"]*"[\s\S]*?<\/li>/g),
      ].map((match) => norm(match[0]));
      paper.references = selected
        .filter(
          ([refId, refTitle]) =>
            refId !== id && entries.some((entry) => entry.includes(norm(refTitle))),
        )
        .map(([refId]) => `arxiv-${refId}`)
        .sort();
      paper.referenceSource = fullTextUrl;
    }
  }
  papers.push(paper);
  console.log(`${id}: ${paper.references.length} verified references in this set`);
}
const output = new URL('../server/literature.json', import.meta.url);
const existing: Literature = JSON.parse(readFileSync(output, 'utf8'));
const date = new Date().toISOString().slice(0, 10);
const result: Literature = {
  ...existing,
  source:
    'OpenAlex CC0 metadata for the original three fields; primary arXiv metadata and bibliography entries for mechanistic interpretability.',
  fieldCollectedAt: { ...existing.fieldCollectedAt, mechinterp: date },
  fieldSources: {
    ...existing.fieldSources,
    mechinterp:
      'Primary arXiv metadata and bibliography entries; global citation counts unavailable.',
  },
  method:
    'Original fields: exact-title OpenAlex snowball collection. Mechanistic interpretability: eight curated arXiv papers, title-verified metadata, and citations verified against available full-text bibliography entries. Links record citations, not agreement; missing reference coverage is not evidence of no citations.',
  papers: [
    ...existing.papers.filter((paper) => paper.fieldId !== 'mechinterp'),
    ...papers.sort((a, b) => (b.year ?? 0) - (a.year ?? 0)),
  ],
};
writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
console.log(
  `${papers.length} interpretability papers; ${papers.reduce((count, paper) => count + paper.references.length, 0)} verified citation links.`,
);
