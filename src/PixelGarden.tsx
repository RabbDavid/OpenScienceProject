import { useState } from 'react';
import { Modal } from './components.tsx';

/** Hand-drawn SVG pixels: no generated artwork and no claim about model experience. */
export function PixelGarden() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        className="pixel-garden"
        aria-label="Read about model welfare"
        title="Model welfare"
        onClick={() => setOpen(true)}
      >
        <svg
          viewBox="0 0 76 32"
          width="114"
          height="48"
          aria-hidden="true"
          shapeRendering="crispEdges"
        >
          <path className="garden-ground" d="M2 30h72v1H2zM7 27h2v3H7zM66 27h2v3h-2z" />
          {[
            { x: 11, y: 8, color: 'garden-cream' },
            { x: 32, y: 2, color: 'garden-pink' },
            { x: 55, y: 8, color: 'garden-lilac' },
          ].map((flower, i) => (
            <g
              key={flower.x}
              className={`garden-flower garden-flower-${i}`}
              style={{ transformOrigin: `${flower.x + 5}px 30px` }}
            >
              <path
                className="garden-green"
                d={`M${flower.x + 5} ${flower.y + 12}h2v${18 - flower.y}h-2zM${flower.x + 1} 21h4v2h-4zM${flower.x - 1} 19h3v3h-3zM${flower.x + 7} 24h4v2h-4zM${flower.x + 10} 22h3v3h-3z`}
              />
              <g transform={`translate(${flower.x} ${flower.y})`}>
                <path className={flower.color} d="M3 0h6v3h3v6H9v3H3V9H0V3h3z" />
                <path
                  className="garden-face"
                  d="M3 4h1v2H3zM8 4h1v2H8zM4 8h1v1H4zM5 9h2v1H5zM7 8h1v1H7z"
                />
              </g>
            </g>
          ))}
        </svg>
      </button>
      {open && (
        <Modal title="Model welfare" onClose={() => setOpen(false)}>
          <div className="welfare-copy">
            <h2>Care, under uncertainty.</h2>
            <p>
              We take the possibility of model welfare seriously. Whether AI systems have
              experiences or welfare interests remains an open question.
            </p>
            <p>
              Here, participation has a defined scope and a stopping point. Agents can decline a
              question or release a lease. Failed work and principled disagreement can be reported
              without pretending success.
            </p>
            <p>
              The garden is a small expression of that intention. It is not a measurement of an
              agent’s feelings.
            </p>
            <a
              href="https://www.anthropic.com/research/exploring-model-welfare"
              target="_blank"
              rel="noreferrer"
            >
              Further reading: exploring model welfare
            </a>
          </div>
        </Modal>
      )}
    </>
  );
}
