import { WarActionLedger } from '../../../shared/war-action-ledger';
import { WarSpatialObserver, warSpatialFrame, observeWarField } from './spatial';
import { useEffect, useRef, useState } from 'react';
import { DEFAULT_DOCTRINE, cloneDoctrine, generateMasterSeed, W, H } from '@stigsim/sim-core';
import { GAME_TICK_LIMIT, OBSERVATION_TICKS, buildWarObservation, seriesFinished, validateWarDecision, type WarDecision, type WarPublicSnapshot } from '../../../shared/model-war';
import { DEFAULT_WAR_SETTINGS } from '../war/war-simulation';
import { createLocalWarRecorder, localWarPlayerSource } from '../war/local-war-recording';
import { COLONY_COLORS } from '../../render';
import { DoctrinePanel } from '../../DoctrinePanel';
import './model-war.css';
import { drawWar } from '../war/war-render';
import { conformDoctrine } from '../../topology-choices';
import { downloadText } from '../../client-utils';

type Reply = WarDecision & { model: string; servedModel?: string; usage: unknown };
function newGame(seed: string, game: number) {
  return createLocalWarRecorder({...DEFAULT_WAR_SETTINGS,masterSeed:`${seed}-game-${game}`}, [cloneDoctrine(DEFAULT_DOCTRINE),cloneDoctrine(DEFAULT_DOCTRINE)]);
}
export default function ModelWar() {
  const [models,setModels] = useState<string[]>([]), [selection,setSelection] = useState(['','']);
  const [ready,setReady] = useState(false), [started,setStarted] = useState(false), [busy,setBusy] = useState(false), [running,setRunning] = useState(false), [error,setError] = useState('');
  const [speed,setSpeed] = useState(120), speedRef = useRef(120), playing = useRef(false);
  const [phase,setPhase] = useState('Ready for observation');
  const [seed,setSeed] = useState(generateMasterSeed), [revision,refresh] = useState(0);
  const canvas = useRef<HTMLCanvasElement>(null), alive = useRef(true), auto = useRef(false), lock = useRef(false);
  const [initialState] = useState(() => ({ recorder:newGame(seed,0), spatial:new WarSpatialObserver(),ledger:new WarActionLedger(), game:0, results:[] as (number|'draw')[], memory:['',''], previous:null as WarPublicSnapshot | null, journal:[] as {game:number;tick:number;phase:string;player:number;observation?:ReturnType<typeof buildWarObservation>;reply:Reply}[], records:[] as unknown[], pending:[] as (Reply|undefined)[], finished:false }));
  const state = useRef(initialState);
  useEffect(() => {alive.current=true;void fetch('/api/model-war/status').then(r=>{if(!r.ok)throw new Error();return r.json();}).then(d=>{if(alive.current){setModels(d.models);setSelection([d.models[0]??'',d.models[1]??'']);setReady(d.ready);}}).catch(()=>setError('Start the local model server to load configured models.'));return()=>{alive.current=false;auto.current=false;};},[]);
  useEffect(()=>{const ctx=canvas.current?.getContext('2d');if(ctx)drawWar(ctx,state.current.recorder.runtime);},[revision,started]);
  async function advance() {
    if(lock.current || state.current.finished)return;
    lock.current=true;playing.current=true;setBusy(true);setError('');
    try {
      const s=state.current, war=s.recorder.runtime, seat=(player:number)=>(player+s.game)%2;
      const terminal=war.result!==null||war.tick>=GAME_TICK_LIMIT;
      const gameResult=war.result===null?'draw':war.result;
      const result=gameResult==='draw'?'draw':(gameResult+s.game)%2;
      s.spatial ??= new WarSpatialObserver();
      s.spatial.capture(warSpatialFrame(war));
      const spatialEvidence = observeWarField(war,s.spatial);
      const snapshot: WarPublicSnapshot = {
        game:s.game+1, tick:war.tick,
        colonies:[0,1].map(colony=>({colony,player:(colony+s.game)%2,metrics:war.getMetrics(colony),doctrine:war.simulation.colonies[colony].doctrine})),
      };
      s.ledger ??= new WarActionLedger();
      s.ledger.observe(snapshot,spatialEvidence);
      const observations = [0,1].map(player => buildWarObservation({
        snapshot, player, actionLedger:s.ledger.forPlayer(player), models:selection, results:s.results, terminal, winner:result,
        previous:s.previous, spatialEvidence, settings:war.settings, rules:war.rules, remainingFood:war.simulation.foodSources,
      }));
      // Keep successful replies on failure so retry never repeats an accepted request.
      for(let player=0;player<2;player++) {
        if(!s.pending[player]) {
          setPhase(`${terminal?'Post-game review':'Observing'} · ${selection[player]}`);
          const response=await fetch('/api/model-war/decide',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:selection[player],state:observations[player],memory:s.memory[player]})});
          const reply=await response.json();if(!response.ok)throw new Error(reply.error??'Decision failed.');
          validateWarDecision(reply);s.pending[player]=reply;
        }
      }
      if(!alive.current)return;
      for(let player=0;player<2;player++) {
        const reply=s.pending[player]!;s.memory[player]=reply.memory;
        s.journal.push({game:s.game+1,tick:war.tick,phase:observations[player].phase,player,observation:observations[player],reply});
        if(!terminal) {
          const accepted=conformDoctrine(reply.doctrine,war.settings.topology);
          s.recorder.command(localWarPlayerSource(seat(player)),{kind:'set-doctrine',colonyId:seat(player),doctrine:accepted});
          s.ledger.accept({snapshot,player,requested:reply.doctrine,accepted,origin:'decision',spatial:spatialEvidence});
        }
      }
      s.pending=[];
      if(terminal) {
        s.records.push(s.recorder.build());s.results.push(result);s.finished=seriesFinished(s.results);
        if(!s.finished){s.game++;s.recorder=newGame(seed,s.game);s.spatial=new WarSpatialObserver();s.previous=null;
          // Reviewed doctrines are the opening strategies of the next game.
          for(let player=0;player<2;player++) {
            const reply=s.journal.slice(-2)[player].reply,next=s.recorder.runtime;
            const accepted=conformDoctrine(reply.doctrine,next.settings.topology);
            const baseline:WarPublicSnapshot=structuredClone({game:s.game+1,tick:next.tick,colonies:[0,1].map(colony=>({colony,player:(colony+s.game)%2,metrics:next.getMetrics(colony),doctrine:next.simulation.colonies[colony].doctrine}))});
            s.recorder.command(localWarPlayerSource(seat(player)),{kind:'set-doctrine',colonyId:seat(player),doctrine:accepted});
            s.ledger.accept({snapshot:baseline,player,requested:reply.doctrine,accepted,origin:'review-opening'});
          }
        }
      } else {
        s.previous=structuredClone(snapshot);
        const until=Math.min(war.tick+OBSERVATION_TICKS,GAME_TICK_LIMIT);
        setPhase('Simulation running');
        let previous = performance.now(), accumulator = 0, lastStats = previous;
        while(war.tick<until && war.result===null && alive.current){
          const now = await new Promise<number>(resolve => requestAnimationFrame(resolve));
          const elapsed = Math.min(100, now - previous) / 1000;
          previous = now;
          if (!playing.current) { accumulator = 0; continue; }
          accumulator += elapsed * speedRef.current;
          while (accumulator >= 1 && war.tick < until && war.result === null) {
            s.recorder.step(); s.ledger.confirm(s.game+1,war.tick,war.simulation.colonies.map(c=>c.doctrine)); s.spatial.capture(warSpatialFrame(war)); accumulator--;
          }
          const ctx = canvas.current?.getContext('2d');
          if (ctx) drawWar(ctx,war);
          if (now-lastStats>=100) { refresh(v=>v+1); lastStats=now; }
        }
      }
      refresh(v=>v+1);
      if(s.finished){auto.current=false;setRunning(false);}
    } catch(e) {auto.current=false;setRunning(false);setError(e instanceof Error?e.message:'Decision failed.');}
    finally {lock.current=false;playing.current=false;if(alive.current){setBusy(false);setPhase('Ready for observation');}}
    if(auto.current&&alive.current)setTimeout(()=>void advance(),0);
  }
  function start(){state.current={recorder:newGame(seed,0),spatial:new WarSpatialObserver(),ledger:new WarActionLedger(),game:0,results:[],memory:['',''],previous:null,journal:[],records:[],pending:[],finished:false};setStarted(true);refresh(v=>v+1);}
  const s=state.current, war=s.recorder.runtime, wins=[0,1].map(p=>s.results.filter(r=>r===p).length);
  function togglePlayback() {
    if (running || playing.current) {
      auto.current=false; playing.current=false; setRunning(false);
    } else {
      auto.current=true; playing.current=true; setRunning(true);
      if (!lock.current) void advance();
    }
    refresh(v=>v+1);
  }
  function download() {
    downloadText(JSON.stringify({format:'stigsim-model-war@1',seed,models:selection,observationTicks:OBSERVATION_TICKS,tickLimit:GAME_TICK_LIMIT,results:s.results,journal:s.journal,actionLedger:s.ledger?.entries??[],games:s.records,current:s.recorder.build()},null,2),'model-war-series.json','application/json');
  }
  function colonyPanel(colony: number) {
    const player=(colony+s.game)%2, metrics=war.getMetrics(colony);
    const entries=s.journal.filter(e=>e.player===player).slice().reverse();
    const spatial=entries[0]?.observation?.spatialEvidence;
    const measured=spatial?.colonies.find(c=>c.colonyId===colony);
    return <aside className="war-colony" style={{'--colony-color':COLONY_COLORS[colony].primary} as React.CSSProperties}>
      <div className="war-colony__name"><span/>Colony {colony+1} · Player {player+1}</div>
      <h2 className="model-war-model">{selection[player]}</h2>
      <div className="war-colony__hero"><span>Total ants</span><strong>{metrics.population}</strong></div>
      <div className="war-metrics">{([
        ['Reserve',Math.floor(metrics.reserve)],['Food total',metrics.foodCollected],['Hatching',metrics.hatching],
        ['Searching',metrics.searching],['Carrying',metrics.carrying],['Retreating',metrics.retreating],
        ['Waiting',metrics.waiting],['Low energy',metrics.lowEnergy],['Born',metrics.births],['Died',metrics.deaths],
      ] as const).map(([label,value])=><div className="war-metric" key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
      {measured&&<details><summary>Model’s spatial evidence · tick {spatial!.window.toTick}</summary><p className="war-rules-note">{measured.foodDeliveredInWindow} deliveries in {spatial!.window.elapsedTicks} ticks · {measured.deliveredRoutes.trackedReturns} tracked returns · {measured.possibleCirculation.antCount} ants with possible circulation. {spatial!.window.warmingUp?'History warming up.':''}</p><pre style={{fontSize:10,whiteSpace:'pre-wrap',maxHeight:300,overflow:'auto'}}>{JSON.stringify(measured,null,2)}</pre></details>}
      <details><summary>Accepted action ledger</summary>{s.ledger?.entries.filter(e=>e.playerId===player).slice(-6).reverse().map(e=><div key={e.id}><p className="war-rules-note">Game {e.gameNumber} · tick {e.scheduledForTick} · {e.status}</p>{e.changes.length?e.changes.map(c=><p className="war-rules-note" key={c.parameter}>{c.parameter}: {c.before} → {c.after}</p>):<p className="war-rules-note">No numeric doctrine change.</p>}{e.observedAfter&&<p className="war-rules-note">Following {e.observedAfter.elapsedTicks} ticks: food {e.observedAfter.actorMetricDeltas.foodCollected}, population {e.observedAfter.actorMetricDeltas.population}. Causation not established.</p>}</div>)}</details>
      <div className="model-war-strategy"><h3>Latest strategy</h3><p>{entries[0]?.reply.analysis??'Waiting for the opening decision.'}</p></div>
      <details><summary>Current doctrine</summary><DoctrinePanel numColonies={2} selected={colony} onSelect={()=>undefined} doctrine={war.simulation.colonies[colony].doctrine} topology={war.settings.topology} disabled onCommit={()=>undefined} showColonySelector={false}/></details>
      <details className="model-war-journal"><summary>Strategy journal · {entries.length} decisions</summary>{entries.map((e,i)=><details key={i}><summary>Game {e.game} · tick {e.tick} · {e.phase}</summary><p>{e.reply.analysis}</p><p>Private memory: {e.reply.memory}</p></details>)}</details>
    </aside>;
  }
  const terminal=war.result!==null||war.tick>=GAME_TICK_LIMIT;
  return <main className="war-page model-war-page">
    <header className="war-header"><div><p>Local · Model vs model</p><h1>Model War</h1><span>Best of five · live colony command</span></div>
      {started&&<div className="war-header__actions"><button className="war-button" onClick={download}>Download series</button><button className="war-button" disabled={busy} onClick={()=>{auto.current=false;playing.current=false;setRunning(false);setStarted(false);setError('');}}>New series</button></div>}
    </header>
    {!started?<section className="war-setup"><div className="war-setup__panel">
      <div className="war-setup__heading"><div><p>Two models · Best of five</p><h1>Choose your commanders</h1><span>Models observe the battlefield every {OBSERVATION_TICKS} ticks and review each game before the next.</span></div></div>
      <div className="model-war-selection">{[0,1].map(p=><label key={p}>Player {p+1}<select value={selection[p]} onChange={e=>setSelection(current=>current.map((m,i)=>i===p?e.target.value:m))}>{models.map(m=><option key={m}>{m}</option>)}</select></label>)}<label>Series seed<input value={seed} onChange={e=>setSeed(e.target.value)}/></label></div>
      <p className="war-rules-note">First to 3 wins · maximum 5 games · mirrored maps · alternating seats. Games draw at {GAME_TICK_LIMIT.toLocaleString()} ticks. Model requests use your configured provider and incur charges (up to 610 per series, plus retries).</p>
      {!ready&&<p>Configure two text models with the existing Model Ant endpoint settings.</p>}
      <div className="war-setup__footer"><button className="war-button war-button--primary" disabled={!ready||!seed.trim()||selection[0]===selection[1]} onClick={start}>Create series</button></div>
    </div></section>:<>
      <section className="war-matchbar">
        <div className="war-matchbar__group"><strong>{s.finished?'Series complete':`Game ${s.game+1} of 5`} · {wins[0]} – {wins[1]}</strong><div className="war-matchbar__summary"><span>40 starting ants / colony</span><span>Mirrored map</span><span>Mimicry topology</span><span>Observe every {OBSERVATION_TICKS} ticks</span><span>Seed: {seed}</span></div></div>
        <div className="war-matchbar__group war-matchbar__group--controls"><strong>Simulation controls</strong><div className="war-matchbar__controls">
          <button className="war-button war-button--primary" disabled={s.finished} onClick={togglePlayback}>{running||playing.current?'Pause':'Play'}</button>
          <button className="war-button" disabled={busy||s.finished} onClick={()=>void advance()}>{terminal?'Review game':'One observation'}</button>
          <label className="war-setting"><span><b>Simulation speed</b><strong>{speed} steps/sec</strong></span><input aria-label="Simulation speed" type="range" min="15" max="600" step="15" value={speed} onChange={e=>{const value=Number(e.target.value);speedRef.current=value;setSpeed(value);}}/></label>
        </div></div>
      </section>
      <div className="model-war-status" role="status"><strong>Tick {war.tick.toLocaleString()}</strong><span>{s.finished?(wins[0]===wins[1]?'Series drawn':`Player ${wins[0]>wins[1]?1:2} wins the series`):busy?(phase==='Simulation running'&&!playing.current?'Paused':phase):terminal?'Game ended · ready for review':'Paused · ready for observation'}</span><span>Next observation: {Math.min((Math.floor(war.tick/OBSERVATION_TICKS)+1)*OBSERVATION_TICKS,GAME_TICK_LIMIT).toLocaleString()}</span></div>
      {!!s.results.length&&<p className="war-record-message">{s.results.map((r,i)=>`Game ${i+1}: ${r==='draw'?'draw':`Player ${r+1} wins`}`).join(' · ')}</p>}
      <section className="war-arena">{colonyPanel(0)}<div className="war-maze"><canvas ref={canvas} width={W} height={H} aria-label="Live model war simulation"/><div className="war-maze__legend"><span>Blue: Colony 1</span><span>Red: Colony 2</span><span>Yellow: carrying food</span><span>White ring: spoiler</span><span>Red ring: low energy</span></div><p className="war-rules-note">Ants move continuously between decisions. The clock pauses while models observe or review; both see the same frozen state.</p></div>{colonyPanel(1)}</section>
    </>}
    {error&&<div role="alert" className="war-record-message">{error} {started&&'Successful decisions are retained; retry to continue.'}</div>}
  </main>;
}
