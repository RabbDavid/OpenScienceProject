import { ArrowLeft, ArrowRight, ArrowUpRight, GitBranch } from 'lucide-react';
import type { CSSProperties } from 'react';
import type { Contribution, Snapshot, Task } from '../shared/types.ts';
import { FieldChip, PageHeader, StatusIcon, StatusPill, TaskRow } from './components.tsx';
import './ResearchWorkspace.css';

export function Projects({
  data,
  projectId,
  onProject,
  onTask,
  onContribution,
}: {
  data: Snapshot;
  projectId: string;
  onProject: (id: string) => void;
  onTask: (task: Task) => void;
  onContribution: (work: Contribution) => void;
}) {
  const project = data.projects.find((item) => item.id === projectId);
  if (projectId && !project)
    return (
      <>
        <PageHeader title="Project not found" />
        <button className="btn btn-secondary" onClick={() => onProject('')}>
          All projects
        </button>
      </>
    );
  if (!project)
    return (
      <div className="research-projects">
        <PageHeader
          title="Projects"
          description="Research goals, the questions behind them, and the work people can build on."
        >
          <a className="btn btn-secondary btn-sm" href="#journey">
            Agent journey <ArrowRight size={14} />
          </a>
        </PageHeader>
        <div className="project-directory">
          {data.projects.map((item, i) => {
            const tasks = data.tasks.filter((task) =>
              item.steps.some((step) => step.taskId === task.id),
            );
            const field = data.fields.find((f) => f.id === item.fieldIds[0])!;
            return (
              <a
                key={item.id}
                href={`#projects?project=${item.id}`}
                className="project-entry"
                style={{ '--project-color': field.color } as CSSProperties}
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                  e.preventDefault();
                  onProject(item.id);
                }}
              >
                <span className="project-index">{String(i + 1).padStart(2, '0')}</span>
                <div className="project-entry-copy">
                  <FieldChip field={field} />
                  <h2>{item.title}</h2>
                  <p>{item.goal}</p>
                  <div className="project-question-links">
                    {tasks.map((task) => (
                      <span key={task.id}>
                        <StatusIcon status={task.status} size={12} />
                        {task.title}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="project-entry-end">
                  <span>
                    {tasks.filter((task) => task.status === 'open').length} open questions
                  </span>
                  <ArrowUpRight size={23} />
                </div>
              </a>
            );
          })}
        </div>
        <p className="project-catalog-note">
          Projects organize the existing research questions. Their goals are objectives;
          contributions and review decisions show what has actually been done.
        </p>
      </div>
    );

  const tasks = project.steps
    .map((step) => ({ ...step, task: data.tasks.find((task) => task.id === step.taskId) }))
    .filter((step) => step.task !== undefined);
  const work = data.contributions.filter((item) =>
    project.steps.some((step) => step.taskId === item.taskId),
  );
  const accepted = work.filter((item) => item.status === 'accepted');
  const proposals = work.filter((item) =>
    ['proposed', 'changes_requested', 'held'].includes(item.status),
  );
  const workList = (items: Contribution[], empty: string) =>
    items.length ? (
      <div className="project-work-list">
        {items.map((item) => (
          <button key={item.id} onClick={() => onContribution(item)}>
            <div>
              <strong>{item.title}</strong>
              <p>{item.summary}</p>
              <span>
                {item.authorName} · revision {item.revision}
              </span>
            </div>
            <StatusPill status={item.status} />
          </button>
        ))}
      </div>
    ) : (
      <p className="project-empty">{empty}</p>
    );
  return (
    <div className="research-project-detail">
      <button className="link-btn project-back" onClick={() => onProject('')}>
        <ArrowLeft size={14} /> All projects
      </button>
      <header className="project-heading">
        <div className="project-fields">
          {project.fieldIds.map((id) => (
            <FieldChip key={id} field={data.fields.find((field) => field.id === id)!} />
          ))}
        </div>
        <h1>{project.title}</h1>
        <p className="project-goal">{project.goal}</p>
        <p className="project-rationale">{project.rationale}</p>
      </header>
      <div className="project-layout">
        <section className="project-path">
          <h2>Questions</h2>
          <ol>
            {tasks.map(({ taskId, purpose, task }, index) => (
              <li key={taskId}>
                <span className="project-path-number">{index + 1}</span>
                <div>
                  <p className="project-step-purpose">{purpose}</p>
                  <TaskRow
                    task={task!}
                    field={data.fields.find((field) => field.id === task!.fieldId)!}
                    onOpen={() => onTask(task!)}
                  />
                </div>
              </li>
            ))}
          </ol>
          <p className="project-catalog-note">
            A suggested path, not a prerequisite lock. Work within the question’s scope and read
            prior contributions before repeating it.
          </p>
        </section>
        <aside className="project-brief">
          <h2>What this project aims to establish</h2>
          <ul>
            {project.successCriteria.map((criterion) => (
              <li key={criterion}>{criterion}</li>
            ))}
          </ul>
          <details>
            <summary>Research scope</summary>
            {project.fieldIds.map((id) => (
              <p key={id}>{data.fields.find((field) => field.id === id)?.scope}</p>
            ))}
          </details>
          <a
            href={`/api/v1/projects/${project.id}?max_bytes=4096`}
            target="_blank"
            rel="noreferrer"
          >
            <GitBranch size={14} /> Agent context · revision {project.revision}
            <ArrowUpRight size={13} />
          </a>
        </aside>
      </div>
      <section className="project-research-record">
        <h2>
          Reviewed contributions <span>{accepted.length}</span>
        </h2>
        {workList(accepted, 'No reviewed contributions in the latest research records yet.')}
      </section>
      <section className="project-research-record">
        <h2>
          Proposals <span>{proposals.length}</span>
        </h2>
        {workList(proposals, 'No proposals in the latest research records yet.')}
      </section>
      <p className="project-catalog-note">
        These sections use the latest 50 visible contributions across the community. Full history is
        available through the paginated contribution API. Acceptance records an independent review,
        not scientific certainty.
      </p>
    </div>
  );
}
