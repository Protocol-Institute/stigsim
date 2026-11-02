import { useEffect, useRef, useState } from 'react';
import { W, H } from '@stigsim/sim-core';
import { BASELINE, CHALLENGE, parseStrategy, strategyId, type Settings, type Strategy } from './contract';
import { composeSource, readEditors } from './authoring';
import { STARTERS } from './starters';
import { evaluationRound, summarizeTrials } from './evaluation';
import type { Observation, Report, SandboxSnapshot, Trial } from './engine';
import type { WorkerRequest } from './worker';
import './strategy-lab.css';

function download(name: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function makeWorker() { return new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }); }
function send(worker: Worker, message: WorkerRequest) { worker.postMessage(message); }
function signature(strategy: Strategy, seed: string) { return JSON.stringify([strategy.source, strategy.initial, seed]); }
const settingLabels: Record<keyof Settings, string> = { evaporation: 'Evaporation', trailBias: 'Trail bias', foodDeposition: 'Food deposition' };

function Field({ observation }: { observation: Observation | null }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = canvas.current?.getContext('2d'); if (!ctx || !observation) return;
    const o = observation, cell = W / o.cols;
    ctx.fillStyle = '#0d0a06'; ctx.fillRect(0, 0, W, H);
    const maxHome = Math.max(100, ...o.trails.home), maxFood = Math.max(100, ...o.trails.food);
    o.open.forEach((open, i) => {
      if (!open) return;
      const x = (i % o.cols) * cell, y = Math.floor(i / o.cols) * cell;
      ctx.fillStyle = '#2a1e0e'; ctx.fillRect(x, y, cell, cell);
      ctx.fillStyle = `rgba(80,158,255,${Math.min(0.55, o.trails.home[i] / maxHome * 0.55)})`;
      ctx.fillRect(x, y, cell, cell);
      ctx.fillStyle = `rgba(80,220,200,${Math.min(0.6, o.trails.food[i] / maxFood * 0.6)})`;
      ctx.fillRect(x, y, cell, cell);
    });
    ctx.font = `${cell - 4}px serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#4b9eff'; ctx.fillRect(o.nest.x * cell, o.nest.y * cell, cell, cell);
    ctx.fillText('🏠', (o.nest.x + 0.5) * cell, (o.nest.y + 0.5) * cell);
    o.food.forEach(f => {
      ctx.fillStyle = f.remaining ? '#16a34a' : '#2a2a2a'; ctx.fillRect(f.x * cell, f.y * cell, cell, cell);
      ctx.globalAlpha = f.remaining ? 1 : 0.35; ctx.fillText('🍎', (f.x + 0.5) * cell, (f.y + 0.5) * cell); ctx.globalAlpha = 1;
    });
    o.ants.forEach(a => {
      ctx.fillStyle = a.carrying ? '#facc15' : '#4b9eff'; ctx.beginPath(); ctx.arc(a.x * cell, a.y * cell, a.carrying ? 4.5 : 3.5, 0, Math.PI * 2); ctx.fill();
    });
  }, [observation]);
  return <canvas ref={canvas} width={W} height={H} aria-label="Sandbox maze. Blue ants, yellow ants carrying food, blue home trails and green food trails." />;
}
interface Batch { strategy: Strategy; round: Report['round']; trials: Trial[]; cancelled: boolean; complete: boolean }
export default function StrategyLab() {
  const [strategy, setStrategy] = useState<Strategy>({ ...STARTERS[1], name: 'My pulse strategy' });
  const [seed, setSeed] = useState('sandbox-1'), [activeSignature, setActiveSignature] = useState('');
  const [snapshot, setSnapshot] = useState<SandboxSnapshot | null>(null), [lastTrial, setLastTrial] = useState<Trial | null>(null);
  const [running, setRunning] = useState(false), [pending, setPending] = useState(false), [speed, setSpeed] = useState(1);
  const [error, setError] = useState(''), [evaluationError, setEvaluationError] = useState('');
  const [testSet, setTestSet] = useState(() => crypto.randomUUID() as string);
  const [batch, setBatch] = useState<Batch | null>(null), [evaluating, setEvaluating] = useState(false);
  const [reports, setReports] = useState<Report[]>([]);
  const sandbox = useRef<Worker | null>(null), evaluation = useRef<Worker | null>(null), file = useRef<HTMLInputElement>(null);
  const editors = readEditors(strategy.source);
  const dirty = signature(strategy, seed) !== activeSignature;
  function reset(entry = strategy, mazeSeed = seed) {
    setRunning(false); setError('');
    try {
      const parsed = parseStrategy(entry);
      if (!mazeSeed.trim() || mazeSeed.length > 200) throw new Error('Maze seed must be 1–200 characters.');
      sandbox.current?.terminate(); const w = makeWorker(); sandbox.current = w;
      setSnapshot(null); setLastTrial(null); setPending(true); setActiveSignature(signature(parsed, mazeSeed));
      w.onmessage = event => {
        if (sandbox.current !== w) return;
        setPending(false);
        if (event.data.kind === 'snapshot') {
          setSnapshot(event.data.snapshot);
          if (event.data.trial) setLastTrial(event.data.trial);
          if (event.data.snapshot.done) setRunning(false);
        } else { setError(event.data.error); setRunning(false); }
      };
      w.onerror = () => { if (sandbox.current === w) { setError('Sandbox worker failed. Reset to try again.'); setPending(false); setRunning(false); } };
      send(w, { kind: 'init', strategy: parsed, seed: mazeSeed });
    } catch (e) { setError(e instanceof Error ? e.message : 'Invalid strategy.'); }
  }
  useEffect(() => {
    reset();
    void strategyId(STARTERS[1]).then(parent => setStrategy(s => s.parent === null && s.name === 'My pulse strategy' ? { ...s, parent } : s));
    return () => { sandbox.current?.terminate(); evaluation.current?.terminate(); };
    // A new trial starts only on an explicit reset/apply, never on each keystroke.
  }, []);
  useEffect(() => {
    if (!running || pending || !snapshot || snapshot.done || dirty || !sandbox.current) return;
    const id = requestAnimationFrame(() => { setPending(true); send(sandbox.current!, { kind: 'advance', ticks: speed }); });
    return () => cancelAnimationFrame(id);
  }, [running, pending, snapshot, dirty, speed]);
  function update(patch: Partial<Strategy>) { setRunning(false); setStrategy(s => ({ ...s, ...patch })); }
  async function selectStarter(index: number) {
    const starter = STARTERS[index];
    const entry = { ...starter, name: `${starter.name} remix`, parent: await strategyId(starter) };
    setStrategy(entry); reset(entry);
  }
  async function test100() {
    if (evaluating) return;
    setRunning(false); setEvaluationError('');
    try {
      const entry = parseStrategy(strategy), round = evaluationRound(testSet);
      setBatch({ strategy: entry, round, trials: [], complete: false, cancelled: false });
      const w = makeWorker(); evaluation.current = w; setEvaluating(true);
      w.onmessage = e => {
        if (evaluation.current !== w) return;
        if (e.data.kind === 'trial') setBatch(b => b && ({ ...b, trials: [...b.trials, e.data.trial] }));
        else {
          if (e.data.kind === 'result') {
            const report: Report = e.data.report;
            setBatch(b => b && ({ ...b, trials: report.trials, complete: true }));
            setReports(rows => [...rows.filter(r => r.entries[0].id !== report.entries[0].id), report]);
          } else { setEvaluationError(e.data.error); setBatch(b => b && ({ ...b, cancelled: true })); }
          setEvaluating(false); w.terminate(); evaluation.current = null;
        }
      };
      w.onerror = () => { if (evaluation.current === w) { setEvaluationError('Evaluation worker failed. Run the test again.'); setBatch(b => b && ({ ...b, cancelled: true })); setEvaluating(false); w.terminate(); evaluation.current = null; } };
      send(w, { kind: 'evaluate', strategy: entry, round });
    } catch (e) { setEvaluationError(e instanceof Error ? e.message : 'Invalid strategy.'); }
  }
  const observation = snapshot?.observation ?? null;
  const summary = summarizeTrials(batch?.trials ?? []);
  const rows = reports.map(report => ({ report, summary: summarizeTrials(report.trials) })).sort((a, b) => (b.summary.mean ?? -1) - (a.summary.mean ?? -1));
  return <main className="strategy-lab">
    <header className="sl-header"><div><p className="sl-kicker">Stigsim / Sandbox</p><h1>Strategy Lab</h1></div>
      <div className="sl-header-actions"><span>{batch?.complete ? `100 mazes complete · mean ${summary.mean?.toFixed(2) ?? "unranked"}` : "Build on one maze. Put it to the test on 100."}</span><button className="sl-primary" disabled={evaluating} onClick={test100}>{evaluating ? `Testing ${batch?.trials.length ?? 0} / 100…` : 'Test on 100 mazes ↗'}</button></div>
    </header>
    <div className="sl-workbench">
      <section className="sl-editor sl-panel" aria-label="Strategy editor">
        <div className="sl-panel-heading"><h2>Your strategy</h2><select aria-label="Load starter strategy" defaultValue="" onChange={e => { void selectStarter(Number(e.target.value)); e.target.value = ''; }}><option value="" disabled>Load a starter…</option>{STARTERS.map((s, i) => <option key={s.name} value={i}>{s.name}</option>)}</select></div>
        <label className="sl-name">Name<input maxLength={80} value={strategy.name} onChange={e => update({ name: e.target.value })} /></label>
        {editors ? <>
          <div className="sl-code-heading"><h3><span>01</span> Observer</h3><small>Raw field → your signals</small></div>
          <textarea className="sl-code sl-observer" aria-label="Observer JavaScript" spellCheck={false} value={editors.observer} onChange={e => update({ source: composeSource({ ...editors, observer: e.target.value }) })} />
          <div className="sl-code-heading"><h3><span>02</span> Controller</h3><small>Your signals → ant settings</small></div>
          <textarea className="sl-code sl-controller" aria-label="Controller JavaScript" spellCheck={false} value={editors.controller} onChange={e => update({ source: composeSource({ ...editors, controller: e.target.value }) })} />
        </> : <><div className="sl-code-heading"><h3>Combined strategy</h3><small>Imported v1 step function</small></div><textarea className="sl-code sl-legacy" aria-label="Strategy JavaScript" spellCheck={false} value={strategy.source} onChange={e => update({ source: e.target.value })} /></>}
        <div className="sl-editor-footer"><button className={dirty ? 'sl-apply' : ''} disabled={evaluating} onClick={() => reset()}>{dirty ? 'Apply edits & restart' : 'Restart with this code'}</button><span>{dirty ? 'Edits not applied to sandbox' : 'Code applied'}</span></div>
        <details><summary>Initial ant settings</summary><div className="sl-settings">{(Object.keys(BASELINE) as (keyof Settings)[]).map(key => <label key={key}>{settingLabels[key]}<input type="number" min={0} max={key === 'evaporation' ? 1 : key === 'trailBias' ? 32 : 3} step={key === 'evaporation' ? 0.001 : key === 'trailBias' ? 0.5 : 1} value={strategy.initial[key]} onChange={e => update({ initial: { ...strategy.initial, [key]: Number(e.target.value) } })} /></label>)}</div></details>
        <details><summary>Code reference & limits</summary><p><code>observe(o, state)</code> returns <code>{'{ signals, state, nextTick }'}</code>. Choose the next absolute observation tick (later than now, at most 3001). Signals are entirely your own design.</p><p><code>control(signals, state, context)</code> returns <code>{'{ state, settings? }'}</code>. Context includes tick, tickLimit, current settings and initial settings. Each observation calls the controller. Each function keeps its own JSON state.</p><p>Raw inputs: tick, tickLimit, cols, rows, open, nest, ants, food, trails, foodDelivered, settings. Ants have id, x, y, carrying. Positions use cell units; map and trails are row-major arrays.</p><p>Complete settings object: evaporation (0–1), trailBias (0–32 in half steps), foodDeposition (integer 0–3). Settings apply before the following tick. Every trial has the same limits: 16 MB observations, 64 KB state, 128 changes, 128 compute units per call and 8,192 total. No host IO, clock or randomness.</p><p>Legacy <code>step(o, state)</code> files remain supported. Exports include the adapter that connects the two functions.</p></details>
        <details><summary>Share strategy</summary><label>Description<textarea rows={2} maxLength={2000} value={strategy.description} onChange={e => update({ description: e.target.value })} /></label><div className="sl-actions"><button onClick={() => { try { download('strategy.json', parseStrategy(strategy)); } catch (e) { setError(String(e)); } }}>Export strategy</button><button onClick={() => file.current?.click()}>Import strategy</button></div>{strategy.parent && <p className="sl-hash">Parent: {strategy.parent}</p>}</details>
        <input ref={file} hidden type="file" accept=".json,application/json" onChange={async e => {
          const f = e.target.files?.[0]; if (!f) return;
          try { if (f.size > 100_000) throw new Error('Strategy file exceeds 100 KB.'); const entry = parseStrategy(JSON.parse(await f.text())); setStrategy(entry); reset(entry); }
          catch (err) { setError(err instanceof Error ? err.message : 'Invalid file.'); } e.target.value = '';
        }} />
      </section>
      <section className="sl-simulation" aria-label="Single-maze sandbox">
        <div className="sl-panel sl-maze-panel"><div className="sl-panel-heading"><h2>Sandbox</h2><span className={`sl-status ${running ? 'is-running' : ''}`}>{dirty ? 'Unapplied edits' : snapshot?.error ? 'Stopped' : snapshot?.done ? 'Complete' : running ? 'Running' : 'Paused'}</span></div>
          <div className="sl-maze-toolbar"><label>Maze seed<input value={seed} maxLength={200} onChange={e => { setRunning(false); setSeed(e.target.value); }} /></label><button disabled={evaluating} onClick={() => { const next = crypto.randomUUID(); setSeed(next); reset(strategy, next); }}>New maze ↻</button></div>
          <Field observation={observation} />
          <div className="sl-sim-controls"><button className="sl-play" disabled={!snapshot || snapshot.done || dirty || evaluating} onClick={() => setRunning(r => !r)}>{running ? 'Ⅱ Pause' : '▶ Play'}</button><button disabled={pending || running || !snapshot || snapshot.done || dirty || evaluating} onClick={() => { setPending(true); send(sandbox.current!, { kind: 'advance', ticks: 1 }); }}>Step</button><button disabled={evaluating} onClick={() => reset()}>Reset</button><label>Speed<select value={speed} onChange={e => setSpeed(Number(e.target.value))}><option value={1}>1×</option><option value={4}>4×</option><option value={16}>16×</option></select></label><span className="sl-tick">Tick {observation?.tick ?? 0} / {CHALLENGE.ticks}</span></div>
          <div className="sl-metrics"><div><strong>{observation?.foodDelivered ?? 0}</strong><span>food delivered</span></div><div><strong>{observation?.ants.length ?? CHALLENGE.ants}</strong><span>ants</span></div><div><strong>{observation?.settings.trailBias ?? strategy.initial.trailBias}</strong><span>trail bias</span></div><div><strong>{snapshot?.actions.length ?? 0}</strong><span>interventions</span></div></div>
          {(error || snapshot?.error) && <p className="sl-error" role="alert">{error || snapshot?.error}</p>}
          <details className="sl-inspector"><summary>Observer signals & action log</summary><pre>{JSON.stringify(snapshot?.signals ?? {}, null, 2)}</pre><p>{snapshot?.usage.calls ?? 0} observations · evaporation {observation?.settings.evaporation ?? strategy.initial.evaporation} · deposition {observation?.settings.foodDeposition ?? strategy.initial.foodDeposition}</p>{snapshot?.actions.map(a => <p key={a.tick}>Tick {a.effectiveTick}: trail bias {a.settings.trailBias}, evaporation {a.settings.evaporation}, deposition {a.settings.foodDeposition}</p>)}{lastTrial?.trace && <button onClick={() => download('sandbox.trace.json', lastTrial.trace)}>Export replay trace</button>}</details>
        </div>
        <section className="sl-panel sl-evaluation" aria-label="100-maze evaluation"><div className="sl-panel-heading"><h2>100-maze test</h2><span className="sl-muted">Same challenge. Fresh mazes.</span></div>
          {batch ? <><div className="sl-batch-heading"><strong>{batch.strategy.name}</strong><span>{batch.cancelled ? 'Cancelled' : batch.complete ? 'Complete' : 'Testing'} · {summary.n} / 100</span></div><progress aria-label="Evaluation progress" max={100} value={summary.n} /><div className="sl-batch-stats"><span>Mean <strong>{summary.mean?.toFixed(2) ?? '—'}</strong></span><span>Std. error <strong>{summary.standardError?.toFixed(2) ?? '—'}</strong></span><span>Failures <strong>{summary.failures}</strong></span></div>{evaluating && <button onClick={() => { evaluation.current?.terminate(); evaluation.current = null; setEvaluating(false); setBatch(b => b && ({ ...b, cancelled: true })); }}>Cancel evaluation</button>}{!batch.complete && <p className="sl-muted">Partial results are not a leaderboard score.</p>}</> : <p className="sl-muted">Test your current strategy across 100 mazes. Results appear here as each run finishes.</p>}
          {evaluationError && <p role="alert" className="sl-error">{evaluationError}</p>}
          {rows.length > 0 && <><table><thead><tr><th>Strategy</th><th>Mean food</th><th>Std. error</th><th /></tr></thead><tbody>{rows.map(({ report, summary: result }) => <tr key={report.entries[0].id}><td>{report.entries[0].strategy.name}</td><td>{result.mean?.toFixed(2) ?? 'Unranked'}</td><td>{result.standardError?.toFixed(2) ?? '—'}</td><td><button aria-label={`Export results for ${report.entries[0].strategy.name}`} onClick={() => download('100-maze-results.json', report)}>↓</button></td></tr>)}</tbody></table><p className="sl-muted">Local results on the same 100-maze set. Fixed settings are an ordinary entry.</p><button disabled={evaluating} onClick={() => { const report = reports[reports.length - 1]; setStrategy(report.entries[0].strategy); setSeed(report.round.seeds[0]); reset(report.entries[0].strategy, report.round.seeds[0]); }}>Open last test’s maze 1 in sandbox</button></>}
          <details><summary>Test set & scoring</summary><label>Test-set seed<input value={testSet} disabled={evaluating || reports.length > 0} maxLength={100} onChange={e => setTestSet(e.target.value)} /></label><button disabled={evaluating} onClick={() => { setTestSet(crypto.randomUUID()); setReports([]); setBatch(null); }}>New test set</button><p>20 ants, 600 food, 3,000 ticks per maze. Score is mean food delivered home. Any failed trial makes that entry unranked. The same seeded set is reused across edits; export results to retain the full manifest. Maze 1 includes a replay trace.</p><p>These are local evaluations. An official round should freeze entries before choosing fresh organizer-held seeds.</p></details>
        </section>
      </section>
    </div>
  </main>;
}
