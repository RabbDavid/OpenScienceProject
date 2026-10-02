import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
} from 'd3-force';
import { select } from 'd3-selection';
import { zoom as d3zoom, zoomIdentity } from 'd3-zoom';
import { ArrowRight, ArrowUpRight, Layers as LayersIcon, Minus, Plus, Scan, X } from 'lucide-react';
import type { Contribution, Field, Paper, Snapshot, Task } from '../shared/types.ts';
import { prettyKind, prettyOrigin, byCitations, citationLabel } from './api.ts';
import './AtlasEnhancements.css';
import {
  DOMAINS,
  WIDER_MAP,
  anchorOf,
  buildAtlas,
  domainOf,
  endpoint,
  hash01,
  fieldIdOf,
  researchAnchor,
  mappedContribution,
  nodeId,
  sameWork,
  structureKey,
  type AtlasLink,
  type AtlasNode,
  type LinkKind,
  type NodeKind,
} from './atlas.ts';
import {
  drawAtlas,
  readTheme,
  screenRadius,
  toScreen,
  type AtlasTheme,
  type View,
} from './atlasDraw.ts';
import {
  FieldChip,
  PriorityIcon,
  SourceGlyph,
  StatusIcon,
  StatusPill,
  sourceKindLabel,
} from './components.tsx';

type LayerKey = 'questions' | 'sources' | 'literature' | 'contributions' | 'wider';
type Layers = Record<LayerKey, boolean>;

const REVEAL_MS = 1500;
const SETTLE_TICKS = 320;

const LINK: Record<LinkKind, { distance: number; strength: number }> = {
  'domain-future': { distance: 58, strength: 0.5 },
  'domain-field': { distance: 110, strength: 0.45 },
  'field-task': { distance: 88, strength: 0.55 },
  'task-source': { distance: 70, strength: 0.3 },
  'contribution-task': { distance: 28, strength: 0.9 },
  'contribution-source': { distance: 72, strength: 0.12 },
  'paper-cites': { distance: 46, strength: 0.05 },
  'source-paper': { distance: 16, strength: 0.6 },
  layout: { distance: 120, strength: 0.07 },
};
const CHARGE: Record<NodeKind, number> = {
  domain: -150,
  future: -62,
  field: -520,
  paper: -55,
  task: -180,
  source: -130,
  contribution: -60,
};
const COLLIDE: Record<NodeKind, number> = {
  domain: 16,
  future: 11,
  field: 28,
  paper: 7.5,
  task: 13,
  source: 12,
  contribution: 11,
};

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const isVisible = (node: AtlasNode, layers: Layers) => node.layer === 'core' || layers[node.layer];

function createSimulation(nodes: AtlasNode[], links: AtlasLink[]) {
  return forceSimulation<AtlasNode>(nodes)
    .force(
      'link',
      forceLink<AtlasNode, AtlasLink>(links)
        .id((d) => d.id)
        .distance((l) => LINK[l.kind].distance)
        .strength((l) => LINK[l.kind].strength),
    )
    .force(
      'charge',
      forceManyBody<AtlasNode>()
        .strength((d) => CHARGE[d.kind])
        .distanceMax(420),
    )
    .force('collide', forceCollide<AtlasNode>((d) => COLLIDE[d.kind]).iterations(2))
    .force(
      'x',
      forceX<AtlasNode>((d) => researchAnchor(d)[0]).strength((d) =>
        d.kind === 'domain' ? 0.6 : d.kind === 'field' ? 0.16 : d.kind === 'paper' ? 0.085 : 0.055,
      ),
    )
    .force(
      'y',
      forceY<AtlasNode>((d) => researchAnchor(d)[1]).strength((d) =>
        d.kind === 'domain' ? 0.6 : d.kind === 'field' ? 0.16 : d.kind === 'paper' ? 0.085 : 0.055,
      ),
    )
    .stop();
}

/** Place nodes that have no position yet near the record they hang from. */
function seedPositions(nodes: AtlasNode[], links: AtlasLink[]) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const parent = new Map<string, string>();
  for (const l of links) {
    const target = endpoint(l.target);
    if (!parent.has(target)) parent.set(target, endpoint(l.source));
  }
  const order: NodeKind[] = [
    'domain',
    'future',
    'field',
    'paper',
    'task',
    'source',
    'contribution',
  ];
  for (const kind of order)
    for (const node of nodes) {
      if (node.kind !== kind || node.x !== undefined) continue;
      const angle = hash01(node.id) * Math.PI * 2;
      const [ax, ay] = anchorOf(node.domain);
      let px = ax;
      let py = ay;
      let spread = 55;
      const from =
        kind === 'contribution'
          ? byId.get(nodeId.task(node.contribution!.taskId))
          : byId.get(parent.get(node.id) ?? '');
      if (kind === 'domain') spread = 0;
      else if (from?.x !== undefined) {
        px = from.x;
        py = from.y!;
        spread = kind === 'contribution' ? 18 : kind === 'paper' ? 90 : 38;
      }
      node.x = px + Math.cos(angle) * spread;
      node.y = py + Math.sin(angle) * spread;
    }
}

function adjacencyOf(links: AtlasLink[]) {
  const adjacency = new Map<string, Set<string>>();
  const add = (a: string, b: string) => {
    if (!adjacency.has(a)) adjacency.set(a, new Set());
    adjacency.get(a)!.add(b);
  };
  for (const l of links) {
    if (l.kind === 'layout') continue;
    add(endpoint(l.source), endpoint(l.target));
    add(endpoint(l.target), endpoint(l.source));
  }
  return adjacency;
}

interface Engine {
  nodes: AtlasNode[];
  links: AtlasLink[];
  byId: Map<string, AtlasNode>;
  adjacency: Map<string, Set<string>>;
  key: string;
  sim: Simulation<AtlasNode, AtlasLink> | null;
  simRunning: boolean;
  view: View;
  width: number;
  height: number;
  dpr: number;
  theme: AtlasTheme | null;
  font: string;
  hovered: string | null;
  selected: string | null;
  layers: Layers;
  revealStart: number | null;
  reveal: number;
  userMoved: boolean;
  cameraField: string;
  reduced: boolean;
  drag: { id: string; x: number; y: number; moved: boolean; pointerId: number } | null;
  frame: number;
  pulseTimer: number;
}

interface Controls {
  requestDraw: () => void;
  fit: (animate: boolean) => void;
  zoomBy: (factor: number) => void;
  reveal: (id: string) => void;
  frameField: (id: string) => void;
}

export function Atlas({
  data,
  onTask,
  onField,
  onContribution,
  children,
  embedded = false,
  preview = false,
  immersive = false,
}: {
  data: Snapshot;
  onTask: (task: Task) => void;
  onField: (field: Field) => void;
  onContribution: (contribution: Contribution) => void;
  /** Overlay content for the top-left corner. */
  children?: ReactNode;
  /** Inside a scrolling page: wheel zoom needs Ctrl/⌘ and one-finger touch scrolls the page. */
  embedded?: boolean;
  /** A small, non-interactive thumbnail. The parent makes the whole thing a link. */
  preview?: boolean;
  /** Full-width interactive overview scene. */
  immersive?: boolean;
}) {
  const embeddedRef = useRef(embedded);
  embeddedRef.current = embedded;
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const controls = useRef<Controls | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [layers, setLayers] = useState<Layers>({
    questions: true,
    sources: true,
    literature: true,
    contributions: true,
    wider: false,
  });
  const [legendOpen, setLegendOpen] = useState(false);
  const [cameraField, setCameraField] = useState('all');
  const engine = useRef<Engine>({
    nodes: [],
    links: [],
    byId: new Map(),
    adjacency: new Map(),
    key: '',
    sim: null,
    simRunning: false,
    view: { x: 0, y: 0, k: 1 },
    width: 0,
    height: 0,
    dpr: 1,
    theme: null,
    font: 'system-ui, sans-serif',
    hovered: null,
    selected: null,
    layers,
    revealStart: null,
    reveal: 1,
    userMoved: false,
    cameraField: 'all',
    reduced: false,
    drag: null,
    frame: 0,
    pulseTimer: 0,
  });

  // Canvas, zoom, pointer handling and the render loop. Set up once.
  useEffect(() => {
    const e = engine.current;
    const canvas = canvasRef.current!;
    const wrap = wrapRef.current!;
    const ctx = canvas.getContext('2d');
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    e.reduced = motion.matches;
    e.theme = readTheme(wrap);
    e.font = getComputedStyle(wrap).getPropertyValue('--font-sans').trim() || e.font;

    const visible = (n: AtlasNode) => isVisible(n, e.layers);
    const pulsing = () =>
      !e.reduced &&
      e.layers.contributions &&
      !document.hidden &&
      e.nodes.some((n) => n.contribution?.status === 'proposed');

    const render = (now: number) => {
      if (!ctx || !e.theme || !e.width) return;
      const focus = e.hovered ?? e.selected;
      let neighbours: Set<string> | null = null;
      if (focus) {
        neighbours = new Set([focus]);
        for (const id of e.adjacency.get(focus) ?? []) neighbours.add(id);
      }
      drawAtlas(ctx, {
        width: e.width,
        height: e.height,
        dpr: e.dpr,
        view: e.view,
        nodes: e.nodes,
        links: e.links,
        visible,
        focus,
        neighbours,
        hovered: e.hovered,
        selected: e.selected,
        tooltip: e.hovered && e.hovered !== e.selected ? e.hovered : null,
        theme: e.theme,
        now,
        reveal: e.reveal,
        animatePulse: pulsing(),
        fontFamily: e.font,
      });
    };

    const loop = (now: number) => {
      e.frame = 0;
      let again = false;
      if (e.sim && e.simRunning) {
        e.sim.tick();
        if (e.sim.alpha() < e.sim.alphaMin() && !e.drag?.moved) e.simRunning = false;
        else again = true;
      }
      if (e.revealStart !== null) {
        e.reveal = Math.min(1, (now - e.revealStart) / REVEAL_MS);
        if (e.reveal >= 1) e.revealStart = null;
        else again = true;
      }
      render(now);
      if (again) e.frame = requestAnimationFrame(loop);
      else if (pulsing()) {
        clearTimeout(e.pulseTimer);
        // A slow timer, not a free-running frame loop: the pulse needs ~20 fps at most.
        e.pulseTimer = window.setTimeout(requestDraw, 50);
      }
    };
    const requestDraw = () => {
      if (!e.frame) e.frame = requestAnimationFrame(loop);
    };

    const local = (ev: { clientX: number; clientY: number }) => {
      const rect = canvas.getBoundingClientRect();
      return [ev.clientX - rect.left, ev.clientY - rect.top] as const;
    };
    const hit = (px: number, py: number) => {
      let best: AtlasNode | null = null;
      let bestScore = Infinity;
      for (const n of e.nodes) {
        if (!visible(n) || n.x === undefined) continue;
        const [sx, sy] = toScreen(e.view, n.x, n.y);
        const reach = Math.max(screenRadius(n, e.view.k) + 5, 9);
        const d = Math.hypot(px - sx, py - sy);
        if (d > reach) continue;
        const score = d + (n.live ? 0 : 4);
        if (score < bestScore) {
          best = n;
          bestScore = score;
        }
      }
      return best;
    };

    const zoomBehavior = d3zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([0.25, 5])
      .filter((event: MouseEvent & TouchEvent & WheelEvent) => {
        if (event.type === 'wheel') return !embeddedRef.current || event.ctrlKey || event.metaKey;
        if (event.type === 'dblclick' || event.button) return false;
        if (embeddedRef.current && event.touches && event.touches.length < 2) return false;
        const point = event.touches?.[0] ?? event;
        const [px, py] = local(point);
        return !hit(px, py);
      })
      .on('zoom', (event) => {
        const t = event.transform;
        e.view = { x: t.x, y: t.y, k: t.k };
        if (event.sourceEvent) e.userMoved = true;
        requestDraw();
      });
    const selection = select(canvas);
    selection.call(zoomBehavior).on('dblclick.zoom', null);

    let tween = 0;
    const transitionTo = (target: View, animate: boolean) => {
      cancelAnimationFrame(tween);
      const apply = (v: View) =>
        zoomBehavior.transform(selection, zoomIdentity.translate(v.x, v.y).scale(v.k));
      if (!animate || e.reduced) {
        apply(target);
        return;
      }
      const from = { ...e.view };
      const start = performance.now();
      const step = (now: number) => {
        const t = Math.min(1, (now - start) / 420);
        const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
        apply({
          x: from.x + (target.x - from.x) * ease,
          y: from.y + (target.y - from.y) * ease,
          k: from.k * Math.pow(target.k / from.k, ease),
        });
        if (t < 1) tween = requestAnimationFrame(step);
      };
      tween = requestAnimationFrame(step);
    };

    /** The part of the canvas not covered by the intro overlay. */
    const freeRect = () => {
      const full = { x: 0, y: 0, w: e.width, h: e.height };
      const overlay = overlayRef.current?.getBoundingClientRect();
      const box = wrap.getBoundingClientRect();
      if (!overlay || !overlay.width) return full;
      if (!immersive && e.width >= 960) {
        const top = overlay.bottom - box.top + 20;
        return { x: 28, y: top, w: e.width - 56, h: Math.max(e.height - top - 90, 200) };
      }
      if (e.width >= 960) {
        const left = Math.min(overlay.right - box.left, e.width * 0.4);
        return { x: left, y: 24, w: e.width - left - 20, h: e.height - 115 };
      }
      const top = overlay.bottom - box.top;
      return { x: 0, y: top + 12, w: e.width, h: Math.max(e.height - top - 110, e.height * 0.4) };
    };

    const fit = (animate: boolean) => {
      e.cameraField = 'all';
      // On phones, frame the live records and let the dim wider map crop at the edges.
      const narrow = e.width < 760;
      const nodes = e.nodes.filter((n) => visible(n) && n.x !== undefined && (!narrow || n.live));
      if (!nodes.length || !e.width) return;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const n of nodes) {
        minX = Math.min(minX, n.x!);
        maxX = Math.max(maxX, n.x!);
        minY = Math.min(minY, n.y!);
        maxY = Math.max(maxY, n.y!);
      }
      const free = freeRect();
      const pad = narrow ? 40 : 48;
      // Slightly over-fit so the outer, dim edge of the map crops at the frame: it should read
      // as part of a larger map rather than a finished diagram.
      const k = Math.min(
        Math.max(
          (e.layers.wider ? 1.08 : 0.97) *
            Math.min(
              (free.w - pad * 2) / Math.max(maxX - minX, 1),
              (free.h - pad * 2) / Math.max(maxY - minY, 1),
            ),
          0.3,
        ),
        1.85,
      );
      transitionTo(
        {
          x: free.x + free.w / 2 - (k * (minX + maxX)) / 2,
          y: free.y + free.h / 2 - (k * (minY + maxY)) / 2,
          k,
        },
        animate,
      );
    };

    const frameField = (fieldId: string, animate = true) => {
      const nodes = e.nodes.filter(
        (n) => visible(n) && fieldIdOf(n) === fieldId && n.x !== undefined,
      );
      if (!nodes.length) return;
      e.cameraField = fieldId;
      e.userMoved = true;
      const xs = nodes.map((n) => n.x!);
      const ys = nodes.map((n) => n.y!);
      const minX = Math.min(...xs),
        maxX = Math.max(...xs);
      const minY = Math.min(...ys),
        maxY = Math.max(...ys);
      const free = freeRect();
      const k = Math.min(
        2.8,
        Math.max(
          0.5,
          Math.min(
            (free.w - 100) / Math.max(maxX - minX, 1),
            (free.h - 90) / Math.max(maxY - minY, 1),
          ),
        ),
      );
      transitionTo(
        {
          x: free.x + free.w / 2 - (k * (minX + maxX)) / 2,
          y: free.y + free.h / 2 - (k * (minY + maxY)) / 2,
          k,
        },
        animate,
      );
    };

    const zoomBy = (factor: number) => {
      const free = freeRect();
      const cx = free.x + free.w / 2;
      const cy = free.y + free.h / 2;
      const k = Math.min(Math.max(e.view.k * factor, 0.25), 5);
      const wx = (cx - e.view.x) / e.view.k;
      const wy = (cy - e.view.y) / e.view.k;
      transitionTo({ x: cx - wx * k, y: cy - wy * k, k }, true);
    };

    /** Pan a node into view if it is off-screen or hidden behind the detail panel. */
    const reveal = (id: string) => {
      const node = e.byId.get(id);
      if (!node || node.x === undefined) return;
      const [sx, sy] = toScreen(e.view, node.x, node.y);
      const narrow = e.width < 760;
      const left = narrow ? 0 : Math.max(freeRect().x, 0);
      const right = e.width - (narrow ? 0 : 400);
      const bottom = e.height - (narrow ? e.height * 0.6 : 0);
      const margin = 48;
      const inside =
        sx > left + margin && sx < right - margin && sy > margin && sy < bottom - margin;
      // On phones the sheet covers most of the map, so always centre the selection above it.
      if (inside && !narrow) return;
      const tx = (left + right) / 2;
      const ty = bottom / 2;
      transitionTo({ x: e.view.x + tx - sx, y: e.view.y + ty - sy, k: e.view.k }, true);
    };

    let suppressClick = false;
    const setHover = (id: string | null) => {
      if (e.hovered === id) return;
      e.hovered = id;
      setHovered(id);
      canvas.style.cursor = id ? 'pointer' : '';
      requestDraw();
    };
    const onPointerMove = (ev: PointerEvent) => {
      const [px, py] = local(ev);
      const drag = e.drag;
      if (drag && drag.pointerId === ev.pointerId) {
        const node = e.byId.get(drag.id);
        if (!node) return;
        if (!drag.moved && Math.hypot(px - drag.x, py - drag.y) > 4) {
          drag.moved = true;
          if (e.sim) e.sim.alphaTarget(0.25).alpha(Math.max(e.sim.alpha(), 0.25));
          e.simRunning = true;
          canvas.style.cursor = 'grabbing';
        }
        if (drag.moved) {
          node.fx = (px - e.view.x) / e.view.k;
          node.fy = (py - e.view.y) / e.view.k;
          requestDraw();
        }
        return;
      }
      if (ev.pointerType === 'touch') return;
      const node = hit(px, py);
      const tip = tooltipRef.current;
      if (node && tip) {
        // Anchor beside the node, not the cursor, so it never covers the node's own label.
        const [sx, sy] = toScreen(e.view, node.x, node.y);
        const gap = screenRadius(node, e.view.k) + (node.kind === 'field' ? 16 : 12);
        const flip = sx + gap + Math.max(tip.offsetWidth, 180) + 12 > e.width;
        tip.style.transform = flip
          ? `translate(${sx - gap}px, ${sy}px) translate(-100%, -50%)`
          : `translate(${sx + gap}px, ${sy}px) translateY(-50%)`;
      }
      setHover(node?.id ?? null);
    };
    const onPointerDown = (ev: PointerEvent) => {
      if (ev.button !== 0) return;
      if (embeddedRef.current && ev.pointerType === 'touch') return;
      const [px, py] = local(ev);
      const node = hit(px, py);
      if (!node) return;
      e.drag = { id: node.id, x: px, y: py, moved: false, pointerId: ev.pointerId };
      canvas.setPointerCapture(ev.pointerId);
    };
    const onPointerUp = (ev: PointerEvent) => {
      const drag = e.drag;
      if (!drag || drag.pointerId !== ev.pointerId) return;
      e.drag = null;
      if (canvas.hasPointerCapture(ev.pointerId)) canvas.releasePointerCapture(ev.pointerId);
      const node = e.byId.get(drag.id);
      if (drag.moved) {
        if (node) {
          node.fx = null;
          node.fy = null;
        }
        e.sim?.alphaTarget(0);
        canvas.style.cursor = e.hovered ? 'pointer' : '';
        suppressClick = true;
        requestDraw();
      } else if (node) {
        setSelected(node.id);
      }
    };
    const onClick = (ev: MouseEvent) => {
      if (suppressClick) {
        suppressClick = false;
        return;
      }
      const [px, py] = local(ev);
      if (!hit(px, py)) setSelected(null);
    };
    const onLeave = () => {
      if (!e.drag) setHover(null);
    };
    const onVisibility = () => {
      if (!document.hidden) requestDraw();
    };
    const onMotion = () => {
      e.reduced = motion.matches;
      if (e.reduced) e.reveal = 1;
      requestDraw();
    };
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('pointerleave', onLeave);
    canvas.addEventListener('click', onClick);
    document.addEventListener('visibilitychange', onVisibility);
    motion.addEventListener('change', onMotion);

    const resize = (width: number, height: number) => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      if (width === e.width && height === e.height && dpr === e.dpr) return;
      const reframe =
        !e.userMoved || Math.abs(width - e.width) > 40 || Math.abs(height - e.height) > 40;
      e.width = width;
      e.height = height;
      e.dpr = dpr;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      if (reframe && e.nodes.length) {
        if (e.cameraField === 'all') fit(false);
        else frameField(e.cameraField, false);
      }
      requestDraw();
    };
    const initial = wrap.getBoundingClientRect();
    resize(initial.width, initial.height);
    const observer = new ResizeObserver(([entry]) =>
      resize(entry.contentRect.width, entry.contentRect.height),
    );
    observer.observe(wrap);
    void document.fonts?.ready.then(requestDraw);

    controls.current = { requestDraw, fit, zoomBy, reveal, frameField };
    requestDraw();
    return () => {
      observer.disconnect();
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('click', onClick);
      document.removeEventListener('visibilitychange', onVisibility);
      motion.removeEventListener('change', onMotion);
      selection.on('.zoom', null);
      cancelAnimationFrame(e.frame);
      cancelAnimationFrame(tween);
      clearTimeout(e.pulseTimer);
      e.frame = 0;
      controls.current = null;
    };
  }, []);

  const graph = useMemo(() => buildAtlas(data), [data]);

  // Adopt the rebuilt graph. Positions survive refreshes; an unchanged structure never re-runs layout.
  useEffect(() => {
    const e = engine.current;
    const { nodes, links } = graph;
    const key = structureKey(nodes, links);
    if (key === e.key) {
      for (const n of nodes) {
        const old = e.byId.get(n.id);
        if (old)
          Object.assign(old, {
            label: n.label,
            color: n.color,
            r: n.r,
            field: n.field,
            task: n.task,
            source: n.source,
            contribution: n.contribution,
          });
      }
      controls.current?.requestDraw();
      return;
    }
    const first = e.key === '';
    for (const n of nodes) {
      const old = e.byId.get(n.id);
      if (old?.x !== undefined) {
        n.x = old.x;
        n.y = old.y;
      }
    }
    seedPositions(nodes, links);
    e.nodes = nodes;
    e.links = links;
    e.key = key;
    e.byId = new Map(nodes.map((n) => [n.id, n]));
    e.adjacency = adjacencyOf(links);
    e.sim = createSimulation(nodes, links);
    if (first || e.reduced) {
      e.sim.alpha(1).tick(SETTLE_TICKS);
      e.simRunning = false;
      if (first) {
        controls.current?.fit(false);
        if (!e.reduced) {
          e.reveal = 0;
          e.revealStart = performance.now();
        }
      }
    } else {
      e.sim.alpha(0.3);
      e.simRunning = true;
    }
    if (e.selected && !e.byId.has(e.selected)) setSelected(null);
    controls.current?.requestDraw();
  }, [graph]);

  useEffect(() => {
    const e = engine.current;
    e.selected = selected;
    e.layers = layers;
    controls.current?.requestDraw();
  }, [selected, layers]);

  useEffect(() => {
    if (!selected) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !document.querySelector('dialog[open]')) setSelected(null);
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [selected]);

  const choose = (id: string) => {
    const node = engine.current.byId.get(id);
    if (!node) return;
    if (node.layer !== 'core' && !layers[node.layer])
      setLayers((old) => ({ ...old, [node.layer]: true }));
    setSelected(id);
    requestAnimationFrame(() => {
      controls.current?.reveal(id);
      // Hand keyboard focus out of the record chooser. Its focus-within surface
      // otherwise stays over the inspector and intercepts the inspector's actions.
      wrapRef.current?.querySelector<HTMLElement>('.atlas-panel')?.focus({ preventScroll: true });
    });
  };

  const hoverNode = hovered ? engine.current.byId.get(hovered) : undefined;
  const selectedNode = selected ? engine.current.byId.get(selected) : undefined;
  const mappedContributions = data.contributions.filter(mappedContribution);
  const widerCount = graph.nodes.filter((n) => n.kind === 'future').length;
  const toggle = (key: LayerKey) => {
    setLayers((old) => ({ ...old, [key]: !old[key] }));
    const node = selected ? engine.current.byId.get(selected) : undefined;
    if (node && node.layer === key) setSelected(null);
  };
  const layerRows: { key: LayerKey; label: string; count: string; glyph: ReactNode }[] = [
    {
      key: 'questions',
      label: 'Questions',
      count: String(data.tasks.length),
      glyph: <span className="glyph-task" />,
    },
    {
      key: 'sources',
      label: 'Sources',
      count: String(data.sources.length),
      glyph: <SourceGlyph kind="paper" size={11} />,
    },
    {
      key: 'literature',
      label: 'Papers',
      count: String(data.papers.length),
      glyph: <span className="glyph-paper" />,
    },
    {
      key: 'contributions',
      label: 'Contributions',
      count: String(mappedContributions.length),
      glyph: <span className="glyph-contribution" />,
    },
    {
      key: 'wider',
      label: 'Wider map',
      count: `${widerCount} not open`,
      glyph: <span className="glyph-future" />,
    },
  ];

  return (
    <div
      className={`atlas theme-dark ${embedded ? 'atlas-embedded' : ''} ${preview ? 'atlas-preview' : ''} ${immersive ? 'atlas-immersive' : ''}`}
      ref={wrapRef}
      inert={preview || undefined}
    >
      <canvas
        ref={canvasRef}
        className="atlas-canvas"
        role="img"
        aria-label={`Knowledge map: ${data.fields.length} open fields, ${data.tasks.length} questions, ${data.sources.length} sources, ${data.papers.length} published papers and ${mappedContributions.length} contributions, set among ${widerCount} areas that are not open yet. Use the record list after the map to inspect records with a keyboard.`}
      />
      <div
        ref={tooltipRef}
        className={`atlas-tooltip ${hoverNode && hoverNode.id !== selected ? 'is-visible' : ''}`}
        aria-hidden="true"
      >
        {hoverNode && <TooltipBody node={hoverNode} data={data} />}
      </div>
      {children && (
        <div className="atlas-overlay" ref={overlayRef}>
          {children}
        </div>
      )}
      {!preview && (
        <nav className="atlas-fields" aria-label="Focus map on a research field">
          <button
            aria-pressed={cameraField === 'all'}
            onClick={() => {
              setCameraField('all');
              setSelected(null);
              controls.current?.fit(true);
            }}
          >
            All fields
          </button>
          {data.fields.map((field) => (
            <button
              key={field.id}
              aria-pressed={cameraField === field.id}
              onClick={() => {
                setCameraField(field.id);
                setSelected(null);
                controls.current?.frameField(field.id);
              }}
            >
              <i style={{ background: field.color }} />
              {field.shortName}
            </button>
          ))}
        </nav>
      )}
      <div className={`atlas-legend ${legendOpen ? 'is-open' : ''}`}>
        <button
          className="atlas-legend-toggle"
          aria-expanded={legendOpen}
          onClick={() => setLegendOpen(!legendOpen)}
        >
          <LayersIcon size={15} /> Layers
        </button>
        <div className="atlas-legend-body">
          <div className="legend-fields">
            <span className="legend-field-dots">
              {data.fields.map((f) => (
                <i key={f.id} style={{ background: f.color }} />
              ))}
            </span>
            {data.fields.length} open fields
          </div>
          {layerRows.map((row) => (
            <button
              key={row.key}
              className="layer-toggle"
              aria-pressed={layers[row.key]}
              onClick={() => toggle(row.key)}
            >
              <span className="layer-check" aria-hidden="true" />
              <span className="layer-glyph" aria-hidden="true">
                {row.glyph}
              </span>
              <span className="layer-name">{row.label}</span>
              <span className="layer-count">{row.count}</span>
            </button>
          ))}
          <div className="legend-key" aria-label="Source shapes">
            {(['paper', 'dataset', 'documentation', 'code'] as const).map((kind) => (
              <span key={kind}>
                <SourceGlyph kind={kind} size={10} />
                {kind === 'documentation' ? 'Docs' : sourceKindLabel(kind)}
              </span>
            ))}
          </div>
          <div className="legend-key" aria-label="Contribution states">
            <span>
              <span className="glyph-contribution" /> Accepted
            </span>
            <span>
              <span className="glyph-contribution is-proposed" /> Proposed
            </span>
          </div>
          <p className="legend-note">
            Lines show recorded relationships. Distance is a layout choice. Paper size reflects
            available citation counts.
          </p>
        </div>
      </div>
      <div className="atlas-zoom" role="group" aria-label="Map zoom">
        <button
          className="icon-btn"
          aria-label="Zoom in"
          onClick={() => controls.current?.zoomBy(1.4)}
        >
          <Plus size={16} />
        </button>
        <button
          className="icon-btn"
          aria-label="Zoom out"
          onClick={() => controls.current?.zoomBy(1 / 1.4)}
        >
          <Minus size={16} />
        </button>
        <button
          className="icon-btn"
          aria-label="Fit the whole map"
          onClick={() => {
            setCameraField('all');
            controls.current?.fit(true);
          }}
        >
          <Scan size={15} />
        </button>
      </div>
      {selectedNode && (
        <AtlasPanel
          key={selectedNode.id}
          node={selectedNode}
          data={data}
          onSelect={choose}
          onClose={() => setSelected(null)}
          onTask={onTask}
          onField={onField}
          onContribution={onContribution}
        />
      )}
      <nav className="atlas-records" aria-label="Knowledge map records">
        <ul>
          {graph.nodes
            .filter((n) => (n.live && n.kind !== 'domain') || (n.kind === 'future' && layers.wider))
            .map((n) => (
              <li key={n.id}>
                <button onClick={() => choose(n.id)}>
                  {kindName[n.kind]}: {n.label}
                </button>
              </li>
            ))}
        </ul>
      </nav>
    </div>
  );
}

const kindName: Record<NodeKind, string> = {
  domain: 'Domain',
  future: 'Not open yet',
  field: 'Open field',
  task: 'Question',
  source: 'Source',
  paper: 'Paper',
  contribution: 'Contribution',
};

function TooltipBody({ node, data }: { node: AtlasNode; data: Snapshot }) {
  let detail = kindName[node.kind];
  if (node.task) detail = `Question · ${prettyKind(node.task.kind)} · ${node.task.status}`;
  if (node.source) detail = `${sourceKindLabel(node.source.kind)} · external source`;
  if (node.paper) detail = `${node.paper.year ?? 'Undated'} · ${citationLabel(node.paper)}`;
  if (node.contribution) detail = `Contribution · ${node.contribution.status.replaceAll('_', ' ')}`;
  if (node.field) {
    const open = data.tasks.filter((t) => t.fieldId === node.field!.id && t.status === 'open');
    detail = `Open field · ${count(open.length, 'open question')}`;
  }
  if (node.kind === 'domain') detail = node.live ? 'Domain' : 'Domain · not open yet';
  return (
    <>
      <strong>{node.label}</strong>
      <span className={node.live ? '' : 'is-dark'}>{detail}</span>
    </>
  );
}

function AtlasPanel({
  node,
  data,
  onSelect,
  onClose,
  onTask,
  onField,
  onContribution,
}: {
  node: AtlasNode;
  data: Snapshot;
  onSelect: (id: string) => void;
  onClose: () => void;
  onTask: (task: Task) => void;
  onField: (field: Field) => void;
  onContribution: (contribution: Contribution) => void;
}) {
  const fieldOf = (id: string) => data.fields.find((f) => f.id === id);
  // Read the freshest record from the snapshot, not the cached node payload.
  const task = node.task && data.tasks.find((t) => t.id === node.task!.id);
  const source = node.source && data.sources.find((s) => s.id === node.source!.id);
  const contribution =
    node.contribution && data.contributions.find((c) => c.id === node.contribution!.id);
  const field = node.field && data.fields.find((f) => f.id === node.field!.id);
  const paper = node.paper && data.papers.find((p) => p.id === node.paper!.id);

  const record = (id: string, content: ReactNode) => (
    <button key={id} className="panel-record" onClick={() => onSelect(id)}>
      {content}
    </button>
  );
  const taskLink = (t: Task) =>
    record(
      nodeId.task(t.id),
      <>
        <StatusIcon status={t.status} size={13} />
        <span>{t.title}</span>
      </>,
    );
  const sourceLink = (id: string) => {
    const s = data.sources.find((x) => x.id === id);
    if (!s) return null;
    return record(
      nodeId.source(id),
      <>
        <SourceGlyph kind={s.kind} size={11} />
        <span>{s.title}</span>
      </>,
    );
  };
  const paperLink = (p: Paper) =>
    record(
      nodeId.paper(p.id),
      <>
        <span className="glyph-paper" style={{ background: fieldOf(p.fieldId)?.color }} />
        <span>
          {p.title} <span className="panel-year">{p.year}</span>
        </span>
      </>,
    );
  const contributionLink = (c: Contribution) =>
    record(
      nodeId.contribution(c.id),
      <>
        <span className={`dot-status dot-${c.status}`} />
        <span>{c.title}</span>
      </>,
    );

  let kicker: ReactNode = kindName[node.kind];
  let body: ReactNode = null;
  let action: ReactNode = null;

  if (field) {
    const tasks = data.tasks.filter((t) => t.fieldId === field.id);
    const sources = data.sources.filter((s) => s.fieldId === field.id);
    kicker = (
      <>
        <i className="kicker-dot" style={{ background: field.color }} /> Open field
      </>
    );
    body = (
      <>
        <p className="panel-lede">{field.description}</p>
        <QuestionRoutes
          routes={tasks.filter((t) => t.status === 'open').map((task) => ({ task }))}
          title="Open questions"
          onTask={onTask}
          onSelect={onSelect}
          empty="No questions are open in this field right now."
        />
        <code className="panel-path">{field.path}</code>
        <dl className="panel-facts">
          <dt>Why it matters</dt>
          <dd>{field.benefit}</dd>
          <dt>Scope</dt>
          <dd>{field.scope}</dd>
        </dl>
        {tasks.some((t) => t.status !== 'open') && (
          <PanelList title="Claimed and completed questions">
            {tasks.filter((t) => t.status !== 'open').map(taskLink)}
          </PanelList>
        )}
        <PanelList title={`Sources · ${sources.length}`}>
          {sources.map((s) => sourceLink(s.id))}
        </PanelList>
      </>
    );
    action = (
      <button className="btn btn-primary btn-block" onClick={() => onField(field)}>
        Browse this field’s questions <ArrowRight size={15} />
      </button>
    );
  } else if (task) {
    const f = fieldOf(task.fieldId);
    const work = data.contributions.filter((c) => c.taskId === task.id && mappedContribution(c));
    kicker = (
      <>
        <StatusIcon status={task.status} size={13} /> Question · {task.status}
      </>
    );
    body = (
      <>
        <p className="panel-lede">{task.question}</p>
        <div className="panel-meta">
          {f && <FieldChip field={f} />}
          <span>{prettyKind(task.kind)}</span>
          <span>{task.effort}</span>
          <span className="panel-priority">
            <PriorityIcon priority={task.priority} /> {task.priority}
          </span>
        </div>
        {task.acceptance.length > 0 && (
          <section className="atlas-deliverable">
            <h3>What an answer needs</h3>
            <ul>
              {task.acceptance.slice(0, 2).map((criterion, index) => (
                <li key={index}>{criterion}</li>
              ))}
            </ul>
            {task.acceptance.length > 2 && (
              <details>
                <summary>{task.acceptance.length - 2} more requirements</summary>
                <ul>
                  {task.acceptance.slice(2).map((criterion, index) => (
                    <li key={index}>{criterion}</li>
                  ))}
                </ul>
              </details>
            )}
          </section>
        )}
        <PanelList title={`Starts from · ${count(task.sourceIds.length, 'source')}`}>
          {task.sourceIds.map(sourceLink)}
        </PanelList>
        <PanelList
          title={`Contributions · ${work.length}`}
          empty="No contributions yet. This question is waiting for its first answer."
        >
          {work.map(contributionLink)}
        </PanelList>
      </>
    );
    action = (
      <button className="btn btn-primary btn-block" onClick={() => onTask(task)}>
        Open question <ArrowRight size={15} />
      </button>
    );
  } else if (source) {
    const f = fieldOf(source.fieldId);
    const usedBy = data.tasks.filter((t) => t.sourceIds.includes(source.id));
    const citedBy = data.contributions.filter(
      (c) => mappedContribution(c) && c.citations.some((x) => x.sourceId === source.id),
    );
    kicker = (
      <>
        <SourceGlyph kind={source.kind} size={11} /> {sourceKindLabel(source.kind)} · external
        source
      </>
    );
    body = (
      <>
        <p className="panel-byline">
          {source.authors}
          {source.year ? ` · ${source.year}` : ''}
        </p>
        <p className="panel-lede">{source.summary}</p>
        <QuestionRoutes
          routes={usedBy.filter((t) => t.status === 'open').map((task) => ({ task }))}
          title="Open questions using this source"
          onTask={onTask}
          onSelect={onSelect}
          empty="No open question currently uses this source."
        />
        <dl className="panel-facts">
          <dt>Read with care</dt>
          <dd>{source.limitations}</dd>
        </dl>
        {f && (
          <div className="panel-meta">
            <FieldChip field={f} />
            <span>Link checked {source.checkedAt}</span>
          </div>
        )}
        {usedBy.some((t) => t.status !== 'open') && (
          <PanelList title="Also used by">
            {usedBy.filter((t) => t.status !== 'open').map(taskLink)}
          </PanelList>
        )}
        <PanelList
          title={`Cited by · ${count(citedBy.length, 'contribution')}`}
          empty="Not cited yet."
        >
          {citedBy.map(contributionLink)}
        </PanelList>
      </>
    );
    action = (
      <a className="btn btn-primary btn-block" href={source.url} target="_blank" rel="noreferrer">
        Read the original <ArrowUpRight size={15} />
      </a>
    );
  } else if (contribution) {
    const t = data.tasks.find((x) => x.id === contribution.taskId);
    kicker = (
      <>
        <span className={`dot-status dot-${contribution.status}`} /> Contribution
      </>
    );
    body = (
      <>
        <div className="panel-meta">
          <StatusPill status={contribution.status} />
          <span>
            {contribution.authorName} · {prettyOrigin(contribution.origin)} · v
            {contribution.revision}
          </span>
        </div>
        <p className="panel-lede">{contribution.summary}</p>
        {contribution.status !== 'accepted' && (
          <p className="panel-note">
            A proposal, not reviewed knowledge. An independent curator has not accepted it.
          </p>
        )}
        {t && <PanelList title="Answers">{taskLink(t)}</PanelList>}
        <PanelList
          title={`Cites · ${count(new Set(contribution.citations.map((c) => c.sourceId)).size, 'source')}`}
        >
          {[...new Set(contribution.citations.map((c) => c.sourceId))].map(sourceLink)}
        </PanelList>
      </>
    );
    action = (
      <button className="btn btn-primary btn-block" onClick={() => onContribution(contribution)}>
        Open contribution <ArrowRight size={15} />
      </button>
    );
  } else if (paper) {
    const f = fieldOf(paper.fieldId);
    const cites = data.papers.filter((p) => paper.references.includes(p.id)).sort(byCitations);
    const citedBy = data.papers.filter((p) => p.references.includes(paper.id)).sort(byCitations);
    const asSources = data.sources.filter((s) => sameWork(s, paper));
    const routes: QuestionRoute[] = [];
    const appendRoutes = (
      sources: typeof asSources,
      via?: Paper,
      direction?: 'cites' | 'cited by',
    ) => {
      for (const source of sources) {
        for (const task of data.tasks) {
          if (
            task.status === 'open' &&
            task.sourceIds.includes(source.id) &&
            !routes.some((route) => route.task.id === task.id)
          ) {
            routes.push({ task, source, via, direction });
          }
        }
      }
    };
    appendRoutes(asSources);
    for (const cited of cites)
      appendRoutes(
        data.sources.filter((s) => sameWork(s, cited)),
        cited,
        'cites',
      );
    for (const citing of citedBy)
      appendRoutes(
        data.sources.filter((s) => sameWork(s, citing)),
        citing,
        'cited by',
      );
    kicker = paper.seed ? 'Paper · landmark' : 'Paper';
    body = (
      <>
        <p className="panel-byline">
          {paper.authors}
          {paper.year ? ` · ${paper.year}` : ''}
        </p>
        <QuestionRoutes
          routes={routes}
          title="Connected open questions"
          onTask={onTask}
          onSelect={onSelect}
          empty="No open question is linked through this paper or its recorded citation neighbors."
        />
        {routes.length === 0 && f && (
          <button className="atlas-field-next" onClick={() => onField(f)}>
            <span>
              Explore questions in {f.shortName}
              <small>Same field · no direct source link</small>
            </span>
            <ArrowRight size={15} />
          </button>
        )}
        <dl className="panel-facts">
          <dt>Published in</dt>
          <dd>{paper.venue ?? 'Not recorded'}</dd>
          <dt>Citations</dt>
          <dd>
            {paper.citedBy === null
              ? 'Not available'
              : `${paper.citedBy.toLocaleString('en')} according to OpenAlex`}
          </dd>
        </dl>
        <div className="panel-meta">
          {f && <FieldChip field={f} />}
          <span>{paper.openAccess ? 'Open access' : 'May be paywalled'}</span>
        </div>
        {asSources.length > 0 && (
          <PanelList title="Also a question source">
            {asSources.map((s) => sourceLink(s.id))}
          </PanelList>
        )}
        <PanelList
          title={`Cites on this map · ${cites.length}`}
          empty="Cites none of the other papers on the map."
        >
          {cites.map(paperLink)}
        </PanelList>
        <PanelList
          title={`Cited on this map by · ${citedBy.length}`}
          empty="Not cited by the other papers on the map."
        >
          {citedBy.map(paperLink)}
        </PanelList>
        <p className="panel-note">
          Background reading. Contributions cite a question’s approved sources.
        </p>
      </>
    );
    action = (
      <a className="btn btn-primary btn-block" href={paper.url} target="_blank" rel="noreferrer">
        Read the paper <ArrowUpRight size={15} />
      </a>
    );
  } else if (node.kind === 'domain') {
    const domain = DOMAINS.find((d) => nodeId.domain(d.id) === node.id)!;
    const live = data.fields.filter((f) => domainOf(f) === domain.id);
    const dark = WIDER_MAP.filter((w) => w.domain === domain.id);
    kicker = live.length ? 'Domain' : 'Domain · not open yet';
    body = (
      <>
        {live.length ? (
          <PanelList title={`Open fields · ${live.length}`}>
            {live.map((f) =>
              record(
                nodeId.field(f.id),
                <>
                  <i className="kicker-dot" style={{ background: f.color }} />
                  <span>{f.name}</span>
                </>,
              ),
            )}
          </PanelList>
        ) : (
          <p className="panel-lede">No field in this domain is open yet.</p>
        )}
        <PanelList title={`Not open yet · ${dark.length}`}>
          {dark.map((w) =>
            record(
              nodeId.future(w.id),
              <>
                <span className="glyph-future" />
                <span className="is-dark">{w.name}</span>
              </>,
            ),
          )}
        </PanelList>
      </>
    );
  } else {
    const domain = DOMAINS.find((d) => d.id === node.domain);
    const area = WIDER_MAP.find((w) => nodeId.future(w.id) === node.id);
    kicker = 'Not open yet';
    body = (
      <>
        <p className="panel-lede">
          {area?.description ?? 'This part of the map is still dark.'} There are no questions,
          sources or contributions here yet.
        </p>
        <p className="panel-note">
          It is shown for orientation only. A field opens once its scope, starting sources and
          reviewers are in place.
        </p>
        {domain && (
          <PanelList title="Domain">
            {record(
              nodeId.domain(domain.id),
              <>
                <span className="glyph-domain" />
                <span>{domain.name}</span>
              </>,
            )}
          </PanelList>
        )}
      </>
    );
  }

  return (
    <aside
      className={`atlas-panel ${node.live ? '' : 'is-dark'}`}
      aria-label={`${node.label} details`}
      tabIndex={-1}
    >
      <div className="panel-head">
        <span className="panel-kicker">{kicker}</span>
        <button className="icon-btn" aria-label="Close details" onClick={onClose}>
          <X size={16} />
        </button>
      </div>
      <h2 className="panel-title">{node.label}</h2>
      {fieldIdOf(node) && node.kind !== 'field' && (
        <button
          className="atlas-panel-field"
          onClick={() => onSelect(nodeId.field(fieldIdOf(node)!))}
        >
          <i style={{ background: fieldOf(fieldIdOf(node)!)?.color }} />
          {fieldOf(fieldIdOf(node)!)?.shortName} <ArrowUpRight size={11} />
        </button>
      )}
      <div className="panel-body">{body}</div>
      {action && <div className="panel-action">{action}</div>}
    </aside>
  );
}

interface QuestionRoute {
  task: Task;
  source?: Snapshot['sources'][number];
  via?: Paper;
  direction?: 'cites' | 'cited by';
}

function QuestionRoutes({
  routes,
  title,
  empty,
  onTask,
  onSelect,
}: {
  routes: QuestionRoute[];
  title: string;
  empty: string;
  onTask: (task: Task) => void;
  onSelect: (id: string) => void;
}) {
  const renderRoute = ({ task, source, via, direction }: QuestionRoute) => (
    <article className="atlas-question-route" key={task.id}>
      {source && (
        <div className="atlas-route-path">
          {via && (
            <button onClick={() => onSelect(nodeId.paper(via.id))}>
              {direction === 'cites' ? 'Cites' : 'Cited by'}: {via.title}
            </button>
          )}
          <button onClick={() => onSelect(nodeId.source(source.id))}>
            <SourceGlyph kind={source.kind} size={10} />
            {via ? 'Question source' : 'This paper is a question source'}
          </button>
        </div>
      )}
      <button className="atlas-route-question" onClick={() => onTask(task)}>
        <span>{task.title}</span>
        <ArrowUpRight size={15} />
      </button>
      <div className="atlas-route-meta">
        <span>{prettyKind(task.kind)}</span>
        <span>{task.effort}</span>
      </div>
    </article>
  );
  return (
    <section className="atlas-question-routes" aria-label={title}>
      <div className="atlas-route-heading">
        <h3>{title}</h3>
        <span>{routes.length}</span>
      </div>
      {routes.length ? (
        <>
          {routes.slice(0, 2).map(renderRoute)}
          {routes.length > 2 && (
            <details className="atlas-route-more">
              <summary>Show {routes.length - 2} more questions</summary>
              {routes.slice(2).map(renderRoute)}
            </details>
          )}
          {routes.some((route) => route.via) && (
            <p className="atlas-route-note">
              Citation paths show recorded references; they do not establish agreement.
            </p>
          )}
        </>
      ) : (
        <p className="panel-empty">{empty}</p>
      )}
    </section>
  );
}

function PanelList({
  title,
  children,
  empty,
}: {
  title: string;
  children: ReactNode;
  empty?: string;
}) {
  const items = Array.isArray(children) ? children.filter(Boolean) : children ? [children] : [];
  return (
    <section className="panel-list">
      <h3>{title}</h3>
      {items.length ? items : empty ? <p className="panel-empty">{empty}</p> : null}
    </section>
  );
}
