import { useEffect, useRef, useState } from 'react';
import { BUDGET, PRACTICE_SEEDS, RULES, parseEntry, entryId, type Entry, type Manifest } from './contract';
import { summarize, type MazeTrial, type Outcome, type Report } from './engine';
import { STARTERS } from './starters';
import { brief } from './brief';
import type { Request } from './worker';
import './maze-agent.css';
type View = ReturnType<MazeTrial['view']>;
function worker() { return new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }); }
function send(w: Worker, message: Request) { w.postMessage(message); }
function save(name: string, value: unknown, raw = false) {
  const url = URL.createObjectURL(new Blob([raw ? String(value) : JSON.stringify(value, null, 2)], { type: raw ? 'text/plain' : 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function Maze({ view }: { view: View | null }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = canvas.current?.getContext('2d'); if (!ctx) return;
    const cell = 16; ctx.fillStyle = '#101614'; ctx.fillRect(0, 0, 496, 496);
    if (!view) return;
    for (const c of view.cells) { ctx.fillStyle = c.open ? '#344137' : '#070b09'; ctx.fillRect(c.x * cell, c.y * cell, cell, cell); }
    ctx.strokeStyle = '#b6b66c80'; ctx.lineWidth = 3; ctx.beginPath();
    view.path.forEach((p, i) => i ? ctx.lineTo((p.x + .5) * cell, (p.y + .5) * cell) : ctx.moveTo((p.x + .5) * cell, (p.y + .5) * cell)); ctx.stroke();
    if (view.goal) { ctx.fillStyle = '#87df9e'; ctx.fillRect(view.goal.x * cell + 2, view.goal.y * cell + 2, cell - 4, cell - 4); }
    const p = view.observation.position;
    ctx.fillStyle = '#ffd66b'; ctx.beginPath(); ctx.arc((p.x + .5) * cell, (p.y + .5) * cell, 6, 0, Math.PI * 2); ctx.fill();
  }, [view]);
  return <canvas ref={canvas} width={496} height={496} aria-label="Explored maze. Unseen cells remain hidden; yellow is the agent and green is the discovered exit." />;
}
export default function MazeAgentLab() {
  const [entry, setEntry] = useState<Entry>(STARTERS[0]), [practice, setPractice] = useState(0);
  const [view, setView] = useState<View | null>(null), [outcome, setOutcome] = useState<Outcome | null>(null);
  const [running, setRunning] = useState(false), [pending, setPending] = useState(false), [speed, setSpeed] = useState(4);
  const [applied, setApplied] = useState(''), [error, setError] = useState('');
  const [busy, setBusy] = useState(false), [partial, setPartial] = useState<Outcome[]>([]), [batchName, setBatchName] = useState('');
  const [cancelled, setCancelled] = useState(false), [reports, setReports] = useState<Report[]>([]);
  const [setSeed, setSetSeed] = useState(() => crypto.randomUUID()), [kit, setKit] = useState<string | null>(null), [copyStatus, setCopyStatus] = useState('');
  const activeEntry = useRef<Entry>(STARTERS[0]);
  const live = useRef<Worker | null>(null), batch = useRef<Worker | null>(null), file = useRef<HTMLInputElement>(null);
  const signature = JSON.stringify([entry.source, practice]);
  const dirty = signature !== applied;
  function reset(selected = entry, index = practice) {
    setRunning(false); setError('');
    try {
      const canonical = parseEntry(selected); activeEntry.current = canonical; live.current?.terminate(); const w = worker(); live.current = w;
      setPending(true); setView(null); setOutcome(null); setApplied(JSON.stringify([canonical.source, index]));
      w.onmessage = e => {
        if (live.current !== w) return;
        setPending(false);
        if (e.data.kind === 'view') { setView(e.data.view); setOutcome(e.data.outcome ?? null); if (e.data.view.done) setRunning(false); }
        else { setError(e.data.error); setRunning(false); }
      };
      w.onerror = () => { if (live.current === w) { setError('Practice worker failed. Reset to retry.'); setRunning(false); setPending(false); } };
      send(w, { kind: 'practice', entry: canonical, index });
    } catch (e) { setError(String(e)); }
  }
  useEffect(() => { reset(); return () => { live.current?.terminate(); batch.current?.terminate(); }; }, []);
  useEffect(() => {
    if (!running || pending || !view || view.done || dirty || !live.current) return;
    const id = requestAnimationFrame(() => { setPending(true); send(live.current!, { kind: 'advance', count: speed }); });
    return () => cancelAnimationFrame(id);
  }, [running, pending, view, dirty, speed]);
  function update(patch: Partial<Entry>) { setRunning(false); setEntry(e => ({ ...e, ...patch })); }
  async function evaluate100() {
    if (busy) return;
    setRunning(false); setError('');
    try {
      const frozen = parseEntry(entry);
      const manifest: Manifest = { format: 'stigsim-maze-agent-round@1', name: 'Local 100-maze evaluation',
        seeds: Array.from({ length: 100 }, (_, i) => `maze-agent-local:${setSeed}:${i + 1}`) };
      const w = worker(); batch.current = w; setBusy(true); setPartial([]); setBatchName(frozen.name); setCancelled(false);
      w.onmessage = e => {
        if (batch.current !== w) return;
        if (e.data.kind === 'trial') setPartial(rows => [...rows, e.data.outcome]);
        else {
          if (e.data.kind === 'result') {
            const report: Report = e.data.report;
            setPartial(report.entries[0].outcomes);
            setReports(rows => [...rows.filter(r => r.entries[0].id !== report.entries[0].id).slice(-9), report]);
          } else { setError(e.data.error); setCancelled(true); }
          setBusy(false); w.terminate(); batch.current = null;
        }
      };
      w.onerror = () => { if (batch.current === w) { setError('Evaluation worker failed.'); setBusy(false); setCancelled(true); w.terminate(); batch.current = null; } };
      send(w, { kind: 'evaluate', entry: frozen, manifest });
    } catch (e) { setError(String(e)); }
  }
  const summary = summarize(partial), rows = reports.map(report => ({ report, score: summarize(report.entries[0].outcomes) })).sort((a, b) => b.score.score - a.score.score);
  return <main className="maze-agent-lab"><header><div><p className="ma-kicker">Stigsim / Individual-agent benchmark</p><h1>Maze Agent Lab</h1><p>Local eyes. Your memory. Your system.</p></div><div className="ma-actions"><button onClick={async () => { try { const current = parseEntry(entry); setKit(brief(current, await entryId(current))); setCopyStatus(''); } catch (e) { setError(String(e)); } }}>Starter kit for your AI</button><button className="ma-primary" disabled={busy} onClick={evaluate100}>{busy ? `Evaluating ${partial.length} / 100…` : 'Freeze & test on 100 mazes ↗'}</button></div></header>
    <div className="ma-workbench"><section className="ma-panel"><div className="ma-row"><h2>Agent system</h2><select aria-label="Starter agent" disabled={busy} defaultValue="" onChange={async e => {
      const template = STARTERS[Number(e.target.value)]; e.target.value = '';
      const next = { ...template, name: `${template.name} remix`, parent: await entryId(template) }; setEntry(next); reset(next);
    }}><option value="" disabled>Load a starter…</option>{STARTERS.map((s, i) => <option key={s.name} value={i}>{s.name}</option>)}</select></div>
      <label>Name<input disabled={busy} maxLength={80} value={entry.name} onChange={e => update({ name: e.target.value })} /></label>
      <div className="ma-row"><h3>step(observation, memory)</h3><span>One local decision per move</span></div>
      <textarea aria-label="Agent JavaScript" className="ma-code" disabled={busy} spellCheck={false} value={entry.source} onChange={e => update({ source: e.target.value })} />
      <div className="ma-actions"><button disabled={busy} onClick={() => reset()}>{dirty ? 'Apply & restart' : 'Restart practice'}</button><span>{dirty ? 'Unapplied edits' : 'Code applied'}</span></div>
      <details><summary>Observation & action contract</summary><p>You get reliable <code>position: {'{x,y}'}</code>, four local <code>exits: {'{N,E,S,W}'}</code>, step, stepLimit, atGoal, and lastMove (direction/moved). North decreases y; east increases x. No hidden map, goal coordinates or seed is provided. Remember and map anything you have already observed.</p><p>Return <code>{'{ move: "N", state: yourJSONMemory }'}</code>. State begins null on every maze. Only returned JSON persists; globals reset each decision. Blocked moves consume a step. The host stops automatically on reaching the goal.</p><p>{BUDGET.sourceBytes / 1000} KB source · {BUDGET.stateBytes / 1000} KB state · 16 MiB VM · 64 compute units per decision · 32,000 per maze · {RULES.stepLimit} movement attempts. No host I/O, clock, runtime model calls or Math.random. Your AI can design arbitrary executable algorithms and memory within these limits.</p></details>
      <details><summary>Import / export system</summary><label>Description<textarea disabled={busy} rows={2} maxLength={2000} value={entry.description} onChange={e => update({ description: e.target.value })} /></label><div className="ma-actions"><button onClick={() => { try { save('maze-agent.json', parseEntry(entry)); } catch (e) { setError(String(e)); } }}>Export agent</button><button disabled={busy} onClick={() => file.current?.click()}>Import agent</button></div></details>
      <input ref={file} hidden type="file" accept=".json,application/json" onChange={async e => {
        const f = e.target.files?.[0]; if (!f) return;
        try { if (f.size > 100000) throw new Error('File exceeds 100 KB.'); const next = parseEntry(JSON.parse(await f.text())); setEntry(next); reset(next); }
        catch (err) { setError(String(err)); } e.target.value = '';
      }} />
    </section><section><div className="ma-panel"><div className="ma-row"><h2>Practice</h2><span>{view?.done ? view.observation.atGoal ? 'Exit found' : 'Stopped' : running ? 'Running' : 'Paused'}</span></div>
      <div className="ma-row"><label>Practice maze<select disabled={busy} value={practice} onChange={e => { const i = Number(e.target.value); setPractice(i); reset(entry, i); }}>{PRACTICE_SEEDS.map((_, i) => <option key={i} value={i}>Maze {i + 1} of 20</option>)}</select></label><p>Only explored cells are visible.</p></div>
      <Maze view={view} /><div className="ma-actions"><button disabled={busy || !view || view.done || dirty} onClick={() => setRunning(r => !r)}>{running ? 'Ⅱ Pause' : '▶ Play'}</button><button disabled={busy || pending || running || !view || view.done || dirty} onClick={() => { setPending(true); send(live.current!, { kind: 'advance', count: 1 }); }}>Step</button><button disabled={busy} onClick={() => reset()}>Reset</button><label>Speed<select value={speed} onChange={e => setSpeed(Number(e.target.value))}><option value={1}>1×</option><option value={4}>4×</option><option value={16}>16×</option><option value={64}>64×</option></select></label><span>{view?.observation.step ?? 0} / {RULES.stepLimit} moves</span></div>
      <div className="ma-metrics"><div><strong>({view?.observation.position.x ?? 1}, {view?.observation.position.y ?? 1})</strong><span>position</span></div><div><strong>{view?.usage.calls ?? 0}</strong><span>decisions</span></div><div><strong>{((view?.usage.peakStateBytes ?? 0) / 1000).toFixed(1)} KB</strong><span>peak memory</span></div></div>
      {outcome && <p>{outcome.solved ? `Solved in ${outcome.steps} moves. Path efficiency ${(outcome.efficiency * 100).toFixed(1)}%. Shortest route: ${outcome.shortest} moves.` : `Unsolved after ${outcome.steps} moves. Score: 0.`} {outcome.illegalMoves} blocked moves. <button onClick={() => save('maze-agent-practice.json', { format: 'stigsim-maze-agent-practice@1', rules: RULES, entry: activeEntry.current, seed: PRACTICE_SEEDS[practice], outcome })}>Export run</button></p>}
      {(error || view?.error) && <p className="ma-error" role="alert">{error || view?.error}</p>}
      <details><summary>Local observation & memory inspector</summary><h3>What the agent sees</h3><pre>{JSON.stringify(view?.observation, null, 2)}</pre><h3>Agent-owned memory</h3><pre>{JSON.stringify(view?.state, null, 2)}</pre></details>
    </div><section className="ma-panel ma-results"><div className="ma-row"><h2>Evaluation</h2><span>Frozen system · 100 mazes</span></div>
      {batchName ? <><p>{batchName} · {cancelled ? 'Cancelled' : busy ? 'Running' : 'Complete'} · {partial.length} / 100</p><progress max={100} value={partial.length} aria-label="Evaluation progress" /><div className="ma-metrics"><div><strong>{summary.solved}/{summary.count}</strong><span>completed</span></div><div><strong>{summary.score.toFixed(2)}</strong><span>efficiency score / 100</span></div><div><strong>{summary.standardError?.toFixed(2) ?? '—'}</strong><span>standard error</span></div></div>{busy && <button onClick={() => { batch.current?.terminate(); batch.current = null; setBusy(false); setCancelled(true); }}>Cancel evaluation</button>}{partial.length < 100 && <p>Partial results are not ranked.</p>}</> : <p>Refine on 20 practice mazes, then freeze your system and evaluate it. Code and memory are reset appropriately for every test maze.</p>}
      {rows.length > 0 && <table><thead><tr><th>System</th><th>Success</th><th>Score</th><th>Moves*</th><th /></tr></thead><tbody>{rows.map(({ report, score }) => <tr key={report.entries[0].id}><td>{report.entries[0].entry.name}<small>{report.entries[0].id.slice(0, 8)}</small></td><td>{score.solved}/100</td><td>{score.score.toFixed(2)}</td><td>{score.meanSteps?.toFixed(0) ?? '—'}</td><td><button aria-label={`Export ${report.entries[0].entry.name} results`} onClick={() => save('maze-agent-evaluation.json', report)}>↓</button></td></tr>)}</tbody></table>}
      <details><summary>Scoring & held-out evaluation</summary><p>Score = 100 × mean(success ? shortest path / attempted moves : 0). All mazes count. Also report completion, blocked moves, runtime errors, compute and memory. *Mean moves covers successful runs only; it is not the ranking score.</p><p>These browser results are local and session-lived. Repeated tests use the same set; using their feedback makes that set development data. Organizers should freeze source hashes and run 100 fresh private seeds with the CLI, then publish the manifest. Hidden evaluation is enforced by the organizer process, not by this browser.</p><label>Local evaluation-set ID<input readOnly value={setSeed} /></label><button disabled={busy} onClick={() => { setSetSeed(crypto.randomUUID()); setPartial([]); setReports([]); setBatchName(''); }}>Fresh local evaluation set</button></details>
    </section></section></div>
    {kit !== null && <div className="ma-modal" role="dialog" aria-modal="true" aria-label="Starter kit for your AI"><div className="ma-panel"><div className="ma-row"><h2>Starter kit for your AI</h2><button onClick={() => setKit(null)}>Close</button></div><p>Review or edit this briefing, then paste it into your AI assistant. It includes the rules and your current system.</p><textarea autoFocus aria-label="AI starter briefing" value={kit} onChange={e => setKit(e.target.value)} /><div className="ma-actions"><button onClick={async () => { try { await navigator.clipboard.writeText(kit); setCopyStatus('Copied'); } catch { setCopyStatus('Clipboard unavailable. Select and copy the text or download it.'); } }}>Copy briefing</button><button onClick={() => save('maze-agent-ai-brief.md', kit, true)}>Download briefing</button><span role="status">{copyStatus}</span></div></div></div>}
  </main>;
}
