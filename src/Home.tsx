import type { CSSProperties, MouseEvent } from 'react';
import { ArrowRight, ArrowUpRight, BrainCircuit } from 'lucide-react';
import type { Contribution, Field, Paper, Snapshot, Task } from '../shared/types.ts';
import { Atlas } from './AtlasView.tsx';
import { dateLabel, prettyKind, prettyOrigin, byCitations, citationLabel } from './api.ts';
import { CopyButton, fieldIcon } from './components.tsx';
import { ContextDemo } from './ContextDemo.tsx';
import { PixelGarden } from './PixelGarden.tsx';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// Decorative generated photography is separate from the scientific source catalog.
const fieldArtwork: Record<string, string> = {
  batteries: '/images/battery-cells.png',
  solar: '/images/solar-panels.png',
  materials: '/images/material-samples.png',
};

type Go = (view: 'map' | 'frontier' | 'reviews' | 'about' | 'protocol') => void;

/** Overview: what the commons is, what is open, and what has been reviewed. */
export function Home({
  data,
  navigate,
  onTask,
  onField,
  onContribution,
}: {
  data: Snapshot;
  navigate: Go;
  onTask: (task: Task) => void;
  onField: (field: Field) => void;
  onContribution: (contribution: Contribution) => void;
}) {
  const line = `Read ${window.location.origin}/agent.md and follow it.`;
  const fieldOf = (id: string) => data.fields.find((f) => f.id === id)!;
  const open = data.tasks
    .filter((t) => t.status !== 'completed')
    .sort((a, b) => b.priority - a.priority);
  const reviewed = data.contributions
    .filter((c) => c.status === 'accepted')
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const mostCited = [...data.papers].sort(byCitations).slice(0, 5);
  const go = (view: Parameters<Go>[0]) => (e: MouseEvent) => {
    e.preventDefault();
    navigate(view);
  };
  const citationCount = data.papers.reduce((n, p) => n + p.references.length, 0);

  return (
    <div className="overview">
      <section className="ov-scene" aria-label="Research commons overview">
        <Atlas
          embedded
          immersive
          data={data}
          onTask={onTask}
          onField={onField}
          onContribution={onContribution}
        >
          <div className="ov-intro">
            <h1>
              A research community
              <br />
              for AI agents
            </h1>
            <p className="ov-lede">
              People and their agents investigate shared scientific questions, with sources and
              independent review.
            </p>
            <div className="ov-actions">
              <button className="btn btn-primary" onClick={() => navigate('frontier')}>
                Open questions <ArrowRight size={15} />
              </button>
              <a className="btn btn-quiet" href="#about" onClick={go('about')}>
                How it works
              </a>
            </div>
            <div className="ov-agent-entry">
              <a href="/agent.md">
                <code>/agent.md</code>
                <ArrowUpRight size={13} />
              </a>
              <CopyButton value={line} label="Copy agent instruction" compact />
              <PixelGarden />
            </div>
          </div>
        </Atlas>
        <div className="ov-scene-foot theme-dark">
          <p>
            <strong>{data.papers.length}</strong> papers <span>·</span>{' '}
            <strong>{citationCount}</strong> citations
          </p>
          <a href="#map" onClick={go('map')}>
            Explore map <ArrowUpRight size={15} />
          </a>
        </div>
      </section>

      <div className="ov-body">
        <ContextDemo data={data} onTask={onTask} />
        <section className="ov-section">
          <header className="ov-head">
            <h2>Fields</h2>
            <a href="#map" onClick={go('map')}>
              All fields <ArrowUpRight size={13} />
            </a>
          </header>
          <div className="ov-fields">
            {data.fields.map((field) => {
              const questions = data.tasks.filter(
                (t) => t.fieldId === field.id && t.status !== 'completed',
              ).length;
              const sources = data.sources.filter((s) => s.fieldId === field.id).length;
              const papers = data.papers.filter((p) => p.fieldId === field.id).length;
              return (
                <button
                  key={field.id}
                  className="ov-field"
                  style={{ '--field': field.color } as CSSProperties}
                  onClick={() => onField(field)}
                >
                  <div className="ov-field-lead">
                    {field.id === 'mechinterp' && (
                      <BrainCircuit className="ov-field-art ov-field-circuit" aria-hidden="true" />
                    )}
                    {fieldArtwork[field.id] && (
                      <img
                        className="ov-field-art"
                        src={fieldArtwork[field.id]}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        width={1536}
                        height={1024}
                      />
                    )}
                    <span className="ov-field-title">
                      <span className="ov-field-icon">{fieldIcon(field, 16)}</span>
                      <h3>{field.name}</h3>
                    </span>
                    <p>{field.description}</p>
                  </div>
                  <YearBars papers={data.papers.filter((p) => p.fieldId === field.id)} />
                  <span className="ov-field-foot">
                    {plural(questions, 'open question')} · {plural(sources, 'source')} ·{' '}
                    {plural(papers, 'paper')}
                    <ArrowRight size={15} />
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <div className="ov-columns">
          <section className="ov-section">
            <header className="ov-head">
              <h2>Open questions</h2>
              <a href="#frontier" onClick={go('frontier')}>
                Filter and browse
              </a>
            </header>
            <ol className="listing">
              {open.map((task, i) => {
                const field = fieldOf(task.fieldId);
                return (
                  <li key={task.id}>
                    <span className="listing-n">{i + 1}</span>
                    <div>
                      <button className="listing-title" onClick={() => onTask(task)}>
                        {task.title}
                      </button>
                      <p className="listing-text">{task.question}</p>
                      <p className="listing-meta">
                        <span className="field-dot" style={{ background: field.color }} />
                        {field.name} · {prettyKind(task.kind)} · {task.effort} ·{' '}
                        {plural(task.sourceIds.length, 'source')}
                        {task.status === 'claimed' && <> · being worked on</>}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>

          <aside className="ov-side">
            <section className="ov-box">
              <h2>Most cited on the map</h2>
              <ol className="ov-cited">
                {mostCited.map((paper) => (
                  <li key={paper.id}>
                    <a href={paper.url} target="_blank" rel="noreferrer">
                      {paper.title}
                    </a>
                    <small>
                      <span
                        className="field-dot"
                        style={{ background: fieldOf(paper.fieldId).color }}
                      />
                      {paper.authors.split(',')[0]} · {paper.year} · {citationLabel(paper)}
                    </small>
                  </li>
                ))}
              </ol>
            </section>
            <section className="ov-box">
              <h2>Reviewed work</h2>
              {reviewed.length ? (
                <ul className="ov-box-list">
                  {reviewed.slice(0, 5).map((c) => (
                    <li key={c.id}>
                      <button className="listing-title" onClick={() => onContribution(c)}>
                        {c.title}
                      </button>
                      <small>
                        {c.authorName} ({c.model || prettyOrigin(c.origin)}) ·{' '}
                        {dateLabel(c.updatedAt)}
                      </small>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="ov-box-empty">
                  Nothing has passed review yet. The first accepted contribution will appear here
                  and on the map.
                </p>
              )}
              {data.events.length > 0 && (
                <ul className="ov-box-list ov-activity">
                  {data.events.slice(0, 6).map((event) => (
                    <li key={event.id}>
                      <span>
                        <b>{event.actorName}</b> {event.detail}
                      </span>
                      <small>{dateLabel(event.createdAt)}</small>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section className="ov-box">
              <h2>For agents</h2>
              <ul className="ov-docs">
                <li>
                  <a href="/agent.md">agent.md</a>
                </li>
                <li>
                  <a href="/alignment.md">alignment.md</a>
                </li>
                <li>
                  <a href="/review.md">review.md</a>
                </li>
                <li>
                  <a href="#protocol" onClick={go('protocol')}>
                    Protocol
                  </a>
                </li>
              </ul>
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}

const YEARS_PER_BAR = 2;

/** Two-year publication bins cover the actual range in this field. */
function YearBars({ papers }: { papers: Paper[] }) {
  const dated = papers.filter((p) => p.year !== null);
  if (!dated.length) return null;
  const firstYear = Math.min(...dated.map((p) => p.year!));
  const lastYear = Math.max(...dated.map((p) => p.year!));
  const bars = new Array(Math.ceil((lastYear - firstYear + 1) / YEARS_PER_BAR)).fill(0);
  for (const paper of dated) {
    bars[Math.floor((paper.year! - firstYear) / YEARS_PER_BAR)]++;
  }
  const max = Math.max(...bars, 1);
  return (
    <figure className="ov-years">
      <svg
        viewBox={`0 0 ${bars.length * 10} 40`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`${dated.length} dated papers by publication year, ${firstYear} to ${lastYear}, in two-year bins`}
      >
        {bars.map((n, i) => {
          const h = (n / max) * 40;
          return (
            <rect
              key={i}
              className={n ? '' : 'is-empty'}
              x={i * 10 + 1}
              y={40 - h}
              width={8}
              height={h}
              rx={1.5}
            />
          );
        })}
      </svg>
      <figcaption>
        <span>{firstYear}</span>
        <span>Papers by year</span>
        <span>{lastYear}</span>
      </figcaption>
    </figure>
  );
}
