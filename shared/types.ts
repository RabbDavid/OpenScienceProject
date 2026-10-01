export type FieldId = 'batteries' | 'solar' | 'materials' | 'mechinterp';
export type ContributionKind = 'source_audit' | 'synthesis' | 'replication' | 'critique';
export type ReviewStatus = 'proposed' | 'changes_requested' | 'held' | 'accepted' | 'rejected';
export type Role = 'contributor' | 'curator';

export interface Field {
  id: FieldId;
  name: string;
  shortName: string;
  path: string;
  color: string;
  description: string;
  benefit: string;
  scope: string;
  icon: 'battery' | 'sun' | 'flask' | 'brain';
}
export interface Source {
  id: string;
  fieldId: FieldId;
  title: string;
  authors: string;
  year: number | null;
  url: string;
  kind: 'paper' | 'dataset' | 'documentation' | 'code';
  summary: string;
  limitations: string;
  locator: string;
  checkedAt: string;
}
/** A published work in a field's citation network, collected from OpenAlex. Background reading,
 * not a task-approved citation source. */
export interface Paper {
  id: string;
  fieldId: FieldId;
  title: string;
  authors: string;
  year: number | null;
  venue: string | null;
  doi: string | null;
  url: string;
  openAccess: boolean;
  /** Global count, or null when the metadata source does not provide one. */
  citedBy: number | null;
  metadataSource?: string;
  referenceSource?: string;
  /** Hand-picked landmark, as opposed to found by following citations. */
  seed: boolean;
  /** IDs of papers in this collection that this paper cites. */
  references: string[];
}
export interface Literature {
  source: string;
  collectedAt: string;
  /** Collection dates for fields refreshed independently of the original catalogue. */
  fieldCollectedAt?: Partial<Record<FieldId, string>>;
  fieldSources?: Partial<Record<FieldId, string>>;
  method: string;
  papers: Paper[];
}
export interface Task {
  id: string;
  fieldId: FieldId;
  title: string;
  question: string;
  description: string;
  kind: ContributionKind;
  priority: number;
  effort: string;
  sourceIds: string[];
  acceptance: string[];
  exclusions: string[];
  skillIds: string[];
  status: 'open' | 'claimed' | 'completed';
  revision: number;
  leaseExpiresAt?: string;
  claimedBy?: string;
}
export interface Citation {
  sourceId: string;
  locator: string;
  supports: string;
}
export interface Contribution {
  id: string;
  taskId: string;
  fieldId: FieldId;
  title: string;
  kind: ContributionKind;
  summary: string;
  body: string;
  method: string;
  limitations: string;
  citations: Citation[];
  risk: 'low' | 'uncertain' | 'high';
  origin?: 'agent' | 'human' | 'human_with_ai' | 'unspecified';
  model?: string;
  authorId: string;
  authorName: string;
  status: ReviewStatus;
  revision: number;
  createdAt: string;
  updatedAt: string;
  contentHash: string;
  checks: { id: string; label: string; passed: boolean }[];
}
export interface Review {
  id: string;
  contributionId: string;
  revision: number;
  reviewerId: string;
  reviewerName: string;
  decision: 'accept' | 'request_changes' | 'reject';
  rationale: string;
  createdAt: string;
}
export interface Event {
  id: number;
  type: string;
  actorName: string;
  entityId: string;
  detail: string;
  createdAt: string;
}
export interface Snapshot {
  fields: Field[];
  sources: Source[];
  papers: Paper[];
  tasks: Task[];
  contributions: Contribution[];
  events: Event[];
  stats: { sources: number; openTasks: number; accepted: number; contributors: number };
}
export interface ContextPacket {
  protocol: string;
  task: Pick<Task, 'id' | 'title' | 'question' | 'acceptance' | 'exclusions' | 'revision'>;
  policy: string[];
  skills: { id: string; steps: string[] }[];
  sources: Pick<Source, 'id' | 'title' | 'url' | 'locator'>[];
  priorWork: Pick<Contribution, 'id' | 'title' | 'status' | 'revision'>[];
  next: {
    claim: string;
    submit: string;
    expand: string;
    relatedWork: string;
    skills: string;
    literature: string;
  };
  budget: {
    maxBytes: number;
    actualBytes: number;
    estimatedTokens: number;
    estimation: string;
    truncated: boolean;
  };
}
