import { CELL, fingerprint, makeSeeds, mazeMode, type Simulation } from '@stigsim/sim-core';
import { buildTrace, MetricsRecorder, SIM_VERSION, type Trace } from '@stigsim/sim-trace';
import { CHALLENGE, LIMITS, doctrine, parseRound, parseStrategy, strategyId, type Round, type Settings, type Strategy } from './contract';
import { decide, type Usage } from './sandbox';

/** Cell coordinates, row-major arrays; only present state, never seeds or engine internals. */
export function observe(sim: Simulation, settings: Settings) {
  const { cols, rows } = sim.bounds;
  const colony = sim.colonies[0];
  const cells = Array.from({ length: cols * rows }, (_, i) => ({ x: i % cols, y: Math.floor(i / cols) }));
  return {
    tick: sim.tick, tickLimit: CHALLENGE.ticks, cols, rows,
    open: cells.map(c => sim.occupancy.isOpen(c.x, c.y) ? 1 : 0),
    nest: { x: colony.nestX, y: colony.nestY },
    ants: colony.ants.map((a, id) => ({ id, x: a.x / CELL, y: a.y / CELL, carrying: a.hasFood })),
    food: sim.foodSources.map(s => ({ x: s.x, y: s.y, remaining: s.remaining })),
    trails: { home: cells.map(c => colony.field.get('home', c.x, c.y)), food: cells.map(c => colony.field.get('food', c.x, c.y)) },
    foodDelivered: colony.foodCollected, settings: { ...settings },
  };
}
export type Observation = ReturnType<typeof observe>;
export interface Action { tick: number; effectiveTick: number; settings: Settings }
export interface Trial {
  entry: string; maze: number; replicate: number; food: number; endTick: number;
  fingerprint: string; usage: Usage; actions: Action[]; error?: string; trace?: Trace;
}
export interface Progress { entry: string; name: string; maze: number; replicate: number; observation: Observation }
export interface Report {
  format: 'stigsim-strategy-results@1'; simVersion: number; controllerEngine: string;
  challenge: typeof CHALLENGE; limits: typeof LIMITS; round: Round;
  entries: { id: string; strategy: Strategy }[]; trials: Trial[];
}
export function createTrial(seed: string, replicate: number, settings: Settings) {
  const seeds = makeSeeds(seed);
  seeds.master = null;
  seeds.ants = `${seed}:ants:${replicate}`;
  const sim = mazeMode.create({ seeds, numAnts: CHALLENGE.ants, params: { tankMax: CHALLENGE.tankMax },
    loopRate: CHALLENGE.loopRate, numColonies: 1, numFoodSources: CHALLENGE.foodSources,
    foodPerSource: CHALLENGE.foodPerSource, layout: 'random' });
  sim.enqueue({ kind: 'setAdoption', mode: 'instant' });
  sim.enqueue({ kind: 'setDoctrine', colony: 0, doctrine: doctrine(settings) });
  return sim;
}
export async function runTrial(strategy: Strategy, seed: string, replicate: number,
  onFrame?: (o: Observation) => void, yieldControl?: () => Promise<void>): Promise<Omit<Trial, 'entry' | 'maze'>> {
  const entry = parseStrategy(strategy);
  let settings = entry.initial;
  const sim = createTrial(seed, replicate, settings);
  const metrics = new MetricsRecorder();
  const usage: Usage = { calls: 0, observationBytes: 0, interrupts: 0 };
  const actions: Action[] = [];
  let state: unknown = null, nextTick = 0, error: string | undefined;
  try {
    while (sim.tick < CHALLENGE.ticks) {
      if (sim.tick === nextTick) {
        const decision = await decide(entry.source, observe(sim, settings), state, sim.tick, usage);
        state = decision.state;
        nextTick = decision.nextTick;
        if (decision.settings && JSON.stringify(decision.settings) !== JSON.stringify(settings)) {
          if (actions.length >= LIMITS.actionsPerTrial) throw new Error('Setting-change budget exhausted.');
          settings = decision.settings;
          actions.push({ tick: sim.tick, effectiveTick: sim.tick + 1, settings });
          sim.enqueue({ kind: 'setDoctrine', colony: 0, doctrine: doctrine(settings) });
        }
      }
      sim.step();
      metrics.maybeSample(sim);
      if (sim.tick % 50 === 0) {
        onFrame?.(observe(sim, settings));
        await yieldControl?.();
      }
    }
  } catch (e) { error = e instanceof Error ? e.message : 'Controller failed.'; }
  return { replicate, food: sim.colonies[0].foodCollected, endTick: sim.tick,
    fingerprint: fingerprint(sim), usage, actions, ...(error ? { error } : {}),
    // Fixed metadata timestamp keeps rerun files comparable; no wall clock feeds the trial.
    trace: buildTrace(sim, metrics, '1970-01-01T00:00:00.000Z') };
}
export async function runRound(strategies: Strategy[], round: Round,
  onFrame?: (p: Progress) => void, yieldControl?: () => Promise<void>): Promise<Report> {
  const manifest = parseRound(round);
  if (strategies.length < 1 || strategies.length > 20) throw new Error('Use 1–20 entries per round.');
  const entries = await Promise.all(strategies.map(async s => ({ id: await strategyId(s), strategy: parseStrategy(s) })));
  if (new Set(entries.map(e => e.id)).size !== entries.length) throw new Error('Duplicate entries in round.');
  const trials: Trial[] = [];
  for (let maze = 0; maze < manifest.seeds.length; maze++) {
    for (let replicate = 0; replicate < manifest.replicates; replicate++) {
      for (const entry of entries) {
        const trial = await runTrial(entry.strategy, manifest.seeds[maze], replicate,
          o => onFrame?.({ entry: entry.id, name: entry.strategy.name, maze, replicate, observation: o }), yieldControl);
        trials.push({ entry: entry.id, maze, ...trial });
      }
    }
  }
  return { format: 'stigsim-strategy-results@1', simVersion: SIM_VERSION, controllerEngine: 'quickjs-emscripten-core@0.32.0/release-sync',
    challenge: CHALLENGE, limits: LIMITS, round: manifest, entries, trials };
}
export function standings(report: Report) {
  return report.entries.map(entry => {
    const trials = report.trials.filter(t => t.entry === entry.id);
    const eligible = trials.length === report.round.seeds.length * report.round.replicates &&
      trials.every(t => !t.error && t.endTick === CHALLENGE.ticks);
    return { ...entry, eligible, mean: eligible ? trials.reduce((sum, t) => sum + t.food, 0) / trials.length : null };
  }).sort((a, b) => (b.mean ?? -1) - (a.mean ?? -1));
}
/** Replicates within a maze are averaged before counting paired differences. */
export function paired(report: Report, entry: string, reference: string) {
  const entries = standings(report).filter(e => e.id === entry || e.id === reference);
  if (entry === reference || entries.length !== 2 || !entries.every(e => e.eligible)) return null;
  const differences = report.round.seeds.map((_, maze) => {
    const mean = (id: string) => report.trials.filter(t => t.entry === id && t.maze === maze).reduce((s, t) => s + t.food, 0) / report.round.replicates;
    return mean(entry) - mean(reference);
  });
  const mean = differences.reduce((a, b) => a + b, 0) / differences.length;
  const variance = differences.reduce((s, d) => s + (d - mean) ** 2, 0) / (differences.length - 1);
  return { mean, standardError: Math.sqrt(variance / differences.length),
    wins: differences.filter(d => d > 0).length, ties: differences.filter(d => d === 0).length,
    losses: differences.filter(d => d < 0).length, mazes: differences.length };
}
