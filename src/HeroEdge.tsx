import type { CSSProperties } from 'react';
import './HeroEdge.css';

type EdgeField = { color: string };

const RADIUS = 23;
const STEP_X = Math.sqrt(3) * RADIUS;
const STEP_Y = RADIUS * 1.5;

// This is decorative geometry, independent of the map's scientific records.
const cells = Array.from({ length: 5 }, (_, row) =>
  Array.from({ length: 39 }, (_, column) => {
    const x = (column - 1) * STEP_X + (row % 2 ? STEP_X / 2 : 0);
    const y = 7 + row * STEP_Y;
    const sample = ((column * 47 + row * 31 + column * column * 7) % 101) / 100;
    const threshold = row === 0 ? 0.94 : row === 1 ? 0.78 : row === 2 ? 0.23 : -1;
    if (sample < threshold) return null;
    const solid = row >= 3;
    // A slight overlap prevents hairline seams between the solid bottom cells.
    const radius = solid ? RADIUS + 0.35 : RADIUS - 0.55;
    const points = Array.from({ length: 6 }, (_, corner) => {
      const angle = ((corner * 60 - 90) * Math.PI) / 180;
      return `${(x + Math.cos(angle) * radius).toFixed(2)},${(y + Math.sin(angle) * radius).toFixed(2)}`;
    }).join(' ');
    return {
      id: `${row}-${column}`,
      points,
      solid,
      floating: row < 2,
      tinted: row < 3 && (column + row * 3) % 7 === 0,
      tint: column % 4,
      opacity: solid ? 1 : row === 2 ? 0.26 + sample * 0.58 : 0.08 + sample * 0.13,
      delay: -((column * 1.7 + row * 2.3) % 14),
    };
  }),
)
  .flat()
  .filter((cell) => cell !== null);

/** Place as a sibling after Atlas inside the positioned .ov-scene. */
export function HeroEdge({ fields = [] }: { fields?: readonly EdgeField[] }) {
  const fallbackTints = ['var(--accent)', 'var(--warn)', 'var(--info)', 'var(--held)'];
  return (
    <div className="hero-edge" aria-hidden="true">
      <svg viewBox="0 0 1440 124" preserveAspectRatio="none" focusable="false">
        {cells.map((cell) => (
          <polygon
            key={cell.id}
            points={cell.points}
            className={`hero-edge-cell${cell.floating ? ' is-floating' : ''}${cell.tinted ? ' is-tinted' : ''}`}
            style={
              {
                '--edge-opacity': cell.opacity,
                '--edge-delay': `${cell.delay}s`,
                '--edge-tint':
                  fields[cell.tint % Math.max(fields.length, 1)]?.color ?? fallbackTints[cell.tint],
              } as CSSProperties
            }
          />
        ))}
      </svg>
    </div>
  );
}
