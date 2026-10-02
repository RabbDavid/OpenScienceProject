import { useState, type CSSProperties } from 'react';
import { ArrowRight, ArrowUpRight, BookOpen, Search } from 'lucide-react';
import type { Snapshot, Task } from '../shared/types.ts';
import { byCitations, citationLabel, prettyKind } from './api.ts';
import { sameWork } from './atlas.ts';
import { Empty, StatusIcon, fieldIcon } from './components.tsx';
import './Frontier.css';

export function Frontier({
  data,
  fieldId,
  search,
  onSearch,
  onField,
  onTask,
}: {
  data: Snapshot;
  fieldId: string;
  search: string;
  onSearch: (value: string) => void;
  onField: (id: string) => void;
  onTask: (task: Task) => void;
}) {
  const [status, setStatus] = useState('all');
  const [kind, setKind] = useState('all');
  const [sort, setSort] = useState('priority');
  const [readingId, setReadingId] = useState('');
  const field = data.fields.find((item) => item.id === fieldId);
  const scoped = data.tasks.filter(
    (task) =>
      (fieldId === 'all' || task.fieldId === fieldId) &&
      (kind === 'all' || task.kind === kind) &&
      `${task.title} ${task.question}`.toLowerCase().includes(search.trim().toLowerCase()),
  );
  const tasks = scoped
    .filter((task) => status === 'all' || task.status === status)
    .sort((a, b) => (sort === 'title' ? a.title.localeCompare(b.title) : b.priority - a.priority));
  const reading = tasks.find((task) => task.id === readingId) ?? tasks[0];
  const readingField = data.fields.find((item) => item.id === reading?.fieldId);
  const sources = reading
    ? data.sources.filter((source) => reading.sourceIds.includes(source.id))
    : [];
  const linkedPapers = data.papers.filter((paper) =>
    sources.some((source) => sameWork(source, paper)),
  );
  const background = [...data.papers]
    .filter(
      (paper) =>
        paper.fieldId === reading?.fieldId && !linkedPapers.some((item) => item.id === paper.id),
    )
    .sort((a, b) => Number(b.seed) - Number(a.seed) || byCitations(a, b))
    .slice(0, 3);
  const selectedPapers = data.papers.filter((paper) => !field || paper.fieldId === field.id);

  function chooseField(id: string) {
    setStatus('all');
    setReadingId('');
    onField(id);
  }

  return (
    <div className="frontier-workspace">
      <header
        className="frontier-heading"
        style={{ '--field': field?.color ?? 'var(--accent)' } as CSSProperties}
      >
        <div>
          {field && (
            <span className="frontier-field-symbol" aria-hidden="true">
              {fieldIcon(field, 25)}
            </span>
          )}
          <h1>{field?.name ?? 'Open questions'}</h1>
          {field && <p>{field.description}</p>}
        </div>
        <div className="frontier-counts">
          <span>
            <strong>
              {
                data.tasks.filter(
                  (task) => (!field || task.fieldId === field.id) && task.status === 'open',
                ).length
              }
            </strong>{' '}
            open questions
          </span>
          <span>
            <strong>{selectedPapers.length}</strong> published papers
          </span>
        </div>
      </header>

      <nav className="frontier-fields" aria-label="Research fields">
        <button aria-pressed={fieldId === 'all'} onClick={() => chooseField('all')}>
          All fields
        </button>
        {data.fields.map((item) => (
          <button
            key={item.id}
            aria-pressed={fieldId === item.id}
            onClick={() => chooseField(item.id)}
          >
            <i style={{ background: item.color }} />
            {item.shortName}
          </button>
        ))}
      </nav>

      {field && (
        <details className="frontier-scope">
          <summary>
            Research scope <code>{field.path}</code>
          </summary>
          <p>{field.benefit}</p>
          <p>{field.scope}</p>
        </details>
      )}

      <div className="frontier-tools">
        <label className="search-input">
          <Search size={14} />
          <input
            aria-label="Search research tasks"
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder="Search questions…"
          />
        </label>
        <select
          aria-label="Filter task type"
          value={kind}
          onChange={(event) => setKind(event.target.value)}
        >
          <option value="all">All types</option>
          <option value="source_audit">Source audits</option>
          <option value="synthesis">Syntheses</option>
          <option value="critique">Critiques</option>
          <option value="replication">Reproductions</option>
        </select>
        <select
          aria-label="Sort tasks"
          value={sort}
          onChange={(event) => setSort(event.target.value)}
        >
          <option value="priority">Priority first</option>
          <option value="title">Title A–Z</option>
        </select>
      </div>

      <div className="frontier-desk">
        <section className="frontier-questions" aria-label="Research questions">
          <div className="frontier-status" role="group" aria-label="Filter task status">
            {['all', 'open', 'claimed', 'completed'].map((value) => (
              <button key={value} aria-pressed={status === value} onClick={() => setStatus(value)}>
                {value[0].toUpperCase() + value.slice(1)}
                <span>
                  {value === 'all'
                    ? scoped.length
                    : scoped.filter((task) => task.status === value).length}
                </span>
              </button>
            ))}
          </div>
          {tasks.map((task, index) => {
            const taskField = data.fields.find((item) => item.id === task.fieldId)!;
            return (
              <article
                key={task.id}
                className={`frontier-question ${task.id === reading?.id ? 'is-reading' : ''}`}
                style={{ '--field': taskField.color } as CSSProperties}
              >
                <span className="frontier-question-number">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <div>
                  <div className="frontier-question-meta">
                    <i style={{ background: taskField.color }} />
                    {taskField.shortName}
                    <span>·</span>
                    {prettyKind(task.kind)}
                    <span>·</span>
                    {task.effort}
                  </div>
                  <button className="frontier-question-title" onClick={() => onTask(task)}>
                    {task.title}
                    <ArrowUpRight size={17} />
                  </button>
                  <p>{task.question}</p>
                  <div className="frontier-question-actions">
                    <button
                      aria-pressed={task.id === reading?.id}
                      onClick={() => setReadingId(task.id)}
                    >
                      <BookOpen size={13} />
                      {task.sourceIds.length} sources
                    </button>
                    <span>
                      <StatusIcon status={task.status} size={12} />
                      {task.status}
                    </span>
                  </div>
                </div>
              </article>
            );
          })}
          {!tasks.length && (
            <Empty title="No questions match these filters.">
              <button
                className="link-btn"
                onClick={() => {
                  onSearch('');
                  setKind('all');
                  setStatus('all');
                }}
              >
                Clear filters
              </button>
            </Empty>
          )}
          <p className="frontier-priority-note">
            Priority is curator judgment about useful starting work, not a measured impact score.
          </p>
        </section>

        {reading && (
          <aside
            className="frontier-reading"
            aria-label="Reading desk"
            style={{ '--field': readingField?.color ?? 'var(--accent)' } as CSSProperties}
          >
            <header>
              <BookOpen size={16} />
              <h2>Reading desk</h2>
            </header>
            <p className="frontier-reading-question">{reading.title}</p>
            <h3>Approved for this question</h3>
            <ul className="frontier-source-list">
              {sources.map((source) => (
                <li key={source.id}>
                  <a href={source.url} target="_blank" rel="noreferrer">
                    {source.title}
                    <ArrowUpRight size={12} />
                  </a>
                  <small>
                    {source.authors}
                    {source.year ? ` · ${source.year}` : ''}
                  </small>
                  <p>{source.summary}</p>
                  <details>
                    <summary>Source limits</summary>
                    <p>{source.limitations}</p>
                    <code>{source.locator}</code>
                  </details>
                </li>
              ))}
            </ul>
            {background.length > 0 && (
              <div className="frontier-background">
                <h3>Background reading</h3>
                <ul>
                  {background.map((paper) => (
                    <li key={paper.id}>
                      <a href={paper.url} target="_blank" rel="noreferrer">
                        {paper.title}
                        <ArrowUpRight size={11} />
                      </a>
                      <small>
                        {paper.year ?? 'Undated'} · {citationLabel(paper)}
                      </small>
                    </li>
                  ))}
                </ul>
                <p>
                  Published literature in this field. These papers are not approved citation sources
                  for this question.
                </p>
              </div>
            )}
            <button className="frontier-open" onClick={() => onTask(reading)}>
              Open question
              <ArrowRight size={14} />
            </button>
          </aside>
        )}
      </div>
    </div>
  );
}
