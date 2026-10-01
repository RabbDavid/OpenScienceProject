/**
 * Builds server/literature.json: a real citation network for each open field, from OpenAlex.
 *
 * Method (a standard "snowball" literature map):
 *   1. Resolve hand-picked landmark papers ("seeds") by title, and keep only exact title matches.
 *   2. Gather their references and their most-cited citing works as candidates.
 *   3. Keep candidates whose titles are on-topic (and outside the field's exclusions), ranked by
 *      how many seeds they connect to, then by citation count.
 *   4. Record every citation between the selected papers. These become the map's edges.
 *
 * Run: npm run literature, or npm run literature -- --field=mechinterp to refresh one field.
 * OpenAlex quotas may change. Requests fail explicitly when access or quota is unavailable.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import type { FieldId, Literature, Paper } from '../shared/types.ts';

const API = 'https://api.openalex.org';
const PER_FIELD = 34; // snowballed papers per field, in addition to seeds

interface FieldPlan {
  seeds: string[];
  topic: RegExp;
  exclude: RegExp;
}

const plans: Record<FieldId, FieldPlan> = {
  batteries: {
    seeds: [
      'Data-driven prediction of battery cycle life before capacity degradation',
      'Closed-loop optimization of fast-charging protocols for batteries with machine learning',
      'Degradation of Commercial Lithium-Ion Cells as a Function of Chemistry and Cycling Conditions',
      'A Wide Range of Testing Results on an Excellent Lithium-Ion Cell Chemistry to be used as Benchmarks for New Battery Technologies',
      'Degradation diagnostics for lithium ion cells',
      'Ageing mechanisms in lithium-ion batteries',
      'Lithium ion battery degradation: what you need to know',
      'Machine learning pipeline for battery state-of-health estimation',
      'Statistical learning for accurate and interpretable battery lifetime prediction',
      'Battery Lifetime Prognostics',
    ],
    topic:
      /batter|lithium|li-ion|\bcells?\b|electrode|cathode|anode|graphite|electrolyte|capacity fade|state.of.health|ageing|aging|cycle life|charging/i,
    exclude: /thermal runaway|abuse|explos|fire|nail penetration|overcharg|short.circuit/i,
  },
  solar: {
    seeds: [
      'Photovoltaic Degradation Rates—an Analytical Review',
      'Compendium of photovoltaic degradation rates',
      'pvlib python: a python package for modeling solar energy systems',
      'The National Solar Radiation Data Base (NSRDB)',
      'Robust PV Degradation Methodology and Application',
      'Photovoltaic failure and degradation modes',
      'Performance Parameters for Grid-Connected PV Systems',
      'Review of photovoltaic power forecasting',
    ],
    topic: /photovolta|\bpv\b|solar|irradiance|insolation|module|inverter/i,
    // Cell chemistry (perovskites) is a separate, not-yet-open area; economics is out of scope.
    exclude:
      /perovskite|ch ?3 ?nh|redox|microgrid|lcoe|economic|environmental impact|pumping|hydrogen|cyber|vulnerab/i,
  },
  materials: {
    seeds: [
      'Benchmarking materials property prediction methods: the Matbench test set and Automatminer reference algorithm',
      'Commentary: The Materials Project: A materials genome approach to accelerating materials innovation',
      'Crystal Graph Convolutional Neural Networks for an Accurate and Interpretable Prediction of Material Properties',
      'Graph Networks as a Universal Machine Learning Framework for Molecules and Crystals',
      'Atomistic Line Graph Neural Network for improved materials property predictions',
      'A critical examination of compound stability predictions from machine-learned formation energies',
      'Matminer: An open source toolkit for materials data mining',
      'Machine learning for molecular and materials science',
      'Leakage and the reproducibility crisis in machine-learning-based science',
      'A framework to evaluate machine learning crystal stability predictions',
    ],
    topic:
      /material|crystal|benchmark|reproduc|replicat|machine.learning|neural|graph network|dataset|leakage|formation energ|stability|property prediction|interatomic|density functional|\bdft\b/i,
    exclude: /explosive|energetic material|toxic|weapon|warfare/i,
  },
  mechinterp: {
    seeds: [
      'Toy Models of Superposition',
      'Interpretability in the Wild: a Circuit for Indirect Object Identification in GPT-2 small',
      'Sparse Autoencoders Find Highly Interpretable Features in Language Models',
      'Towards Best Practices of Activation Patching in Language Models: Metrics and Methods',
      'Towards Automated Circuit Discovery for Mechanistic Interpretability',
      'Progress measures for grokking via mechanistic interpretability',
    ],
    topic:
      /mechanistic|interpretab|circuit|superposition|sparse.autoencoder|activation.patch|induction.head|grokking/i,
    exclude: /jailbreak|backdoor|exploit|weapon|malware|offensive|attack/i,
  },
};

interface Work {
  id: string;
  doi: string | null;
  title: string | null;
  publication_year: number | null;
  cited_by_count: number;
  type?: string;
  authorships?: { author: { display_name: string } }[];
  primary_location?: {
    source?: { display_name?: string } | null;
    landing_page_url?: string | null;
  };
  open_access?: { is_oa: boolean; oa_url: string | null };
  referenced_works?: string[];
}

const FULL =
  'id,doi,title,publication_year,cited_by_count,type,authorships,primary_location,open_access,referenced_works';
const BRIEF = 'id,title,publication_year,cited_by_count,type';
// Known arXiv DOIs permit exact single-work lookup without a paid title search.
const seedDois: Record<string, string> = {
  'Toy Models of Superposition': '10.48550/arXiv.2209.10652',
  'Interpretability in the Wild: a Circuit for Indirect Object Identification in GPT-2 small':
    '10.48550/arXiv.2211.00593',
  'Sparse Autoencoders Find Highly Interpretable Features in Language Models':
    '10.48550/arXiv.2309.08600',
  'Towards Best Practices of Activation Patching in Language Models: Metrics and Methods':
    '10.48550/arXiv.2309.16042',
  'Towards Automated Circuit Discovery for Mechanistic Interpretability':
    '10.48550/arXiv.2304.14997',
  'Progress measures for grokking via mechanistic interpretability': '10.48550/arXiv.2301.05217',
};
let requests = 0;

async function get<T>(path: string): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    requests++;
    const key = process.env.OPENALEX_API_KEY;
    const response = await fetch(`${API}${path}${key ? `&api_key=${key}` : ''}`);
    if (response.ok) return (await response.json()) as T;
    if (attempt >= 3 || ![429, 500, 502, 503].includes(response.status))
      throw new Error(`OpenAlex ${response.status} for ${path}`);
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
  }
}
const short = (id: string) => id.replace('https://openalex.org/', '');
const norm = (t: string) =>
  t
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

async function batch(ids: string[], select: string): Promise<Work[]> {
  const out: Work[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50).map(short);
    const page = await get<{ results: Work[] }>(
      `/works?filter=openalex:${chunk.join('|')}&per-page=50&select=${select}`,
    );
    out.push(...page.results);
  }
  return out;
}

async function resolveSeed(title: string): Promise<Work | null> {
  if (seedDois[title]) {
    const work = await get<Work>(`/works/https://doi.org/${seedDois[title]}?select=${FULL}`);
    return work.title && norm(work.title) === norm(title) ? work : null;
  }
  const query = encodeURIComponent(norm(title));
  const page = await get<{ results: Work[] }>(
    `/works?filter=title.search:${query}&sort=cited_by_count:desc&per-page=5&select=${FULL}`,
  );
  return page.results.find((w) => w.title && norm(w.title) === norm(title)) ?? null;
}

const authorsOf = (w: Work) => {
  const names = (w.authorships ?? []).map((a) => a.author.display_name.split(' ').at(-1)!);
  return names.length > 3 ? `${names.slice(0, 3).join(', ')}, et al.` : names.join(', ');
};

async function main() {
  const fieldOption = process.argv
    .slice(2)
    .find((arg) => arg.startsWith('--field='))
    ?.slice(8);
  if (fieldOption && !(fieldOption in plans)) throw new Error(`Unknown field: ${fieldOption}`);
  const selectedField = fieldOption as FieldId | undefined;
  const output = new URL('../server/literature.json', import.meta.url);
  const existing: Literature | undefined = selectedField
    ? JSON.parse(readFileSync(output, 'utf8'))
    : undefined;
  const retained = existing?.papers.filter((paper) => paper.fieldId !== selectedField) ?? [];
  const retainedIds = new Set(retained.map((paper) => `https://openalex.org/${paper.id}`));
  const chosen = new Map<string, { work: Work; fieldId: FieldId; seed: boolean }>();
  const unresolved: string[] = [];

  for (const [fieldId, plan] of Object.entries(plans) as [FieldId, FieldPlan][]) {
    if (selectedField && fieldId !== selectedField) continue;
    const seeds: Work[] = [];
    for (const title of plan.seeds) {
      const work = await resolveSeed(title);
      if (work && !retainedIds.has(work.id)) seeds.push(work);
      else unresolved.push(`${fieldId}: ${title}`);
    }
    const seedIds = new Set(seeds.map((s) => s.id));
    const links = new Map<string, number>();
    const bump = (id: string) => !seedIds.has(id) && links.set(id, (links.get(id) ?? 0) + 1);
    for (const seed of seeds) {
      seed.referenced_works?.forEach(bump);
      const citing = await get<{ results: Work[] }>(
        `/works?filter=cites:${short(seed.id)}&sort=cited_by_count:desc&per-page=25&select=${BRIEF}`,
      );
      citing.results.forEach((w) => bump(w.id));
    }
    const candidates = (await batch([...links.keys()], BRIEF)).filter(
      (w) =>
        w.title &&
        plan.topic.test(w.title) &&
        !plan.exclude.test(w.title) &&
        !chosen.has(w.id) &&
        !retainedIds.has(w.id) &&
        ['article', 'review', 'preprint', 'book-chapter'].includes(w.type ?? 'article'),
    );
    candidates.sort(
      (a, b) =>
        (links.get(b.id) ?? 0) - (links.get(a.id) ?? 0) || b.cited_by_count - a.cited_by_count,
    );
    for (const seed of seeds)
      if (!plan.exclude.test(seed.title!)) chosen.set(seed.id, { work: seed, fieldId, seed: true });
    const picked = await batch(
      candidates.slice(0, PER_FIELD).map((w) => w.id),
      FULL,
    );
    for (const work of picked) chosen.set(work.id, { work, fieldId, seed: false });
    console.log(`${fieldId}: ${seeds.length} seeds, ${picked.length} snowballed`);
  }

  if (!chosen.size) throw new Error('No papers resolved; the existing catalogue was not changed.');
  const ids = new Set([...chosen.keys()].map(short).concat(retained.map((paper) => paper.id)));
  const papers: Paper[] = [...chosen.values()]
    .map<Paper>(({ work, fieldId, seed }) => ({
      id: short(work.id),
      fieldId,
      title: work.title!.replace(/<[^>]+>/g, ''),
      authors: authorsOf(work),
      year: work.publication_year,
      venue: work.primary_location?.source?.display_name ?? null,
      doi: work.doi,
      url:
        work.open_access?.oa_url ??
        work.doi ??
        work.primary_location?.landing_page_url ??
        `https://openalex.org/${short(work.id)}`,
      openAccess: work.open_access?.is_oa ?? false,
      citedBy: work.cited_by_count,
      seed,
      references: (work.referenced_works ?? [])
        .map(short)
        .filter((r) => ids.has(r))
        .sort(),
    }))
    .concat(
      retained.map((paper) => ({
        ...paper,
        references: paper.references.filter((id) => ids.has(id)),
      })),
    )
    .sort((a, b) => a.fieldId.localeCompare(b.fieldId) || (b.citedBy ?? -1) - (a.citedBy ?? -1));

  const literature: Literature = {
    source:
      selectedField && existing ? existing.source : 'OpenAlex (https://openalex.org), CC0 metadata',
    collectedAt:
      selectedField && existing ? existing.collectedAt : new Date().toISOString().slice(0, 10),
    ...(selectedField && {
      fieldCollectedAt: {
        ...existing?.fieldCollectedAt,
        [selectedField]: new Date().toISOString().slice(0, 10),
      },
      fieldSources: {
        ...existing?.fieldSources,
        [selectedField]: 'OpenAlex (https://openalex.org), CC0 metadata',
      },
    }),
    method:
      selectedField && existing
        ? existing.method
        : 'Landmark papers per field, resolved by exact title or known DOI, expanded through their references and most-cited citing works; on-topic titles only; edges are citations between included papers.',
    papers,
  };
  writeFileSync(output, `${JSON.stringify(literature, null, 2)}\n`);
  const edges = papers.reduce((n, p) => n + p.references.length, 0);
  console.log(`${papers.length} papers, ${edges} citation links, ${requests} requests.`);
  if (unresolved.length) console.log(`Unresolved seeds:\n  ${unresolved.join('\n  ')}`);
}

await main();
