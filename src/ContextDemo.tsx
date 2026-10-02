import { useEffect, useState } from 'react';
import { ArrowRight, ArrowUpRight, ChevronDown } from 'lucide-react';
import type { ContextPacket, Snapshot, Task } from '../shared/types.ts';
import { api } from './api.ts';
import { CopyButton, Modal } from './components.tsx';
import { editReasons, revisionExample, utf8Bytes, wordCount } from './contextExample.ts';
import './ContextDemo.css';

const number = (value: number) => value.toLocaleString('en');
const draft = revisionExample.draft.map((part) => part.text).join('');
const edited = revisionExample.edited.map((part) => part.text).join('');

export function ContextDemo({ data, onTask }: { data: Snapshot; onTask: (task: Task) => void }) {
  const [mode, setMode] = useState<'revision' | 'context'>('revision');
  const [taskId, setTaskId] = useState(data.tasks[0]?.id ?? '');
  const [showEdits, setShowEdits] = useState(false);
  const [maxBytes, setMaxBytes] = useState(4096);
  const [packet, setPacket] = useState<ContextPacket | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [inspectPacket, setInspectPacket] = useState(false);
  const task = data.tasks.find((item) => item.id === taskId) ?? data.tasks[0];
  const fullJson = JSON.stringify(data);
  const fullBytes = utf8Bytes(fullJson);
  const packetPath = task
    ? `/tasks/${encodeURIComponent(task.id)}/context?max_bytes=${maxBytes}`
    : '';

  useEffect(() => {
    if (mode !== 'context' || !packetPath) return;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    setPacket(null);
    api<ContextPacket>(packetPath, { signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) setPacket(result);
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted)
          setError(failure instanceof Error ? failure.message : 'Could not load this packet.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [mode, packetPath]);

  return (
    <section className="context-demo ov-section" aria-labelledby="context-demo-heading">
      <header className="context-demo-head">
        <h2 id="context-demo-heading">Context engineering</h2>
        <div className="demo-modes" role="group" aria-label="Context engineering demonstration">
          <button aria-pressed={mode === 'revision'} onClick={() => setMode('revision')}>
            Research revision
          </button>
          <button aria-pressed={mode === 'context'} onClick={() => setMode('context')}>
            Agent context
          </button>
        </div>
      </header>
      {mode === 'revision' ? (
        <>
          <div className={`demo-spread ${showEdits ? 'demo-show-edits' : ''}`}>
            <article className="demo-page demo-draft">
              <header>
                <span>Draft</span>
                <span>{wordCount(draft)} words</span>
              </header>
              <h3>{revisionExample.title}</h3>
              <p>
                {revisionExample.draft.map((part, i) => (
                  <span key={i} className={part.reason ? `edit-${part.reason}` : undefined}>
                    {part.text}
                  </span>
                ))}
              </p>
            </article>
            <div className="demo-seam" aria-hidden="true">
              <ArrowRight size={18} />
            </div>
            <article className="demo-page demo-edited">
              <header>
                <span>Revised</span>
                <span>
                  {wordCount(edited)} words{' '}
                  <span className="demo-saving">
                    −{Math.round((1 - wordCount(edited) / wordCount(draft)) * 100)}%
                  </span>
                </span>
              </header>
              <h3>{revisionExample.title}</h3>
              <p>
                {revisionExample.edited.map((part, i) => (
                  <span key={i} className={part.reason ? `edit-${part.reason}` : undefined}>
                    {part.text}
                  </span>
                ))}
              </p>
              <a
                className="demo-citation"
                href={revisionExample.source.url}
                target="_blank"
                rel="noreferrer"
              >
                {revisionExample.source.title} <ArrowUpRight size={12} />
                <small>{revisionExample.source.locator}</small>
              </a>
            </article>
          </div>
          <div className="demo-toolbar">
            <button
              className="demo-text-button"
              aria-expanded={showEdits}
              aria-controls="demo-review-notes"
              onClick={() => setShowEdits(!showEdits)}
            >
              Review the changes <ChevronDown size={14} className={showEdits ? 'is-open' : ''} />
            </button>
            <CopyButton value={edited} label="Copy revised example" compact />
          </div>
          {showEdits && (
            <ol className="demo-review" id="demo-review-notes">
              {editReasons.map((reason, i) => (
                <li key={reason.id}>
                  <span className={`edit-key edit-${reason.id}`}>
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <div>
                    <h4>{reason.title}</h4>
                    <p>{reason.note}</p>
                  </div>
                </li>
              ))}
            </ol>
          )}
          <p className="demo-footnote">
            Illustrative edit, written for this demonstration. Not a submitted or reviewed
            contribution; shorter writing alone does not establish accuracy.
          </p>
        </>
      ) : (
        <>
          <div className="context-workbench-controls">
            <label className="context-task-picker">
              Research question
              <select
                value={task?.id ?? ''}
                disabled={!data.tasks.length}
                onChange={(event) => {
                  setTaskId(event.target.value);
                  setInspectPacket(false);
                }}
              >
                {!data.tasks.length && <option value="">No questions available</option>}
                {data.fields.map((field) => (
                  <optgroup key={field.id} label={field.name}>
                    {data.tasks
                      .filter((item) => item.fieldId === field.id)
                      .map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.title}
                        </option>
                      ))}
                  </optgroup>
                ))}
              </select>
            </label>
            <fieldset className="context-budgets">
              <legend>JSON byte limit</legend>
              {[1536, 2048, 4096, 8192].map((limit) => (
                <button
                  key={limit}
                  aria-pressed={maxBytes === limit}
                  onClick={() => {
                    setMaxBytes(limit);
                    setInspectPacket(false);
                  }}
                >
                  {limit / 1024} KiB
                </button>
              ))}
            </fieldset>
          </div>
          <div className="context-workbench" aria-busy={loading}>
            <aside className="context-catalog" aria-label="Catalog snapshot">
              <h3>Public catalog</h3>
              <div className="context-catalog-bytes">
                <strong>{number(fullBytes)}</strong>
                <span>UTF-8 bytes</span>
              </div>
              <dl>
                <div>
                  <dt>Research fields</dt>
                  <dd>{number(data.fields.length)}</dd>
                </div>
                <div>
                  <dt>Questions</dt>
                  <dd>{number(data.tasks.length)}</dd>
                </div>
                <div>
                  <dt>Source records</dt>
                  <dd>{number(data.sources.length)}</dd>
                </div>
                <div>
                  <dt>Published papers</dt>
                  <dd>{number(data.papers.length)}</dd>
                </div>
              </dl>
              <p>Full snapshot, including contributions and activity.</p>
              <ArrowRight size={22} aria-hidden="true" />
            </aside>
            <article className="context-focused">
              <header className="context-packet-heading">
                <code>Task context</code>
                <span className="context-live-state" role="status">
                  {loading
                    ? 'Fetching packet…'
                    : packet
                      ? 'Live API response'
                      : error
                        ? 'Packet unavailable'
                        : 'No question selected'}
                </span>
              </header>
              {packet && (
                <>
                  <div className="context-byte-readout">
                    <div>
                      <strong>{number(packet.budget.actualBytes)}</strong>
                      <span> / {number(packet.budget.maxBytes)} bytes</span>
                    </div>
                    <meter
                      min={0}
                      max={packet.budget.maxBytes}
                      value={packet.budget.actualBytes}
                      aria-label="Context packet byte budget used"
                    />
                    <span>
                      {packet.budget.truncated
                        ? 'Optional detail trimmed. Required policy retained.'
                        : 'Fits the budget. Required policy retained.'}
                    </span>
                  </div>
                  <h3>{packet.task.question}</h3>
                  <p className="context-packet-meta">
                    Task revision {packet.task.revision} · {packet.sources.length} approved source{' '}
                    {packet.sources.length === 1 ? 'record' : 'records'}
                  </p>
                  <div className="context-packet-sections">
                    <details open>
                      <summary>
                        Acceptance criteria <span>{packet.task.acceptance.length}</span>
                      </summary>
                      <ul>
                        {packet.task.acceptance.map((item, i) => (
                          <li key={i}>{item}</li>
                        ))}
                      </ul>
                    </details>
                    <details>
                      <summary>
                        Scope exclusions <span>{packet.task.exclusions.length}</span>
                      </summary>
                      <ul>
                        {packet.task.exclusions.map((item, i) => (
                          <li key={i}>{item}</li>
                        ))}
                      </ul>
                    </details>
                    <details>
                      <summary>
                        Required policy <span>{packet.policy.length}</span>
                      </summary>
                      <ul>
                        {packet.policy.map((item, i) => (
                          <li key={i}>{item}</li>
                        ))}
                      </ul>
                    </details>
                    <details>
                      <summary>
                        Methods <span>{packet.skills.length}</span>
                      </summary>
                      {packet.skills.map((skill) => (
                        <div className="context-method" key={skill.id}>
                          <h4>{skill.id.replaceAll('-', ' ')}</h4>
                          <ol>
                            {skill.steps.map((step, i) => (
                              <li key={i}>{step}</li>
                            ))}
                          </ol>
                        </div>
                      ))}
                      {!packet.skills.length && (
                        <p>No method detail in this packet. Use the methods expansion link.</p>
                      )}
                    </details>
                    <details>
                      <summary>
                        Prior contributions <span>{packet.priorWork.length}</span>
                      </summary>
                      {packet.priorWork.length ? (
                        <ul>
                          {packet.priorWork.map((item) => (
                            <li key={item.id}>
                              {item.title}{' '}
                              <span className="context-work-status">
                                {item.status.replaceAll('_', ' ')} · revision {item.revision}
                              </span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p>
                          No prior contributions included. The related-work endpoint may contain
                          more.
                        </p>
                      )}
                    </details>
                  </div>
                  <div className="context-evidence">
                    <h4>Source references</h4>
                    {packet.sources.map((source) => (
                      <a key={source.id} href={source.url} target="_blank" rel="noreferrer">
                        <span>
                          {source.title}
                          <small>{source.locator}</small>
                        </span>
                        <ArrowUpRight size={14} aria-hidden="true" />
                      </a>
                    ))}
                  </div>
                  <footer className="context-expansion">
                    <div>
                      {[
                        ['Task detail', packet.next.expand],
                        ['Related work', packet.next.relatedWork],
                        ['Methods', packet.next.skills],
                        ['Literature', packet.next.literature],
                      ].map(([label, href]) => (
                        <a key={label} href={href} target="_blank" rel="noreferrer">
                          {label}
                          <ArrowUpRight size={12} aria-hidden="true" />
                        </a>
                      ))}
                    </div>
                  </footer>
                </>
              )}
              {loading && (
                <div className="context-packet-pending" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </div>
              )}
              {error && (
                <div className="context-fetch-error" role="alert">
                  <h3>Could not load this packet</h3>
                  <p>{error}</p>
                </div>
              )}
              {!task && (
                <p className="context-empty">
                  Add a real research question to inspect its context packet.
                </p>
              )}
            </article>
          </div>
          <div className="demo-toolbar">
            {task && (
              <button className="demo-text-button" onClick={() => onTask(task)}>
                Open this question <ArrowUpRight size={13} />
              </button>
            )}
            {packet && (
              <div className="context-packet-actions">
                <button className="demo-text-button" onClick={() => setInspectPacket(true)}>
                  Inspect JSON <ArrowUpRight size={13} />
                </button>
                <CopyButton
                  value={JSON.stringify(packet)}
                  label="Copy live context packet"
                  compact
                />
              </div>
            )}
          </div>
          <p className="demo-footnote">
            Sizes measure UTF-8 JSON. The packet selects context for one question; it is not a
            lossless compression of the catalog or a research-quality benchmark.
          </p>
        </>
      )}
      {inspectPacket && packet && (
        <Modal title="Live context packet" wide onClose={() => setInspectPacket(false)}>
          <div className="demo-packet-inspector">
            <div>
              <code>GET /api/v1{packetPath}</code>
              <CopyButton value={JSON.stringify(packet)} label="Copy full context packet" compact />
            </div>
            <pre>{JSON.stringify(packet, null, 2)}</pre>
          </div>
        </Modal>
      )}
    </section>
  );
}
