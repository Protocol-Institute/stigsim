import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_DOCTRINE,
  DEPOSIT_RATE,
  DEPOSITS_PER_CELL,
  H,
  W,
  cloneDoctrine,
  generateMasterSeed,
  type Doctrine,
} from "@stigsim/sim-core";
import { serializeModeRunRecord } from "@stigsim/sim-trace";
import { COLONY_COLORS, render } from "../../render";
import { DoctrinePanel as FullDoctrinePanel } from "../../DoctrinePanel";
import { TOPOLOGY_CHOICES, choiceFor, conformDoctrine } from "../../topology-choices";
import { LAYOUT_CHOICES, layoutChoice } from "../../layout-choices";
import { ADOPTION_CHOICES, adoptionChoice } from "../../adoption-choices";
import {
  DEFAULT_WAR_SETTINGS,
  WAR_RULES,
  type WarColonyMetrics,
  type WarMatchSettings,
  type WarSimulation,
} from "./war-simulation";
import {
  createLocalWarRecorder,
  createLocalWarReplay,
  localWarPlayerSource,
  localWarRecordFilename,
  parseLocalWarRecord,
  type LocalWarRecord,
} from "./local-war-recording";

const EMPTY_METRICS: WarColonyMetrics = {
  population: 0, foodCollected: 0, reserve: 0, hatching: 0,
  searching: 0, carrying: 0, retreating: 0, waiting: 0,
  lowEnergy: 0, births: 0, deaths: 0, doctrineChanged: false, doctrineAdopted: 0,
};

type AdjustableSetting = "startingAnts" | "foodSources" | "foodPerSource" | "loopRate" | "tankMax";

function drawWar(ctx: CanvasRenderingContext2D, war: WarSimulation) {
  render(ctx, war.simulation, "all", 0, "none", null, ant => {
    const state = war.getAntSnapshot(ant);
    return state ? 0.3 + 0.7 * Math.max(0, Math.min(1, state.energy / war.rules.maxEnergy)) : 1;
  });
  for (const colony of war.simulation.colonies) {
    for (const ant of colony.ants) {
      const state = war.getAntSnapshot(ant);
      if (!state || state.energy > war.rules.retreatEnergy) continue;
      ctx.beginPath();
      ctx.arc(ant.x, ant.y, 5.5, 0, Math.PI * 2);
      ctx.strokeStyle = "#ef4444";
      ctx.lineWidth = 1.25;
      ctx.stroke();
    }
  }
}

function Metric({ label, value, warning = false }: { label: string; value: number; warning?: boolean }) {
  return (
    <div className="war-metric">
      <span>{label}</span>
      <strong className={warning && value > 0 ? "war-metric--warning" : ""}>{value}</strong>
    </div>
  );
}

function ColonyPanel({
  colonyId, doctrine, metrics, topology, adoption, disabled, onCommit,
}: {
  colonyId: number;
  doctrine: Doctrine;
  metrics: WarColonyMetrics;
  topology: WarMatchSettings["topology"];
  adoption: WarMatchSettings["adoption"];
  disabled: boolean;
  onCommit: (colonyId: number, doctrine: Doctrine) => void;
}) {
  const color = COLONY_COLORS[colonyId].primary;
  return (
    <aside className="war-colony" style={{ "--colony-color": color } as React.CSSProperties}>
      <div className="war-colony__name"><span />Colony {colonyId + 1}</div>
      <div className="war-colony__hero">
        <span>Total ants</span>
        <strong>{metrics.population}</strong>
      </div>
      <div className="war-metrics">
        <Metric label="Reserve" value={Math.floor(metrics.reserve)} />
        <Metric label="Food total" value={metrics.foodCollected} />
        <Metric label="Hatching" value={metrics.hatching} />
        <Metric label="Searching" value={metrics.searching} />
        <Metric label="Carrying" value={metrics.carrying} />
        <Metric label="Retreating" value={metrics.retreating} warning />
        <Metric label="Waiting" value={metrics.waiting} warning />
        <Metric label="Low energy" value={metrics.lowEnergy} warning />
        <Metric label="Born" value={metrics.births} />
        <Metric label="Died" value={metrics.deaths} warning />
      </div>
      <FullDoctrinePanel
        numColonies={2}
        selected={colonyId}
        onSelect={() => undefined}
        doctrine={doctrine}
        topology={topology}
        disabled={disabled}
        onCommit={onCommit}
        showColonySelector={false}
      />
      {metrics.doctrineChanged && (
        <p className="war-adoption">
          <strong>{metrics.doctrineAdopted}/{metrics.population} ants updated.</strong>{" "}
          {adoptionChoice(adoption).note}
        </p>
      )}
    </aside>
  );
}

function Setting({ label, value, display, min, max, step, onChange }: {
  label: string; value: number; display: string; min: number; max: number; step: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="war-setting">
      <span><b>{label}</b><strong>{display}</strong></span>
      <input type="range" value={value} min={min} max={max} step={step} onChange={e => onChange(Number(e.target.value))} />
    </label>
  );
}

function MatchSetup({
  settings, hasMatch, onChange, onUseSameSeed, onGenerateSeed, onCancel, onStart,
}: {
  settings: WarMatchSettings;
  hasMatch: boolean;
  onChange: (settings: WarMatchSettings) => void;
  onUseSameSeed: () => void;
  onGenerateSeed: () => void;
  onCancel: () => void;
  onStart: () => void;
}) {
  const update = (key: AdjustableSetting, value: number) => onChange({ ...settings, [key]: value });
  return (
    <section className={`war-setup${hasMatch ? " war-setup--modal" : ""}`} aria-label="Create local match">
      <div className="war-setup__panel">
        <div className="war-setup__heading">
          <div>
            <p>{hasMatch ? "New local match" : "Local · Two players"}</p>
            <h1>{hasMatch ? "Configure the next match" : "Create a War Mode match"}</h1>
            <span>Choose the starting conditions. These settings lock when the match begins.</span>
          </div>
          {hasMatch && <button className="war-setup__close" onClick={onCancel} aria-label="Close match setup">×</button>}
        </div>

        <div className="war-setup__settings">
          <Setting label="Starting ants" value={settings.startingAnts} display={`${settings.startingAnts} per colony`} min={1} max={100} step={1} onChange={value => update("startingAnts", value)} />
          <Setting label="Gland size" value={settings.tankMax} display={`~${Math.round(settings.tankMax / (DEPOSIT_RATE * DEPOSITS_PER_CELL))} cells`} min={1600} max={16000} step={800} onChange={value => update("tankMax", value)} />
          <Setting label="Food sources" value={settings.foodSources} display={`${settings.foodSources}`} min={1} max={12} step={1} onChange={value => update("foodSources", value)} />
          <Setting label="Food per source" value={settings.foodPerSource} display={`${settings.foodPerSource} units`} min={50} max={10000} step={50} onChange={value => update("foodPerSource", value)} />
          <div className="war-setting war-setting--topology war-setting--choice">
            <span><b>Map layout</b><strong>{layoutChoice(settings.layout).label}</strong></span>
            <p>{layoutChoice(settings.layout).description}</p>
            <div className="war-topology-options">
              {LAYOUT_CHOICES.map(choice => (
                <button
                  key={choice.name}
                  type="button"
                  className={choice.name === settings.layout ? "is-active" : ""}
                  onClick={() => onChange({ ...settings, layout: choice.name })}
                >{choice.label}</button>
              ))}
            </div>
          </div>
          <div className="war-setting war-setting--topology war-setting--choice">
            <span><b>Doctrine changes apply</b><strong>{adoptionChoice(settings.adoption).label}</strong></span>
            <p>{adoptionChoice(settings.adoption).description}</p>
            <div className="war-topology-options">
              {ADOPTION_CHOICES.map(choice => (
                <button
                  key={choice.name}
                  type="button"
                  className={choice.name === settings.adoption ? "is-active" : ""}
                  onClick={() => onChange({ ...settings, adoption: choice.name })}
                >{choice.label}</button>
              ))}
            </div>
          </div>
          <Setting label="Maze loop rate" value={settings.loopRate} display={`${Math.round(settings.loopRate * 100)}%`} min={0} max={0.5} step={0.05} onChange={value => update("loopRate", value)} />
          <div className="war-setting war-setting--topology">
            <span><b>Field topology</b><strong>{choiceFor(settings.topology).label}</strong></span>
            <p>{choiceFor(settings.topology).description}</p>
            <div className="war-topology-options">
              {TOPOLOGY_CHOICES.map(choice => (
                <button
                  key={choice.name}
                  type="button"
                  className={choice.name === choiceFor(settings.topology).name ? "is-active" : ""}
                  onClick={() => onChange({ ...settings, topology: choice.topology })}
                >{choice.label}</button>
              ))}
            </div>
          </div>
        </div>

        <div className="war-seed">
          <div className="war-seed__heading">
            <div>
              <strong>Match seed</strong>
              <span>Reuse a seed to compare strategies under identical starting conditions.</span>
            </div>
            <div className="war-seed__actions">
              {hasMatch && <button className="war-button" onClick={onUseSameSeed}>Same seed</button>}
              <button className="war-button" onClick={onGenerateSeed}>New seed</button>
            </div>
          </div>
          <input
            aria-label="Match seed"
            value={settings.masterSeed}
            onChange={event => onChange({ ...settings, masterSeed: event.target.value })}
            spellCheck={false}
          />
        </div>

        <div className="war-setup__footer">
          {hasMatch && <button className="war-button" onClick={onCancel}>Cancel</button>}
          <button className="war-button war-button--primary" onClick={onStart}>Start match</button>
        </div>
      </div>
    </section>
  );
}

export default function LocalWarMode() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const loadRecordRef = useRef<HTMLInputElement>(null);
  const [initialSettings] = useState<WarMatchSettings>(() => ({
    ...DEFAULT_WAR_SETTINGS,
    masterSeed: generateMasterSeed(),
  }));
  const [settings, setSettings] = useState<WarMatchSettings>(initialSettings);
  const [draftSettings, setDraftSettings] = useState<WarMatchSettings>(initialSettings);
  const [speed, setSpeed] = useState(15);
  const speedRef = useRef(speed);
  const [doctrines, setDoctrines] = useState<Doctrine[]>([
    cloneDoctrine(DEFAULT_DOCTRINE), cloneDoctrine(DEFAULT_DOCTRINE),
  ]);
  const [initialRecorder] = useState(() => createLocalWarRecorder(initialSettings, doctrines));
  const recorderRef = useRef(initialRecorder);
  const warRef = useRef(initialRecorder.runtime);
  const replayRef = useRef<ReturnType<typeof createLocalWarReplay> | null>(null);
  const loadedRecordRef = useRef<LocalWarRecord | null>(null);
  const [metrics, setMetrics] = useState(() => [warRef.current.getMetrics(0), warRef.current.getMetrics(1)]);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(warRef.current.result);
  const [hasMatch, setHasMatch] = useState(false);
  const [setupOpen, setSetupOpen] = useState(true);
  const [recordMessage, setRecordMessage] = useState<string | null>(null);
  const [replayState, setReplayState] = useState<{
    tick: number;
    endTick: number;
    divergedAt: number | null;
  } | null>(null);

  const paint = useCallback(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx) drawWar(ctx, warRef.current);
  }, []);

  const refreshStats = useCallback(() => {
    setMetrics([warRef.current.getMetrics(0), warRef.current.getMetrics(1)]);
    setResult(warRef.current.result);
    const replay = replayRef.current;
    if (replay) {
      setDoctrines(warRef.current.simulation.colonies.map(colony => cloneDoctrine(colony.doctrine)));
      setReplayState({
        tick: replay.tick,
        endTick: replay.endTick,
        divergedAt: replay.divergedAt,
      });
    }
  }, []);

  const createMatch = useCallback((nextSettings: WarMatchSettings, nextDoctrines = doctrines) => {
    setRunning(false);
    const recorder = createLocalWarRecorder(nextSettings, nextDoctrines);
    recorderRef.current = recorder;
    replayRef.current = null;
    loadedRecordRef.current = null;
    warRef.current = recorder.runtime;
    setSettings(nextSettings);
    setHasMatch(true);
    setSetupOpen(false);
    setResult(null);
    setReplayState(null);
    setRecordMessage(null);
    setMetrics([warRef.current.getMetrics(0), warRef.current.getMetrics(1)]);
    requestAnimationFrame(paint);
  }, [doctrines, paint]);

  useEffect(() => { if (hasMatch) paint(); }, [hasMatch, paint]);

  useEffect(() => {
    if (!running) return;
    let animationFrame = 0;
    let previous = performance.now();
    let accumulator = 0;
    let statsElapsed = 0;
    const frame = (now: number) => {
      const elapsed = Math.min(0.1, (now - previous) / 1000);
      previous = now;
      accumulator += elapsed;
      statsElapsed += elapsed;
      const secondsPerStep = 1 / speedRef.current;
      let canContinue = true;
      while (accumulator >= secondsPerStep && canContinue) {
        const replay = replayRef.current;
        if (replay) {
          canContinue = replay.step();
          warRef.current = replay.runtime;
        } else if (warRef.current.result === null) {
          canContinue = recorderRef.current.step();
        } else {
          canContinue = false;
        }
        accumulator -= secondsPerStep;
      }
      paint();
      const replay = replayRef.current;
      const stopped = replay
        ? replay.atEnd || replay.divergedAt !== null
        : warRef.current.result !== null;
      if (statsElapsed >= 0.15 || stopped) {
        statsElapsed = 0;
        refreshStats();
      }
      if (!stopped) animationFrame = requestAnimationFrame(frame);
      else setRunning(false);
    };
    animationFrame = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(animationFrame);
  }, [paint, refreshStats, running]);

  const updateSpeed = (value: number) => {
    speedRef.current = value;
    setSpeed(value);
  };

  const updateDoctrine = (colonyId: number, doctrine: Doctrine) => {
    if (replayRef.current) return;
    const conformed = conformDoctrine(doctrine, settings.topology);
    setDoctrines(current => current.map((currentDoctrine, id) => id === colonyId ? conformed : currentDoctrine));
    recorderRef.current.command(localWarPlayerSource(colonyId), {
      kind: "set-doctrine",
      colonyId,
      doctrine: conformed,
    });
    refreshStats();
  };

  const download = useCallback((contents: string, filename: string) => {
    const blob = new Blob([contents], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }, []);

  const saveRecord = useCallback(() => {
    if (replayRef.current) return;
    const record = recorderRef.current.build();
    download(serializeModeRunRecord(record), localWarRecordFilename(record));
    setRecordMessage(`Saved a replayable research record through tick ${record.endTick}.`);
  }, [download]);

  const enterReplay = useCallback((text: string) => {
    const parsed = parseLocalWarRecord(text);
    if (!parsed.ok) {
      setRecordMessage(parsed.error);
      return;
    }
    const replay = createLocalWarReplay(parsed.record);
    replayRef.current = replay;
    loadedRecordRef.current = parsed.record;
    warRef.current = replay.runtime;
    setRunning(false);
    setHasMatch(true);
    setSetupOpen(false);
    setSettings(parsed.record.mode.config.settings);
    setDraftSettings(parsed.record.mode.config.settings);
    setDoctrines(parsed.record.mode.config.doctrines.map(cloneDoctrine));
    setRecordMessage(parsed.warning ?? "Loaded a verified Local War research record.");
    setReplayState({ tick: replay.tick, endTick: replay.endTick, divergedAt: null });
    setMetrics([replay.runtime.getMetrics(0), replay.runtime.getMetrics(1)]);
    setResult(replay.runtime.result);
    requestAnimationFrame(paint);
  }, [paint]);

  const exitReplay = useCallback(() => {
    const record = loadedRecordRef.current;
    if (!record) return;
    const liveDoctrines = record.mode.config.doctrines.map(cloneDoctrine);
    setDoctrines(liveDoctrines);
    createMatch(record.mode.config.settings, liveDoctrines);
  }, [createMatch]);

  const restart = useCallback(() => {
    const replay = replayRef.current;
    if (!replay) {
      createMatch(settings);
      return;
    }
    setRunning(false);
    replay.reset();
    warRef.current = replay.runtime;
    refreshStats();
    requestAnimationFrame(paint);
  }, [createMatch, paint, refreshStats, settings]);

  const seekReplay = useCallback((tick: number) => {
    const replay = replayRef.current;
    if (!replay) return;
    setRunning(false);
    replay.seek(tick);
    warRef.current = replay.runtime;
    refreshStats();
    requestAnimationFrame(paint);
  }, [paint, refreshStats]);

  const openMatchSetup = (seed: "same" | "new" = "same") => {
    setRunning(false);
    setDraftSettings({
      ...settings,
      masterSeed: seed === "new" ? generateMasterSeed() : settings.masterSeed,
    });
    setSetupOpen(true);
  };

  const startDraftMatch = () => {
    const next = {
      ...draftSettings,
      masterSeed: draftSettings.masterSeed.trim() || generateMasterSeed(),
    };
    const nextDoctrines = doctrines.map(doctrine => conformDoctrine(doctrine, next.topology));
    setDoctrines(nextDoctrines);
    setDraftSettings(next);
    createMatch(next, nextDoctrines);
    setRunning(true);
  };

  const loadSelectedRecord = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      enterReplay(await file.text());
    } catch {
      setRecordMessage("That run record could not be read.");
    }
  };

  const replaying = replayState !== null;
  const replayStopped = replayState !== null &&
    (replayState.tick >= replayState.endTick || replayState.divergedAt !== null);

  if (!hasMatch) {
    return (
      <main className="war-page war-page--setup">
        <MatchSetup
          settings={draftSettings}
          hasMatch={false}
          onChange={setDraftSettings}
          onUseSameSeed={() => undefined}
          onGenerateSeed={() => setDraftSettings(current => ({ ...current, masterSeed: generateMasterSeed() }))}
          onCancel={() => undefined}
          onStart={startDraftMatch}
        />
        <div className="war-setup-record">
          <button className="war-button" onClick={() => loadRecordRef.current?.click()}>Load recorded match</button>
          <span>Open a Local War research record for verified playback.</span>
          <input ref={loadRecordRef} type="file" accept="application/json,.json" hidden onChange={loadSelectedRecord} />
          {recordMessage && <p role="status">{recordMessage}</p>}
        </div>
      </main>
    );
  }

  return (
    <main className="war-page">
      <header className="war-header">
        <div>
          <p>Local · Two players</p>
          <h1>War Mode</h1>
          <span>Last colony standing wins.</span>
        </div>
        <div className="war-header__actions">
          <button className="war-button" disabled={replaying} onClick={saveRecord}>Save record</button>
          <button className="war-button" onClick={() => loadRecordRef.current?.click()}>Load record</button>
          <button className="war-button" onClick={() => openMatchSetup()}>New match</button>
          <input ref={loadRecordRef} type="file" accept="application/json,.json" hidden onChange={loadSelectedRecord} />
        </div>
      </header>

      <section className="war-matchbar" aria-label="Locked match settings">
        <div className="war-matchbar__group">
          <strong>Match settings</strong>
          <div className="war-matchbar__summary">
            <span>{settings.startingAnts} ants / colony</span>
            <span>~{Math.round(settings.tankMax / (DEPOSIT_RATE * DEPOSITS_PER_CELL))}-cell gland</span>
            <span>{settings.foodSources} food {settings.foodSources === 1 ? "source" : "sources"}</span>
            <span>{settings.foodPerSource} food / source</span>
            <span>{Math.round(settings.loopRate * 100)}% maze loops</span>
            <span>{layoutChoice(settings.layout).label} map</span>
            <span>{choiceFor(settings.topology).label} topology</span>
            <span>Doctrine: {adoptionChoice(settings.adoption).label.toLowerCase()}</span>
            <span className="war-matchbar__seed" title={settings.masterSeed}>Seed: {settings.masterSeed}</span>
          </div>
        </div>
        <div className="war-matchbar__group war-matchbar__group--controls">
          <strong>Simulation controls</strong>
          <div className="war-matchbar__controls">
            <button className="war-button war-button--primary" disabled={replaying ? replayStopped : result !== null} onClick={() => setRunning(value => !value)}>
              {running ? "Pause" : "Play"}
            </button>
            <button className="war-button" onClick={restart}>{replaying ? "Restart replay" : "Restart"}</button>
            <Setting label="Simulation speed" value={speed} display={`${speed} steps/sec`} min={2} max={60} step={1} onChange={updateSpeed} />
          </div>
        </div>
      </section>

      {recordMessage && <div className="war-record-message" role="status">{recordMessage}</div>}

      {replayState && (
        <section className="war-replay" aria-label="Recorded match playback">
          <div className="war-replay__heading">
            <div>
              <strong>Recorded match</strong>
              <span>Tick {replayState.tick.toLocaleString()} of {replayState.endTick.toLocaleString()}</span>
            </div>
            <div>
              {replayState.divergedAt !== null && (
                <button className="war-button" onClick={() => {
                  replayRef.current?.continueAfterDivergence();
                  refreshStats();
                }}>Continue without verification</button>
              )}
              <button className="war-button" onClick={exitReplay}>Exit replay</button>
            </div>
          </div>
          <input
            aria-label="Replay tick"
            type="range"
            min={0}
            max={replayState.endTick}
            value={replayState.tick}
            onChange={event => seekReplay(Number(event.target.value))}
          />
          {replayState.divergedAt !== null && (
            <p className="war-replay__error">
              Replay diverged at tick {replayState.divergedAt.toLocaleString()}. Playback stopped before showing unverified state.
            </p>
          )}
        </section>
      )}

      {setupOpen && (
        <MatchSetup
          settings={draftSettings}
          hasMatch={hasMatch}
          onChange={setDraftSettings}
          onUseSameSeed={() => setDraftSettings(current => ({ ...current, masterSeed: settings.masterSeed }))}
          onGenerateSeed={() => setDraftSettings(current => ({ ...current, masterSeed: generateMasterSeed() }))}
          onCancel={() => setSetupOpen(false)}
          onStart={startDraftMatch}
        />
      )}

      <>
        {result !== null && (
          <div className="war-result" style={{ "--winner-color": result === "draw" ? "#f4ead7" : COLONY_COLORS[result].primary } as React.CSSProperties}>
            <div>
              <strong>{result === "draw" ? "Both colonies were eliminated" : `Colony ${result + 1} survives`}</strong>
              <span>{replaying ? "The recorded match has ended." : "The match has ended. Replay these conditions or generate a new seed."}</span>
            </div>
            <div className="war-result__actions">
              {replaying ? (
                <>
                  <button className="war-button" onClick={restart}>Replay from start</button>
                  <button className="war-button war-button--primary" onClick={exitReplay}>Run these settings live</button>
                </>
              ) : (
                <>
                  <button className="war-button" onClick={() => createMatch(settings)}>Rematch same seed</button>
                  <button className="war-button war-button--primary" onClick={() => openMatchSetup("new")}>Play new seed</button>
                </>
              )}
            </div>
          </div>
        )}

        <section className="war-arena">
          <ColonyPanel colonyId={0} doctrine={doctrines[0]} metrics={metrics[0] ?? EMPTY_METRICS} topology={settings.topology} adoption={settings.adoption} disabled={result !== null || replaying} onCommit={updateDoctrine} />
          <div className="war-maze">
            <canvas ref={canvasRef} width={W} height={H} />
            <div className="war-maze__legend"><span>Blue: Colony 1</span><span>Yellow: carrying food</span><span>White ring: spoiler</span><span>Inset: false-trail provenance</span><span>Red ring: low energy</span><span>Red: Colony 2</span></div>
          </div>
          <ColonyPanel colonyId={1} doctrine={doctrines[1]} metrics={metrics[1] ?? EMPTY_METRICS} topology={settings.topology} adoption={settings.adoption} disabled={result !== null || replaying} onCommit={updateDoctrine} />
        </section>
        <p className="war-rules-note">
          Ants retreat below {Math.round(WAR_RULES.retreatEnergy / WAR_RULES.maxEnergy * 100)}% energy, refuel from their colony reserve,
          and new ants hatch when the colony can afford them.
        </p>
      </>
    </main>
  );
}
