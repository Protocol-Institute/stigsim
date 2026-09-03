import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_PARAMS, H, W, generateMasterSeed, type SimParams } from "@stigsim/sim-core";
import { COLONY_COLORS, render } from "../../render";
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

type AdjustableSetting = "startingAnts" | "foodSources" | "foodPerSource" | "loopRate";

function drawWar(ctx: CanvasRenderingContext2D, war: WarSimulation) {
  render(ctx, war.simulation);
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

function DoctrinePanel({
  colonyId, doctrine, metrics, onChange,
}: {
  colonyId: number;
  doctrine: SimParams;
  metrics: WarColonyMetrics;
  onChange: <K extends keyof SimParams>(key: K, value: SimParams[K]) => void;
}) {
  const color = COLONY_COLORS[colonyId].primary;
  const sliders = [
    { key: "evapRate" as const, label: "Evaporation rate", min: 0.001, max: 0.02, step: 0.001, value: `${Math.round(doctrine.evapRate * 1000)}‰ / step` },
    { key: "trailPower" as const, label: "Trail bias", min: 1, max: 10, step: 0.5, value: `power ${doctrine.trailPower}` },
    { key: "tankMax" as const, label: "Gland size", min: 1600, max: 16000, step: 800, value: `${doctrine.tankMax}` },
  ];
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
      <div className="war-doctrine">
        {sliders.map(control => (
          <label key={control.key}>
            <span><b>{control.label}</b><strong>{control.value}</strong></span>
            <input
              type="range" min={control.min} max={control.max} step={control.step}
              value={doctrine[control.key] as number}
              onChange={event => onChange(control.key, Number(event.target.value))}
            />
          </label>
        ))}
        <div className="war-toggle">
          <b>Cautionary</b>
          <div>
            {[false, true].map(value => (
              <button
                key={String(value)} className={doctrine.cautionary === value ? "is-active" : ""}
                onClick={() => onChange("cautionary", value)}
              >{value ? "On" : "Off"}</button>
            ))}
          </div>
        </div>
      </div>
      {metrics.doctrineChanged && (
        <p className="war-adoption">
          <strong>{metrics.doctrineAdopted}/{metrics.population} ants updated.</strong>{" "}
          Changes are adopted when each ant returns to this colony's nest.
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

export default function LocalWarMode() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [settings, setSettings] = useState<WarMatchSettings>({
    ...DEFAULT_WAR_SETTINGS,
    masterSeed: generateMasterSeed(),
  });
  const [speed, setSpeed] = useState(15);
  const [doctrines, setDoctrines] = useState<SimParams[]>([
    { ...DEFAULT_PARAMS }, { ...DEFAULT_PARAMS },
  ]);
  const warRef = useRef(new WarSimulation(settings, doctrines));
  const [metrics, setMetrics] = useState(() => [warRef.current.getMetrics(0), warRef.current.getMetrics(1)]);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(warRef.current.result);

  const paint = useCallback(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx) drawWar(ctx, warRef.current);
  }, []);

  const refreshStats = useCallback(() => {
    setMetrics([warRef.current.getMetrics(0), warRef.current.getMetrics(1)]);
    setResult(warRef.current.result);
  }, []);

  const resetMatch = useCallback((nextSettings = settings, nextDoctrines = doctrines) => {
    setRunning(false);
    warRef.current = new WarSimulation(nextSettings, nextDoctrines);
    setResult(null);
    setMetrics([warRef.current.getMetrics(0), warRef.current.getMetrics(1)]);
    requestAnimationFrame(paint);
  }, [doctrines, paint, settings]);

  useEffect(() => { paint(); }, [paint]);

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
      const secondsPerStep = 1 / speed;
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
  }, [paint, refreshStats, running, speed]);

  const updateDoctrine = <K extends keyof SimParams>(colonyId: number, key: K, value: SimParams[K]) => {
    setDoctrines(current => current.map((doctrine, id) => id === colonyId ? { ...doctrine, [key]: value } : doctrine));
    warRef.current.setDoctrine(colonyId, { ...doctrines[colonyId], [key]: value });
    refreshStats();
  };

  const updateSetting = (key: AdjustableSetting, value: number) => {
    const next = { ...settings, [key]: value };
    setSettings(next);
    resetMatch(next, doctrines);
  };

  const newMaze = () => {
    const next = { ...settings, masterSeed: generateMasterSeed() };
    setSettings(next);
    resetMatch(next, doctrines);
  };

  return (
    <main className="war-page">
      <header className="war-header">
        <div>
          <p>Local · Two players</p>
          <h1>War Mode</h1>
          <span>Last colony standing wins.</span>
        </div>
        <div className="war-header__actions">
          <button className="war-button war-button--primary" disabled={result !== null} onClick={() => setRunning(value => !value)}>
            {running ? "Pause" : "Play"}
          </button>
          <button className="war-button" onClick={() => resetMatch()}>Reset</button>
          <button className="war-button" onClick={newMaze}>New maze</button>
        </div>
      </header>

      <section className="war-settings" aria-label="Match settings">
        <div className="war-settings__heading"><strong>Match settings</strong><span>Changing these starts a fresh match · Seed: {settings.masterSeed}</span></div>
        <div className="war-settings__grid">
          <Setting label="Simulation speed" value={speed} display={`${speed} steps/sec`} min={2} max={60} step={1} onChange={setSpeed} />
          <Setting label="Starting ants" value={settings.startingAnts} display={`${settings.startingAnts} per colony`} min={1} max={100} step={1} onChange={value => updateSetting("startingAnts", value)} />
          <Setting label="Food sources" value={settings.foodSources} display={`${settings.foodSources}`} min={1} max={12} step={1} onChange={value => updateSetting("foodSources", value)} />
          <Setting label="Food per source" value={settings.foodPerSource} display={`${settings.foodPerSource} units`} min={50} max={2000} step={50} onChange={value => updateSetting("foodPerSource", value)} />
          <Setting label="Maze loop rate" value={settings.loopRate} display={`${Math.round(settings.loopRate * 100)}%`} min={0} max={0.5} step={0.05} onChange={value => updateSetting("loopRate", value)} />
        </div>
      </section>

      {result !== null && (
        <div className="war-result" style={{ "--winner-color": result === "draw" ? "#f4ead7" : COLONY_COLORS[result].primary } as React.CSSProperties}>
          <strong>{result === "draw" ? "Both colonies were eliminated" : `Colony ${result + 1} survives`}</strong>
          <span>The match has ended. Reset or generate a new maze to play again.</span>
        </div>
      )}

      <section className="war-arena">
        <DoctrinePanel colonyId={0} doctrine={doctrines[0]} metrics={metrics[0] ?? EMPTY_METRICS} onChange={(key, value) => updateDoctrine(0, key, value)} />
        <div className="war-maze">
          <canvas ref={canvasRef} width={W} height={H} />
          <div className="war-maze__legend"><span>Blue: Colony 1</span><span>Yellow: carrying food</span><span>Red ring: low energy</span><span>Red: Colony 2</span></div>
        </div>
        <DoctrinePanel colonyId={1} doctrine={doctrines[1]} metrics={metrics[1] ?? EMPTY_METRICS} onChange={(key, value) => updateDoctrine(1, key, value)} />
      </section>

      <p className="war-rules-note">
        Ants retreat below {Math.round(WAR_RULES.retreatEnergy / WAR_RULES.maxEnergy * 100)}% energy, refuel from their colony reserve,
        and new ants hatch when the colony can afford them.
      </p>
    </main>
  );
}
