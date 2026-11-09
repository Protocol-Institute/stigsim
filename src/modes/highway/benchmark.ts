import {
  Simulation, DEFAULT_PARAMS, DEFAULT_DOCTRINE, cloneDoctrine, makeSeeds,
  pathDistances, TOPOLOGY_PRIVATE, MAX_ANTS_PER_COLONY, MAX_TANK, MAX_TICKS,
  MAX_EVAP_RATE, MAX_TRAIL_POWER, isHalfStep, fingerprint,
} from '@stigsim/sim-core';

export interface HighwayConfig {
  seedPrefix: string;
  mazeCount: number;
  replicates: number;
  numAnts: number;
  tankMax: number;
  loopRate: number;
  maxTicks: number;
  sampleEvery: number;
  holdTicks: number;
  deliveryWindow: number;
  minDeliveries: number;
  minShare: number;
  maxStretch: number;
  evapRates: number[];
  trailPowers: number[];
}
export const DEFAULT_CONFIG: HighwayConfig = {
  seedPrefix: 'highway-v1', mazeCount: 10, replicates: 3,
  numAnts: 20, tankMax: DEFAULT_PARAMS.tankMax, loopRate: 0.1,
  maxTicks: 20000, sampleEvery: 20, holdTicks: 1000,
  deliveryWindow: 1000, minDeliveries: 3, minShare: 0.95, maxStretch: 1.1,
  evapRates: [0.001, 0.005, 0.01], trailPowers: [1, 3, 5, 7],
};

export function validateConfig(c: HighwayConfig): void {
  if (!c || typeof c !== 'object') throw new Error('Expected a configuration object');
  const integer = (key: keyof HighwayConfig, min: number, max: number) => {
    const n = c[key];
    if (typeof n !== 'number' || !Number.isInteger(n) || n < min || n > max) {
      throw new Error(`${key} must be an integer in ${min}..${max}`);
    }
  };
  integer('mazeCount', 1, 10000); integer('replicates', 1, 100);
  integer('numAnts', 1, MAX_ANTS_PER_COLONY); integer('tankMax', 1, MAX_TANK);
  integer('maxTicks', 1, MAX_TICKS); integer('sampleEvery', 1, c.maxTicks);
  integer('holdTicks', c.sampleEvery, c.maxTicks);
  integer('deliveryWindow', 1, c.maxTicks); integer('minDeliveries', 1, c.numAnts * c.deliveryWindow);
  for (const [key, min, max] of [['loopRate', 0, 0.5], ['minShare', 0, 1], ['maxStretch', 1, 10]] as const) {
    if (!Number.isFinite(c[key]) || c[key] < min || c[key] > max) throw new Error(`Invalid ${key}`);
  }
  if (c.minShare === 0) throw new Error('minShare must be positive');
  if (c.holdTicks % c.sampleEvery !== 0) throw new Error('holdTicks must be a multiple of sampleEvery');
  if (typeof c.seedPrefix !== 'string' || !c.seedPrefix.length) throw new Error('seedPrefix must be nonempty');
  for (const [values, max, half] of [[c.evapRates, MAX_EVAP_RATE, false], [c.trailPowers, MAX_TRAIL_POWER, true]] as const) {
    if (!Array.isArray(values) || !values.length || values.length > 100 || new Set(values).size !== values.length ||
      values.some(v => !Number.isFinite(v) || v < 0 || v > max || (half && !isHalfStep(v)))) {
      throw new Error('Invalid or duplicate evaporation rates / trail powers (powers need half steps)');
    }
  }
}

/** Loop erasure makes a real, contiguous simple route, never a union of branches. */
export function appendCell(route: number[], cell: number): void {
  if (route.at(-1) === cell) return;
  const previous = route.indexOf(cell);
  if (previous >= 0) route.length = previous + 1;
  else route.push(cell);
}

interface Route { cells: number[]; edges: Set<string>; since: number | null }
const edge = (a: number, b: number) => a < b ? `${a}:${b}` : `${b}:${a}`;
export class HighwayDetector {
  private routes = new Map<string, Route>();
  private deliveries: number[] = [];
  constructor(private readonly c: HighwayConfig, private readonly shortest: number) {}

  delivered(tick: number, cells: number[]): void {
    this.deliveries.push(tick);
    if (cells.length - 1 > this.shortest * this.c.maxStretch) return;
    const key = cells.join(',');
    if (!this.routes.has(key)) {
      const edges = new Set(cells.slice(1).map((cell, i) => edge(cells[i], cell)));
      this.routes.set(key, { cells: [...cells], edges, since: null });
      // Bounded observer memory; preserve candidates already qualifying.
      if (this.routes.size > 50) {
        const oldest = [...this.routes].find(([k, r]) => k !== key && r.since === null);
        if (oldest) this.routes.delete(oldest[0]);
      }
    }
  }

  sample(tick: number, ants: readonly { cx: number; cy: number; tx: number; ty: number }[], cols: number) {
    this.deliveries = this.deliveries.filter(t => t > tick - this.c.deliveryWindow);
    for (const route of this.routes.values()) {
      const cells = new Set(route.cells);
      const share = ants.filter(a => {
        const here = a.cy * cols + a.cx, target = a.ty * cols + a.tx;
        return cells.has(here) && (here === target || route.edges.has(edge(here, target)));
      }).length / ants.length;
      const qualifies = share >= this.c.minShare && this.deliveries.length >= this.c.minDeliveries;
      route.since = qualifies ? route.since ?? tick : null;
      if (route.since !== null && tick - route.since >= this.c.holdTicks) {
        return { onsetTick: route.since, confirmedTick: tick, route: route.cells, share };
      }
    }
    return null;
  }
}

export function createTrialSimulation(c: HighwayConfig, maze: number, replicate: number, evapRate: number, trailPower: number) {
  const seeds = makeSeeds(`${c.seedPrefix}:maze:${maze}`);
  seeds.master = null;
  seeds.ants = `${c.seedPrefix}:maze:${maze}:ants:${replicate}`;
  const doctrine = cloneDoctrine(DEFAULT_DOCTRINE);
  doctrine.evapRate = evapRate;
  doctrine.forager.follow.searching.food.own = trailPower;
  doctrine.forager.follow.returning.home.own = trailPower;
  // At most one pickup per ant per tick: this cannot deplete within the horizon.
  // A finite integer preserves JSON and fingerprint compatibility without changing physics.
  const foodCapacity = c.numAnts * c.maxTicks + 1;
  const sim = new Simulation({
    seeds, numAnts: c.numAnts, params: { tankMax: c.tankMax }, loopRate: c.loopRate,
    numColonies: 1, numFoodSources: 1, foodPerSource: foodCapacity, layout: 'random',
  }, { doctrines: [doctrine], topology: TOPOLOGY_PRIVATE });
  return sim;
}

export function runTrial(c: HighwayConfig, maze: number, replicate: number, evapRate: number, trailPower: number,
  observe?: (sim: Simulation) => void) {
  const sim = createTrialSimulation(c, maze, replicate, evapRate, trailPower);
  const seeds = sim.config.seeds, foodCapacity = sim.foodPerSource;
  const colony = sim.colonies[0], food = sim.foodSources[0], cols = sim.bounds.cols;
  if (!food) throw new Error('No food source generated');
  const shortest = pathDistances(sim.occupancy, colony.nestX, colony.nestY)[food.y * cols + food.x];
  if (shortest <= 0) throw new Error('Food must be reachable and distinct from nest');
  const detector = new HighwayDetector(c, shortest);
  const paths = colony.ants.map(() => [] as number[]);
  let firstDiscovery: number | null = null, firstDelivery: number | null = null;
  let highway: ReturnType<HighwayDetector['sample']> = null;
  for (let tick = 1; tick <= c.maxTicks; tick++) {
    const wasCarrying = colony.ants.map(a => a.hasFood);
    sim.step();
    colony.ants.forEach((a, i) => {
      if (a.hasFood && !wasCarrying[i]) {
        firstDiscovery ??= tick;
        paths[i] = [food.y * cols + food.x];
      }
      if (wasCarrying[i] || a.hasFood) appendCell(paths[i], a.cy * cols + a.cx);
      if (wasCarrying[i] && !a.hasFood) {
        firstDelivery ??= tick;
        detector.delivered(tick, paths[i]);
        paths[i] = [];
      }
    });
    if (tick % c.sampleEvery === 0) highway = detector.sample(tick, colony.ants, cols);
    if (tick % c.sampleEvery === 0) observe?.(sim);
    if (highway) break;
  }
  observe?.(sim);
  return {
    maze, replicate, evapRate, trailPower, seeds, shortest,
    food: { x: food.x, y: food.y }, foodCapacity,
    firstDiscovery, firstDelivery, highway,
    endTick: sim.tick, deliveries: colony.foodCollected, fingerprint: fingerprint(sim),
  };
}
export type Trial = ReturnType<typeof runTrial>;

export function summarize(rows: Trial[], maxTicks: number) {
  const groups = new Map<string, Trial[]>();
  for (const r of rows) {
    const key = `${r.evapRate}:${r.trailPower}`;
    groups.set(key, [...groups.get(key) ?? [], r]);
  }
  return [...groups.values()].map(group => {
    const times = group.flatMap(r => r.highway ? [r.highway.confirmedTick] : []).sort((a, b) => a - b);
    return {
      evapRate: group[0].evapRate, trailPower: group[0].trailPower,
      trials: group.length, successes: times.length, successRate: times.length / group.length,
      // Restricted mean time to confirmation: timeouts stay in the denominator.
      cappedMeanTicks: group.reduce((sum, r) => sum + (r.highway?.confirmedTick ?? maxTicks), 0) / group.length,
      medianSuccessTicks: times.length ? (times[Math.floor((times.length - 1) / 2)] + times[Math.floor(times.length / 2)]) / 2 : null,
    };
  }).sort((a, b) => a.cappedMeanTicks - b.cappedMeanTicks || b.successRate - a.successRate);
}
