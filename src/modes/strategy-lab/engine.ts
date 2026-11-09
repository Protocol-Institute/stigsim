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
/** One trial, advanced either interactively or headlessly through the same path. */
export class TrialSession {
  readonly sim: Simulation;
  readonly usage: Usage = { calls: 0, observationBytes: 0, interrupts: 0 };
  readonly actions: Action[] = [];
  readonly strategy: Strategy;
  readonly metrics = new MetricsRecorder();
  settings: Settings;
  state: unknown = null;
  nextTick = 0;
  error: string | undefined;
  constructor(strategy: Strategy, seed: string, readonly replicate = 0, readonly recordTrace = true) {
    this.strategy = parseStrategy(strategy);
    this.settings = this.strategy.initial;
    this.sim = createTrial(seed, replicate, this.settings);
  }
  get done() { return !!this.error || this.sim.tick >= CHALLENGE.ticks; }
  snapshot() {
    return { observation: observe(this.sim, this.settings), usage: { ...this.usage },
      actions: [...this.actions], signals: (this.state as { signals?: unknown } | null)?.signals ?? null,
      done: this.done, error: this.error };
  }
  async advance(ticks: number) {
    if (!Number.isInteger(ticks) || ticks < 1 || ticks > 1000) throw new Error('Advance by 1–1000 ticks.');
    try {
      const target = Math.min(CHALLENGE.ticks, this.sim.tick + ticks);
      while (!this.done && this.sim.tick < target) {
        if (this.sim.tick === this.nextTick) {
          const decision = await decide(this.strategy.source, observe(this.sim, this.settings), this.state, this.sim.tick, this.usage);
          this.state = decision.state;
          this.nextTick = decision.nextTick;
          if (decision.settings && JSON.stringify(decision.settings) !== JSON.stringify(this.settings)) {
            if (this.actions.length >= LIMITS.actionsPerTrial) throw new Error('Setting-change budget exhausted.');
            this.settings = decision.settings;
            this.actions.push({ tick: this.sim.tick, effectiveTick: this.sim.tick + 1, settings: this.settings });
            this.sim.enqueue({ kind: 'setDoctrine', colony: 0, doctrine: doctrine(this.settings) });
          }
        }
        this.sim.step();
        if (this.recordTrace) this.metrics.maybeSample(this.sim);
      }
    } catch (e) { this.error = e instanceof Error ? e.message : 'Controller failed.'; }
  }
  result(): Omit<Trial, 'entry' | 'maze'> {
    return { replicate: this.replicate, food: this.sim.colonies[0].foodCollected, endTick: this.sim.tick,
      fingerprint: fingerprint(this.sim), usage: { ...this.usage }, actions: [...this.actions],
      ...(this.error ? { error: this.error } : {}),
      // Stable metadata makes rerun files comparable; no wall clock feeds the trial.
      ...(this.recordTrace ? { trace: buildTrace(this.sim, this.metrics, '1970-01-01T00:00:00.000Z') } : {}) };
  }
}
export type SandboxSnapshot = ReturnType<TrialSession['snapshot']>;
export async function runTrial(strategy: Strategy, seed: string, replicate: number,
  onFrame?: (o: Observation) => void, yieldControl?: () => Promise<void>, recordTrace = true): Promise<Omit<Trial, 'entry' | 'maze'>> {
  const session = new TrialSession(strategy, seed, replicate, recordTrace);
  while (!session.done) {
    await session.advance(50);
    onFrame?.(observe(session.sim, session.settings));
    await yieldControl?.();
  }
  return session.result();
}
export interface RoundOptions {
  traces?: 'all' | 'first' | 'none';
  onTrial?: (trial: Trial, completed: number) => void;
}
export async function runRound(strategies: Strategy[], round: Round,
  onFrame?: (p: Progress) => void, yieldControl?: () => Promise<void>, options: RoundOptions = {}): Promise<Report> {
  const manifest = parseRound(round);
  if (strategies.length < 1 || strategies.length > 20) throw new Error('Use 1–20 entries per round.');
  const entries = await Promise.all(strategies.map(async s => ({ id: await strategyId(s), strategy: parseStrategy(s) })));
  if (new Set(entries.map(e => e.id)).size !== entries.length) throw new Error('Duplicate entries in round.');
  const trials: Trial[] = [];
  for (let maze = 0; maze < manifest.seeds.length; maze++) {
    for (let replicate = 0; replicate < manifest.replicates; replicate++) {
      for (const entry of entries) {
        const recordTrace = options.traces === undefined || options.traces === 'all' || (options.traces === 'first' && maze === 0 && replicate === 0);
        const trial = await runTrial(entry.strategy, manifest.seeds[maze], replicate,
          onFrame ? o => onFrame({ entry: entry.id, name: entry.strategy.name, maze, replicate, observation: o }) : undefined,
          yieldControl, recordTrace);
        trials.push({ entry: entry.id, maze, ...trial });
        options.onTrial?.(trials[trials.length - 1], trials.length);
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
