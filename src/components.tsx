import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  X,
  Check,
  Copy,
  BatteryMedium,
  Sun,
  FlaskConical,
  BrainCircuit,
  ArrowUpRight,
} from 'lucide-react';
import type { Contribution, Field, Source, Task } from '../shared/types.ts';
import { prettyKind, prettyStatus } from './api.ts';

export const fieldIcon = (field: Field, size = 18) =>
  field.icon === 'battery' ? (
    <BatteryMedium size={size} />
  ) : field.icon === 'sun' ? (
    <Sun size={size} />
  ) : field.icon === 'brain' ? (
    <BrainCircuit size={size} />
  ) : (
    <FlaskConical size={size} />
  );
/** Intersecting orbits, shared by the navigation and favicon. */
export function Mark({ size = 22 }: { size?: number }) {
  return (
    <svg
      className="mark"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <ellipse
        cx="12"
        cy="12"
        rx="5"
        ry="10.2"
        transform="rotate(42 12 12)"
        stroke="currentColor"
        strokeWidth=".9"
      />
      <ellipse
        cx="12"
        cy="12"
        rx="5"
        ry="10.2"
        transform="rotate(-42 12 12)"
        stroke="currentColor"
        strokeWidth=".9"
      />
      <circle className="mark-core" cx="12" cy="12" r="1.7" fill="currentColor" />
    </svg>
  );
}

export function CopyButton({
  value,
  label = 'Copy',
  compact = false,
  className = '',
}: {
  value: string;
  label?: string;
  compact?: boolean;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <button
      type="button"
      className={`${compact ? 'icon-btn' : 'btn btn-secondary btn-sm'} ${className}`}
      aria-label={label}
      title={failed ? 'Clipboard unavailable. Select and copy the text manually.' : label}
      data-copied={copied || undefined}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setFailed(false);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => setCopied(false), 2000);
        } catch {
          setFailed(true);
        }
      }}
    >
      {copied ? <Check size={15} /> : <Copy size={15} />}
      {!compact && <span>{copied ? 'Copied' : failed ? 'Select text to copy' : label}</span>}
    </button>
  );
}

export function Modal({
  title,
  children,
  onClose,
  wide = false,
  drawer = false,
  bare = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  drawer?: boolean;
  /** Hide the visible header row (the title still labels the dialog for assistive tech). */
  bare?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current!;
    const focused = document.activeElement as HTMLElement | null;
    element.showModal();
    (element.querySelector('[data-autofocus]') as HTMLElement | null)?.focus();
    return () => {
      element.close();
      focused?.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className={`modal ${wide ? 'modal-wide' : ''} ${drawer ? 'modal-drawer' : ''} ${bare ? 'modal-bare' : ''}`}
      aria-labelledby="modal-heading"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          const rect = dialog.current!.getBoundingClientRect();
          if (
            event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom
          )
            onClose();
        }
      }}
    >
      <div className="modal-top">
        <span className="modal-title" id="modal-heading">
          {title}
        </span>
        <button className="icon-btn" aria-label="Close dialog" onClick={onClose}>
          <X size={18} />
        </button>
      </div>
      <div className="modal-body">{children}</div>
    </dialog>
  );
}

export function FieldChip({ field }: { field: Field }) {
  return (
    <span className="field-chip">
      <i style={{ background: field.color }} />
      {field.shortName}
    </span>
  );
}

const statusLabel = { open: 'Open', claimed: 'Claimed', completed: 'Completed' } as const;

/** Linear-style status glyph for a research question. */
export function StatusIcon({ status, size = 14 }: { status: Task['status']; size?: number }) {
  return (
    <svg
      className={`status-icon status-${status}`}
      width={size}
      height={size}
      viewBox="0 0 14 14"
      role="img"
      aria-label={statusLabel[status]}
    >
      <circle cx="7" cy="7" r="5.75" fill="none" stroke="currentColor" strokeWidth="1.5" />
      {status === 'claimed' && <path d="M7 3.25a3.75 3.75 0 0 1 0 7.5Z" fill="currentColor" />}
      {status === 'completed' && (
        <>
          <circle cx="7" cy="7" r="5.75" fill="currentColor" />
          <path
            d="m4.6 7.2 1.6 1.6 3.3-3.4"
            fill="none"
            stroke="var(--bg)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      )}
    </svg>
  );
}

export const priorityLevel = (priority: number) => (priority >= 88 ? 3 : priority >= 78 ? 2 : 1);
const priorityName = ['', 'Lower', 'Medium', 'High'];

export function PriorityIcon({ priority }: { priority: number }) {
  const level = priorityLevel(priority);
  return (
    <svg
      className="priority-icon"
      width="14"
      height="14"
      viewBox="0 0 14 14"
      role="img"
      aria-label={`${priorityName[level]} curator priority (${priority})`}
    >
      <title>{`${priorityName[level]} curator priority · ${priority}`}</title>
      {[0, 1, 2].map((i) => (
        <rect
          key={i}
          x={1.5 + i * 4.25}
          y={9 - i * 3}
          width="2.75"
          height={3.5 + i * 3}
          rx="0.8"
          fill="currentColor"
          opacity={i < level ? 1 : 0.28}
        />
      ))}
    </svg>
  );
}

/** Shapes shared with the atlas: paper ○, dataset ■, documentation □, code ◆. */
export function SourceGlyph({ kind, size = 12 }: { kind: Source['kind']; size?: number }) {
  return (
    <svg className="source-glyph" width={size} height={size} viewBox="0 0 12 12" aria-hidden="true">
      {kind === 'paper' ? (
        <circle cx="6" cy="6" r="4.2" fill="none" stroke="currentColor" strokeWidth="1.5" />
      ) : kind === 'dataset' ? (
        <rect x="2" y="2" width="8" height="8" fill="currentColor" />
      ) : kind === 'documentation' ? (
        <rect
          x="2.25"
          y="2.25"
          width="7.5"
          height="7.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        />
      ) : (
        <path d="M6 1 11 6 6 11 1 6Z" fill="currentColor" />
      )}
    </svg>
  );
}

export const sourceKindLabel = (kind: Source['kind']) =>
  kind === 'documentation' ? 'Documentation' : kind.charAt(0).toUpperCase() + kind.slice(1);

export function StatusPill({ status }: { status: Contribution['status'] }) {
  return <span className={`pill pill-${status}`}>{prettyStatus(status)}</span>;
}

export function TaskRow({ task, field, onOpen }: { task: Task; field: Field; onOpen: () => void }) {
  return (
    <button className="issue" onClick={onOpen}>
      <StatusIcon status={task.status} />
      <span className="issue-dot" style={{ background: field.color }} title={field.name} />
      <span className="issue-main">
        <span className="issue-title">{task.title}</span>
        <span className="issue-question">{task.question}</span>
      </span>
      <span className="issue-meta">
        <span className="issue-field">{field.shortName}</span>
        <span className="issue-kind">{prettyKind(task.kind)}</span>
        <span className="issue-effort">{task.effort}</span>
        <span className="issue-sources" title={`${task.sourceIds.length} starting sources`}>
          <SourceGlyph kind="paper" size={10} />
          {task.sourceIds.length}
        </span>
        <PriorityIcon priority={task.priority} />
      </span>
    </button>
  );
}

export function SourceRow({
  source,
  field,
  usedBy,
}: {
  source: Source;
  field: Field;
  usedBy: number;
}) {
  return (
    <article className="source-row">
      <span className={`source-row-glyph kind-${source.kind}`}>
        <SourceGlyph kind={source.kind} size={12} />
      </span>
      <div className="source-row-main">
        <div className="source-row-head">
          <a href={source.url} target="_blank" rel="noreferrer" className="source-row-title">
            {source.title}
            <ArrowUpRight size={15} />
          </a>
          <span className="source-row-kind">
            {sourceKindLabel(source.kind)} · {source.year ?? 'living resource'}
          </span>
        </div>
        <div className="source-row-authors">{source.authors}</div>
        <p className="source-row-summary">{source.summary}</p>
        <p className="source-row-limits">
          <strong>Read with care.</strong> {source.limitations}
        </p>
        <div className="source-row-foot">
          <FieldChip field={field} />
          <span>
            Used by {usedBy} question{usedBy === 1 ? '' : 's'}
          </span>
          <span className="mono">{source.locator}</span>
          <span>Link checked {source.checkedAt}</span>
        </div>
      </div>
    </article>
  );
}

export function Empty({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="empty">
      <svg width="44" height="44" viewBox="0 0 44 44" fill="none" aria-hidden="true">
        <circle
          cx="22"
          cy="22"
          r="20"
          stroke="currentColor"
          strokeOpacity=".25"
          strokeDasharray="2 4"
        />
        <circle cx="22" cy="22" r="11" stroke="currentColor" strokeOpacity=".4" />
        <circle cx="22" cy="22" r="3" fill="currentColor" fillOpacity=".7" />
      </svg>
      <h3>{title}</h3>
      <div className="empty-body">{children}</div>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  children,
}: {
  title: string;
  description?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {children && <div className="page-header-actions">{children}</div>}
    </header>
  );
}
