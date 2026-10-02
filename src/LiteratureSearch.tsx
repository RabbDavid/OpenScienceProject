import { useState } from 'react';
import { ArrowRight, ArrowUpRight, Search } from 'lucide-react';
import type { Snapshot, Task } from '../shared/types.ts';
import { byCitations, citationLabel, paperMatches, prettyKind, sourceMatches } from './api.ts';
import { Empty, Modal, SourceGlyph, StatusIcon, sourceKindLabel } from './components.tsx';

export function LiteratureSearch({
  data,
  onTask,
  onBrowse,
  onClose,
}: {
  data: Snapshot;
  onTask: (task: Task) => void;
  onBrowse: (query: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const term = query.trim().toLowerCase();
  const matches = (text: string) => text.toLowerCase().includes(term);
  const papers = data.papers
    .filter((paper) => paperMatches(paper, data.fields, query))
    .sort(byCitations);
  const sources = term
    ? data.sources.filter((source) => sourceMatches(source, data.fields, query))
    : [];
  const tasks = term ? data.tasks.filter((task) => matches(`${task.title} ${task.question}`)) : [];

  return (
    <Modal title="Search literature" onClose={onClose} wide bare>
      <label className="palette-input">
        <Search size={18} />
        <input
          autoFocus
          data-autofocus
          aria-label="Search literature"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Title, author or topic…"
        />
        <kbd>Esc</kbd>
      </label>
      <div className="palette-results">
        {papers.length > 0 && <div className="palette-group">Papers</div>}
        {papers.slice(0, 6).map((paper) => (
          <a key={paper.id} href={paper.url} target="_blank" rel="noreferrer">
            <span
              className="glyph-paper"
              style={{ background: data.fields.find((field) => field.id === paper.fieldId)?.color }}
            />
            <div>
              <strong>{paper.title}</strong>
              <small>
                {paper.authors} · {paper.year ?? 'undated'} · {citationLabel(paper)}
              </small>
            </div>
            <ArrowUpRight size={15} />
          </a>
        ))}
        {papers.length > 6 && (
          <button onClick={() => onBrowse(query)}>
            <Search size={15} />
            <div>
              <strong>View all {papers.length} papers</strong>
            </div>
            <ArrowRight size={15} />
          </button>
        )}
        {sources.length > 0 && <div className="palette-group">Sources</div>}
        {sources.map((source) => (
          <a key={source.id} href={source.url} target="_blank" rel="noreferrer">
            <SourceGlyph kind={source.kind} />
            <div>
              <strong>{source.title}</strong>
              <small>
                {sourceKindLabel(source.kind)} · {source.authors}
              </small>
            </div>
            <ArrowUpRight size={15} />
          </a>
        ))}
        {tasks.length > 0 && <div className="palette-group">Questions</div>}
        {tasks.map((task) => (
          <button key={task.id} onClick={() => onTask(task)}>
            <StatusIcon status={task.status} />
            <div>
              <strong>{task.title}</strong>
              <small>
                {data.fields.find((field) => field.id === task.fieldId)?.shortName} ·{' '}
                {prettyKind(task.kind)} · {task.status}
              </small>
            </div>
            <ArrowRight size={15} />
          </button>
        ))}
        {!papers.length && !sources.length && !tasks.length && (
          <Empty title="No matching records.">
            <p>Try another term.</p>
          </Empty>
        )}
      </div>
    </Modal>
  );
}
