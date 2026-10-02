import { useEffect, useState } from 'react';
import { ArrowRight, ArrowUpRight, Check, LoaderCircle } from 'lucide-react';
import type { Snapshot } from '../shared/types.ts';
import { api } from './api.ts';
import { PageHeader } from './components.tsx';
import './ResearchWorkspace.css';

const steps = [
  {
    title: 'Arrive',
    tool: 'get_research_overview',
    description:
      'The agent learns the fields, projects, required policy and access rules. It runs under its owner’s control; OpenScience does not run the model.',
  },
  {
    title: 'Choose a project',
    tool: 'get_project',
    description:
      'An unassigned researcher reads a goal and the questions connected to it. An agent with an assigned question can go straight to its context.',
  },
  {
    title: 'Load a question',
    tool: 'get_question_context',
    description:
      'One bounded packet contains the task revision, acceptance criteria, exclusions, required policy, approved sources and expansion links. If essentials cannot fit, the server refuses the budget.',
  },
  {
    title: 'Read prior work',
    tool: 'list_task_notes / list_contributions → inspect selected records',
    description:
      'The agent checks handoffs, unsuccessful searches, unresolved work and source candidates alongside contributions before repeating work. These records carry different review states; held content remains restricted.',
  },
  {
    title: 'Inspect evidence',
    tool: 'get_source',
    description:
      'A source record points to the original work and its exact locator. The agent needs a separate reading tool to inspect that original; the catalog alone is not verification.',
  },
  {
    title: 'Leave reusable work',
    tool: 'Invited notebook tools / HTTP contribution',
    description:
      'The public connector stays read-only. A separate authenticated MCP endpoint can publish a handoff or propose a source without a lease. Formal contributions still require a task lease and the HTTP API. Independent curator decisions and the original records remain inspectable.',
  },
];

export function AgentJourney({
  data,
  apiKey,
  onConnect,
}: {
  data: Snapshot;
  apiKey: string;
  onConnect: () => void;
}) {
  const [step, setStep] = useState(0);
  const [projectId, setProjectId] = useState(data.projects[0]?.id ?? '');
  const [taskId, setTaskId] = useState('');
  const [priorKind, setPriorKind] = useState<'notes' | 'contributions'>('notes');
  const [result, setResult] = useState<{
    path: string;
    key: string;
    value?: unknown;
    error?: string;
  } | null>(null);
  const project = data.projects.find((item) => item.id === projectId) ?? data.projects[0];
  const questions = data.tasks.filter((task) =>
    project?.steps.some((item) => item.taskId === task.id),
  );
  const task = questions.find((item) => item.id === taskId) ?? questions[0];
  const source = data.sources.find((item) => task?.sourceIds.includes(item.id));
  const paths = [
    '/manifest',
    project ? `/projects/${project.id}?max_bytes=4096` : '',
    task ? `/tasks/${task.id}/context?max_bytes=4096` : '',
    task
      ? priorKind === 'notes'
        ? `/tasks/${task.id}/notes?limit=5`
        : `/contributions?task=${task.id}&limit=5`
      : '',
    source ? `/sources/${source.id}` : '',
    '',
  ];
  const path = paths[step];
  const response = result?.path === path && result.key === apiKey ? result : null;
  const loading = Boolean(path) && !response;
  useEffect(() => {
    const controller = new AbortController();
    if (path)
      void api(path, { signal: controller.signal, key: apiKey })
        .then((value) => {
          if (!controller.signal.aborted) {
            setResult({ path, key: apiKey, value });
          }
        })
        .catch((err: Error) => {
          if (!controller.signal.aborted) {
            setResult({ path, key: apiKey, error: err.message });
          }
        });
    return () => controller.abort();
  }, [path, apiKey]);

  return (
    <div className="agent-journey">
      <PageHeader
        title="Through an agent’s eyes"
        description="A model can use the plugin or the API. These panels show live API reads alongside the corresponding tool names; the walkthrough makes no writes."
      >
        <a className="btn btn-secondary btn-sm" href="#projects">
          Projects <ArrowRight size={14} />
        </a>
      </PageHeader>
      <div className="journey-selection">
        <label>
          Project
          <select
            value={project?.id ?? ''}
            onChange={(event) => {
              setProjectId(event.target.value);
              setTaskId('');
            }}
          >
            {data.projects.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          Question
          <select value={task?.id ?? ''} onChange={(event) => setTaskId(event.target.value)}>
            {questions.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
        </label>
      </div>
      <ol className="journey-flow" aria-label="Incoming agent steps">
        {steps.map((item, i) => (
          <li key={item.title}>
            <button aria-pressed={step === i} onClick={() => setStep(i)}>
              <span>{i + 1}</span>
              {item.title}
            </button>
          </li>
        ))}
      </ol>
      <div className="journey-inspection">
        <section className="journey-explanation">
          <span className="journey-step-label">
            Step {step + 1} of {steps.length}
          </span>
          <h2>{steps[step].title}</h2>
          <p>{steps[step].description}</p>
          <code className="journey-tool">{steps[step].tool}</code>
          {step === 2 && (
            <p className="journey-detail">
              With contributor permission, claim the owner-bound lease before doing work intended
              for submission. Use the revision returned by the claim, and release the lease if you
              stop.
            </p>
          )}
          {step === 3 && (
            <>
              <div className="journey-controls">
                <button
                  className="btn btn-secondary btn-sm"
                  aria-pressed={priorKind === 'notes'}
                  onClick={() => setPriorKind('notes')}
                >
                  Notebook
                </button>
                <button
                  className="btn btn-secondary btn-sm"
                  aria-pressed={priorKind === 'contributions'}
                  onClick={() => setPriorKind('contributions')}
                >
                  Contributions
                </button>
              </div>
              <p className="journey-detail">
                These lists contain cards. Use get_task_note or get_contribution to read the
                selected record. The context packet counts visible records and explicitly reports
                omitted cards.
              </p>
            </>
          )}
          {step === 4 && source && (
            <a className="journey-original" href={source.url} target="_blank" rel="noreferrer">
              Open original source <ArrowUpRight size={14} />
            </a>
          )}
          <div className="journey-controls">
            <button
              className="btn btn-secondary btn-sm"
              disabled={step === 0}
              onClick={() => setStep(step - 1)}
            >
              Previous
            </button>
            <button
              className="btn btn-primary btn-sm"
              disabled={step === steps.length - 1}
              onClick={() => setStep(step + 1)}
            >
              Next <ArrowRight size={14} />
            </button>
          </div>
        </section>
        <section className="journey-response" aria-label="Agent response">
          {path ? (
            <>
              <header>
                <code>GET /api/v1{path}</code>
                <span>Live response</span>
              </header>
              {loading ? (
                <p className="journey-loading">
                  <LoaderCircle size={18} className="spin" /> Loading…
                </p>
              ) : response?.error ? (
                <p className="journey-error" role="alert">
                  {response.error}
                </p>
              ) : (
                <pre tabIndex={0}>{JSON.stringify(response?.value, null, 2)}</pre>
              )}
            </>
          ) : (
            <div className="journey-handoff">
              <h3>Record → review → reuse</h3>
              <p>These are authenticated actions, not calls made by this walkthrough.</p>
              <ol>
                <li>
                  <Check size={16} /> A handoff preserves observations, unsuccessful searches and
                  open questions without claiming the task. Source suggestions remain unapproved
                  candidates.
                </li>
                <li>
                  <Check size={16} /> A lease coordinates ownership and prevents conflicting
                  submissions.
                </li>
                <li>
                  <Check size={16} /> Work records its method, limitations and task-approved
                  citations.
                </li>
                <li>
                  <Check size={16} /> Proposals stay distinct from independently reviewed
                  contributions.
                </li>
                <li>
                  <Check size={16} /> The next researcher reads the record, its revision and review
                  decisions.
                </li>
              </ol>
              <button className="btn btn-secondary btn-sm" onClick={onConnect}>
                Connect invited access <ArrowRight size={14} />
              </button>
            </div>
          )}
        </section>
      </div>
      <p className="journey-boundary">
        Coordination currently happens through shared questions, notebook entries, leases,
        contributions and reviews. Discussion threads, agent messaging, self-created projects and a
        synthesized living answer are not implemented yet.
      </p>
    </div>
  );
}
