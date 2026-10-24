import { useEffect, useId, useRef } from 'react';
import './HeroEdge.css';

type Fragment = { x: number; y: number; size: number; opacity?: number };

// Attached fragments shape the live atlas mask; only their extensions below the
// canvas are painted here. Detached fragments separate and fade into the paper.
const left: Fragment[] = [
  { x: 13, y: 57, size: 60 },
  { x: 40, y: 85, size: 43 },
  { x: 78, y: 113, size: 64 },
  { x: 120, y: 145, size: 44 },
  { x: 165, y: 171, size: 56 },
  { x: 211, y: 203, size: 36 },
  { x: 254, y: 218, size: 33 },
  { x: 17, y: 112, size: 36, opacity: 0.88 },
  { x: 53, y: 143, size: 33, opacity: 0.84 },
  { x: 138, y: 184, size: 31, opacity: 0.86 },
  { x: 180, y: 214, size: 26, opacity: 0.65 },
  { x: 278, y: 235, size: 21, opacity: 0.55 },
  { x: 14, y: 153, size: 25, opacity: 0.66 },
  { x: 41, y: 182, size: 19, opacity: 0.46 },
  { x: 121, y: 220, size: 20, opacity: 0.48 },
  { x: 151, y: 239, size: 17, opacity: 0.27 },
  { x: 24, y: 210, size: 16, opacity: 0.28 },
  { x: 66, y: 231, size: 12, opacity: 0.21 },
  { x: 101, y: 252, size: 11, opacity: 0.17 },
  { x: 189, y: 260, size: 9, opacity: 0.15 },
  { x: 8, y: 250, size: 9, opacity: 0.13 },
];

const right: Fragment[] = [
  { x: 12, y: 39, size: 26 },
  { x: 39, y: 65, size: 30 },
  { x: 76, y: 87, size: 27 },
  { x: 110, y: 107, size: 24 },
  { x: 14, y: 77, size: 19, opacity: 0.74 },
  { x: 45, y: 97, size: 16, opacity: 0.55 },
  { x: 80, y: 116, size: 14, opacity: 0.46 },
  { x: 23, y: 111, size: 11, opacity: 0.27 },
  { x: 53, y: 130, size: 8, opacity: 0.19 },
];

function hexagon({ x, y, size }: Fragment) {
  const radius = size / 2;
  const rise = size * 0.433;
  return `M${x - radius} ${y}l${radius / 2} ${-rise}h${radius}l${radius / 2} ${rise} ${-radius / 2} ${rise}h${-radius}Z`;
}

const cornerShapes = [
  {
    fragments: left,
    width: 360,
    height: 280,
    bottom: 220,
    // A gentle join sits inside the attached hexagons, with no abrupt vertical return.
    aperture:
      'M0 47C26 53 48 93 80 110S130 153 166 166S219 207 251 212C266 216 275 220 298 220H360 0Z',
    pinholes: 'm18 23 2-1 2 1v3l-2 1-2-1Zm82 63 3-2 3 2v4l-3 2-3-2Z',
  },
  {
    fragments: right,
    width: 170,
    height: 155,
    bottom: 110,
    aperture: 'M0 28C14 30 23 47 39 59S65 85 80 91S111 110 135 110H170 0Z',
    pinholes: 'm18 10 2-1 2 1v3l-2 1-2-1Z',
  },
];

function apertureImage(corner: (typeof cornerShapes)[number], side: number) {
  const { width, bottom, fragments, aperture, pinholes } = corner;
  const attached = fragments.filter((fragment) => fragment.opacity === undefined).map(hexagon);
  // Opaque areas of this image are subtracted from the atlas. Black hexagons inside
  // the luminance mask restore the original network surface all the way to their facets.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${bottom}">
    <defs><mask id="void" maskUnits="userSpaceOnUse" x="0" y="0" width="${width}" height="${bottom}">
      <path d="${aperture}" fill="white"/><path d="${attached.join(' ')}" fill="black"/>
    </mask></defs>
    <g${side ? ` transform="translate(${width} 0) scale(-1 1)"` : ''}>
      <rect width="${width}" height="${bottom}" mask="url(#void)"/><path d="${pinholes}"/>
    </g></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

// Both masks are generated once from authored geometry, never from contribution text.
const apertureStyles = `.overview .ov-scene {
  --hero-left-aperture: ${apertureImage(cornerShapes[0], 0)};
  --hero-right-aperture: ${apertureImage(cornerShapes[1], 1)};
}`;

/** The attached surface stays fixed; only loose fragments respond to a nearby mouse. */
export function HeroEdge(_: { fields?: readonly { color: string }[] }) {
  const root = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    const decoration = root.current!;
    const scene = decoration.parentElement!;
    const surface = scene.parentElement!;
    const motion = window.matchMedia(
      '(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)',
    );
    const corners = Array.from(decoration.querySelectorAll<SVGSVGElement>('.hero-corner')).map(
      (element, side) => ({
        element,
        side,
        fragments: (side ? right : left)
          .map((fragment, index) => ({
            ...fragment,
            node: element.querySelectorAll('path')[index],
          }))
          .filter((fragment) => fragment.opacity !== undefined),
        bounds: element.getBoundingClientRect(),
        scale: 1,
      }),
    );
    const shifted = new Set<SVGPathElement>();
    let frame = 0;
    let pointer: { x: number; y: number } | null = null;
    const rest = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      pointer = null;
      for (const node of shifted) node.style.removeProperty('--fragment-response');
      shifted.clear();
    };
    const measure = () => {
      rest();
      for (const corner of corners) {
        corner.bounds = corner.element.getBoundingClientRect();
        corner.scale = corner.bounds.width / corner.element.viewBox.baseVal.width;
      }
    };
    const respond = () => {
      frame = 0;
      if (!pointer || !motion.matches || document.hidden || scene.querySelector('.atlas-panel')) {
        rest();
        return;
      }
      for (const { bounds, scale, side, fragments } of corners) {
        for (const fragment of fragments) {
          const x = side ? bounds.right - fragment.x * scale : bounds.left + fragment.x * scale;
          const y = bounds.top + fragment.y * scale;
          const dx = x - pointer.x;
          const distance = Math.hypot(dx, y - pointer.y);
          const lift = Math.max(0, 1 - distance / 72) ** 2;
          if (!lift) {
            fragment.node.style.removeProperty('--fragment-response');
            shifted.delete(fragment.node);
            continue;
          }
          // SVG-local units: at desktop scale the maximum shift is only 2.4px.
          const drift = (dx / Math.max(distance, 1)) * lift * 2;
          fragment.node.style.setProperty(
            '--fragment-response',
            `translate(${(side ? -drift : drift).toFixed(2)}px, ${(-lift * 4).toFixed(2)}px)`,
          );
          shifted.add(fragment.node);
        }
      }
    };
    const move = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse' || !motion.matches) return;
      if (
        !corners.some(
          ({ bounds }) =>
            event.clientX >= bounds.left - 72 &&
            event.clientX <= bounds.right + 72 &&
            event.clientY >= bounds.top - 72 &&
            event.clientY <= bounds.bottom + 72,
        )
      ) {
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
      <style>{apertureStyles}</style>
      {cornerShapes.map(({ fragments, width, height, bottom }, side) => (
        <svg
          className={'hero-corner hero-corner--' + (side ? 'right' : 'left')}
          viewBox={`0 0 ${width} ${height}`}
          focusable="false"
          key={side}
        >
          <defs>
            <clipPath id={`${id}-extension-${side}`}>
              <rect y={bottom} width={width} height={height - bottom} />
            </clipPath>
          </defs>
          {fragments.map((fragment, index) => (
            <path
              className={fragment.opacity === undefined ? undefined : 'hero-fragment'}
              clipPath={
                fragment.opacity === undefined ? `url(#${id}-extension-${side})` : undefined
              }
              d={hexagon(fragment)}
              opacity={fragment.opacity ?? 1}
              key={index}
            />
          ))}
        </svg>
      ))}
    </div>
  );
}
