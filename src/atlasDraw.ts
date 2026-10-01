import type { AtlasLink, AtlasNode, LinkKind } from './atlas.ts';
import { hash01 } from './atlas.ts';

export interface AtlasTheme {
  bg: string;
  grid: string;
  edge: string;
  edgeStrong: string;
  edgeFocus: string;
  dimNode: string;
  dimNodeHover: string;
  dimEdge: string;
  source: string;
  label: string;
  label2: string;
  labelDim: string;
  ring: string;
  region: string;
}

const tokenNames: Record<keyof AtlasTheme, string> = {
  bg: '--atlas-bg',
  grid: '--atlas-grid',
  edge: '--atlas-edge',
  edgeStrong: '--atlas-edge-strong',
  edgeFocus: '--atlas-edge-focus',
  dimNode: '--atlas-dim-node',
  dimNodeHover: '--atlas-dim-node-hover',
  dimEdge: '--atlas-dim-edge',
  source: '--atlas-source',
  label: '--atlas-label',
  label2: '--atlas-label-2',
  labelDim: '--atlas-label-dim',
  ring: '--atlas-ring',
  region: '--atlas-region',
};

export function readTheme(element: Element): AtlasTheme {
  const style = getComputedStyle(element);
  return Object.fromEntries(
    Object.entries(tokenNames).map(([key, token]) => [key, style.getPropertyValue(token).trim()]),
  ) as unknown as AtlasTheme;
}

export interface View {
  x: number;
  y: number;
  k: number;
}

export interface DrawState {
  width: number;
  height: number;
  dpr: number;
  view: View;
  nodes: AtlasNode[];
  links: AtlasLink[];
  visible: (node: AtlasNode) => boolean;
  /** The node whose neighbourhood is highlighted (hover wins over selection). */
  focus: string | null;
  neighbours: Set<string> | null;
  hovered: string | null;
  selected: string | null;
  /** A node whose name is shown in the DOM tooltip, so the canvas skips its label. */
  tooltip: string | null;
  theme: AtlasTheme;
  now: number;
  /** Intro progress, 0 → 1. 1 means fully revealed. */
  reveal: number;
  animatePulse: boolean;
  fontFamily: string;
}

export const screenRadius = (node: AtlasNode, k: number) => {
  const scale = Math.min(Math.max(Math.sqrt(k), 0.72), 1.9);
  return node.r * scale;
};

export const toScreen = (view: View, x = 0, y = 0) => [x * view.k + view.x, y * view.k + view.y];

const revealDelay = (node: AtlasNode) => {
  const spread = hash01(node.id);
  switch (node.kind) {
    case 'domain':
      return 0;
    case 'future':
      return 0.08 + spread * 0.3;
    case 'field':
      return 0.18;
    case 'paper':
      return 0.24 + spread * 0.3;
    case 'task':
      return 0.34 + spread * 0.14;
    case 'source':
      return 0.44 + spread * 0.16;
    default:
      return 0.58 + spread * 0.1;
  }
};
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

function withAlpha(hex: string, alpha: number) {
  if (!hex.startsWith('#') || (hex.length !== 7 && hex.length !== 4)) return hex;
  const full = hex.length === 4 ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}` : hex;
  const n = parseInt(full.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

interface Placed {
  node: AtlasNode;
  sx: number;
  sy: number;
  r: number;
  alpha: number;
}

const curved = new Set<LinkKind>(['task-source', 'contribution-source']);

export function drawAtlas(ctx: CanvasRenderingContext2D, s: DrawState) {
  const { view, theme } = s;
  ctx.setTransform(s.dpr, 0, 0, s.dpr, 0, 0);
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, s.width, s.height);
  drawGraticule(ctx, s);

  const byId = new Map<string, AtlasNode>();
  for (const node of s.nodes) byId.set(node.id, node);

  // Resolve display positions (the intro eases nodes out from their domain hub).
  const placed = new Map<string, Placed>();
  for (const node of s.nodes) {
    if (!s.visible(node)) continue;
    let x = node.x ?? 0;
    let y = node.y ?? 0;
    let alpha = 1;
    if (s.reveal < 1) {
      const local = easeOut(clamp01((s.reveal - revealDelay(node)) / 0.38));
      const hub = byId.get(`domain:${node.domain}`);
      if (hub && hub !== node) {
        const spread = 0.35 + 0.65 * local;
        x = (hub.x ?? 0) + (x - (hub.x ?? 0)) * spread;
        y = (hub.y ?? 0) + (y - (hub.y ?? 0)) * spread;
      }
      alpha = local;
    }
    if (s.focus && s.neighbours && !s.neighbours.has(node.id)) alpha *= 0.16;
    const [sx, sy] = toScreen(view, x, y);
    placed.set(node.id, { node, sx, sy, r: screenRadius(node, view.k), alpha });
  }

  drawRegions(ctx, s, placed);
  drawLinks(ctx, s, placed);
  for (const kind of [
    'domain',
    'future',
    'paper',
    'field',
    'source',
    'task',
    'contribution',
  ] as const)
    for (const p of placed.values()) if (p.node.kind === kind) drawNode(ctx, s, p);
  drawLabels(ctx, s, placed);
}

function drawGraticule(ctx: CanvasRenderingContext2D, s: DrawState) {
  const { view, theme } = s;
  const [cx, cy] = toScreen(view, 90, 10);
  ctx.save();
  ctx.strokeStyle = theme.grid;
  ctx.lineWidth = 1;
  const rings = [140, 280, 420, 560, 700];
  for (const radius of rings) {
    ctx.beginPath();
    ctx.arc(cx, cy, radius * view.k, 0, Math.PI * 2);
    ctx.stroke();
  }
  const inner = rings[0] * view.k;
  const outer = rings.at(-1)! * view.k;
  ctx.beginPath();
  for (let deg = 0; deg < 360; deg += 30) {
    const a = (deg * Math.PI) / 180;
    ctx.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
    ctx.lineTo(cx + Math.cos(a) * outer, cy + Math.sin(a) * outer);
  }
  ctx.stroke();
  // Fine ticks on the outer ring, like the bezel of an instrument.
  ctx.beginPath();
  for (let deg = 0; deg < 360; deg += 5) {
    const a = (deg * Math.PI) / 180;
    const len = (deg % 30 === 0 ? 10 : 4) * Math.min(view.k, 1.4);
    ctx.moveTo(cx + Math.cos(a) * outer, cy + Math.sin(a) * outer);
    ctx.lineTo(cx + Math.cos(a) * (outer + len), cy + Math.sin(a) * (outer + len));
  }
  ctx.stroke();
  ctx.restore();
}

/** Soft territory behind each domain, like the shaded regions of a printed science map. */
function drawRegions(ctx: CanvasRenderingContext2D, s: DrawState, placed: Map<string, Placed>) {
  ctx.save();
  for (const p of placed.values()) {
    if (p.node.kind !== 'domain' || p.alpha <= 0.01) continue;
    const radius = 150 * s.view.k;
    const glow = ctx.createRadialGradient(p.sx, p.sy, 0, p.sx, p.sy, radius);
    glow.addColorStop(0, s.theme.region);
    glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.globalAlpha = p.alpha * (s.focus ? 0.5 : 1);
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(p.sx, p.sy, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawLinks(ctx: CanvasRenderingContext2D, s: DrawState, placed: Map<string, Placed>) {
  const { theme } = s;
  ctx.save();
  ctx.lineCap = 'round';
  for (const link of s.links) {
    if (link.kind === 'layout') continue;
    const a = placed.get(typeof link.source === 'string' ? link.source : link.source.id);
    const b = placed.get(typeof link.target === 'string' ? link.target : link.target.id);
    if (!a || !b) continue;
    const touchesFocus = !!s.focus && (a.node.id === s.focus || b.node.id === s.focus);
    let alpha = Math.min(a.alpha, b.alpha);
    let width = 1;
    let color: string;
    switch (link.kind) {
      case 'domain-future':
        color = theme.dimEdge;
        break;
      case 'domain-field':
        color = theme.edge;
        alpha *= 0.7;
        break;
      case 'field-task':
      case 'contribution-task':
        color = withAlpha(b.node.color || a.node.color, link.kind === 'field-task' ? 0.42 : 0.6);
        width = 1.2;
        break;
      case 'contribution-source':
        color = theme.edgeStrong;
        width = 1.4;
        break;
      case 'paper-cites':
        color = theme.edge;
        alpha *= 0.5;
        width = 0.7;
        break;
      case 'source-paper':
        color = theme.edgeStrong;
        width = 1.2;
        break;
      default:
        color = theme.edge;
    }
    if (touchesFocus) {
      color = link.kind === 'domain-future' ? theme.label2 : theme.edgeFocus;
      width = Math.max(width, 1.4);
      alpha = Math.max(alpha, 0.9);
    }
    if (alpha <= 0.01) continue;
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.setLineDash(link.kind === 'domain-future' ? [2, 4] : []);
    ctx.beginPath();
    ctx.moveTo(a.sx, a.sy);
    if (curved.has(link.kind)) {
      const mx = (a.sx + b.sx) / 2;
      const my = (a.sy + b.sy) / 2;
      const dx = b.sx - a.sx;
      const dy = b.sy - a.sy;
      const bend = 0.16;
      ctx.quadraticCurveTo(mx - dy * bend, my + dx * bend, b.sx, b.sy);
    } else ctx.lineTo(b.sx, b.sy);
    ctx.stroke();
  }
  ctx.restore();
}

function drawNode(ctx: CanvasRenderingContext2D, s: DrawState, p: Placed) {
  const { node, sx, sy, r } = p;
  const { theme } = s;
  if (p.alpha <= 0.01) return;
  ctx.save();
  ctx.globalAlpha = p.alpha;
  const hovered = s.hovered === node.id;
  switch (node.kind) {
    case 'domain': {
      ctx.strokeStyle = node.live ? theme.label2 : theme.labelDim;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(sx, sy, r + 1, 0, Math.PI * 2);
      ctx.stroke();
      const arm = r + 5;
      ctx.beginPath();
      ctx.moveTo(sx - arm, sy);
      ctx.lineTo(sx - r - 2.5, sy);
      ctx.moveTo(sx + r + 2.5, sy);
      ctx.lineTo(sx + arm, sy);
      ctx.moveTo(sx, sy - arm);
      ctx.lineTo(sx, sy - r - 2.5);
      ctx.moveTo(sx, sy + r + 2.5);
      ctx.lineTo(sx, sy + arm);
      ctx.stroke();
      break;
    }
    case 'paper': {
      const seed = node.paper?.seed;
      ctx.globalAlpha = p.alpha * (seed || hovered ? 0.95 : 0.62);
      ctx.fillStyle = node.color;
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fill();
      if (seed) {
        ctx.globalAlpha = p.alpha * 0.7;
        ctx.strokeStyle = node.color;
        ctx.lineWidth = 0.9;
        ctx.beginPath();
        ctx.arc(sx, sy, r + 2.4, 0, Math.PI * 2);
        ctx.stroke();
      }
      break;
    }
    case 'future': {
      ctx.fillStyle = hovered ? theme.dimNodeHover : theme.dimNode;
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'field': {
      const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, r * 5.2);
      glow.addColorStop(0, withAlpha(node.color, 0.34));
      glow.addColorStop(0.35, withAlpha(node.color, 0.1));
      glow.addColorStop(1, withAlpha(node.color, 0));
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(sx, sy, r * 5.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = withAlpha(node.color, 0.55);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(sx, sy, r + 5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = node.color;
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'task': {
      const status = node.task?.status ?? 'open';
      ctx.fillStyle = theme.bg;
      ctx.beginPath();
      ctx.arc(sx, sy, r + 1.8, 0, Math.PI * 2);
      ctx.fill();
      if (status === 'claimed') {
        ctx.strokeStyle = node.color;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(sx, sy, r - 0.8, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = node.color;
        ctx.beginPath();
        ctx.arc(sx, sy, r - 0.8, -Math.PI / 2, Math.PI / 2);
        ctx.fill();
      } else {
        ctx.fillStyle = node.color;
        ctx.beginPath();
        ctx.arc(sx, sy, r, 0, Math.PI * 2);
        ctx.fill();
        if (status === 'completed') {
          ctx.strokeStyle = node.color;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(sx, sy, r + 3, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      break;
    }
    case 'source':
      drawSourceGlyph(ctx, node.source?.kind ?? 'paper', sx, sy, r, theme.source, theme.bg);
      break;
    case 'contribution': {
      const status = node.contribution?.status ?? 'proposed';
      ctx.fillStyle = theme.bg;
      ctx.beginPath();
      ctx.arc(sx, sy, r + 1.8, 0, Math.PI * 2);
      ctx.fill();
      if (status === 'accepted') {
        ctx.fillStyle = node.color;
        ctx.beginPath();
        ctx.arc(sx, sy, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = theme.label;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(sx, sy, r + 2.6, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        const muted = status === 'held';
        ctx.strokeStyle = muted ? theme.label2 : node.color;
        ctx.lineWidth = 1.6;
        ctx.setLineDash(status === 'proposed' ? [] : [2.5, 2.5]);
        ctx.beginPath();
        ctx.arc(sx, sy, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        if (status === 'proposed' && s.animatePulse) {
          const phase = (s.now % 2400) / 2400;
          ctx.globalAlpha = p.alpha * (1 - phase) * 0.7;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(sx, sy, r + 2 + phase * 9, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      break;
    }
  }
  if (s.selected === node.id || hovered) {
    ctx.globalAlpha = 1;
    ctx.strokeStyle = s.selected === node.id ? theme.ring : theme.label2;
    ctx.lineWidth = s.selected === node.id ? 1.5 : 1;
    ctx.beginPath();
    ctx.arc(sx, sy, r + (node.kind === 'field' ? 9 : 5), 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawSourceGlyph(
  ctx: CanvasRenderingContext2D,
  kind: string,
  x: number,
  y: number,
  r: number,
  color: string,
  bg: string,
) {
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.arc(x, y, r + 2.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1.5;
  const h = r * 0.9;
  ctx.beginPath();
  if (kind === 'paper') {
    ctx.arc(x, y, r - 0.4, 0, Math.PI * 2);
    ctx.stroke();
  } else if (kind === 'dataset') {
    ctx.rect(x - h, y - h, h * 2, h * 2);
    ctx.fill();
  } else if (kind === 'documentation') {
    ctx.rect(x - h + 0.75, y - h + 0.75, h * 2 - 1.5, h * 2 - 1.5);
    ctx.stroke();
  } else {
    const d = r * 1.25;
    ctx.moveTo(x, y - d);
    ctx.lineTo(x + d, y);
    ctx.lineTo(x, y + d);
    ctx.lineTo(x - d, y);
    ctx.closePath();
    ctx.fill();
  }
}

const truncate = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;

function drawLabels(ctx: CanvasRenderingContext2D, s: DrawState, placed: Map<string, Placed>) {
  const { view, theme } = s;
  const k = view.k;
  const boxes: [number, number, number, number][] = [];
  const free = (x: number, y: number, w: number, h: number) =>
    !boxes.some(([bx, by, bw, bh]) => x < bx + bw && x + w > bx && y < by + bh && y + h > by);
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';

  interface Candidate {
    p: Placed;
    priority: number;
    text: string;
    font: string;
    color: string;
    below: boolean;
    spacing: number;
  }
  const candidates: Candidate[] = [];
  const f = s.fontFamily;
  // Zoomed far out (small screens), labels shrink a little so the clusters stay legible.
  const small = k < 0.62;
  for (const p of placed.values()) {
    const { node } = p;
    if (node.id === s.tooltip) continue;
    if (p.sx < 0 || p.sx > s.width || p.sy < 0 || p.sy > s.height) continue;
    if (p.alpha < 0.2 && node.id !== s.focus) continue;
    const isFocus = node.id === s.focus;
    const near = !!s.focus && !!s.neighbours?.has(node.id);
    switch (node.kind) {
      case 'domain':
        candidates.push({
          p,
          priority: 80,
          text: node.label.toUpperCase(),
          font: `600 ${small ? 9.5 : 10.5}px ${f}`,
          color: node.live ? theme.label2 : theme.labelDim,
          below: false,
          spacing: 1.6,
        });
        break;
      case 'field':
        candidates.push({
          p,
          priority: isFocus ? 100 : 90,
          text: node.label,
          font: `600 ${small ? 12 : 13}px ${f}`,
          color: theme.label,
          below: true,
          spacing: 0,
        });
        break;
      case 'future':
        if (isFocus || k >= 1.7)
          candidates.push({
            p,
            priority: isFocus ? 100 : 10,
            text: node.label,
            font: `500 11px ${f}`,
            color: isFocus ? theme.label2 : theme.labelDim,
            below: true,
            spacing: 0,
          });
        break;
      default: {
        const zoomed =
          node.kind === 'paper'
            ? k >= (node.paper?.seed ? 1.7 : 2.6)
            : node.kind === 'source'
              ? k >= 2.1
              : k >= 1.55;
        if (isFocus || near || zoomed)
          candidates.push({
            p,
            priority: isFocus ? 100 : near ? 60 : node.kind === 'task' ? 40 : 30,
            text: isFocus ? truncate(node.label, 64) : truncate(node.label, 38),
            font: `${isFocus ? 600 : 500} 11.5px ${f}`,
            color: isFocus ? theme.label : theme.label2,
            below: true,
            spacing: 0,
          });
      }
    }
  }
  candidates.sort((a, b) => b.priority - a.priority);
  // Live nodes are obstacles too: a label may cross a dim area, never a record.
  const obstacles: { id: string; box: [number, number, number, number] }[] = [];
  for (const p of placed.values())
    if (p.alpha >= 0.2 && p.node.live && p.node.kind !== 'domain')
      obstacles.push({
        id: p.node.id,
        box: [p.sx - p.r - 3, p.sy - p.r - 3, p.r * 2 + 6, p.r * 2 + 6],
      });
  const overlaps = (a: number[], b: number[]) =>
    a[0] < b[0] + b[2] && a[0] + a[2] > b[0] && a[1] < b[1] + b[3] && a[1] + a[3] > b[1];
  const clear = (box: [number, number, number, number], own: string) =>
    free(...box) && !obstacles.some((o) => o.id !== own && overlaps(box, o.box));
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  for (const c of candidates) {
    ctx.font = c.font;
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${c.spacing}px`;
    const width = ctx.measureText(c.text).width;
    const height = 14;
    const { sx, sy, r } = c.p;
    const offset = c.p.node.kind === 'field' ? r + 17 : r + 11;
    const side = r + (c.p.node.kind === 'field' ? 14 : 8) + width / 2 + 3;
    const below: [number, number] = [sx, sy + offset];
    const above: [number, number] = [sx, sy - offset - 4];
    // Keep every label inside the frame; a clipped name is worse than a nudged one.
    const inFrame = ([x, y]: [number, number]): [number, number] => [
      Math.min(Math.max(x, width / 2 + 8), s.width - width / 2 - 8),
      y,
    ];
    const spots = (
      [
        ...(c.below ? [below, above] : [above, below]),
        [sx + side, sy],
        [sx - side, sy],
        [sx, sy - offset - 20],
        [sx, sy + offset + 16],
      ] as [number, number][]
    ).map(inFrame);
    const boxAt = ([x, y]: [number, number]): [number, number, number, number] => [
      x - width / 2 - 3,
      y - height / 2,
      width + 6,
      height,
    ];
    let spot = spots.find((p) => clear(boxAt(p), c.p.node.id));
    // Field hubs, domain names and the focused record are always labelled.
    if (!spot && c.priority >= 80) spot = spots.find((p) => free(...boxAt(p))) ?? spots[0];
    if (!spot) continue;
    const [x, y] = spot;
    boxes.push(boxAt(spot));
    ctx.globalAlpha = Math.max(c.p.alpha, c.p.node.id === s.focus ? 1 : 0);
    ctx.strokeStyle = theme.bg;
    ctx.lineWidth = 4;
    ctx.strokeText(c.text, x, y);
    ctx.fillStyle = c.color;
    ctx.fillText(c.text, x, y);
  }
  ctx.restore();
}
