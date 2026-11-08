import { useEffect, useRef, useState } from "react";
import {
  PRACTICE_SEEDS,
  parseStrategy,
  type Strategy,
  type Limits,
} from "./contract";
import { STARTER } from "./starter";
import { briefing } from "./brief";
import { loadRecording } from "./load-recording";
import type { Snapshot, RunRecord } from "./record";
import { MazeCanvas, LocalNotes } from "./MazeCanvas";
import MemoryReplay from "./MemoryReplay";
import "./maze-memory.css";
const API = "/local-maze-memory";
async function api(path: string, method = "GET", body?: unknown) {
  const r = await fetch(API + path, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let data;
  try {
    data = await r.json();
  } catch {
    throw Error(
      "Start the loopback inference runner and local frontend. See the setup instructions below.",
    );
  }
  if (!r.ok) throw Error(data.error || "Local request failed.");
  return data;
}
function download(name: string, value: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export default function MazeMemoryLab() {
  const [strategy, setStrategy] = useState<Strategy>(STARTER),
    [index, setIndex] = useState(0),
    [count, setCount] = useState(100),
    [round, setRound] = useState<string>(() => crypto.randomUUID());
  const [limits, setLimits] = useState<Limits>({
    movesPerMaze: 4000,
    requests: 1000,
  });
  const [connection, setConnection] = useState<{
      ready: boolean;
      model: string;
    } | null>(null),
    [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    [playing, setPlaying] = useState(false),
    [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    [applied, setApplied] = useState("");
  const [replay, setReplay] = useState<RunRecord | null>(null),
    [brief, setBrief] = useState<string | null>(null),
    [copyStatus, setCopyStatus] = useState("");
  const [replayKey, setReplayKey] = useState(0);
  function loadReplay(record: RunRecord) {
    setReplay(record);
    setReplayKey((k) => k + 1);
  }
  const runId = useRef<string | null>(null),
    input = useRef<HTMLInputElement>(null),
    mounted = useRef(true);
  const signature = JSON.stringify([strategy, index, limits, count, round]),
    dirty = signature !== applied,
    locked = pending || playing;
  async function connect() {
    try {
      setConnection(await api("/status"));
      setError("");
    } catch {
      setConnection(null);
    }
  }
  useEffect(() => {
    mounted.current = true;
    void connect();
    const leave = () => {
      if (runId.current)
        void fetch(API + "/runs/" + runId.current, {
          method: "DELETE",
          keepalive: true,
        }).catch(() => {});
    };
    window.addEventListener("pagehide", leave);
    return () => {
      mounted.current = false;
      window.removeEventListener("pagehide", leave);
      leave();
    };
  }, []);
  function accept(s: Snapshot) {
    if (!mounted.current || s.runId !== runId.current) return;
    setSnapshot(s);
    if (s.record.status !== "running") setPlaying(false);
  }
  async function start(mode: "practice" | "evaluation") {
    setError("");
    setPending(true);
    setPlaying(false);
    setReplay(null);
    try {
      const canonical = parseStrategy(strategy);
      if (
        !Number.isInteger(count) ||
        count < 1 ||
        count > 100 ||
        !round.trim() ||
        round.length > 80
      )
        throw Error(
          "Choose 1–100 mazes and a round identifier up to 80 characters.",
        );
      if (runId.current) await api("/runs/" + runId.current, "DELETE");
      runId.current = null;
      setSnapshot(null);
      const s: Snapshot = await api("/runs", "POST", {
        strategy: canonical,
        limits,
        mode,
        index,
        manifest: {
          name: "Local evaluation " + round,
          seeds: Array.from(
            { length: count },
            (_, i) => `maze-memory-eval:${round}:${i + 1}`,
          ),
        },
      });
      runId.current = s.runId;
      setSnapshot(s);
      setApplied(signature);
      if (mode === "evaluation") setPlaying(true);
    } catch (e) {
      setError(String(e));
    } finally {
      setPending(false);
    }
  }
  async function step() {
    if (!snapshot || pending || dirty || snapshot.record.status !== "running")
      return;
    setPending(true);
    setError("");
    const id = snapshot.runId;
    try {
      accept(
        await api("/runs/" + id + "/step", "POST", {
          maze: snapshot.record.currentMaze,
          step: snapshot.view.observation.step,
          revision: snapshot.revision,
        }),
      );
    } catch (e) {
      if (runId.current === id) {
        setError(String(e));
        setPlaying(false);
      }
    } finally {
      if (runId.current === id) setPending(false);
    }
  }
  useEffect(() => {
    if (
      !playing ||
      pending ||
      dirty ||
      !snapshot ||
      snapshot.record.status !== "running"
    )
      return;
    const t = setTimeout(() => void step(), 100);
    return () => clearTimeout(t);
  }, [playing, pending, dirty, snapshot]);
  async function recording(show: boolean) {
    setPlaying(false);
    setError("");
    setPending(true);
    try {
      const r = await loadRecording(
        await api("/runs/" + runId.current + "/export"),
      );
      if (show) loadReplay(r);
      else download("maze-memory-run.json", r);
    } catch (e) {
      setError(String(e));
    } finally {
      setPending(false);
    }
  }
  async function importFile(file: File) {
    setPlaying(false);
    setError("");
    setPending(true);
    try {
      if (file.size > 64 * 1024 * 1024)
        throw Error("Recording exceeds 64 MiB.");
      const value = JSON.parse(await file.text());
      if (value.format === "stigsim-maze-memory-run@1")
        loadReplay(await loadRecording(value));
      else {
        if (file.size > 100000) throw Error("Strategy file exceeds 100 KB.");
        setStrategy(parseStrategy(value));
        setReplay(null);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setPending(false);
    }
  }
  const m = snapshot?.metrics;
  return (
    <main className="mm-lab">
      <header className="mm-row">
        <div>
          <p className="mm-kicker">
            Local experiment · model-directed navigation
          </p>
          <h1>Maze Memory Lab</h1>
          <p>
            Design the notes. Write the instructions. Let the model choose the
            moves.
          </p>
        </div>
        <div className="mm-actions">
          <a className="mm-eval-link" href="#mm-evaluation">
            Evaluate strategy
          </a>
          <button
            onClick={() => {
              setBrief(briefing(strategy));
              setCopyStatus("");
            }}
          >
            Starter kit for your AI
          </button>
          <button disabled={locked} onClick={() => input.current?.click()}>
            Import strategy or replay
          </button>
        </div>
      </header>
      <input
        ref={input}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void importFile(f);
          e.target.value = "";
        }}
      />
      {error && (
        <p role="alert" className="mm-error">
          {error}
        </p>
      )}
      {replay ? (
        <MemoryReplay
          key={replayKey}
          record={replay}
          onClose={() => setReplay(null)}
        />
      ) : (
        <div className="mm-grid">
          <section className="mm-panel">
            <div className="mm-row">
              <h2>Your strategy</h2>
              <button disabled={locked} onClick={() => setStrategy(STARTER)}>
                Load least-used starter
              </button>
            </div>
            <label>
              Name
              <input
                disabled={locked}
                maxLength={80}
                value={strategy.name}
                onChange={(e) =>
                  setStrategy((s) => ({ ...s, name: e.target.value }))
                }
              />
            </label>
            <textarea
              className="mm-code"
              aria-label="Strategy JavaScript"
              spellCheck={false}
              disabled={locked}
              value={strategy.source}
              onChange={(e) =>
                setStrategy((s) => ({ ...s, source: e.target.value }))
              }
            />
            <div className="mm-actions">
              <button
                disabled={locked || !connection?.ready}
                onClick={() => void start("practice")}
              >
                Apply & start sandbox
              </button>
              <button
                onClick={() => {
                  try {
                    download(
                      "maze-memory-strategy.json",
                      parseStrategy(strategy),
                    );
                  } catch (e) {
                    setError(String(e));
                  }
                }}
              >
                Export strategy
              </button>
            </div>
            <p>
              {dirty
                ? "Edits apply when starting a new run."
                : "Strategy frozen for this run."}{" "}
              Export results before starting over.
            </p>
            <details>
              <summary>Strategy contract & memory limits</summary>
              <p>
                Implement prepare(o) and return instructions, context, writes.
                No private state survives a decision. Read free-form JSON on the
                current cell and open adjacent passages; null means empty. Code
                can recommend a move, but only the model response executes it.
              </p>
              <pre>{`{ target: 'cell', value: { note: 'exploring' } }
{ target: 'E', when: 'chosen', value: { visits: 2 } }`}</pre>
              <p>
                Writes replace whole notes. Conditional passage writes commit
                only on a successful crossing. Other local writes commit after a
                valid response, including blocked movement. Invalid, failed or
                cancelled inference commits nothing. No automatic retries or
                fallback moves.
              </p>
              <p>
                2 KiB/note · 8 KiB and 16 writes/decision · 1 MiB/maze · JSON
                depth 32 · 32 KB source · 24 KB context · 8,000 instruction
                characters. Fresh isolated VM: no filesystem, network, clocks or
                ambient randomness. All local notes are sent to the model and
                consume tokens.
              </p>
            </details>
            <details open={!connection}>
              <summary>Local inference setup</summary>
              <p>
                {connection?.ready
                  ? `Configured model: ${connection.model}`
                  : "The local runner is unavailable or not configured."}{" "}
                The app and credential holder run locally; inference uses your
                configured endpoint and credits.
              </p>
              <pre>{`pnpm install
pnpm build
# Terminal 1: keep credentials in your own untracked env file
node --env-file=/path/to/model.env --import tsx scripts/maze-memory-server.ts
# Terminal 2
PORT=3015 pnpm preview:maze-memory`}</pre>
              <p>
                Set MAZE_MEMORY_MODEL and the endpoint variables documented in
                docs/maze-memory.md. Credentials never belong in VITE_
                variables. Static hosting does not provide an inference service.
              </p>
              <button onClick={() => void connect()}>Refresh connection</button>
            </details>
          </section>
          <section>
            <div className="mm-panel">
              <div className="mm-row">
                <h2>One-maze sandbox</h2>
                <label>
                  Practice maze
                  <select
                    disabled={locked}
                    value={index}
                    onChange={(e) => setIndex(+e.target.value)}
                  >
                    {PRACTICE_SEEDS.map((_, i) => (
                      <option key={i} value={i}>
                        Maze {i + 1} of 20
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <p>
                Local runner:{" "}
                {connection?.ready ? connection.model : "not configured"} · one
                model request at a time
              </p>
              <MazeCanvas view={snapshot?.view ?? null} />
              <div className="mm-actions">
                <button
                  disabled={
                    !snapshot || dirty || snapshot.record.status !== "running"
                  }
                  onClick={() => setPlaying((p) => !p)}
                >
                  {playing ? "Pause after decision" : "▶ Play"}
                </button>
                <button
                  disabled={
                    !snapshot ||
                    locked ||
                    dirty ||
                    snapshot.record.status !== "running"
                  }
                  onClick={() => void step()}
                >
                  {pending ? "Working…" : "One model move"}
                </button>
                <button
                  disabled={!snapshot || snapshot.record.status !== "running"}
                  onClick={async () => {
                    setPlaying(false);
                    try {
                      accept(
                        await api("/runs/" + runId.current + "/stop", "POST"),
                      );
                    } catch (e) {
                      setError(String(e));
                    }
                  }}
                >
                  Stop
                </button>
              </div>
              {snapshot && (
                <>
                  <p>
                    {snapshot.record.status} · maze{" "}
                    {snapshot.record.currentMaze + 1}/
                    {snapshot.record.manifest.seeds.length} ·{" "}
                    {snapshot.view.observation.step} moves here
                  </p>
                  <LocalNotes view={snapshot.view} />
                </>
              )}
            </div>
            <div className="mm-panel">
              <h2 id="mm-evaluation">Test against up to 100 mazes</h2>
              <p>
                The frozen strategy runs sequentially on reproducible evaluation
                mazes. This makes paid model calls. A budget or provider
                interruption leaves an incomplete batch.
              </p>
              <div className="mm-row">
                <label>
                  Mazes
                  <input
                    type="number"
                    min={1}
                    max={100}
                    disabled={locked}
                    value={count}
                    onChange={(e) => setCount(+e.target.value)}
                  />
                </label>
                <label>
                  Moves / maze
                  <input
                    type="number"
                    min={1}
                    max={4000}
                    disabled={locked}
                    value={limits.movesPerMaze}
                    onChange={(e) =>
                      setLimits((l) => ({
                        ...l,
                        movesPerMaze: +e.target.value,
                      }))
                    }
                  />
                </label>
                <label>
                  Total request budget
                  <input
                    type="number"
                    min={1}
                    max={100000}
                    disabled={locked}
                    value={limits.requests}
                    onChange={(e) =>
                      setLimits((l) => ({ ...l, requests: +e.target.value }))
                    }
                  />
                </label>
              </div>
              <details>
                <summary>Evaluation round</summary>
                <label>
                  Round identifier
                  <input
                    disabled={locked}
                    maxLength={80}
                    value={round}
                    onChange={(e) => setRound(e.target.value)}
                  />
                </label>
                <button
                  disabled={locked}
                  onClick={() => setRound(crypto.randomUUID())}
                >
                  New maze set
                </button>
                <p>
                  Reuse a round identifier to compare strategies on the same
                  mazes. These local seeds are visible, not hidden tournament
                  tests.
                </p>
              </details>
              <button
                className="mm-primary"
                disabled={locked || !connection?.ready}
                onClick={() => void start("evaluation")}
              >
                Start {count}-maze evaluation · ≤
                {limits.requests.toLocaleString()} requests
              </button>
            </div>
            {snapshot && (
              <div className="mm-panel">
                <h2>Results</h2>
                {snapshot.record.mode === "evaluation" && (
                  <progress
                    aria-label="Evaluation progress"
                    max={m?.mazes ?? 100}
                    value={m?.finished ?? 0}
                  />
                )}
                <p>
                  {m?.solved}/{m?.finished} finished mazes solved ·{" "}
                  {m?.finished}/{m?.mazes} trials finished · {m?.requests}/
                  {snapshot.record.limits.requests} requests
                </p>
                <p>
                  {m?.inputTokens.toLocaleString()} input +{" "}
                  {m?.outputTokens.toLocaleString()} output tokens ·{" "}
                  {m?.unknownUsage} requests with unknown usage
                </p>
                <strong>
                  {m?.tokensPerSolution === null
                    ? "No ranked cost: incomplete, unknown usage, or no solutions."
                    : `${Math.round(m?.tokensPerSolution ?? 0).toLocaleString()} tokens per solution`}
                </strong>
                <p>
                  Token proxy, not dollar pricing. Includes spending on
                  unsuccessful mazes. These are local diagnostic results, not
                  verified leaderboard scores.
                </p>
                <div className="mm-actions">
                  <button
                    disabled={pending}
                    onClick={() => void recording(true)}
                  >
                    Watch memory replay
                  </button>
                  <button
                    disabled={pending}
                    onClick={() => void recording(false)}
                  >
                    Export run & results
                  </button>
                </div>
                <details>
                  <summary>Maze outcomes and strategy errors</summary>
                  {snapshot.record.outcomes.map((o) => (
                    <p key={o.maze}>
                      Maze {o.maze + 1}: {o.status} · {o.moves} moves{" "}
                      {o.error && <span className="mm-error">{o.error}</span>}
                    </p>
                  ))}
                </details>
                <h3>Recent decisions</h3>
                {snapshot.recentAttempts
                  .slice()
                  .reverse()
                  .map((a, i) => (
                    <details key={`${a.maze}:${a.step}`} open={i === 0}>
                      <summary>
                        Maze {a.maze + 1}, step {a.step}:{" "}
                        {a.answer?.move ?? "no choice"}{" "}
                        {a.applied ? "applied" : "not applied"} · {a.elapsedMs}{" "}
                        ms
                      </summary>
                      {a.error && <p className="mm-error">{a.error}</p>}
                      <pre>
                        {JSON.stringify(
                          {
                            observation: a.observation,
                            ...a.prepared,
                            answer: a.answer,
                          },
                          null,
                          2,
                        )}
                      </pre>
                    </details>
                  ))}
              </div>
            )}
          </section>
        </div>
      )}
      {brief !== null && (
        <div
          className="mm-modal"
          role="dialog"
          aria-modal="true"
          aria-label="Starter kit for your AI"
        >
          <div className="mm-panel">
            <div className="mm-row">
              <h2>Copy this to your AI</h2>
              <button onClick={() => setBrief(null)}>Close</button>
            </div>
            <textarea
              aria-label="AI strategy briefing"
              value={brief}
              readOnly
            />
            <button
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(brief);
                  setCopyStatus("Copied");
                } catch {
                  setCopyStatus("Select the text and copy it manually.");
                }
              }}
            >
              Copy briefing
            </button>
            <span role="status">{copyStatus}</span>
          </div>
        </div>
      )}
    </main>
  );
}
