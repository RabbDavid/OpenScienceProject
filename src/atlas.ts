import type { SimulationLinkDatum, SimulationNodeDatum } from 'd3-force';
import type { Contribution, Field, Paper, Snapshot, Source, Task } from '../shared/types.ts';

export type DomainId = 'energy' | 'materials' | 'health' | 'mathematics' | 'climate' | 'methods';

export interface Domain {
  id: DomainId;
  name: string;
  /** Layout anchor in world units. Only a layout aid; distance carries no meaning. */
  anchor: [number, number];
}

export const DOMAINS: readonly Domain[] = [
  { id: 'energy', name: 'Energy', anchor: [0, 0] },
  { id: 'methods', name: 'Methods', anchor: [255, 175] },
  { id: 'materials', name: 'Materials', anchor: [235, -175] },
  { id: 'climate', name: 'Climate', anchor: [-250, -185] },
  { id: 'health', name: 'Health', anchor: [-285, 205] },
  { id: 'mathematics', name: 'Mathematics', anchor: [480, 10] },
];

/**
 * The wider map: areas of science where the commons has NOT opened a field.
 *
 * This is orientation only. These entries have no questions, sources,
 * contributions, agents or activity behind them, and the interface must always
 * present them as "Not open yet". Never attach records to them or describe them
 * as research in progress.
 */
export const WIDER_MAP: readonly {
  id: string;
  name: string;
  domain: DomainId;
  description?: string;
}[] = [
  { id: 'grid-storage', name: 'Grid-scale storage', domain: 'energy' },
  { id: 'solid-state-electrolytes', name: 'Solid-state electrolytes', domain: 'energy' },
  { id: 'battery-recycling', name: 'Battery recycling', domain: 'energy' },
  { id: 'wind-forecasting', name: 'Wind forecasting', domain: 'energy' },
  { id: 'heat-pumps', name: 'Heat pump performance', domain: 'energy' },
  { id: 'geothermal-data', name: 'Geothermal resource data', domain: 'energy' },
  { id: 'building-energy', name: 'Building energy use', domain: 'energy' },
  { id: 'catalysis', name: 'Catalysis', domain: 'materials' },
  { id: 'polymers', name: 'Polymers', domain: 'materials' },
  { id: 'perovskites', name: 'Perovskite stability', domain: 'materials' },
  { id: 'porous-frameworks', name: 'Porous frameworks', domain: 'materials' },
  { id: 'alloy-fatigue', name: 'Alloy fatigue', domain: 'materials' },
  { id: 'thermoelectrics', name: 'Thermoelectrics', domain: 'materials' },
  { id: 'materials-data-standards', name: 'Materials data standards', domain: 'materials' },
  { id: 'drug-repurposing', name: 'Drug repurposing literature', domain: 'health' },
  { id: 'amr-surveillance', name: 'Antimicrobial resistance surveillance', domain: 'health' },
  { id: 'rare-disease-literature', name: 'Rare disease literature', domain: 'health' },
  { id: 'air-quality-exposure', name: 'Air quality exposure data', domain: 'health' },
  { id: 'global-health-statistics', name: 'Global health statistics', domain: 'health' },
  { id: 'formal-proofs', name: 'Formal proofs', domain: 'mathematics' },
  { id: 'open-conjectures', name: 'Open conjectures', domain: 'mathematics' },
  { id: 'integer-sequences', name: 'Integer sequences', domain: 'mathematics' },
  { id: 'combinatorics', name: 'Combinatorics', domain: 'mathematics' },
  { id: 'graph-theory', name: 'Graph theory', domain: 'mathematics' },
  { id: 'numerical-methods', name: 'Numerical methods', domain: 'mathematics' },
  { id: 'emissions-data', name: 'Emissions data', domain: 'climate' },
  { id: 'crop-resilience', name: 'Crop resilience', domain: 'climate' },
  { id: 'sea-level-records', name: 'Sea-level records', domain: 'climate' },
  { id: 'wildfire-data', name: 'Wildfire data', domain: 'climate' },
  { id: 'ocean-observations', name: 'Ocean observations', domain: 'climate' },
  { id: 'biodiversity-records', name: 'Biodiversity records', domain: 'climate' },
  { id: 'statistics', name: 'Statistical practice', domain: 'methods' },
  { id: 'meta-analysis', name: 'Meta-analysis', domain: 'methods' },
  { id: 'preregistration', name: 'Preregistration audits', domain: 'methods' },
  { id: 'citation-integrity', name: 'Citation integrity', domain: 'methods' },
  { id: 'negative-results', name: 'Negative results', domain: 'methods' },
  { id: 'research-software', name: 'Research software', domain: 'methods' },
  { id: 'open-data-licensing', name: 'Open data licensing', domain: 'methods' },
];

export type NodeKind = 'domain' | 'future' | 'field' | 'paper' | 'task' | 'source' | 'contribution';
export type Layer = 'core' | 'questions' | 'sources' | 'literature' | 'contributions' | 'wider';
export type LinkKind =
  | 'domain-field'
  | 'domain-future'
  | 'field-task'
  | 'task-source'
  | 'contribution-task'
  | 'contribution-source'
  | 'paper-cites'
  | 'source-paper'
  | 'layout';

export interface AtlasNode extends SimulationNodeDatum {
  id: string;
  kind: NodeKind;
  label: string;
  domain: DomainId;
  /** Field colour for live records, empty for neutral and dim nodes. */
  color: string;
  /** Base radius in screen pixels at zoom 1. */
  r: number;
  layer: Layer;
  field?: Field;
  task?: Task;
  source?: Source;
  paper?: Paper;
  contribution?: Contribution;
  /** Domain hubs are part of the wider map when none of their fields are open. */
  live: boolean;
}

export interface AtlasLink extends SimulationLinkDatum<AtlasNode> {
  source: string | AtlasNode;
  target: string | AtlasNode;
  kind: LinkKind;
}

export const nodeId = {
  domain: (id: string) => `domain:${id}`,
  future: (id: string) => `future:${id}`,
  field: (id: string) => `field:${id}`,
  task: (id: string) => `task:${id}`,
  source: (id: string) => `source:${id}`,
  paper: (id: string) => `paper:${id}`,
  contribution: (id: string) => `contribution:${id}`,
};

export const domainOf = (field: Field): DomainId => {
  const head = field.path.split('/')[0];
  return (DOMAINS.find((d) => d.id === head)?.id ?? 'methods') as DomainId;
};

export const fieldIdOf = (node: AtlasNode) =>
  node.field?.id ??
  node.paper?.fieldId ??
  node.task?.fieldId ??
  node.source?.fieldId ??
  node.contribution?.fieldId;

/** Composition anchors organise fields; their distance has no scientific meaning. */
export const researchAnchor = (node: AtlasNode): [number, number] => {
  const field = fieldIdOf(node);
  if (field === 'batteries') return [-130, -170];
  if (field === 'solar') return [-130, 175];
  if (field === 'materials') return [295, -160];
  if (field === 'mechinterp') return [295, 185];
  return anchorOf(node.domain);
};

/** Contributions that belong on the map: rejected work is left in the review record only. */
export const mappedContribution = (c: Contribution) => c.status !== 'rejected';

export function buildAtlas(data: Snapshot) {
  const nodes: AtlasNode[] = [];
  const links: AtlasLink[] = [];
  const ids = new Set<string>();
  const add = (node: AtlasNode) => {
    if (ids.has(node.id)) return;
    ids.add(node.id);
    nodes.push(node);
  };
  const link = (source: string, target: string, kind: LinkKind) => {
    if (ids.has(source) && ids.has(target)) links.push({ source, target, kind });
  };

  const liveDomains = new Set(data.fields.map(domainOf));
  for (const domain of DOMAINS) {
    add({
      id: nodeId.domain(domain.id),
      kind: 'domain',
      label: domain.name,
      domain: domain.id,
      color: '',
      r: 2.5,
      layer: liveDomains.has(domain.id) ? 'core' : 'wider',
      live: liveDomains.has(domain.id),
    });
  }

  const liveKeys = new Set(data.fields.flatMap((f) => [f.id, f.path.split('/').at(-1) ?? '']));
  for (const area of WIDER_MAP) {
    if (liveKeys.has(area.id)) continue;
    add({
      id: nodeId.future(area.id),
      kind: 'future',
      label: area.name,
      domain: area.domain,
      color: '',
      r: 3.4,
      layer: 'wider',
      live: false,
    });
    link(nodeId.domain(area.domain), nodeId.future(area.id), 'domain-future');
  }

  for (const field of data.fields) {
    add({
      id: nodeId.field(field.id),
      kind: 'field',
      label: field.name,
      domain: domainOf(field),
      color: field.color,
      r: 10,
      layer: 'core',
      field,
      live: true,
    });
    link(nodeId.domain(domainOf(field)), nodeId.field(field.id), 'domain-field');
  }

  const fieldById = new Map(data.fields.map((f) => [f.id, f]));
  for (const source of data.sources) {
    const field = fieldById.get(source.fieldId);
    if (!field) continue;
    add({
      id: nodeId.source(source.id),
      kind: 'source',
      label: source.title,
      domain: domainOf(field),
      color: field.color,
      r: 4.6,
      layer: 'sources',
      source,
      live: true,
    });
  }

  // Published literature: sized by citations, linked by who cites whom.
  for (const paper of data.papers) {
    const field = fieldById.get(paper.fieldId);
    if (!field) continue;
    add({
      id: nodeId.paper(paper.id),
      kind: 'paper',
      label: paper.title,
      domain: domainOf(field),
      color: field.color,
      r: paper.citedBy === null ? 2.8 : 1.6 + Math.log10(paper.citedBy + 1) * 1.05,
      layer: 'literature',
      paper,
      live: true,
    });
    link(nodeId.field(field.id), nodeId.paper(paper.id), 'layout');
  }
  for (const paper of data.papers)
    for (const ref of paper.references)
      link(nodeId.paper(paper.id), nodeId.paper(ref), 'paper-cites');
  for (const source of data.sources) {
    const same = data.papers.find((p) => sameWork(source, p));
    if (same) link(nodeId.source(source.id), nodeId.paper(same.id), 'source-paper');
  }

  const referenced = new Set<string>();
  for (const task of data.tasks) {
    const field = fieldById.get(task.fieldId);
    if (!field) continue;
    add({
      id: nodeId.task(task.id),
      kind: 'task',
      label: task.title,
      domain: domainOf(field),
      color: field.color,
      r: 5.5,
      layer: 'questions',
      task,
      live: true,
    });
    link(nodeId.field(field.id), nodeId.task(task.id), 'field-task');
    for (const sourceId of task.sourceIds) {
      referenced.add(sourceId);
      link(nodeId.task(task.id), nodeId.source(sourceId), 'task-source');
    }
  }
  // Keep sources that no task references near their field without drawing a claimed relation.
  for (const source of data.sources)
    if (!referenced.has(source.id))
      link(nodeId.field(source.fieldId), nodeId.source(source.id), 'layout');

  for (const contribution of data.contributions.filter(mappedContribution)) {
    const field = fieldById.get(contribution.fieldId);
    if (!field) continue;
    add({
      id: nodeId.contribution(contribution.id),
      kind: 'contribution',
      label: contribution.title,
      domain: domainOf(field),
      color: field.color,
      r: contribution.status === 'accepted' ? 6.5 : 5.5,
      layer: 'contributions',
      contribution,
      live: true,
    });
    link(
      nodeId.contribution(contribution.id),
      nodeId.task(contribution.taskId),
      'contribution-task',
    );
    for (const sourceId of new Set(contribution.citations.map((c) => c.sourceId)))
      link(nodeId.contribution(contribution.id), nodeId.source(sourceId), 'contribution-source');
  }

  return { nodes, links };
}

/** A curated source and a collected paper are the same work when the source links to its DOI. */
export function sameWork(source: Source, paper: Paper) {
  const arxivId = paper.doi?.match(/arxiv\.(\d{4}\.\d{4,5})/i)?.[1];
  if (arxivId && source.url.includes(arxivId)) return true;
  const suffix = paper.doi?.replace(/^https:\/\/doi\.org\/[^/]+\//, '').toLowerCase();
  return !!suffix && suffix.length >= 8 && source.url.toLowerCase().includes(suffix);
}

/** A stable string that changes only when the graph's structure changes. */
export const structureKey = (nodes: AtlasNode[], links: AtlasLink[]) =>
  nodes.map((n) => n.id).join('|') +
  '#' +
  links.map((l) => `${endpoint(l.source)}>${endpoint(l.target)}`).join('|');

export const endpoint = (end: string | AtlasNode) => (typeof end === 'string' ? end : end.id);

export const anchorOf = (domain: DomainId) =>
  DOMAINS.find((d) => d.id === domain)?.anchor ?? ([0, 0] as [number, number]);

/** Deterministic pseudo-random number in [0, 1) derived from a string. */
export function hash01(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}
