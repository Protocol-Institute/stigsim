import { COLS, ROWS, DIRS4 } from "./constants";
import type { CellType, Colony } from "./types";
import type { Simulation } from "./sim";

export const METRICS_INTERVAL = 10;
export const METRICS_CAPACITY = 20000;
export const RATE_WINDOW_TICKS = 1000;

export interface LayerStats {
  home: number;
  food: number;
  caut: number;
}

export interface ColonySample {
  food: number;
  ratePerKTick: number;
  highwayScore: number;
  pheroMass: LayerStats;
  pheroEntropy: LayerStats;
  meanTripRatio: number | null;
}

export interface MetricsSample {
  t: number;
  colonies: ColonySample[];
  foodRemaining: number[];
}

/** Breadth-first distance in cells from the nest. -1 means unreachable. */
export function shortestFromNest(grid: CellType[][], nestX: number, nestY: number): Int32Array {
  const dist = new Int32Array(COLS * ROWS).fill(-1);
  if (grid[nestY][nestX] !== 1) return dist;

  const queue = new Int32Array(COLS * ROWS);
  let head = 0, tail = 0;
  dist[nestY * COLS + nestX] = 0;
  queue[tail++] = nestY * COLS + nestX;

  while (head < tail) {
    const idx = queue[head++];
    const x = idx % COLS;
    const y = (idx - x) / COLS;
    for (const [dx, dy] of DIRS4) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) continue;
      if (grid[ny][nx] !== 1) continue;
      const nIdx = ny * COLS + nx;
      if (dist[nIdx] !== -1) continue;
      dist[nIdx] = dist[idx] + 1;
      queue[tail++] = nIdx;
    }
  }
  return dist;
}

/** The share of a colony's pheromone mass carried by its busiest tenth of cells. */
export function colonyHighwayScore(sim: Simulation, colony: Colony): number {
  const open: number[] = [];
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (sim.grid[y][x] !== 1) continue;
      const idx = y * COLS + x;
      open.push(colony.foodPhero[idx] + colony.homePhero[idx]);
    }
  }
  if (open.length === 0) return 0;
  const total = open.reduce((a, b) => a + b, 0);
  if (total < 1) return 0;
  open.sort((a, b) => b - a);
  const topN = Math.max(1, Math.floor(open.length * 0.1));
  const topSum = open.slice(0, topN).reduce((a, b) => a + b, 0);
  return topSum / total;
}

function layerStats(layer: Float32Array, openIdx: Int32Array): { mass: number; entropy: number } {
  let mass = 0;
  for (let i = 0; i < openIdx.length; i++) mass += layer[openIdx[i]];
  if (mass <= 0) return { mass: 0, entropy: 0 };
  let entropy = 0;
  for (let i = 0; i < openIdx.length; i++) {
    const p = layer[openIdx[i]] / mass;
    if (p > 0) entropy -= p * Math.log(p);
  }
  return { mass, entropy };
}

function openCellIndices(sim: Simulation): Int32Array {
  const out: number[] = [];
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) if (sim.grid[y][x] === 1) out.push(y * COLS + x);
  }
  return Int32Array.from(out);
}

/**
 * Always-on sampling into a capped ring buffer. Nothing here feeds back into
 * the simulation, so Math.log is safe to use even though its precision is
 * implementation-defined.
 */
export class MetricsRecorder {
  readonly interval: number;
  readonly capacity: number;
  samples: MetricsSample[] = [];
  truncated = false;

  private rateHistory: { t: number; food: number }[][] = [];
  private distCache: Int32Array[] | null = null;
  private distCacheVersion = -1;

  constructor(interval: number = METRICS_INTERVAL, capacity: number = METRICS_CAPACITY) {
    this.interval = interval;
    this.capacity = capacity;
  }

  reset() {
    this.samples = [];
    this.truncated = false;
    this.rateHistory = [];
    this.distCache = null;
    this.distCacheVersion = -1;
  }

  /** Call once after every sim.step(). Samples only on the interval. */
  maybeSample(sim: Simulation) {
    if (sim.tick === 0 || sim.tick % this.interval !== 0) return;
    this.samples.push(this.sample(sim));
    if (this.samples.length > this.capacity) {
      this.samples.shift();
      this.truncated = true;
    }
  }

  private distances(sim: Simulation): Int32Array[] {
    if (this.distCache && this.distCacheVersion === sim.gridVersion) return this.distCache;
    this.distCache = sim.colonies.map(c => shortestFromNest(sim.grid, c.nestX, c.nestY));
    this.distCacheVersion = sim.gridVersion;
    return this.distCache;
  }

  private sample(sim: Simulation): MetricsSample {
    const openIdx = openCellIndices(sim);
    const dists = this.distances(sim);

    const colonies: ColonySample[] = sim.colonies.map((colony, i) => {
      const home = layerStats(colony.homePhero, openIdx);
      const food = layerStats(colony.foodPhero, openIdx);
      const caut = layerStats(colony.cautPhero, openIdx);

      if (!this.rateHistory[i]) this.rateHistory[i] = [];
      const history = this.rateHistory[i];
      history.push({ t: sim.tick, food: colony.foodCollected });
      while (history.length > 1 && sim.tick - history[0].t > RATE_WINDOW_TICKS) history.shift();
      const oldest = history[0];
      const span = sim.tick - oldest.t;
      const ratePerKTick = span > 0
        ? ((colony.foodCollected - oldest.food) / span) * 1000
        : 0;

      const dist = dists[i];
      const ratios: number[] = [];
      for (const trip of colony.recentTrips) {
        const shortest = dist[trip.sy * COLS + trip.sx];
        if (shortest > 0) ratios.push(trip.steps / (2 * shortest));
      }
      const meanTripRatio = ratios.length > 0
        ? ratios.reduce((a, b) => a + b, 0) / ratios.length
        : null;

      return {
        food: colony.foodCollected,
        ratePerKTick,
        highwayScore: colonyHighwayScore(sim, colony),
        pheroMass: { home: home.mass, food: food.mass, caut: caut.mass },
        pheroEntropy: { home: home.entropy, food: food.entropy, caut: caut.entropy },
        meanTripRatio,
      };
    });

    return {
      t: sim.tick,
      colonies,
      foodRemaining: sim.foodSources.map(s => s.remaining),
    };
  }
}

const CSV_BASE_COLUMNS = [
  "t", "colony", "food", "ratePerKTick", "highwayScore",
  "pheroMassHome", "pheroMassFood", "pheroMassCaut",
  "pheroEntropyHome", "pheroEntropyFood", "pheroEntropyCaut",
  "meanTripRatio",
];

/** One row per tick per colony. Food sources become fixed-width columns. */
export function metricsToCsv(samples: MetricsSample[]): string {
  const maxSources = samples.reduce((m, s) => Math.max(m, s.foodRemaining.length), 0);
  const header = [
    ...CSV_BASE_COLUMNS,
    ...Array.from({ length: maxSources }, (_, i) => `foodRemaining${i}`),
  ];

  const rows: string[] = [header.join(",")];
  for (const s of samples) {
    const remaining = Array.from({ length: maxSources }, (_, i) =>
      i < s.foodRemaining.length ? String(s.foodRemaining[i]) : "");
    s.colonies.forEach((c, colonyIdx) => {
      rows.push([
        s.t, colonyIdx, c.food, c.ratePerKTick, c.highwayScore,
        c.pheroMass.home, c.pheroMass.food, c.pheroMass.caut,
        c.pheroEntropy.home, c.pheroEntropy.food, c.pheroEntropy.caut,
        c.meanTripRatio === null ? "" : c.meanTripRatio,
        ...remaining,
      ].join(","));
    });
  }
  return rows.join("\n") + "\n";
}
