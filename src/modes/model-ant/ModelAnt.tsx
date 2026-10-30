import { modelErrorMessage } from './provider-error';
import ExperimentSetup, { strategyLabel } from './ExperimentSetup';
import { strategyText, type ExperimentConfig } from '../../../shared/model-ant-config';
import { POLICY_ACTION_QUESTION } from '../../../shared/model-ant-policy';
import { useEffect, useRef, useState } from 'react';
import { MAZE_WIDTH, MAZE_HEIGHT, EXIT_X, EXIT_Y, AGENT_PROMPT, AGENT_RULES, AGENT_TOOLS, OBSERVED_MAP_RULES, SELECTION_RULES, ACTION_OPTIONS, ACTION_QUESTION, agentObservation, PEBBLE_BUDGET, parseDecision, type AgentStep, type AgentObservation, type AgentUsage, type AgentEvent } from '../../../shared/model-ant';
import { createMaze, move, observe, solved } from './maze';
import './model-ant.css';
import ModelAntControls from './ModelAntControls';
import { getRunPacing, PACING } from './pacing';
import { summarizeUsage, formatTokenTotal, formatEstimatedCost, pricing } from './usage';
interface Entry extends AgentStep { outcome: string; observation: AgentObservation }
interface FailedAttempt { model?: string; turn: number; error: string; usage?: AgentUsage; events?: AgentEvent[] }
export default function ModelAnt() {
  const [config, setConfig] = useState<ExperimentConfig>();
  const [setupOpen, setSetupOpen] = useState(true);
  const [revision, setRevision] = useState(0);
  return <>{config && <div hidden={setupOpen}><ExperimentRun key={revision} config={config} onNew={() => setSetupOpen(true)} suspended={setupOpen} /></div>}{setupOpen && <ExperimentSetup previous={config} onCancel={config ? () => setSetupOpen(false) : undefined} onStart={next => { setConfig(next); setRevision(value => value + 1); setSetupOpen(false); }} />}</>;
}
function ExperimentRun({config,onNew,suspended}: {config: ExperimentConfig; onNew: () => void; suspended: boolean}) {
  const [maze, setMaze] = useState(() => createMaze(config.seed, config.loopRate));
  const [entries, setEntries] = useState<Entry[]>([]);
  const [failures, setFailures] = useState<FailedAttempt[]>([]);
  const runId = useRef(crypto.randomUUID());
  const [connection, setConnection] = useState<{ ready: boolean; model?: string; mode?: 'agent' | 'selection'; message: string }>({ ready: false, message: 'Checking model server…' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);
  const [fullMap, setFullMap] = useState(true);
  const lock = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const mapSupport = config.observationSupport === 'observed-map';
  const explicitPolicy = config.strategy !== 'none';
  const observation = agentObservation(observe(maze));
  const done = solved(maze) || maze.turn >= 200;
  const pacing = getRunPacing(runId.current);
  // Hot updates preserve React state, but recent request timestamps may be unavailable.
  if (entries.length > 0 && pacing.consecutiveRateLimits === 0) pacing.resumeExistingRun();
  async function connect() {
    try {
      const response = await fetch('/api/model-ant/status');
      if (!response.ok) throw new Error();
      const status = await response.json(); setConnection({...status, model:config.model, mode:config.mode});
    } catch { setConnection({ ready: false, message: 'Start the local simulation server to connect a model. Setup: docs/model-ant.md' }); }
  }
  useEffect(() => { void connect(); return () => { generation.current++; controller.current?.abort(); }; }, []);
  async function step() {
    if (lock.current || done || !connection.ready || pacing.delayMs() > 0) return;
    lock.current = true; setBusy(true); setError('');
    const version = generation.current;
    const abort = new AbortController(); controller.current = abort;
    try {
      const response = await fetch('/api/model-ant/step', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ runId: runId.current, observation, model:config.model, experimentMode:config.mode, suppliedPolicy:config.strategy, customPolicy:config.customPolicy, initialHeading:config.initialHeading, observationSupport: connection.mode === 'selection' && mapSupport ? 'observed-map' : 'raw-history' }), signal: abort.signal,
      });
      const result = await response.json();
      if (version !== generation.current) return;
      if (!response.ok) {
        const message = typeof result.error === 'string' ? result.error : 'Model request failed.';
        setFailures(previous => [...previous, { model: connection.model, turn: maze.turn, error: message, usage: result.usage, events: result.events }]);
        if (message.includes('Model provider returned HTTP 429')) {
          const stop = pacing.rateLimited();
          setError(stop
            ? 'Repeated model rate limits. The run is paused; wait before retrying, or check Neon limits. Your maze and context are preserved.'
            : 'The model service reached a rate or quota limit. Cooling down for 60 seconds; no move was applied.');
          if (stop) setRunning(false);
          return;
        }
        throw new Error(message);
      }
      const decision = parseDecision(result.decision);
      if (version !== generation.current) return;
      pacing.succeeded(result.usage);
      const next = move(maze, decision);
      setMaze(next);
      setEntries(previous => [...previous, { ...result, outcome: next.lastResult, observation, decision }]);
    } catch (e) {
      if (version === generation.current) { setError(e instanceof Error ? e.message : 'Request failed.'); setRunning(false); }
    } finally {
      if (version === generation.current) { lock.current = false; setBusy(false); }
    }
  }
  useEffect(() => {
    if (!running || busy || done || suspended) return;
    const timer = setTimeout(() => void step(), Math.max(500, pacing.delayMs()));
    return () => clearTimeout(timer);
  });
  function download() {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ format: 'stigsim-model-ant-experiment@11', configuration:config, suppliedPolicy: selectionMode && explicitPolicy ? strategyText(config.strategy,config.customPolicy) : null, observationSupport: selectionMode && mapSupport ? 'observed-map' : 'raw-history', mode: connection.mode ?? 'agent', requestPacing: PACING, pebbleBudget: PEBBLE_BUDGET, finalPebbles: maze.pebbles, finalPolicy: entries.at(-1)?.policy ?? '', policyRevision: entries.at(-1)?.policyRevision ?? 0, seed: maze.seed, environment: { generator: '@stigsim/sim-core/generateMaze', layout: 'random', loopRate: maze.loopRate, width: MAZE_WIDTH, height: MAZE_HEIGHT }, prompt: AGENT_PROMPT, mechanics: selectionMode ? (mapSupport ? OBSERVED_MAP_RULES : SELECTION_RULES) : AGENT_RULES, tools: selectionMode ? [] : AGENT_TOOLS, ...(selectionMode ? { actionOptions: ACTION_OPTIONS, actionQuestion: entries.at(-1)?.actionQuestion ?? (entries.length === 0 && explicitPolicy ? POLICY_ACTION_QUESTION : ACTION_QUESTION) } : {}), entries, failedAttempts: failures, accounting: { ...usageSummary, basis: 'catalog input/output rates; cache discounts excluded; input-only decision models have zero output rate', pricingAsOf: pricing.asOf, pricingSource: pricing.source, rates: Object.fromEntries([...new Set(usageRecords.map(record => record.model).filter((model): model is string => !!model))].map(model => [model, (pricing.rates as Record<string, { input: number; output: number }>)[model] ?? null])) } }, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `model-ant-${maze.seed}.json`; link.click(); URL.revokeObjectURL(url);
  }
  const latest = entries.at(-1);
  const modelId = connection.model;
  const selectionMode = connection.mode === 'selection';
  const modelName = modelId === 'claude-sonnet-4-6' ? 'Claude Sonnet 4.6'
    : modelId === 'gpt-5-mini' ? 'GPT-5 mini' : modelId === 'typesafeai-jev-1-14-0' ? 'Jev 1.14' : modelId === 'openjev-qwen35-4b' ? 'OpenJev (Qwen 3.5 4B)' : modelId || 'No model configured';
  const usageRecords = [...entries.map(entry => ({ model: entry.model, usage: entry.usage })),
    ...failures.map(failure => ({ model: failure.model ?? connection.model, usage: failure.usage }))];
  const usageSummary = summarizeUsage(usageRecords);


  return <main className="model-ant">
    <header className="ant-header">
      <div className="ant-header__intro">
        <span className="ant-kicker">STIGSIM / MODEL ANT EXPERIMENT</span>
        <h1>A language model<br /><em>in a maze.</em></h1>
        <p>Explore strategy, memory, and stigmergy. A model controls one ant with a local view of the maze, choosing how to use pebbles{selectionMode ? '' : ' and its own policy'} to find the exit.</p>
      </div>
      <div className="ant-active-model" aria-label="Active model">
        <span className="ant-active-model__label">EXPERIMENT</span>
        <strong>{modelName}</strong>
        {modelId && <code>{modelId}</code>}
        <div className="ant-active-model__caption"><span>{selectionMode ? 'Action-only comparison' : 'Policy-authoring agent'}</span><dl className="ant-config-facts"><div><dt>Seed</dt><dd>{maze.seed}</dd></div><div><dt>Extra holes</dt><dd>{Math.round(maze.loopRate * 100)}%</dd></div><div><dt>Information</dt><dd>{mapSupport ? 'History + automatic map' : 'History only'}</dd></div><div><dt>Strategy</dt><dd>{strategyLabel(config.strategy)}</dd></div>{config.strategy === 'right-hand' && <div><dt>Initial heading</dt><dd>{config.initialHeading}</dd></div>}</dl></div>
        <button disabled={busy} onClick={() => { setRunning(false); onNew(); }}>New experiment</button>
      </div>
    </header>
    <div className="ant-layout">
      <section className="ant-world" aria-label="Maze experiment">
        <ModelAntControls pacing={pacing} running={running} busy={busy} ready={connection.ready} done={done} onToggle={() => setRunning(!running)} onStep={() => void step()} />

        <div className="ant-toolbar"><span className="ant-pill">{solved(maze) ? 'EXIT FOUND' : maze.turn >= 200 ? 'MOVE LIMIT REACHED' : busy ? 'THINKING…' : running ? 'EXPLORING' : 'PAUSED'}</span><label><input type="checkbox" checked={fullMap} onChange={e => setFullMap(e.target.checked)} /> Observer view</label></div>
        <svg viewBox={`0 0 ${MAZE_WIDTH * 20} ${MAZE_HEIGHT * 20}`} role="img" aria-label={`Ant at ${maze.x}, ${maze.y}. Exit at ${EXIT_X}, ${EXIT_Y}. ${maze.turn} moves.`}>
          {maze.cells.flatMap((row, y) => row.map((open, x) => {
            const visible = fullMap || Math.abs(x - maze.x) + Math.abs(y - maze.y) <= 1;
            const visited = maze.visited.includes(`${x},${y}`);
            return <g key={`${x},${y}`}><rect x={x * 20 + 1} y={y * 20 + 1} width="18" height="18" rx="3" fill={!visible ? '#10171c' : !open ? '#34414a' : visited ? '#293c30' : '#182229'} />{visible && x === EXIT_X && y === EXIT_Y && <text x={x * 20 + 10} y={y * 20 + 14} textAnchor="middle" fill="#bef264" fontSize="13">✦</text>}{visible && (maze.pebbles[`${x},${y}`] ?? 0) > 0 && <g><circle cx={x * 20 + 15} cy={y * 20 + 5} r="4" fill="#f5c77e" /><text x={x * 20 + 15} y={y * 20 + 7} textAnchor="middle" fontSize="6" fill="#30200b">{maze.pebbles[`${x},${y}`]}</text></g>}</g>;
          }))}
          <g transform={`translate(${maze.x * 20 + 10} ${maze.y * 20 + 10})`} fill="#bef264" stroke="#bef264" strokeWidth="1.2"><path d="M-3 -3L-7 -6M3 -3L7 -6M-3 0L-8 0M3 0L8 0M-3 3L-7 6M3 3L7 6" /><ellipse cy="3" rx="3" ry="4" /><circle cy="-2" r="2.5" /><circle cy="-6" r="2" /></g>
        </svg>
        <div className="ant-legend"><span>● Ant</span><span>✦ Exit</span><span>Green tiles: visited</span><span style={{color: "#f5c77e"}}>● Pebbles (count)</span></div>
        <p className="ant-caption">{fullMap ? 'You see the whole maze. The ant never does.' : 'The ant can sense only the four cells around it.'}</p>
      </section>
      <aside className="ant-panel">
        <h2>Live experiment</h2>
        {!connection.ready && <div className="ant-notice">{connection.message}<button onClick={() => void connect()}>Check connection</button></div>}
        {error && <p role="alert" className="ant-error">{modelErrorMessage(error)}</p>}
        <div className="ant-stats"><div><strong>{maze.turn}<small> / 200</small></strong><span>Moves</span></div><div><strong>{maze.visited.length}</strong><span>Cells visited</span></div><div><strong>{latest ? `${(latest.elapsedMs / 1000).toFixed(1)}s` : '—'}</strong><span>Last decision</span></div>
          <div><strong>{formatTokenTotal(usageSummary)}</strong><span>Tokens used{usageSummary.tokensComplete ? '' : ' (partial)'}</span></div>
          <div><strong>{formatEstimatedCost(usageSummary)}</strong><span>Est. cost{usageSummary.costComplete ? '' : ' (partial)'}</span></div>
        </div>
        {(!usageSummary.tokensComplete || !usageSummary.costComplete) && <p className="ant-caption">Some requests have no usage or pricing data. Totals show the recorded portion only.</p>}
        <h3>Pebbles <small>{maze.carried} carried · {PEBBLE_BUDGET - maze.carried} placed · {observation.pebbles.here} on this cell</small></h3>
        <h3>What it sees now</h3><div className="ant-senses">{Object.entries(observation.neighbors).map(([direction, cell]) => <div key={direction}><span>{direction}</span><strong>{cell} · {observation.pebbles.neighbors[direction as keyof typeof observation.pebbles.neighbors]} pebbles</strong></div>)}</div>
        {!selectionMode && <section className="ant-policy" aria-label="Agent-written policy">
          <h3>Agent-written policy <small>{latest?.policyRevision ? `Written by ${modelName} · Revision ${latest.policyRevision}` : 'Awaiting the agent’s first policy'}</small></h3>
          <p className="ant-memory">{latest?.policy || (latest?.policyRevision ? 'The agent cleared its policy.' : 'The agent has not written a policy yet.')}</p>
          {entries.some(entry => entry.events.some(event => event.type === 'policy')) && <details><summary>Agent’s policy revisions</summary>
            <div className="ant-journal">{[...entries].reverse().flatMap(entry => [...entry.events].reverse().filter(event => event.type === 'policy').map(event => <details key={event.revision}>
              <summary>Revision {event.revision} · before move {entry.observation.turn + 1}</summary>
              <p className="ant-memory">{event.text || '(cleared)'}</p>
              <details><summary>Previous policy</summary><p className="ant-memory">{event.previousPolicy || '(blank)'}</p></details>
            </details>))}</div>
          </details>}
        </section>}
        <h3>{selectionMode ? 'Observation history' : 'Conversation context'} <small>{selectionMode ? `${latest?.contextMessages ?? 0} observations in the last request` : `${latest?.contextMessages ?? 0} messages · ${latest?.compactions ?? 0} model-chosen summaries`}</small></h3>
        {selectionMode && mapSupport && <details><summary>Map supplied to the model · {latest?.observedMap?.length ?? 0} observed cells</summary><p className="ant-caption">Snapshot from the last request, before its move. Visits = 0 means seen but not entered. Missing coordinates are unknown.</p><pre>{JSON.stringify(latest?.observedMap ?? [], null, 2)}</pre></details>}
        {selectionMode && explicitPolicy && <section aria-label="Supplied strategy"><h3>Strategy compliance</h3>{config.strategy !== 'custom' ? <p>Policy departures: {entries.filter(entry => entry.policyCheck?.compliant === false).length} / {entries.filter(entry => entry.policyCheck?.compliant != null).length} checked moves.</p> : <p className="ant-caption">Custom strategy · automatic compliance scoring unavailable.</p>}</section>}
        <h3>Model usage <small>{usageSummary.requests} requests · {formatTokenTotal(usageSummary)} tokens</small></h3>
        {latest?.summary && <details><summary>Latest context summary</summary><p className="ant-memory">{latest.summary}</p></details>}
        {selectionMode && latest?.selection && <section className="ant-choices" aria-label="Action probabilities">
          <h3>Selected action <small>{latest.selection.action.replace('_', ' · ')}{latest.selection.confidence === null ? '' : ` · ${(latest.selection.confidence * 100).toFixed(1)}% reported confidence`}</small></h3>
          {latest.selection.probabilities ? <div>{[...ACTION_OPTIONS].sort((a, b) => (latest.selection!.probabilities![b.id] ?? -1) - (latest.selection!.probabilities![a.id] ?? -1)).map(option => {
            const chance = latest.selection!.probabilities![option.id];
            return <div className="ant-choice" key={option.id}><span>{option.direction} · {option.pebbleAction}</span><meter aria-label={option.id} min="0" max="1" value={chance ?? 0} /><strong>{chance == null ? '—' : `${(chance * 100).toFixed(1)}%`}</strong></div>;
          })}</div> : <p className="ant-caption">This provider did not return action probabilities.</p>}
        </section>}
        <h3>Activity</h3><div className="ant-journal" aria-live="polite">{entries.length === 0 ? <p className="ant-caption">Start with one step to inspect the first decision.</p> : [...entries].reverse().map((entry, i) => <details key={entry.observation.turn} open={i === 0}><summary><span>{String(entry.observation.turn + 1).padStart(2, '0')}</span> Move {entry.decision.direction} · {entry.decision.pebbleAction === 'none' ? 'no pebble action' : `${entry.decision.pebbleAction} pebble`} {entry.observation.neighbors[entry.decision.direction] === 'wall' ? '· blocked' : ''}</summary>{entry.events.filter(event => event.type !== 'action').map((event, index) => <p className="ant-memory" key={index}>{event.type === 'compaction' ? 'Context summary: ' : event.type === 'policy' ? `Policy revision ${event.revision}: ` : ''}{event.text || (event.type === 'policy' ? '(cleared)' : '')}</p>)}{entry.policyCheck && <p className="ant-caption">Policy: {entry.policyCheck.compliant === null ? 'no prescribed direction' : entry.policyCheck.compliant ? 'followed' : `departure · expected ${entry.policyCheck.expectedDirection}`} · {entry.policyCheck.basis}</p>}<p className="ant-caption">{entry.outcome}</p><details><summary>Observation</summary><pre>{JSON.stringify(entry.observation, null, 2)}</pre></details></details>)}</div>
        <button disabled={!entries.length && !failures.length} onClick={download}>Download experiment</button>
      </aside>
    </div>
    <details className="ant-guide"><summary>About this experiment · rules, strategy and accounting</summary><div className="ant-guide-grid">
      <section><h3>Environment and information</h3><p>{MAZE_WIDTH} × {MAZE_HEIGHT} maze · 200-move limit. The model senses adjacent cells; the observer view does not change its information. Pause finishes the current move.</p><p>{selectionMode ? (mapSupport ? 'Full observation and action history plus an automatic map of seen cells and entry counts. Missing coordinates are unknown.' : 'Full observation and action history; the model reconstructs its own map.') : 'The model can write and revise a persistent policy and summarize older history. Policies survive summaries. Optional public explanations are supported; private reasoning is not exposed.'}</p><p>Drop or pick transfers one pebble on the current cell before moving. Pebbles persist and stack; their meaning is up to the model.</p></section>
      <section><h3>Strategy and scoring</h3><p>{explicitPolicy ? strategyText(config.strategy,config.customPolicy) : selectionMode ? 'No strategy is supplied. The model chooses its own approach through its actions.' : 'The model starts with a blank policy and decides what to write and when to revise it.'}</p>{explicitPolicy && <p>Decision question: {latest?.actionQuestion ?? POLICY_ACTION_QUESTION}</p>}<p>Built-in strategy compliance is checked after each choice and never changes a move. Custom strategies have no automatic compliance score. Reported confidence and probabilities are not verified accuracy.</p></section>
      <section><h3>Tokens and cost</h3><p>Totals cover this run, including repeated context and policy-writing requests. Missing usage is shown as partial. Estimated USD uses catalog rates from {pricing.asOf}, before cache discounts; actual billing may differ.{modelId?.includes('jev') ? ' Jev bills input tokens only.' : ''}</p></section>
      <section><h3>Instructions supplied to the model</h3><p>{AGENT_PROMPT}</p><p>{selectionMode ? (mapSupport ? OBSERVED_MAP_RULES : SELECTION_RULES) : AGENT_RULES}</p></section>
    </div></details>
  </main>;
}
