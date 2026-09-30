import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  X,
  Check,
  Copy,
  BatteryMedium,
  Sun,
  FlaskConical,
  ArrowUpRight,
  FileText,
  Database,
  Code2,
  BookOpen,
  ArrowRight,
  Clock3,
} from 'lucide-react';
import type { Field, Source, Task } from '../shared/types.ts';
import { prettyKind } from './api.ts';

export const fieldIcon = (field: Field, size = 20) =>
  field.icon === 'battery' ? (
    <BatteryMedium size={size} />
  ) : field.icon === 'sun' ? (
    <Sun size={size} />
  ) : (
    <FlaskConical size={size} />
  );
export const sourceIcon = (source: Source) =>
  source.kind === 'paper' ? (
    <FileText size={17} />
  ) : source.kind === 'dataset' ? (
    <Database size={17} />
  ) : source.kind === 'code' ? (
    <Code2 size={17} />
  ) : (
    <BookOpen size={17} />
  );
export function Mark({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <ellipse
        cx="20"
        cy="20"
        rx="16"
        ry="7"
        transform="rotate(-45 20 20)"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <ellipse
        cx="20"
        cy="20"
        rx="16"
        ry="7"
        transform="rotate(45 20 20)"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <circle cx="20" cy="20" r="3" fill="currentColor" />
    </svg>
  );
}
export function CopyButton({
  value,
  label = 'Copy',
  compact = false,
}: {
  value: string;
  label?: string;
  compact?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <button
      className={compact ? 'icon-button' : 'button button-light'}
      aria-label={label}
      title={failed ? 'Clipboard unavailable. Select and copy the text manually.' : label}
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
      {copied ? <Check size={15} /> : <Copy size={15} />}{' '}
      {!compact && (copied ? 'Copied' : failed ? 'Select text to copy' : label)}
    </button>
  );
}
export function Modal({
  title,
  children,
  onClose,
  wide = false,
  drawer = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  drawer?: boolean;
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
      className={`modal ${wide ? 'modal-wide' : ''} ${drawer ? 'modal-drawer' : ''}`}
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
        <span className="eyebrow" id="modal-heading">
          {title}
        </span>
        <button className="icon-button" aria-label="Close dialog" onClick={onClose}>
          <X size={20} />
        </button>
      </div>
      {children}
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
export function TaskRow({
  task,
  field,
  onOpen,
  number,
}: {
  task: Task;
  field: Field;
  onOpen: () => void;
  number?: number;
}) {
  return (
    <button className="task-row" onClick={onOpen}>
      {number !== undefined && (
        <span className="task-number">{String(number).padStart(2, '0')}</span>
      )}
      <div className="task-row-main">
        <div className="task-kicker">
          <span>{prettyKind(task.kind)}</span>
          {task.priority >= 88 && <span className="priority-label">High priority</span>}
          <span className={`status-dot ${task.status}`}>{task.status}</span>
        </div>
        <h3>{task.title}</h3>
        <div className="task-meta">
          <FieldChip field={field} />
          <span>
            <Clock3 size={12} />
            {task.effort}
          </span>
          <span>{task.sourceIds.length} sources</span>
        </div>
      </div>
      <ArrowUpRight size={19} className="task-arrow" />
    </button>
  );
}
export function SourceCard({ source, field }: { source: Source; field: Field }) {
  return (
    <article className="source-card">
      <div className="source-top">
        <span className="source-type">
          {sourceIcon(source)} {source.kind}
        </span>
        <span className="small-mono">{source.year ?? 'LIVING RESOURCE'}</span>
      </div>
      <a href={source.url} target="_blank" rel="noreferrer" className="source-title">
        {source.title}
        <ArrowUpRight size={17} />
      </a>
      <div className="source-authors">{source.authors}</div>
      <p>{source.summary}</p>
      <div className="source-limitations">
        <span>READ WITH CONTEXT</span>
        {source.limitations}
      </div>
      <div className="source-bottom">
        <FieldChip field={field} />
        <span>Link checked {source.checkedAt}</span>
      </div>
    </article>
  );
}
export function Empty({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="empty-state">
      <Mark size={40} />
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
export function SectionTitle({
  eyebrow,
  title,
  children,
}: {
  eyebrow?: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="section-heading">
      <div>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h2>{title}</h2>
      </div>
      {children}
    </div>
  );
}
export function FieldCard({
  field,
  taskCount,
  onOpen,
  index,
}: {
  field: Field;
  taskCount: number;
  onOpen: () => void;
  index: number;
}) {
  return (
    <button className="field-card" onClick={onOpen}>
      <div className="field-card-top">
        <span className="field-icon" style={{ color: field.color }}>
          {fieldIcon(field, 23)}
        </span>
        <span className="small-mono">
          0{index + 1} /{' '}
          {field.id === 'batteries'
            ? 'ENERGY STORAGE'
            : field.id === 'solar'
              ? 'RENEWABLES'
              : 'RESEARCH METHODS'}
        </span>
      </div>
      <h3>{field.name}</h3>
      <p>{field.description}</p>
      <div className="field-card-bottom">
        <span>
          <i style={{ background: field.color }} />
          {taskCount} open questions
        </span>
        <ArrowRight size={18} />
      </div>
    </button>
  );
}
