import './HeroEdge.css';

type Fragment = { x: number; y: number; size: number; opacity?: number };

// Coordinates share the corner apertures in HeroEdge.css. The first fragments overlap
// the intact atlas; the rest separate into paper. No stroke or bevel divides that material.
const left: Fragment[] = [
  { x: 13, y: 57, size: 60 },
  { x: 40, y: 85, size: 43 },
  { x: 78, y: 113, size: 64 },
  { x: 120, y: 145, size: 44 },
  { x: 165, y: 171, size: 56 },
  { x: 211, y: 203, size: 36 },
  { x: 254, y: 218, size: 33 },
  { x: 17, y: 112, size: 36, opacity: 0.96 },
  { x: 53, y: 143, size: 33, opacity: 0.92 },
  { x: 93, y: 159, size: 31, opacity: 0.88 },
  { x: 138, y: 184, size: 31, opacity: 0.93 },
  { x: 180, y: 214, size: 26, opacity: 0.76 },
  { x: 278, y: 235, size: 21, opacity: 0.65 },
  { x: 14, y: 153, size: 25, opacity: 0.78 },
  { x: 41, y: 182, size: 19, opacity: 0.59 },
  { x: 83, y: 196, size: 23, opacity: 0.63 },
  { x: 121, y: 220, size: 20, opacity: 0.6 },
  { x: 215, y: 239, size: 20, opacity: 0.52 },
  { x: 151, y: 239, size: 17, opacity: 0.34 },
  { x: 24, y: 210, size: 16, opacity: 0.35 },
  { x: 66, y: 231, size: 12, opacity: 0.27 },
  { x: 101, y: 252, size: 11, opacity: 0.23 },
  { x: 189, y: 260, size: 9, opacity: 0.2 },
  { x: 245, y: 260, size: 10, opacity: 0.14 },
  { x: 8, y: 250, size: 9, opacity: 0.13 },
];

const right: Fragment[] = [
  { x: 12, y: 39, size: 26 },
  { x: 39, y: 65, size: 30 },
  { x: 76, y: 87, size: 27 },
  { x: 110, y: 107, size: 24 },
  { x: 14, y: 77, size: 19, opacity: 0.84 },
  { x: 45, y: 97, size: 16, opacity: 0.65 },
  { x: 80, y: 116, size: 14, opacity: 0.58 },
  { x: 23, y: 111, size: 11, opacity: 0.36 },
  { x: 53, y: 130, size: 8, opacity: 0.19 },
  { x: 111, y: 134, size: 8, opacity: 0.16 },
  { x: 10, y: 142, size: 5, opacity: 0.09 },
];

function hexagon({ x, y, size }: Fragment) {
  const radius = size / 2;
  const rise = size * 0.433;
  return `M${x - radius} ${y}l${radius / 2} ${-rise}h${radius}l${radius / 2} ${rise} ${-radius / 2} ${rise}h${-radius}Z`;
}

/** Static continuation of the atlas surface. Its field colours remain in the map itself. */
export function HeroEdge(_: { fields?: readonly { color: string }[] }) {
  return (
    <div className="hero-edge" aria-hidden="true">
      {[left, right].map((fragments, side) => (
        <svg
          className={'hero-corner hero-corner--' + (side ? 'right' : 'left')}
          viewBox={side ? '0 0 170 155' : '0 0 360 280'}
          focusable="false"
          key={side}
        >
          {fragments.map((fragment, index) => (
            <path d={hexagon(fragment)} opacity={fragment.opacity ?? 1} key={index} />
          ))}
        </svg>
      ))}
    </div>
  );
}
