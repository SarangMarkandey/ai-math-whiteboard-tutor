import katex from "katex";
import { boardAt, type PreparedLesson } from "../domain/lesson";
export default function Board({
  lesson,
  time,
  reduced = false,
  highlights = [],
  viewBox = "0 0 960 575",
}: {
  lesson: PreparedLesson;
  time: number;
  reduced?: boolean;
  highlights?: string[];
  viewBox?: string;
}) {
  const state = boardAt(lesson, time, reduced);
  return (
    <svg
      viewBox={viewBox}
      role="img"
      aria-label="Mathematical working and balance illustration"
    >
      {Object.values(state)
        .filter((e) => e.opacity > 0)
        .map((e) => (
          <g
            key={e.id}
            data-element={e.id}
            transform={`translate(${e.x},${e.y})`}
            opacity={reduced ? 1 : e.opacity}
          >
            {e.kind === "term" ? (
              <>
                <rect
                  x={e.align === "center" ? 0 : -8}
                  y="-34"
                  width={
                    e.align === "center" ? e.width : e.text.length * 22 + 15
                  }
                  height="45"
                  rx="5"
                  fill="#f3cb68"
                  opacity={highlights.includes(e.id) ? 0.4 : e.highlight * 0.35}
                />
                <foreignObject
                  x="0"
                  y="-40"
                  width={
                    e.align === "center" ? e.width : Math.max(100, 950 - e.x)
                  }
                  height="65"
                >
                  <div
                    className="math-term"
                    style={{ textAlign: e.align ?? "left" }}
                    dangerouslySetInnerHTML={{
                      __html: katex.renderToString(e.text, {
                        throwOnError: false,
                      }),
                    }}
                  />
                </foreignObject>
              </>
            ) : e.kind === "stroke" ? (
              <path
                d={`M0 0 l${e.width} ${e.height}`}
                fill="none"
                stroke="#b55235"
                strokeWidth="3"
                pathLength="1"
                strokeDasharray="1"
                strokeDashoffset={1 - e.progress}
              />
            ) : e.kind === "block" ? (
              <>
                <rect
                  width={e.width}
                  height={e.height}
                  rx="4"
                  fill={
                    e.text ? "#d2e9e0" : e.highlight ? "#e7b54a" : "#f6d59b"
                  }
                  stroke={e.highlight ? "#ae592f" : "#6a8c7c"}
                  strokeWidth={e.highlight ? 3 : 1}
                />
                <text x={e.width / 2} y="39" textAnchor="middle" fontSize="30">
                  {e.text}
                </text>
              </>
            ) : e.kind === "group" ? (
              <rect
                width={e.width}
                height={e.height}
                rx="12"
                stroke="#43816a"
                fill="none"
                strokeDasharray="6 4"
              />
            ) : (
              <path
                d="M-180 55 H180 M0 55 V-90 M-40 78 H40 M-180 55 l-18 -18 M180 55 l18 -18"
                fill="none"
                stroke="#476f60"
                strokeWidth="4"
              />
            )}
          </g>
        ))}
    </svg>
  );
}
