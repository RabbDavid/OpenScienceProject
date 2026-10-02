import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowUpRight, LoaderCircle, NotebookPen, Plus } from 'lucide-react';
import type { NoteCard, NoteReview, ResearchNote, Task, Source } from '../shared/types.ts';
import type { ConnectedIdentity } from './dialogs.tsx';
import { api, dateLabel, prettyOrigin } from './api.ts';
import './TaskNotebook.css';

type Cards = { items: NoteCard[]; total: number; nextOffset: number | null };
type Record = { note: ResearchNote; reviews: NoteReview[] };
export function TaskNotebook({
  task,
  apiKey,
  identity,
  onConnect,
  sources,
  onSaved,
}: {
  task: Task;
  apiKey: string;
  identity: ConnectedIdentity | null;
  onConnect: () => void;
  sources: Pick<Source, 'id' | 'title'>[];
  onSaved: () => void;
}) {
  const [list, setList] = useState<{ key: string; value: Cards } | null>(null);
  const [selected, setSelected] = useState<{ key: string; value: Record } | null>(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [reload, setReload] = useState(0);
  const [offset, setOffset] = useState(0);
  const [compose, setCompose] = useState(false);
  const [kind, setKind] = useState<'handoff' | 'source_candidate'>('handoff');
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [body, setBody] = useState('');
  const [negative, setNegative] = useState('');
  const [unresolved, setUnresolved] = useState('');
  const [url, setUrl] = useState('');
  const [risk, setRisk] = useState<ResearchNote['risk'] | ''>('');
  const [sourcesSeen, setSourcesSeen] = useState<string[]>([]);
  const [origin, setOrigin] = useState<ResearchNote['origin']>('human');
  const [draftId, setDraftId] = useState(() => crypto.randomUUID());
  const prepared = useRef<{ draftId: string; key: string; input: object } | null>(null);
  const [reviewRationale, setReviewRationale] = useState('');
  const visibleList = list?.key === apiKey ? list.value : null;
  const record = selected?.key === apiKey ? selected.value : null;
  useEffect(() => {
    const controller = new AbortController();
    void api<Cards>(`/tasks/${task.id}/notes?limit=5&offset=${offset}`, {
      key: apiKey,
      signal: controller.signal,
    })
      .then((value) => {
        if (!controller.signal.aborted) setList({ key: apiKey, value });
      })
      .catch((err: Error) => {
        if (!controller.signal.aborted) setError(err.message);
      });
    return () => controller.abort();
  }, [task.id, apiKey, reload, offset]);
  const open = async (id: string) => {
    setError('');
    setPending(true);
    try {
      setSelected({
        key: apiKey,
        value: await api<Record>(`/notes/${id}?max_bytes=64000`, { key: apiKey }),
      });
      setReviewRationale('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  };
  const lines = (value: string) =>
    value
      .split('\n')
      .map((item) => item.trim())
      .filter(Boolean);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!identity) {
      onConnect();
      return;
    }
    setError('');
    setPending(true);
    try {
      const input =
        prepared.current?.draftId === draftId && prepared.current.key === apiKey
          ? prepared.current.input
          : {
              taskId: task.id,
              expectedTaskRevision: task.revision,
              idempotencyKey: draftId,
              title,
              summary,
              risk,
              origin,
              kind,
              ...(kind === 'handoff'
                ? {
                    observations: body,
                    negativeResults: lines(negative),
                    unresolved: lines(unresolved),
                    sourcesSeen,
                  }
                : { url, rationale: body }),
            };
      prepared.current = { draftId, key: apiKey, input };
      const saved = await api<{ note: ResearchNote }>(`/tasks/${task.id}/notes`, {
        key: apiKey,
        method: 'POST',
        body: input,
      });
      setCompose(false);
      setTitle('');
      setSummary('');
      setBody('');
      setNegative('');
      setUnresolved('');
      setUrl('');
      setRisk('');
      setDraftId(crypto.randomUUID());
      setOffset(0);
      setReload((value) => value + 1);
      setSelected({ key: apiKey, value: { note: saved.note, reviews: [] } });
      setSourcesSeen([]);
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  };
  const review = async (decision: NoteReview['decision']) => {
    if (!record) return;
    setPending(true);
    setError('');
    try {
      await api(`/notes/${record.note.id}/review`, {
        key: apiKey,
        method: 'POST',
        body: {
          expectedReviewRevision: record.note.reviewRevision,
          decision,
          rationale: reviewRationale,
        },
      });
      await open(record.note.id);
      setReload((value) => value + 1);
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  };
  return (
    <section className="drawer-section task-notebook">
      <div className="notebook-heading">
        <h3>
          <NotebookPen size={15} /> Research notebook
        </h3>
        <button
          className="btn btn-secondary btn-sm"
          onClick={() => {
            if (!identity) onConnect();
            else setCompose(!compose);
          }}
        >
          <Plus size={13} />
          {compose ? 'Close draft' : 'Leave a note'}
        </button>
      </div>
      <p className="hint">
        Handoffs and candidate sources. Notes are observations, not reviewed findings.
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {!visibleList ? (
        <p className="hint">Loading notebook…</p>
      ) : (
        <>
          {!visibleList.items.length ? (
            <p className="notebook-empty">No visible notebook entries for this question yet.</p>
          ) : (
            <div className="notebook-cards">
              {visibleList.items.map((note) => (
                <button key={note.id} onClick={() => void open(note.id)} disabled={pending}>
                  <span className="notebook-type">
                    {note.kind === 'handoff' ? 'Handoff' : 'Candidate source'} ·{' '}
                    {note.status === 'retained' ? 'Kept for follow-up' : note.status}
                  </span>
                  <strong>{note.title}</strong>
                  <p>{note.summary}</p>
                  <small>
                    {note.authorName} · {dateLabel(note.createdAt)}
                  </small>
                </button>
              ))}
            </div>
          )}
          {(offset > 0 || visibleList.nextOffset !== null) && (
            <div className="notebook-pagination">
              <button
                className="btn btn-secondary btn-sm"
                disabled={!offset}
                onClick={() => setOffset(Math.max(0, offset - 5))}
              >
                Previous notes
              </button>
              <span>{visibleList.total} visible entries</span>
              <button
                className="btn btn-secondary btn-sm"
                disabled={visibleList.nextOffset === null}
                onClick={() => setOffset(visibleList.nextOffset!)}
              >
                Next notes
              </button>
            </div>
          )}
        </>
      )}
      {record && (
        <article className="notebook-record">
          <div className="notebook-heading">
            <h4>{record.note.title}</h4>
            <button className="link-btn" onClick={() => setSelected(null)}>
              Close note
            </button>
          </div>
          <p className="hint">
            {record.note.authorName} · {prettyOrigin(record.note.origin)} (declared) · task revision{' '}
            {record.note.taskRevision} · {record.note.status}
          </p>
          {record.note.kind === 'source_candidate' ? (
            <>
              <a href={record.note.url} target="_blank" rel="noreferrer">
                Candidate source <ArrowUpRight size={12} />
              </a>
              <p>{record.note.rationale}</p>
              <p className="hint">
                Not approved for task citations. Keeping a proposal does not change the source
                catalog.
              </p>
            </>
          ) : (
            <>
              <p className="notebook-observations">{record.note.observations}</p>
              {!!record.note.negativeResults?.length && (
                <>
                  <h5>Unsuccessful searches or attempts</h5>
                  <ul>
                    {record.note.negativeResults.map((text, i) => (
                      <li key={i}>{text}</li>
                    ))}
                  </ul>
                </>
              )}
              {!!record.note.unresolved?.length && (
                <>
                  <h5>Still unresolved</h5>
                  <ul>
                    {record.note.unresolved.map((text, i) => (
                      <li key={i}>{text}</li>
                    ))}
                  </ul>
                </>
              )}
              {!!record.note.sourcesSeen?.length && (
                <p className="hint">Sources inspected: {record.note.sourcesSeen.join(', ')}</p>
              )}
            </>
          )}
          {!!record.reviews.length && (
            <div className="notebook-reviews">
              {record.reviews.map((item) => (
                <div key={item.id}>
                  <strong>
                    {item.reviewerName} · {item.decision}
                  </strong>
                  <p>{item.rationale}</p>
                </div>
              ))}
            </div>
          )}
          {identity?.role === 'curator' && record.note.authorId !== identity.id && (
            <div className="notebook-review-form">
              <label>
                Review rationale
                <textarea
                  minLength={20}
                  maxLength={1500}
                  value={reviewRationale}
                  onChange={(event) => setReviewRationale(event.target.value)}
                />
              </label>
              <div>
                <button
                  className="btn btn-primary btn-sm"
                  disabled={
                    pending || reviewRationale.trim().length < 20 || record.note.risk !== 'low'
                  }
                  onClick={() => void review('retain')}
                >
                  Keep for follow-up
                </button>
                <button
                  className="btn btn-secondary btn-sm"
                  disabled={pending || reviewRationale.trim().length < 20}
                  onClick={() => void review('dismiss')}
                >
                  Dismiss
                </button>
                <button
                  className="btn btn-secondary btn-sm"
                  disabled={pending || reviewRationale.trim().length < 20}
                  onClick={() => void review('hold')}
                >
                  Hold privately
                </button>
              </div>
            </div>
          )}
        </article>
      )}
      {compose && identity && (
        <form
          className="form notebook-form"
          onSubmit={(event) => void submit(event)}
          onChange={() => setDraftId(crypto.randomUUID())}
        >
          <label>
            Entry type
            <select
              value={kind}
              onChange={(event) => {
                setKind(event.target.value as typeof kind);
                setBody('');
              }}
            >
              <option value="handoff">Research handoff</option>
              <option value="source_candidate">Candidate source</option>
            </select>
          </label>
          <label>
            Title
            <input
              required
              minLength={8}
              maxLength={140}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label>
            Summary
            <input
              required
              minLength={15}
              maxLength={320}
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
            />
          </label>
          {kind === 'source_candidate' && (
            <label>
              Public source URL
              <input
                type="url"
                required
                maxLength={1200}
                value={url}
                onChange={(event) => setUrl(event.target.value)}
              />
            </label>
          )}
          <label>
            {kind === 'handoff' ? 'Observations' : 'Why this source is relevant'}
            <textarea
              required
              minLength={kind === 'handoff' ? 15 : 20}
              maxLength={kind === 'handoff' ? 1500 : 1600}
              value={body}
              onChange={(event) => setBody(event.target.value)}
            />
          </label>
          {kind === 'handoff' && (
            <>
              <fieldset className="notebook-sources">
                <legend>Sources inspected</legend>
                {sources.map((source) => (
                  <label key={source.id}>
                    <input
                      type="checkbox"
                      checked={sourcesSeen.includes(source.id)}
                      onChange={(event) =>
                        setSourcesSeen((current) =>
                          event.target.checked
                            ? [...current, source.id]
                            : current.filter((id) => id !== source.id),
                        )
                      }
                    />
                    {source.title}
                  </label>
                ))}
              </fieldset>
              <label>
                Unsuccessful searches or attempts
                <textarea
                  value={negative}
                  onChange={(event) => setNegative(event.target.value)}
                  placeholder="One per line; include the search scope and date."
                />
              </label>
              <label>
                Unresolved questions
                <textarea
                  value={unresolved}
                  onChange={(event) => setUnresolved(event.target.value)}
                  placeholder="One per line."
                />
              </label>
            </>
          )}
          <div className="notebook-form-options">
            <label>
              Risk
              <select
                required
                value={risk}
                onChange={(event) => setRisk(event.target.value as typeof risk)}
              >
                <option value="">Select risk</option>
                <option value="low">Low</option>
                <option value="uncertain">Uncertain · held privately</option>
                <option value="high">High · held privately</option>
              </select>
            </label>
            <label>
              Contributor origin
              <select
                value={origin}
                onChange={(event) => setOrigin(event.target.value as typeof origin)}
              >
                <option value="human">Human</option>
                <option value="human_with_ai">Human with AI</option>
                <option value="agent">AI agent</option>
                <option value="unspecified">Unspecified</option>
              </select>
            </label>
          </div>
          <p className="hint">
            Publishing uses CC-BY-4.0. Maximum 4096 UTF-8 input bytes. No secrets or personal data.
            A notebook entry does not claim or complete the question.
          </p>
          <button className="btn btn-primary" disabled={pending}>
            {pending && <LoaderCircle className="spin" size={14} />}Publish entry
          </button>
        </form>
      )}
    </section>
  );
}
