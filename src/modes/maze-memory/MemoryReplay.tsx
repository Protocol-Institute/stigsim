import { useEffect, useMemo, useState } from "react";
import type { RunRecord } from "./record";
import { ReplayCursor } from "./replay";
import { MazeCanvas, LocalNotes } from "./MazeCanvas";
export default function MemoryReplay({
  record,
  onClose,
}: {
  record: RunRecord;
  onClose: () => void;
}) {
  const [maze, setMaze] = useState(0),
    [tick, setTick] = useState(0),
    [playing, setPlaying] = useState(false),
    [speed, setSpeed] = useState(700);
  const cursor = useMemo(() => new ReplayCursor(record, maze), [record, maze]);
  const frame = useMemo(() => cursor.at(tick), [cursor, tick]);
  useEffect(() => {
    if (!playing) return;
    if (tick >= frame.max) {
      setPlaying(false);
      return;
    }
    const timer = setTimeout(() => setTick((t) => t + 1), speed);
    return () => clearTimeout(timer);
  }, [playing, tick, frame.max, speed]);
  function seek(n: number) {
    setPlaying(false);
    setTick(n);
  }
  return (
    <section className="mm-replay">
      <div className="mm-row">
        <h2>Memory replay · no model calls</h2>
        <button onClick={onClose}>Close replay</button>
      </div>
      <p>
        Recorded strategy: {record.strategy.name} · model: {record.model} ·
        round: {record.manifest.name}
      </p>
      <div className="mm-actions">
        <label>
          Maze
          <select
            value={maze}
            onChange={(e) => {
              setPlaying(false);
              setMaze(+e.target.value);
              setTick(0);
            }}
          >
            {record.manifest.seeds.map((_, i) => (
              <option key={i} value={i}>
                Maze {i + 1}
                {i > record.currentMaze ? " · not started" : ""}
              </option>
            ))}
          </select>
        </label>
        <button
          onClick={() => {
            if (tick === frame.max) setTick(0);
            setPlaying((p) => !p);
          }}
          disabled={!frame.max}
        >
          {playing ? "Pause" : "▶ Play"}
        </button>
        <button disabled={!tick} onClick={() => seek(tick - 1)}>
          ← Step back
        </button>
        <button disabled={tick === frame.max} onClick={() => seek(tick + 1)}>
          Step forward →
        </button>
        <label>
          Speed
          <select value={speed} onChange={(e) => setSpeed(+e.target.value)}>
            <option value={700}>Slow</option>
            <option value={200}>Normal</option>
            <option value={50}>Fast</option>
          </select>
        </label>
      </div>
      <div className="mm-grid">
        <div className="mm-panel">
          <MazeCanvas view={frame.view} />
          <input
            aria-label="Replay position"
            type="range"
            min={0}
            max={frame.max}
            value={tick}
            onChange={(e) => seek(+e.target.value)}
          />
          <p>
            {tick}/{frame.max} recorded moves{" "}
            {frame.view.solved ? "· exit reached" : ""}
          </p>
        </div>
        <div className="mm-panel">
          <LocalNotes view={frame.view} />
          <h3>Last committed memory changes</h3>
          {!frame.changes.length ? (
            <p>No write committed at this position.</p>
          ) : (
            frame.changes.map((w, i) => (
              <div className="mm-change" key={i}>
                <strong>{w.target}</strong>
                <pre>
                  {JSON.stringify(w.before, null, 2)}
                  {"\n↓ crossing / local write\n"}
                  {JSON.stringify(w.after, null, 2)}
                </pre>
              </div>
            ))
          )}
          <h3>Next recorded decision</h3>
          <p>
            {frame.next?.answer
              ? `${frame.next.applied ? "Applied" : "Not applied"} choice: ${frame.next.answer.move}`
              : (frame.next?.error ?? "No further decision recorded.")}
          </p>
          {frame.next && (
            <>
              <details>
                <summary>
                  Prepared writes (conditional alternatives may be skipped)
                </summary>
                <pre>{JSON.stringify(frame.next.prepared.writes, null, 2)}</pre>
              </details>
              <details>
                <summary>
                  Exact local observation, instructions and context
                </summary>
                <pre>
                  {JSON.stringify(
                    {
                      observation: frame.next.observation,
                      ...frame.next.prepared,
                    },
                    null,
                    2,
                  )}
                </pre>
              </details>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
