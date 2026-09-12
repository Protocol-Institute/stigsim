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
import { COLONY_COLORS, render } from "../../render";
import { DoctrinePanel as FullDoctrinePanel } from "../../DoctrinePanel";
import { TOPOLOGY_CHOICES, choiceFor, conformDoctrine } from "../../topology-choices";
import { LAYOUT_CHOICES, layoutChoice } from "../../layout-choices";
import {
  DEFAULT_WAR_SETTINGS,
  WAR_RULES,
  WarSimulation,
  type WarColonyMetrics,
  type WarMatchSettings,
} from "./war-simulation";

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
  colonyId, doctrine, metrics, topology, disabled, onCommit,
}: {
  colonyId: number;
  doctrine: Doctrine;
  metrics: WarColonyMetrics;
  topology: WarMatchSettings["topology"];
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
          Follow and lay behavior updates when each ant returns; colony-level settings apply on the next tick.
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
          <Setting label="Maze loop rate" value={settings.loopRate} display={`${Math.round(settings.loopRate * 100)}%`} min={0} max={0.5} step={0.05} onChange={value => update("loopRate", value)} />
          <div className="war-setting war-setting--topology">
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
  const [initialWar] = useState(() => new WarSimulation(initialSettings, doctrines));
  const warRef = useRef(initialWar);
  const [metrics, setMetrics] = useState(() => [warRef.current.getMetrics(0), warRef.current.getMetrics(1)]);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(warRef.current.result);
  const [hasMatch, setHasMatch] = useState(false);
  const [setupOpen, setSetupOpen] = useState(true);

  const paint = useCallback(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx) drawWar(ctx, warRef.current);
  }, []);

  const refreshStats = useCallback(() => {
    setMetrics([warRef.current.getMetrics(0), warRef.current.getMetrics(1)]);
    setResult(warRef.current.result);
  }, []);

  const createMatch = useCallback((nextSettings: WarMatchSettings, nextDoctrines = doctrines) => {
    setRunning(false);
    warRef.current = new WarSimulation(nextSettings, nextDoctrines);
    setSettings(nextSettings);
    setHasMatch(true);
    setSetupOpen(false);
    setResult(null);
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
      while (accumulator >= secondsPerStep && warRef.current.result === null) {
        warRef.current.step();
        accumulator -= secondsPerStep;
      }
      paint();
      if (statsElapsed >= 0.15 || warRef.current.result !== null) {
        statsElapsed = 0;
        refreshStats();
      }
      if (warRef.current.result === null) animationFrame = requestAnimationFrame(frame);
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
    const conformed = conformDoctrine(doctrine, settings.topology);
    setDoctrines(current => current.map((currentDoctrine, id) => id === colonyId ? conformed : currentDoctrine));
    warRef.current.setDoctrine(colonyId, conformed);
    refreshStats();
  };

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
          <button className="war-button" onClick={() => openMatchSetup()}>New match</button>
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
            <span className="war-matchbar__seed" title={settings.masterSeed}>Seed: {settings.masterSeed}</span>
          </div>
        </div>
        <div className="war-matchbar__group war-matchbar__group--controls">
          <strong>Simulation controls</strong>
          <div className="war-matchbar__controls">
            <button className="war-button war-button--primary" disabled={result !== null} onClick={() => setRunning(value => !value)}>
              {running ? "Pause" : "Play"}
            </button>
            <button className="war-button" onClick={() => createMatch(settings)}>Restart</button>
            <Setting label="Simulation speed" value={speed} display={`${speed} steps/sec`} min={2} max={60} step={1} onChange={updateSpeed} />
          </div>
        </div>
      </section>

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
              <span>The match has ended. Replay these conditions or generate a new seed.</span>
            </div>
            <div className="war-result__actions">
              <button className="war-button" onClick={() => createMatch(settings)}>Rematch same seed</button>
              <button className="war-button war-button--primary" onClick={() => openMatchSetup("new")}>Play new seed</button>
            </div>
          </div>
        )}

        <section className="war-arena">
          <ColonyPanel colonyId={0} doctrine={doctrines[0]} metrics={metrics[0] ?? EMPTY_METRICS} topology={settings.topology} disabled={result !== null} onCommit={updateDoctrine} />
          <div className="war-maze">
            <canvas ref={canvasRef} width={W} height={H} />
            <div className="war-maze__legend"><span>Blue: Colony 1</span><span>Yellow: carrying food</span><span>White ring: spoiler</span><span>Inset: false-trail provenance</span><span>Red ring: low energy</span><span>Red: Colony 2</span></div>
          </div>
          <ColonyPanel colonyId={1} doctrine={doctrines[1]} metrics={metrics[1] ?? EMPTY_METRICS} topology={settings.topology} disabled={result !== null} onCommit={updateDoctrine} />
        </section>
        <p className="war-rules-note">
          Ants retreat below {Math.round(WAR_RULES.retreatEnergy / WAR_RULES.maxEnergy * 100)}% energy, refuel from their colony reserve,
          and new ants hatch when the colony can afford them.
        </p>
      </>
    </main>
  );
}
