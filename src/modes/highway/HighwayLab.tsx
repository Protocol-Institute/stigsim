import { useEffect, useRef, useState } from 'react';
import { DEFAULT_CONFIG, createTrialSimulation, summarize, validateConfig, type HighwayConfig, type Trial } from './benchmark';
import { snapshot, type HighwaySnapshot } from './snapshot';
import type { BenchmarkEvent } from './worker';
import { SIM_VERSION } from '../../../packages/sim-trace/src/trace';
import './highway.css';

const QUICK = { ...DEFAULT_CONFIG, mazeCount: 3, replicates: 1, evapRates: [0.005], trailPowers: [3, 5] };
const count = (c: HighwayConfig) => c.mazeCount * c.replicates * c.evapRates.length * c.trailPowers.length;
const fmt = (n: number | null | undefined) => n == null ? '—' : Math.round(n).toLocaleString();
type View = { snapshot: HighwaySnapshot; trial?: Trial; title: string };

function MazeView({ view }: { view: View }) {
  const s = view.snapshot;
  const max = Math.max(100, ...s.cells.map(c => c.trail));
  return <div className="highway-maze">
    <div className="hw-section-head"><h2>{view.title}</h2><span>Tick {fmt(s.tick)} · {s.deliveries} delivered</span></div>
    <svg viewBox={`0 0 ${s.cols} ${s.rows}`} role="img" aria-label={`Maze at tick ${s.tick}, ${s.deliveries} food delivered${view.trial?.highway ? ', confirmed highway highlighted' : ''}`}>
      <rect width={s.cols} height={s.rows} fill="#0d0a06" />
      {s.cells.map((cell, i) => cell.open && <rect key={i} x={i % s.cols} y={Math.floor(i / s.cols)} width="1" height="1" fill={cell.trail > 0.5 ? `rgb(${42 - 20 * cell.trail / max}, ${30 + 120 * cell.trail / max}, ${14 + 130 * cell.trail / max})` : '#2a1e0e'} />)}
      {view.trial?.highway && <polyline points={view.trial.highway.route.map(i => `${i % s.cols + .5},${Math.floor(i / s.cols) + .5}`).join(' ')} fill="none" stroke="#a7f3d0" strokeWidth=".18" strokeLinejoin="round" />}
      <text x={s.nest[0] + .5} y={s.nest[1] + .75} textAnchor="middle" fontSize=".85">🏠</text>
      <text x={s.food[0] + .5} y={s.food[1] + .8} textAnchor="middle" fontSize=".85">🍎</text>
      {s.ants.map((a, i) => <circle key={i} cx={a.x} cy={a.y} r=".18" fill={a.carrying ? '#facc15' : '#60a5fa'} />)}
    </svg>
    <div className="hw-legend"><span>🏠 Nest</span><span>🍎 Infinite food</span><span style={{ color: '#60a5fa' }}>● Searching</span><span style={{ color: '#facc15' }}>● Carrying</span><span style={{ color: '#5eead4' }}>━ Food trail</span></div>
    {view.trial && <p>{view.trial.highway ? `Highway confirmed at tick ${fmt(view.trial.highway.confirmedTick)} · ${view.trial.highway.route.length - 1} cells vs. ${view.trial.shortest} shortest.` : `No highway by tick ${fmt(view.trial.endTick)} · shortest path ${view.trial.shortest} cells.`} First delivery: {fmt(view.trial.firstDelivery)}.</p>}
  </div>;
}

export default function HighwayLab() {
  const [config, setConfig] = useState<HighwayConfig>(QUICK);
  const [evaps, setEvaps] = useState(QUICK.evapRates.join(', '));
  const [powers, setPowers] = useState(QUICK.trailPowers.join(', '));
  const [runConfig, setRunConfig] = useState<HighwayConfig | null>(null);
  const [rows, setRows] = useState<Trial[]>([]);
  const [status, setStatus] = useState<'ready' | 'running' | 'stopped' | 'complete' | 'error'>('ready');
  const [error, setError] = useState('');
  const [views, setViews] = useState<View[]>([]);
  const [selected, setSelected] = useState(-1);
  const [view, setView] = useState<View>(() => ({ snapshot: snapshot(createTrialSimulation(QUICK, 0, 0, .005, 3)), title: 'First maze preview' }));
  const worker = useRef<Worker | null>(null);
  useEffect(() => () => worker.current?.terminate(), []);
  const running = status === 'running';
  const summary = summarize(rows, runConfig?.maxTicks ?? config.maxTicks);
  const successes = rows.filter(r => r.highway).length;
  const total = runConfig ? count(runConfig) : 0;
  const parsed: HighwayConfig = { ...config,
    evapRates: evaps.split(',').map(s => s.trim() ? Number(s) : NaN),
    trailPowers: powers.split(',').map(s => s.trim() ? Number(s) : NaN) };
  const planned = count(parsed);

  function preset(full: boolean) {
    const c = full ? DEFAULT_CONFIG : QUICK;
    setConfig({ ...c }); setEvaps(c.evapRates.join(', ')); setPowers(c.trailPowers.join(', '));
  }
  function start() {
    try {
      validateConfig(parsed);
      worker.current?.terminate();
      const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      worker.current = w;
      setRows([]); setViews([]); setSelected(-1); setError(''); setRunConfig(parsed); setStatus('running');
      setView({ snapshot: snapshot(createTrialSimulation(parsed, 0, 0, parsed.evapRates[0], parsed.trailPowers[0])), title: 'Starting first trial' });
      w.onmessage = (event: MessageEvent<BenchmarkEvent>) => {
        if (worker.current !== w) return;
        const message = event.data;
        if (message.kind === 'progress') {
          setView({ snapshot: message.snapshot, title: `Maze ${message.maze + 1} · ant seed ${message.replicate + 1} · evaporation ${message.evapRate} · bias ${message.trailPower}` });
        } else if (message.kind === 'trial') {
          const t = message.trial;
          const resultView = { snapshot: message.snapshot, trial: t, title: `Maze ${t.maze + 1} · ant seed ${t.replicate + 1} · evaporation ${t.evapRate} · bias ${t.trailPower}` };
          setRows(previous => [...previous, t]);
          setViews(previous => [...previous.slice(-29), resultView]);
          setView(resultView);
        } else {
          setStatus(message.kind === 'done' ? 'complete' : 'error');
          if (message.kind === 'error') setError(message.message);
          w.terminate(); worker.current = null;
        }
      };
      w.onerror = event => {
        if (worker.current !== w) return;
        setError(event.message || 'Benchmark worker failed'); setStatus('error'); w.terminate(); worker.current = null;
      };
      w.postMessage(parsed);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }
  function stop() { worker.current?.terminate(); worker.current = null; setStatus('stopped'); }
  function download() {
    const data = { format: 'stigsim-highway-benchmark', version: 1, simVersion: SIM_VERSION,
      source: 'browser', complete: status === 'complete', config: runConfig, summary, rows };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2) + '\n'], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = 'highway-results.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const numeric = (key: keyof HighwayConfig, label: string, step = 1, min = 1, max?: number) =>
    <label key={key}>{label}<input type="number" value={config[key] as number} step={step} min={min} max={max} onChange={e => setConfig(c => ({ ...c, [key]: Number(e.target.value) }))} /></label>;

  return <main className="highway-lab"><p className="hw-note"><a href={`${import.meta.env.BASE_URL}delivery-lab`}>Looking to optimize food collection? Open Food Delivery Lab →</a></p>
    <header className="hw-header"><div><p className="hw-kicker">STIGSIM / LOCAL EXPERIMENT</p><h1>How fast does a<br /><em>highway emerge?</em></h1><p>One nest. Infinite food. The same random mazes for every setting.<br />Find the ants that build a reliable route fastest.</p></div><div className="hw-contract"><span>WHAT COUNTS AS A HIGHWAY</span><strong>One route. Sustained traffic.</strong><p>By default: 95% of ants on one route within 10% of the shortest path, sustained for 1,000 ticks with repeated food deliveries.</p></div></header>
    <div className="hw-layout">
      <section className="hw-card hw-setup"><div className="hw-section-head"><h2>Design the experiment</h2><span>31 × 31 maze</span></div>
        <div className="hw-presets"><button disabled={running} onClick={() => preset(false)}>Quick comparison</button><button disabled={running} onClick={() => preset(true)}>Full sweep</button></div>
        <fieldset disabled={running}><legend>Fixed environment & colony</legend><div className="hw-fields">
          <label className="hw-wide">Seed prefix<input value={config.seedPrefix} onChange={e => setConfig(c => ({ ...c, seedPrefix: e.target.value }))} /></label>
          {numeric('mazeCount', 'Random mazes', 1, 1, 10000)}{numeric('replicates', 'Ant seeds per maze', 1, 1, 100)}
          {numeric('numAnts', 'Colony size', 1, 1, 1000)}{numeric('tankMax', 'Gland capacity', 1, 1, 1000000)}
          {numeric('loopRate', 'Maze loop rate', .01, 0, .5)}{numeric('maxTicks', 'Tick limit', 1000, 1, 2000000)}
        </div></fieldset>
        <fieldset disabled={running}><legend>Ant settings to compare</legend><label>Evaporation rates<input value={evaps} onChange={e => setEvaps(e.target.value)} /></label><label>Trail bias powers<input value={powers} onChange={e => setPowers(e.target.value)} /></label><p>Comma-separated values. Every combination runs on the same maze and ant seeds.</p></fieldset>
        <details><summary>Highway detection thresholds</summary><fieldset disabled={running}><div className="hw-fields">
          {numeric('minShare', 'Ant fraction on route', .05, .01, 1)}{numeric('maxStretch', 'Max route / shortest', .05, 1, 10)}
          {numeric('holdTicks', 'Sustain for ticks', 20)}{numeric('sampleEvery', 'Sample every ticks', 1)}
          {numeric('minDeliveries', 'Minimum deliveries', 1)}{numeric('deliveryWindow', 'Delivery window ticks', 20)}
        </div></fieldset></details>
        <p className="hw-plan">{parsed.evapRates.length * parsed.trailPowers.length} settings × {config.mazeCount} mazes × {config.replicates} ant seeds = <strong>{fmt(planned)} trials</strong></p>
        {error && <p className="hw-error" role="alert">{error}</p>}
        <button className="hw-primary" onClick={running ? stop : start}>{running ? 'Stop experiment' : rows.length ? 'Run new experiment →' : 'Run experiment →'}</button>
        <p className="hw-note">Runs privately in your browser. Stopping keeps completed trials. A new experiment replaces the current results.</p>
      </section>
      <div className="hw-observation"><section className="hw-card hw-progress" aria-live="polite"><div className="hw-section-head"><h2>{status === 'ready' ? 'Ready to compare' : status === 'running' ? 'Experiment running' : status === 'complete' ? 'Experiment complete' : status === 'stopped' ? 'Stopped · partial results' : 'Experiment interrupted'}</h2><span>{rows.length} / {total || fmt(planned)} trials</span></div><progress value={rows.length} max={total || Math.max(1, planned)} /><div className="hw-facts"><div><strong>{rows.length ? `${Math.round(successes / rows.length * 100)}%` : '—'}</strong><span>confirmed highways</span></div><div><strong>{fmt(summary[0]?.cappedMeanTicks)}</strong><span>{status === 'complete' ? 'best capped mean ticks' : 'provisional capped mean'}</span></div><div><strong>{fmt(runConfig?.maxTicks ?? config.maxTicks)}</strong><span>ticks per trial</span></div></div></section>
        <section className="hw-card"><MazeView view={selected >= 0 && views[selected] ? views[selected] : view} />
          {!running && views.length > 0 && <label className="hw-review">Inspect a completed trial (latest 30)<select value={selected} onChange={e => setSelected(Number(e.target.value))}><option value={-1}>Latest view</option>{views.map((v, i) => <option key={i} value={i}>{v.title} · {v.trial?.highway ? 'highway' : 'timeout'}</option>)}</select></label>}
          {!rows.length && !running && <p className="hw-note">Preview of the first quick-comparison maze. Run to apply your settings and watch trials.</p>}
        </section>
      </div>
    </div>
    <section className="hw-card hw-results"><div className="hw-section-head"><div><h2>Which settings form highways fastest?</h2><p>{status === 'complete' ? 'All trials finished. Lower capped mean is better.' : 'Rankings are provisional until all settings finish the same trials.'}</p></div><button disabled={!rows.length} onClick={download}>Download {status === 'complete' ? 'results' : 'partial results'} ↓</button></div>
      {!rows.length ? <div className="hw-empty">Your comparison will appear here.<span>Quick comparison runs two trail biases on three mazes. Full sweep tests 12 settings on 10 mazes with three ant seeds each.</span></div> : <><div className="hw-table-wrap"><table><thead><tr><th>Evaporation</th><th>Trail bias</th><th>Completed</th><th>Highways</th><th>Capped mean ↓</th><th>Success median</th></tr></thead><tbody>{summary.map(r => <tr key={`${r.evapRate}:${r.trailPower}`}><td>{r.evapRate}</td><td>{r.trailPower}</td><td>{r.trials} / {runConfig!.mazeCount * runConfig!.replicates}</td><td><div className="hw-rate"><span style={{ width: `${r.successRate * 100}%` }} /></div>{r.successes}/{r.trials} · {Math.round(r.successRate * 100)}%</td><td>{fmt(r.cappedMeanTicks)} ticks</td><td>{r.medianSuccessTicks == null ? '—' : `${fmt(r.medianSuccessTicks)} ticks`}</td></tr>)}</tbody></table></div>{successes === 0 && <p className="hw-notice">No qualifying highways in completed trials. These results establish no winner; timeouts remain in the ranking.</p>}</>}
      <p className="hw-note">Capped mean counts every timeout at the tick limit. Success median includes only confirmed highways. Each highway must stay on the same simple route; bright pheromone alone does not qualify. Use a new seed prefix to test selected settings on unseen mazes.</p>
    </section>
  </main>;
}
