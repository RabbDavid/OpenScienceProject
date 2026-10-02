import { useEffect, useRef, type CSSProperties } from 'react';
import './HeroEdge.css';

type EdgeField = { color: string };
type Tile = {
  x: number;
  y: number;
  size: number;
  turn: number;
  finish: 'porcelain' | 'sage' | 'glass';
  opacity?: number;
};

// Positions follow the two bevelled corners, rather than a repeating border.
// y is measured upward from the map's bottom edge; negative values float over paper.
const left: Tile[] = [
  { x: 12, y: 154, size: 26, turn: -12, finish: 'glass', opacity: 0.38 },
  { x: 25, y: 115, size: 54, turn: -9, finish: 'porcelain' },
  { x: 81, y: 151, size: 30, turn: 14, finish: 'glass', opacity: 0.5 },
  { x: 62, y: 75, size: 64, turn: 7, finish: 'porcelain' },
  { x: 113, y: 100, size: 39, turn: -15, finish: 'sage', opacity: 0.85 },
  { x: 119, y: 36, size: 70, turn: -5, finish: 'porcelain' },
  { x: 172, y: 77, size: 24, turn: 17, finish: 'glass', opacity: 0.46 },
  { x: 178, y: 8, size: 48, turn: 11, finish: 'sage' },
  { x: 229, y: 29, size: 28, turn: -13, finish: 'glass', opacity: 0.35 },
  { x: 230, y: -20, size: 25, turn: 12, finish: 'porcelain', opacity: 0.8 },
  { x: 47, y: 11, size: 34, turn: -17, finish: 'porcelain' },
  { x: 18, y: -27, size: 23, turn: 7, finish: 'sage', opacity: 0.8 },
];
const right: Tile[] = [
  { x: 15, y: 67, size: 22, turn: 12, finish: 'glass', opacity: 0.36 },
  { x: 23, y: 31, size: 42, turn: -8, finish: 'porcelain' },
  { x: 68, y: 9, size: 33, turn: 13, finish: 'sage', opacity: 0.9 },
  { x: 107, y: -14, size: 22, turn: -12, finish: 'porcelain', opacity: 0.75 },
];
const OVERHANG = 42;

/** Static SVG prisms, with a short pointer-driven response. No canvas or idle render loop. */
export function HeroEdge({ fields = [] }: { fields?: readonly EdgeField[] }) {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const decoration = root.current!;
    const scene = decoration.parentElement!;
    const surface = scene.parentElement!;
    const motion = window.matchMedia(
      '(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)',
    );
    const clusters = Array.from(decoration.querySelectorAll<HTMLElement>('.hero-corner')).map(
      (element, index) => ({
        element,
        tiles: index === 0 ? left : right,
        nodes: Array.from(element.querySelectorAll<HTMLElement>('.hero-tile')),
        bounds: element.getBoundingClientRect(),
        scale: 1,
        right: index === 1,
      }),
    );
    let frame = 0;
    let active = false;
    let pointer: { x: number; y: number } | null = null;
    const measure = () => {
      for (const cluster of clusters) {
        cluster.bounds = cluster.element.getBoundingClientRect();
        cluster.scale = cluster.bounds.width / cluster.element.offsetWidth;
      }
    };
    const rest = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      pointer = null;
      if (!active) return;
      for (const cluster of clusters)
        for (const node of cluster.nodes) node.style.removeProperty('--tile-response');
      active = false;
    };
    const respond = () => {
      frame = 0;
      if (!pointer || !motion.matches || document.hidden) {
        rest();
        return;
      }
      active = false;
      for (const cluster of clusters) {
        const { bounds, scale } = cluster;
        cluster.tiles.forEach((tile, index) => {
          const cx = cluster.right ? bounds.right - tile.x * scale : bounds.left + tile.x * scale;
          const cy = bounds.bottom - (tile.y + OVERHANG) * scale;
          const dx = cx - pointer!.x;
          const dy = cy - pointer!.y;
          const distance = Math.hypot(dx, dy);
          const influence = Math.max(0, 1 - distance / (125 * scale));
          const node = cluster.nodes[index];
          if (!influence) {
            node.style.removeProperty('--tile-response');
            return;
          }
          active = true;
          const lift = influence * influence;
          const driftX = (dx / Math.max(distance, 1)) * lift * 5;
          const driftY = -lift * 9;
          const roll = (dx / Math.max(distance, 1)) * lift * 4;
          node.style.setProperty(
            '--tile-response',
            'translate3d(' +
              driftX.toFixed(2) +
              'px, ' +
              driftY.toFixed(2) +
              'px, 0) rotate(' +
              roll.toFixed(2) +
              'deg)',
          );
        });
      }
    };
    const move = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse' || !motion.matches) return;
      const nearCorner = clusters.some(
        ({ bounds }) =>
          event.clientX >= bounds.left - 30 &&
          event.clientX <= bounds.right + 30 &&
          event.clientY >= bounds.top &&
          event.clientY <= bounds.bottom + 20,
      );
      if (!nearCorner) {
        rest();
        return;
      }
      pointer = { x: event.clientX, y: event.clientY };
      if (!frame) frame = requestAnimationFrame(respond);
    };
    measure();
    const resize = new ResizeObserver(measure);
    resize.observe(scene);
    surface.addEventListener('pointerenter', measure, { passive: true });
    surface.addEventListener('pointermove', move, { passive: true });
    surface.addEventListener('pointerleave', rest);
    window.addEventListener('scroll', measure, { passive: true, capture: true });
    window.addEventListener('blur', rest);
    document.addEventListener('visibilitychange', rest);
    motion.addEventListener('change', rest);
    return () => {
      rest();
      resize.disconnect();
      surface.removeEventListener('pointerenter', measure);
      surface.removeEventListener('pointermove', move);
      surface.removeEventListener('pointerleave', rest);
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('blur', rest);
      document.removeEventListener('visibilitychange', rest);
      motion.removeEventListener('change', rest);
    };
  }, []);

  return (
    <div className="hero-edge" ref={root} aria-hidden="true">
      {[left, right].map((tiles, side) => (
        <div className={'hero-corner hero-corner--' + (side ? 'right' : 'left')} key={side}>
          {tiles.map((tile, index) => (
            <div
              className={'hero-tile-anchor is-' + tile.finish}
              key={index}
              style={
                {
                  '--tile-at': tile.x + 'px',
                  '--tile-up': tile.y + OVERHANG + 'px',
                  '--tile-size': tile.size + 'px',
                  '--tile-turn': tile.turn + 'deg',
                  '--tile-opacity': tile.opacity ?? 1,
                  '--tile-tint': fields[side ? 3 : 0]?.color ?? '#8eae7b',
                } as CSSProperties
              }
            >
              <div className="hero-tile">
                <svg viewBox="-28 -24 56 55" focusable="false">
                  <path className="tile-side-light" d="M-22 8 0 17V23L-22 14Z" />
                  <path className="tile-side-shade" d="M0 17 22 8V14L0 23Z" />
                  <path className="tile-face" d="M0-17 22-8V8L0 17-22 8V-8Z" />
                  <path className="tile-rim" d="M-21-8 0-16 21-8" />
                </svg>
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
