import type { ResearchProject } from './types.ts';

// Repository-curated directions around existing questions. No discoveries or activity are seeded.
// Membership is separate from persisted task definitions, revisions and work leases.
export const projects: ResearchProject[] = [
  {
    id: 'battery-evidence',
    revision: 1,
    title: 'Comparable battery evidence',
    fieldIds: ['batteries'],
    goal: 'Make public battery-lifetime evidence usable across studies without losing the conditions behind each result.',
    rationale:
      'A lifetime comparison is only useful when study definitions and operating conditions remain attached to the evidence.',
    successCriteria: [
      'A cited metadata checklist identifies when studies can and cannot be compared.',
      'A reviewed evidence map preserves study populations, lifetime definitions and missing information.',
    ],
    steps: [
      {
        taskId: 'battery-metadata-map',
        purpose: 'Establish the conditions a comparison must preserve.',
      },
      {
        taskId: 'battery-lifetime-evidence',
        purpose: 'Use those distinctions to map the evidence and its gaps.',
      },
    ],
  },
  {
    id: 'solar-data',
    revision: 1,
    title: 'Reusable solar data',
    fieldIds: ['solar'],
    goal: 'Make public solar observations easier to access and compare reproducibly.',
    rationale:
      'An analysis cannot be reused if its access route has disappeared or its time-series assumptions are undocumented.',
    successCriteria: [
      'An access map distinguishes documented replacement routes from actually tested endpoints.',
      'A comparison protocol makes missing metadata, time alignment and normalization explicit.',
    ],
    steps: [
      { taskId: 'pvdaq-access-audit', purpose: 'Find the documented path into the public data.' },
      {
        taskId: 'solar-comparison-checklist',
        purpose: 'Specify what a defensible comparison would require.',
      },
    ],
  },
  {
    id: 'materials-evaluation',
    revision: 1,
    title: 'Reliable materials prediction',
    fieldIds: ['materials'],
    goal: 'Understand when a materials-prediction score supports a useful comparison, and what further evidence practical use requires.',
    rationale:
      'Shared evaluation conditions and clearly stated limits help researchers decide what a benchmark result actually establishes.',
    successCriteria: [
      'A reproducibility checklist traces evaluation choices to the paper and implementation.',
      'A reviewed critique separates benchmark performance, generalization hypotheses and experimental validation.',
    ],
    steps: [
      {
        taskId: 'matbench-split-audit',
        purpose: 'Establish what must be fixed for a fair comparison.',
      },
      {
        taskId: 'matbench-limitations',
        purpose:
          'Identify what the comparison leaves unanswered and propose a falsifiable next step.',
      },
    ],
  },
  {
    id: 'model-circuit-evidence',
    revision: 1,
    title: 'Evidence for model circuits',
    fieldIds: ['mechinterp'],
    goal: 'Make claims about model features and circuits easier to inspect, challenge and reproduce.',
    rationale:
      'A descriptive interpretation and a causal explanation require different evidence; reproducible evaluation makes that distinction inspectable.',
    successCriteria: [
      'A source audit distinguishes feature descriptions, intervention evidence and untested generalization.',
      'A reproduction protocol fixes model, prompts, controls, metrics and an owner-approved compute budget.',
    ],
    steps: [
      {
        taskId: 'mechinterp-feature-evidence',
        purpose: 'Clarify what supports a feature interpretation and what remains untested.',
      },
      {
        taskId: 'mechinterp-ioi-reproduction',
        purpose: 'Specify the controls needed to reproduce a circuit study.',
      },
    ],
  },
];

export const projectForTask = (taskId: string) =>
  projects.find((project) => project.steps.some((step) => step.taskId === taskId));
