import { useMemo, useState } from 'react';
import { ArrowUpRight, Plus, Minus, RotateCcw, Network, X } from 'lucide-react';
import type { Contribution, Field, Snapshot, Task } from '../shared/types.ts';

interface GraphNode {
  id: string;
  label: string;
  x: number;
  y: number;
  kind: 'field' | 'source' | 'task' | 'contribution';
  fieldId: string;
  color: string;
}
const centers = [
  { x: 240, y: 205 },
  { x: 535, y: 205 },
  { x: 385, y: 440 },
];

export function Graph({
  data,
  preview = false,
  onTask,
  onField,
  onContribution,
}: {
  data: Snapshot;
  preview?: boolean;
  onTask: (task: Task) => void;
  onField: (field: Field) => void;
  onContribution: (contribution: Contribution) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [visibleKinds, setVisibleKinds] = useState(['field', 'source', 'task', 'contribution']);
  const { nodes, edges } = useMemo(() => {
    const nodes: GraphNode[] = [];
    const edges: { from: string; to: string; relation: string }[] = [];
    data.fields.forEach((field, index) => {
      const center = centers[index];
      nodes.push({
        id: field.id,
        label: field.shortName,
        ...center,
        kind: 'field',
        fieldId: field.id,
        color: field.color,
      });
      const sourceList = data.sources.filter((s) => s.fieldId === field.id);
      const taskList = data.tasks.filter((t) => t.fieldId === field.id);
      sourceList.forEach((source, i) => {
        const angle =
          (index === 2 ? 0.12 : 0.88) * Math.PI + (i / Math.max(sourceList.length, 2)) * Math.PI;
        const x = center.x + Math.cos(angle) * 125,
          y = center.y + Math.sin(angle) * 115;
        nodes.push({
          id: source.id,
          label: source.title,
          x,
          y,
          kind: 'source',
          fieldId: field.id,
          color: field.color,
        });
        edges.push({ from: field.id, to: source.id, relation: 'contains source' });
      });
      taskList.forEach((task, i) => {
        const angle = (index === 2 ? 1.1 : -0.45) * Math.PI + i * 0.64 * Math.PI;
        const x = center.x + Math.cos(angle) * 130,
          y = center.y + Math.sin(angle) * 115;
        nodes.push({
          id: task.id,
          label: task.title,
          x,
          y,
          kind: 'task',
          fieldId: field.id,
          color: field.color,
        });
        edges.push({ from: field.id, to: task.id, relation: 'contains task' });
        task.sourceIds.forEach((sourceId) =>
          edges.push({ from: task.id, to: sourceId, relation: 'uses source' }),
        );
      });
    });
    // Only reviewed work enters the knowledge map. Proposed work stays in the review queue.
    data.contributions
      .filter((c) => c.status === 'accepted')
      .forEach((contribution, i) => {
        const parent = nodes.find((n) => n.id === contribution.taskId)!;
        nodes.push({
          id: contribution.id,
          label: contribution.title,
          x: parent.x + 35 + (i % 3) * 18,
          y: parent.y + 65,
          kind: 'contribution',
          fieldId: contribution.fieldId,
          color: '#32896d',
        });
        edges.push({ from: contribution.id, to: contribution.taskId, relation: 'answers task' });
        contribution.citations.forEach((c) =>
          edges.push({ from: contribution.id, to: c.sourceId, relation: 'cites source' }),
        );
      });
    return { nodes, edges };
  }, [data]);
  const active = nodes.find((n) => n.id === selected);
  const connected = new Set(
    edges.filter((e) => e.from === selected || e.to === selected).flatMap((e) => [e.from, e.to]),
  );
  const source = data.sources.find((s) => s.id === selected);
  const task = data.tasks.find((t) => t.id === selected);
  const field = data.fields.find((f) => f.id === selected);
  const toggle = (kind: string) => {
    setVisibleKinds((old) => (old.includes(kind) ? old.filter((x) => x !== kind) : [...old, kind]));
    setSelected(null);
  };
  const enabled = new Set(nodes.filter((n) => visibleKinds.includes(n.kind)).map((n) => n.id));
  return (
    <div className={`graph-shell ${preview ? 'graph-preview' : ''}`}>
      <div className="graph-heading">
        <span>
          <Network size={14} /> {preview ? 'A connected research commons' : 'THE EVIDENCE MAP'}
        </span>
        <span className="graph-live">
          <i /> {nodes.length} connected records
        </span>
      </div>
      <svg
        className="research-graph"
        viewBox="0 0 780 610"
        role="group"
        aria-label="Interactive research graph. Circles are fields, small dots are sources, and squares are tasks. Select a record to inspect its connections."
      >
        <defs>
          <pattern
            id={preview ? 'dots-preview' : 'dots-map'}
            width="24"
            height="24"
            patternUnits="userSpaceOnUse"
          >
            <circle cx="1" cy="1" r="0.8" fill="#ccdbce" />
          </pattern>
          <radialGradient id={preview ? 'glow-preview' : 'glow-map'}>
            <stop offset="0" stopColor="#e6f2dd" stopOpacity=".8" />
            <stop offset="1" stopColor="#f8faf5" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="780" height="610" fill={`url(#${preview ? 'dots-preview' : 'dots-map'})`} />
        <circle cx="390" cy="310" r="290" fill={`url(#${preview ? 'glow-preview' : 'glow-map'})`} />
        <g transform={`translate(390 305) scale(${zoom}) translate(-390 -305)`}>
          {data.fields.map((f, i) => (
            <g key={f.id} opacity=".5">
              <circle
                cx={centers[i].x}
                cy={centers[i].y}
                r="150"
                fill="none"
                stroke={f.color}
                strokeDasharray="2 7"
              />
              <circle cx={centers[i].x} cy={centers[i].y} r="67" fill={f.color} opacity=".08" />
            </g>
          ))}
          {edges
            .filter((e) => enabled.has(e.from) && enabled.has(e.to))
            .map((edge, i) => {
              const a = nodes.find((n) => n.id === edge.from)!,
                b = nodes.find((n) => n.id === edge.to)!;
              const highlighted = selected && (edge.from === selected || edge.to === selected);
              return (
                <line
                  key={i}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke={highlighted ? '#47795b' : '#a8beb0'}
                  strokeWidth={highlighted ? 2 : 1}
                  opacity={selected ? (highlighted ? 0.85 : 0.12) : 0.6}
                  strokeDasharray={edge.relation === 'uses source' ? '3 4' : undefined}
                />
              );
            })}
          {nodes
            .filter((n) => enabled.has(n.id))
            .map((node) => (
              <g
                key={node.id}
                className="graph-node"
                tabIndex={0}
                role="button"
                aria-label={`${node.kind}: ${node.label}`}
                onClick={() => setSelected(selected === node.id ? null : node.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setSelected(selected === node.id ? null : node.id);
                  }
                }}
                opacity={selected && selected !== node.id && !connected.has(node.id) ? 0.3 : 1}
              >
                <title>{node.label}</title>
                {node.kind === 'field' ? (
                  <>
                    <circle
                      cx={node.x}
                      cy={node.y}
                      r="30"
                      fill="#fff"
                      stroke={node.color}
                      strokeWidth="1.6"
                    />
                    <circle cx={node.x} cy={node.y} r="19" fill={node.color} opacity=".15" />
                    <text
                      x={node.x}
                      y={node.y + 5}
                      textAnchor="middle"
                      className="graph-field-icon"
                    >
                      {node.fieldId === 'batteries' ? '↯' : node.fieldId === 'solar' ? '☀' : '∴'}
                    </text>
                    <text x={node.x} y={node.y + 50} textAnchor="middle" className="graph-label">
                      {node.label}
                    </text>
                  </>
                ) : node.kind === 'task' ? (
                  <>
                    <rect
                      x={node.x - 7}
                      y={node.y - 7}
                      width="14"
                      height="14"
                      rx="4"
                      fill="white"
                      stroke={node.color}
                      strokeWidth="2"
                    />
                    <circle cx={node.x} cy={node.y} r="2" fill={node.color} />
                  </>
                ) : (
                  <circle
                    cx={node.x}
                    cy={node.y}
                    r={node.kind === 'contribution' ? 8 : 5}
                    fill={node.color}
                    stroke="white"
                    strokeWidth="2"
                  />
                )}
                {selected === node.id && (
                  <circle
                    cx={node.x}
                    cy={node.y}
                    r={node.kind === 'field' ? 36 : 14}
                    fill="none"
                    stroke="#264e3c"
                    strokeWidth="1.5"
                  />
                )}
              </g>
            ))}
        </g>
      </svg>
      {!preview && (
        <div className="graph-controls">
          <button aria-label="Zoom out" onClick={() => setZoom(Math.max(0.65, zoom - 0.15))}>
            <Minus size={16} />
          </button>
          <span>{Math.round(zoom * 100)}%</span>
          <button aria-label="Zoom in" onClick={() => setZoom(Math.min(1.65, zoom + 0.15))}>
            <Plus size={16} />
          </button>
          <button
            aria-label="Reset graph"
            onClick={() => {
              setZoom(1);
              setSelected(null);
            }}
          >
            <RotateCcw size={14} />
          </button>
        </div>
      )}
      <div className="graph-legend">
        {['field', 'source', 'task', ...(!preview ? ['contribution'] : [])].map((kind) => (
          <button
            className={!visibleKinds.includes(kind) ? 'disabled-kind' : ''}
            key={kind}
            onClick={() => toggle(kind)}
            aria-pressed={visibleKinds.includes(kind)}
          >
            <i className={`legend-${kind}`} />
            {kind === 'contribution'
              ? 'Reviewed work'
              : kind.charAt(0).toUpperCase() + kind.slice(1) + 's'}
          </button>
        ))}
      </div>
      {active && (
        <div className="graph-inspector">
          <button
            className="icon-button inspector-close"
            aria-label="Close record details"
            onClick={() => setSelected(null)}
          >
            <X size={15} />
          </button>
          <span className="eyebrow">
            {active.kind} · {connected.size - 1} connections
          </span>
          <h4>{active.label}</h4>
          {source && (
            <>
              <p>{source.summary}</p>
              <a className="text-link" href={source.url} target="_blank" rel="noreferrer">
                Read original source <ArrowUpRight size={14} />
              </a>
            </>
          )}
          {task && (
            <>
              <p>{task.question}</p>
              <button className="text-link" onClick={() => onTask(task)}>
                Open research task <ArrowUpRight size={14} />
              </button>
            </>
          )}
          {field && (
            <>
              <p>{field.description}</p>
              <button className="text-link" onClick={() => onField(field)}>
                Explore this field <ArrowUpRight size={14} />
              </button>
            </>
          )}
          {active.kind === 'contribution' && (
            <>
              <p>{data.contributions.find((c) => c.id === active.id)?.summary}</p>
              <button
                className="text-link"
                onClick={() => onContribution(data.contributions.find((c) => c.id === active.id)!)}
              >
                Read reviewed contribution <ArrowUpRight size={14} />
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
