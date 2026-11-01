import { useEffect, useRef, useState } from 'react';
import { Replayer } from '@stigsim/sim-trace';
import { W, H } from '@stigsim/sim-core';
import { render } from '../../render';
import { BASELINE, CHALLENGE, PRACTICE_ROUND, parseStrategy, strategyId, type Strategy } from './contract';
import { paired, standings, type Observation, type Progress, type Report } from './engine';
import { STARTERS } from './starters';
import './strategy-lab.css';

function download(name: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function Field({ observation }: { observation: Observation }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = canvas.current?.getContext('2d'); if (!ctx) return;
    const o = observation, cell = W / o.cols;
    ctx.fillStyle = '#090f13'; ctx.fillRect(0, 0, W, H);
    const max = Math.max(100, ...o.trails.food, ...o.trails.home);
    o.open.forEach((open, i) => {
      if (!open) return;
      const x = (i % o.cols) * cell, y = Math.floor(i / o.cols) * cell;
      ctx.fillStyle = '#243137'; ctx.fillRect(x, y, cell, cell);
      ctx.fillStyle = `rgba(70,210,180,${Math.min(0.9, (o.trails.food[i] + o.trails.home[i]) / max)})`;
      ctx.fillRect(x, y, cell, cell);
    });
    ctx.fillStyle = '#70b9ff'; ctx.fillRect(o.nest.x * cell, o.nest.y * cell, cell, cell);
    ctx.fillStyle = '#64dc81'; o.food.filter(f => f.remaining > 0).forEach(f => ctx.fillRect(f.x * cell, f.y * cell, cell, cell));
    o.ants.forEach(a => { ctx.fillStyle = a.carrying ? '#ffcf5c' : '#a9d8ff'; ctx.beginPath(); ctx.arc(a.x * cell, a.y * cell, 3, 0, Math.PI * 2); ctx.fill(); });
  }, [observation]);
  return <canvas ref={canvas} width={W} height={H} aria-label="Live maze: blue nest, green food, yellow ants carrying food" />;
}
function Playback({ report }: { report: Report }) {
  const [selected, setSelected] = useState(0), [playing, setPlaying] = useState(false), [tick, setTick] = useState(0);
  const canvas = useRef<HTMLCanvasElement>(null), replay = useRef<Replayer | null>(null);
  const trial = report.trials[selected];
  useEffect(() => {
    replay.current = trial.trace ? new Replayer(trial.trace) : null;
    setPlaying(false); setTick(0);
    const ctx = canvas.current?.getContext('2d'); if (ctx && replay.current) render(ctx, replay.current.sim);
  }, [trial]);
  useEffect(() => {
    if (!playing) return;
    let id = 0;
    const frame = () => {
      const r = replay.current; if (!r) return;
      for (let i = 0; i < 4; i++) if (!r.step()) { setPlaying(false); break; }
      const ctx = canvas.current?.getContext('2d'); if (ctx) render(ctx, r.sim);
      setTick(r.tick);
      if (r.atEnd || r.divergedAt !== null) setPlaying(false);
      if (!r.atEnd && r.divergedAt === null) id = requestAnimationFrame(frame);
    };
    id = requestAnimationFrame(frame); return () => cancelAnimationFrame(id);
  }, [playing]);
  return <section className="sl-replay">
    <h2>Watch the decisions play out</h2>
    <label>Trial<select value={selected} onChange={e => setSelected(Number(e.target.value))}>
      {report.trials.map((t, i) => <option key={i} value={i}>{report.entries.find(e => e.id === t.entry)?.strategy.name} · maze {t.maze + 1} · replicate {t.replicate + 1}{t.error ? ' · failed' : ''}</option>)}
    </select></label>
    <canvas ref={canvas} width={W} height={H} aria-label="Recorded simulation replay" />
    <div className="sl-actions"><button onClick={() => { if (replay.current?.atEnd) { replay.current.reset(); setTick(0); } setPlaying(p => !p); }}>{playing ? 'Pause' : 'Play replay'}</button><span>Tick {tick} / {trial.endTick}</span>
      <button onClick={() => download('strategy-trial.trace.json', trial.trace)}>Download trace</button></div>
    <input aria-label="Replay tick" type="range" min={0} max={trial.endTick} value={tick} onChange={e => {
      setPlaying(false); const r = replay.current; if (!r) return; r.seek(Number(e.target.value)); setTick(r.tick);
      const ctx = canvas.current?.getContext('2d'); if (ctx) render(ctx, r.sim);
    }} />
    {replay.current?.divergedAt !== null && replay.current?.divergedAt !== undefined && <p role="alert">Replay diverged at tick {replay.current.divergedAt}.</p>}
    <p>{trial.actions.length} setting changes · {trial.usage.calls} observations · {(trial.usage.observationBytes / 1e6).toFixed(2)} MB observed · {trial.usage.interrupts} compute units</p>
    {trial.error && <p role="alert">{trial.error} This entry is unranked; its partial food total is not a score.</p>}
    <details><summary>Setting changes</summary>{trial.actions.length ? <ul>{trial.actions.map(a => <li key={a.tick}>Tick {a.effectiveTick}: evaporation {a.settings.evaporation}, trail bias {a.settings.trailBias}, deposition {a.settings.foodDeposition}</li>)}</ul> : <p>Initial settings held throughout.</p>}</details>
  </section>;
}
export default function StrategyLab() {
  const [strategy, setStrategy] = useState<Strategy>(STARTERS[1]);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null), [report, setReport] = useState<Report | null>(null);
  const worker = useRef<Worker | null>(null), file = useRef<HTMLInputElement>(null);
  useEffect(() => {
    void strategyId(STARTERS[1]).then(parent => setStrategy(s => s === STARTERS[1] ? { ...s, name: `${s.name} remix`, parent } : s));
    return () => worker.current?.terminate();
  }, []);
  const update = (patch: Partial<Strategy>) => setStrategy(s => ({ ...s, ...patch }));
  const run = async () => {
    setError(''); setReport(null); setProgress(null);
    try {
      const entry = parseStrategy(strategy);
      const baselineId = await strategyId(STARTERS[0]);
      if (await strategyId(entry) === baselineId) throw new Error('Remix the fixed reference before comparing it with itself.');
      const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }); worker.current = w; setBusy(true);
      w.onmessage = e => {
        if (e.data.kind === 'progress') setProgress(e.data.progress);
        else { if (e.data.kind === 'result') setReport(e.data.report); else setError(e.data.error); w.terminate(); worker.current = null; setBusy(false); }
      };
      w.onerror = () => { setError('Worker failed to load or run. Check that the app assets are available.'); w.terminate(); worker.current = null; setBusy(false); };
      w.postMessage({ strategies: [STARTERS[0], entry], round: PRACTICE_ROUND });
    } catch (e) { setError(e instanceof Error ? e.message : 'Invalid entry.'); }
  };
  return <main className="strategy-lab">
    <header><p className="sl-kicker">Stigsim · Strategy Lab · Preview</p><h1>Can your ants bring home more food?</h1>
      <p>Build a strategy. Choose what to measure and when to intervene. Compare it with a fixed reference on the same random mazes, then share a file others can improve.</p></header>
    <div className="sl-rulebar"><span><strong>{CHALLENGE.ants}</strong> ants</span><span><strong>600</strong> available food</span><span><strong>{CHALLENGE.ticks}</strong> ticks</span><span>Score = food delivered home</span></div>
    <div className="sl-columns"><section className="sl-editor"><h2>1. Start with an idea</h2>
      <div className="sl-gallery">{STARTERS.map(s => <button key={s.name} disabled={busy} onClick={async () => {
        update({ ...s, name: `${s.name} remix`, parent: await strategyId(s) }); setError('');
      }}>{s.name}<small>{s.description}</small></button>)}</div>
      <label>Name<input maxLength={80} value={strategy.name} disabled={busy} onChange={e => update({ name: e.target.value })} /></label>
      <label>Explain your idea<textarea rows={2} maxLength={2000} value={strategy.description} disabled={busy} onChange={e => update({ description: e.target.value })} /></label>
      <fieldset disabled={busy}><legend>Initial ant settings</legend>{(Object.keys(BASELINE) as (keyof typeof BASELINE)[]).map(key => <label key={key}>{({ evaporation: 'Evaporation', trailBias: 'Trail bias', foodDeposition: 'Food-trail deposition' })[key]}<input type="number" min={0} max={key === 'evaporation' ? 1 : key === 'trailBias' ? 32 : 3} step={key === 'evaporation' ? 0.001 : key === 'trailBias' ? 0.5 : 1} value={strategy.initial[key]} onChange={e => update({ initial: { ...strategy.initial, [key]: Number(e.target.value) } })} /></label>)}</fieldset>
      <h2>2. Define your observer and controller</h2>
      <p>Write JavaScript below. <code>step(o, state)</code> gets the current field and returns the next tick to observe. Only the JSON state you return survives to the next call.</p>
      <textarea className="sl-code" aria-label="Strategy JavaScript" spellCheck={false} value={strategy.source} disabled={busy} onChange={e => update({ source: e.target.value })} />
      <details><summary>Inputs, actions and fair limits</summary><p><code>o</code> includes tick, tickLimit, cols, rows, open, nest, ants, food, trails, foodDelivered and settings. Ant positions are in cell units; trails and open are row-major arrays. Ant IDs remain stable.</p>
        <p>Return <code>{'{ nextTick, state, settings? }'}</code>. nextTick must be later than now and at most 3001. Settings are a complete object: evaporation (0–1), trailBias (0–32, half steps), foodDeposition (0–3 integer). Changes take effect on the next simulation tick.</p>
        <p>Evaporation fades trails. Trail bias controls following both food and home trails. Deposition controls how strongly returning ants mark food trails.</p>
        <p>Each trial allows 16 MB of observations, 64 KB of persistent state, 128 setting changes, 128 compute units per call and 8,192 per trial. A compute unit is one deterministic QuickJS interrupt callback. No network, files, clock, random source or simulation seed is available. Choose your own sampling schedule, windows, features and detector.</p></details>
      <div className="sl-actions"><button disabled={busy} onClick={() => { try { download('strategy.json', parseStrategy(strategy)); } catch (e) { setError(String(e)); } }}>Export strategy</button><button disabled={busy} onClick={() => file.current?.click()}>Import strategy</button></div>
      <input ref={file} hidden type="file" accept=".json,application/json" onChange={async e => {
        const f = e.target.files?.[0]; if (!f) return;
        try { if (f.size > 100_000) throw new Error('Strategy file exceeds 100 KB.'); setStrategy(parseStrategy(JSON.parse(await f.text()))); setError(''); }
        catch (err) { setError(err instanceof Error ? err.message : 'Invalid file.'); } e.target.value = '';
      }} />
      {strategy.parent && <p className="sl-hash">Remixed from {strategy.parent}</p>}
    </section><aside className="sl-results"><h2>3. Put it to the test</h2><p>Three public practice mazes. Each strategy gets an identical copy of each maze, food layout and ant random stream. Highest mean food delivered wins.</p>
      <p className="sl-note">Practice is feedback, not evidence of a general improvement. Official rounds should use fresh organizer-held seeds after entries are frozen.</p>
      <div className="sl-actions"><button className="sl-primary" disabled={busy} onClick={run}>Run paired practice</button>{busy && <button onClick={() => { worker.current?.terminate(); worker.current = null; setBusy(false); setProgress(null); }}>Cancel</button>}</div>
      {error && <p role="alert">{error}</p>}
      <div aria-live="polite">{busy && progress && <p>{progress.name} · Maze {progress.maze + 1} / 3 · {progress.observation.tick} / {CHALLENGE.ticks} ticks · {progress.observation.foodDelivered} delivered</p>}{busy && !progress && <p>Loading the isolated controller engine…</p>}</div>
      {busy && progress && <Field observation={progress.observation} />}
      {report && <><h2>Practice results</h2><table><thead><tr><th>Strategy</th><th>Mean food</th></tr></thead><tbody>{standings(report).map(e => <tr key={e.id}><td>{e.strategy.name}</td><td>{e.mean?.toFixed(2) ?? 'Unranked'}</td></tr>)}</tbody></table>
        {(() => { const comparison = paired(report, report.entries[1].id, report.entries[0].id); return comparison && <p>Your strategy − reference: {comparison.mean >= 0 ? '+' : ''}{comparison.mean.toFixed(2)} food per maze. {comparison.wins} wins, {comparison.ties} ties, {comparison.losses} losses. Standard error across mazes: {comparison.standardError.toFixed(2)}. Three mazes are too few for a reliable conclusion.</p>; })()}
        <button onClick={() => download('strategy-practice-results.json', report)}>Export results and replays</button><Playback report={report} /></>}
      <details><summary>How a shared competition works</summary><ol><li>Publish strategy files with explanations and parent hashes.</li><li>Freeze entries before an organizer chooses fresh seeds.</li><li>Run all entries with the same versioned challenge and budgets.</li><li>Publish the round manifest, source files, scores and traces so anyone can rerun them.</li><li>Remix, practice and enter the next round.</li></ol><p>This preview handles local practice and portable entries. The repository includes a headless round runner for organizers; it does not submit entries to a hosted leaderboard.</p></details>
    </aside></div>
  </main>;
}
