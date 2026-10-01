import { useEffect, useState } from 'react';
import { ArrowRight, ArrowUpRight, ChevronDown } from 'lucide-react';
import type { ContextPacket, Snapshot, Task } from '../shared/types.ts';
import { api } from './api.ts';
import { CopyButton, Modal } from './components.tsx';
import { editReasons, revisionExample, utf8Bytes, wordCount } from './contextExample.ts';

const number = (value: number) => value.toLocaleString('en');
const draft = revisionExample.draft.map((part) => part.text).join('');
const edited = revisionExample.edited.map((part) => part.text).join('');

export function ContextDemo({ data, onTask }: { data: Snapshot; onTask: (task: Task) => void }) {
  const [mode, setMode] = useState<'revision' | 'context'>('revision');
  const [showEdits, setShowEdits] = useState(false);
  const [maxBytes, setMaxBytes] = useState(4096);
  const [packet, setPacket] = useState<ContextPacket | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [inspectPacket, setInspectPacket] = useState(false);
  const task = data.tasks.find((item) => item.id === 'battery-metadata-map');
  const fullJson = JSON.stringify(data);
  const fullBytes = utf8Bytes(fullJson);
  const packetPath = task ? `/tasks/${task.id}/context?max_bytes=${maxBytes}` : '';

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
          <div className="context-controls">
            <span>{task?.title ?? 'No example task available'}</span>
            <label>
              Size limit{' '}
              <select
                value={maxBytes}
                onChange={(event) => setMaxBytes(Number(event.target.value))}
              >
                <option value={2048}>2 KB</option>
                <option value={4096}>4 KB</option>
                <option value={8192}>8 KB</option>
              </select>
            </label>
          </div>
          <div className="demo-spread demo-context-spread" aria-busy={loading}>
            <article className="demo-page">
              <header>
                <span>Whole catalogue</span>
                <span>{number(fullBytes)} bytes</span>
              </header>
              <pre>
                {JSON.stringify(
                  {
                    fields: `${data.fields.length} fields`,
                    tasks: `${data.tasks.length} questions`,
                    sources: `${data.sources.length} source records`,
                    papers: `${data.papers.length} published papers`,
                    contributions: `${data.contributions.length} contributions`,
                    events: `${data.events.length} events`,
                  },
                  null,
                  2,
                )}
              </pre>
              <p className="demo-context-note">
                Every field and paper, whether this question needs it or not.
              </p>
            </article>
            <div className="demo-seam" aria-hidden="true">
              <ArrowRight size={18} />
            </div>
            <article className="demo-page demo-edited">
              <header>
                <span>Task packet</span>
                <span aria-live="polite">
                  {loading
                    ? 'Loading…'
                    : packet
                      ? `${number(packet.budget.actualBytes)} bytes`
                      : 'Cannot fit'}
                </span>
              </header>
              {packet && (
                <>
                  <pre>
                    {JSON.stringify(
                      {
                        task: packet.task.id,
                        question: packet.task.question,
                        revision: packet.task.revision,
                        acceptance: packet.task.acceptance,
                        exclusions: packet.task.exclusions,
                        policy: packet.policy,
                        sources: packet.sources.map((source) => ({
                          id: source.id,
                          url: source.url,
                        })),
                        skills: packet.skills.map((skill) => skill.id),
                        priorWork: packet.priorWork,
                        expand: packet.next.expand,
                      },
                      null,
                      2,
                    )}
                  </pre>
                  <p className="demo-context-note">
                    The question, evidence links and constraints. More detail stays one request
                    away.
                  </p>
                </>
              )}
              {loading && (
                <div className="demo-packet-loading" role="status">
                  Requesting the live context packet…
                </div>
              )}
              {error && (
                <div className="demo-budget-error" role="alert">
                  <p>{error}</p>
                  <span>
                    The API refuses the budget instead of dropping required policy or source links.
                  </span>
                </div>
              )}
              {!task && (
                <p className="demo-context-note">
                  The example task is unavailable in this instance.
                </p>
              )}
            </article>
          </div>
          {packet && (
            <div className="demo-context-result">
              <span>
                <strong>{number(fullBytes)}</strong>
                <ArrowRight size={15} />
                <strong>{number(packet.budget.actualBytes)}</strong> bytes
              </span>
              <span>
                {packet.budget.truncated
                  ? 'Optional detail trimmed; required context retained.'
                  : 'Required context retained.'}
              </span>
              <button className="demo-text-button" onClick={() => setInspectPacket(true)}>
                Full packet <ArrowUpRight size={13} />
              </button>
            </div>
          )}
          <div className="demo-toolbar">
            {task && (
              <button className="demo-text-button" onClick={() => onTask(task)}>
                Open this question <ArrowUpRight size={13} />
              </button>
            )}
            {packet && (
              <CopyButton value={JSON.stringify(packet)} label="Copy live context packet" compact />
            )}
          </div>
          <p className="demo-footnote">
            Live JSON byte counts, not a model benchmark. The left summary and right preview are
            abbreviated; the full packet retains its methods and expansion links. These inputs
            contain different information.
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
