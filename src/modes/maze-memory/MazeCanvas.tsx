import { useEffect, useRef } from "react";
import type { Trial } from "./engine";
import { DELTAS, DIRECTIONS } from "./contract";
export function MazeCanvas({
  view,
}: {
  view: ReturnType<Trial["view"]> | null;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current?.getContext("2d");
    if (!c) return;
    c.fillStyle = "#11160f";
    c.fillRect(0, 0, 620, 620);
    if (!view) return;
    for (const cell of view.cells) {
      c.fillStyle = cell.open ? "#39452f" : "#080b06";
      c.fillRect(cell.x * 20, cell.y * 20, 19, 19);
    }
    c.strokeStyle = "#83b8c5";
    c.lineWidth = 3;
    c.beginPath();
    view.path.forEach((p, i) =>
      i
        ? c.lineTo(p.x * 20 + 10, p.y * 20 + 10)
        : c.moveTo(p.x * 20 + 10, p.y * 20 + 10),
    );
    c.stroke();
    const p = view.observation.position;
    for (const d of DIRECTIONS) {
      if (!view.observation.exits[d]) continue;
      const [dx, dy] = DELTAS[d];
      c.strokeStyle = "#d8e59e";
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(p.x * 20 + 10, p.y * 20 + 10);
      c.lineTo((p.x + dx) * 20 + 10, (p.y + dy) * 20 + 10);
      c.stroke();
    }
    c.fillStyle = view.solved ? "#8cdb83" : "#ffe28c";
    c.beginPath();
    c.arc(p.x * 20 + 10, p.y * 20 + 10, 7, 0, 7);
    c.fill();
  }, [view]);
  return (
    <canvas
      ref={ref}
      width={620}
      height={620}
      aria-label="Explored maze; yellow is the agent, blue is its path, green means exit reached"
    />
  );
}
export function LocalNotes({ view }: { view: ReturnType<Trial["view"]> }) {
  return (
    <>
      <h3>What the model can read here</h3>
      <p>
        Position ({view.observation.position.x}, {view.observation.position.y})
        · private memory: none
      </p>
      <table>
        <thead>
          <tr>
            <th>Passage</th>
            <th>Local JSON note</th>
          </tr>
        </thead>
        <tbody>
          {DIRECTIONS.map((d) => (
            <tr key={d}>
              <td>{d}</td>
              <td>
                {view.observation.exits[d] ? (
                  <code>
                    {JSON.stringify(view.observation.environment.passages[d])}
                  </code>
                ) : (
                  "Blocked"
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <details>
        <summary>Current cell note</summary>
        <pre>{JSON.stringify(view.observation.environment.cell, null, 2)}</pre>
      </details>
    </>
  );
}
