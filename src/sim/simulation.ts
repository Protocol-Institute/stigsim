// ─────────────────────────────────────────────────────────────────────────────
// The maze simulation model.
//
// Kept free of React so it can be stepped, tested and reasoned about on its
// own; src/AntSim.tsx owns presentation and controls.
// ─────────────────────────────────────────────────────────────────────────────

import { Rng, randomSeed } from "./rng";
import {
  DEFAULT_FOOD_SPAWN,
  isSpawnTick,
  planFoodSpawn,
  SiteMemory,
  type FoodSpawnConfig,
} from "../../shared/food-spawn";
import {
  ARRIVE_THRESH,
  COLONY_NESTS,
  COLS,
  CELL,
  DEPOSIT_RATE,
  NEST_SEED,
  ROWS,
  V,
} from "./constants";

export interface SimParams {
  evapRate: number;
  trailPower: number;
  tankMax: number;
  cautionary: boolean;
  /**
   * Whether eaten food grows back. Off by default: the maze is a controlled
   * laboratory, and a fixed larder is what makes two runs comparable. Turning
   * it on converts the maze into a small ecology where routes have to be worth
   * maintaining over time.
   */
  replenish: boolean;
}

export const DEFAULT_PARAMS: SimParams = {
  evapRate: 0.005,
  trailPower: 5,
  tankMax: 6400,
  cautionary: false,
  replenish: false,
};

// Growth in the maze is brisker than in the shared world: a run is watched for
// minutes rather than inhabited for days.
export const MAZE_FOOD_SPAWN: FoodSpawnConfig = {
  ...DEFAULT_FOOD_SPAWN,
  intervalTicks: 120,
  maxSourcesPerAttempt: 2,
  clusterRadius: 4,
};

/**
 * Size new piles against the larder this run was configured with, rather than
 * the shared world's fixed 120-600 units. The maze's whole capacity can be as
 * low as 50 units, and a fixed minimum larger than the capacity means headroom
 * never reaches it and nothing ever grows.
 */
export function mazeFoodSpawnConfig(numFoodSources: number, foodPerSource: number): FoodSpawnConfig {
  const minUnits = Math.max(1, Math.round(foodPerSource * 0.25));
  return {
    ...MAZE_FOOD_SPAWN,
    capacityUnits: numFoodSources * foodPerSource,
    minUnits,
    maxUnits: Math.max(minUnits, foodPerSource),
  };
}

// Simulation steps between highway-score samples.
export const HIGHWAY_SAMPLE_EVERY = 15;

export const DEFAULT_NUM_COLONIES = 1;
export const DEFAULT_NUM_FOOD_SOURCES = 1;
export const DEFAULT_FOOD_PER_SOURCE = 500;

export type CellType = 0 | 1;
export type AntState = "searching" | "returning";

export interface FoodSource {
  x: number;
  y: number;
  remaining: number;
  total: number;
}

export interface Colony {
  id: number;
  nestX: number;
  nestY: number;
  homePhero: Float32Array;
  foodPhero: Float32Array;
  cautPhero: Float32Array;
  ants: Ant[];
  foodCollected: number;
  discoveredSources: Set<number>;
}

export interface Ant {
  x: number; y: number;
  cx: number; cy: number;
  tx: number; ty: number;
  prevCx: number; prevCy: number;
  state: AntState;
  hasFood: boolean;
  tank: number;
  colonyId: number;
  manual?: boolean;
}

export function generateMaze(rng: Rng, loopRate: number = 0.1): CellType[][] {
  const grid: CellType[][] = Array.from({ length: ROWS }, () => Array(COLS).fill(0));
  const visited = Array.from({ length: ROWS }, () => Array(COLS).fill(false));
  function carve(cx: number, cy: number) {
    visited[cy][cx] = true;
    grid[cy][cx] = 1;
    const dirs = rng.shuffle([[0, -2], [0, 2], [-2, 0], [2, 0]]);
    for (const [dx, dy] of dirs) {
      const nx = cx + dx, ny = cy + dy;
      if (nx >= 0 && nx < COLS && ny >= 0 && ny < ROWS && !visited[ny][nx]) {
        grid[cy + dy / 2][cx + dx / 2] = 1;
        carve(nx, ny);
      }
    }
  }
  carve(1, 1);
  for (let y = 1; y < ROWS - 1; y++)
    for (let x = 1; x < COLS - 1; x++)
      if (grid[y][x] === 0 && rng.chance(loopRate)) grid[y][x] = 1;
  // Ensure all colony nest corners are open
  for (const [nx, ny] of COLONY_NESTS) grid[ny][nx] = 1;
  return grid;
}

/**
 * How concentrated the ant-laid pheromone is: the share of it sitting in the
 * busiest tenth of open cells. Near 1 means the colonies have committed to a
 * few routes; low means scent is still spread thinly across the maze.
 *
 * Nest and food cells are excluded. Both are pinned to NEST_SEED every step by
 * the model rather than earned by any ant, and they are large enough to
 * dominate: counting them reported a fully converged 100% on a fresh maze where
 * no ant had yet moved.
 */
export function computeHighwayScore(sim: Simulation): number {
  const anchors = new Set<number>();
  for (const c of sim.colonies) anchors.add(c.nestY * COLS + c.nestX);
  for (const s of sim.foodSources) anchors.add(s.y * COLS + s.x);

  const open: number[] = [];
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (sim.grid[y][x] === 1) {
        const idx = y * COLS + x;
        if (anchors.has(idx)) continue;
        let total = 0;
        for (const c of sim.colonies) total += c.foodPhero[idx] + c.homePhero[idx];
        open.push(total);
      }
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

const DIRS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export function openNeighbours(grid: CellType[][], x: number, y: number, exX?: number, exY?: number): [number, number][] {
  return DIRS4
    .map(([dx, dy]) => [x + dx, y + dy] as [number, number])
    .filter(([nx, ny]) =>
      nx >= 0 && nx < COLS && ny >= 0 && ny < ROWS &&
      grid[ny][nx] === 1 && !(nx === exX && ny === exY)
    );
}

export function powerChoice(
  rng: Rng,
  cells: [number, number][],
  phero: Float32Array,
  power: number,
  cautPhero?: Float32Array,
  cautPower?: number,
): [number, number] {
  const scores = cells.map(([cx, cy]) => {
    const idx = cy * COLS + cx;
    const trail = Math.pow(phero[idx] + 1, power);
    const caution = (cautPhero && cautPower) ? Math.pow(cautPhero[idx] + 1, cautPower) : 1;
    return trail / caution;
  });
  const total = scores.reduce((a, b) => a + b, 0);
  let r = rng.next() * total;
  for (let i = 0; i < cells.length; i++) { r -= scores[i]; if (r <= 0) return cells[i]; }
  return cells[cells.length - 1];
}

export const cellCenter = (gx: number, gy: number) => ({ px: gx * CELL + CELL / 2, py: gy * CELL + CELL / 2 });

export class Simulation {
  numAnts: number;
  numColonies: number;
  numFoodSources: number;
  foodPerSource: number;
  params: SimParams;
  loopRate: number;
  grid: CellType[][];
  colonies: Colony[];
  foodSources: FoodSource[];
  seed: string;
  rng: Rng;
  tick = 0;
  foodMemory = new SiteMemory();

  constructor(
    numAnts: number,
    params: SimParams,
    loopRate: number = 0.1,
    numColonies: number = 1,
    numFoodSources: number = 1,
    foodPerSource: number = 500,
    seed: string = randomSeed(),
  ) {
    this.numAnts = numAnts;
    this.params = { ...params };
    this.loopRate = loopRate;
    this.numColonies = numColonies;
    this.numFoodSources = numFoodSources;
    this.foodPerSource = foodPerSource;
    this.seed = seed;
    this.rng = new Rng(seed);
    this.grid = generateMaze(this.rng, loopRate);
    this.colonies = this._initColonies();
    this.foodSources = this._placeFoodSources();
    for (const colony of this.colonies) this._seedNest(colony);
  }

  private _initColonies(): Colony[] {
    return Array.from({ length: this.numColonies }, (_, id) => {
      const [nestX, nestY] = COLONY_NESTS[id];
      this.grid[nestY][nestX] = 1;
      return {
        id,
        nestX,
        nestY,
        homePhero: new Float32Array(COLS * ROWS),
        foodPhero: new Float32Array(COLS * ROWS),
        cautPhero: new Float32Array(COLS * ROWS),
        ants: this._spawnAnts(id, nestX, nestY),
        foodCollected: 0,
        discoveredSources: new Set<number>(),
      };
    });
  }

  private _placeFoodSources(): FoodSource[] {
    const nestSet = new Set(this.colonies.map(c => c.nestY * COLS + c.nestX));
    // Minimum Manhattan distance from any nest
    const minDist = Math.floor(Math.min(COLS, ROWS) / 4);
    const open: [number, number][] = [];
    for (let y = 2; y < ROWS - 2; y++) {
      for (let x = 2; x < COLS - 2; x++) {
        if (this.grid[y][x] !== 1) continue;
        if (nestSet.has(y * COLS + x)) continue;
        const farEnough = this.colonies.every(
          c => Math.abs(c.nestX - x) + Math.abs(c.nestY - y) >= minDist
        );
        if (farEnough) open.push([x, y]);
      }
    }
    this.rng.shuffle(open);
    const count = Math.min(this.numFoodSources, open.length);
    return open.slice(0, count).map(([x, y]) => {
      this.foodMemory.remember(x, y);
      return { x, y, remaining: this.foodPerSource, total: this.foodPerSource };
    });
  }

  private _seedNest(colony: Colony) {
    const { nestX, nestY } = colony;
    colony.homePhero[nestY * COLS + nestX] = NEST_SEED;
    for (const [dx, dy] of DIRS4) {
      const nx = nestX + dx, ny = nestY + dy;
      if (nx >= 0 && nx < COLS && ny >= 0 && ny < ROWS && this.grid[ny][nx]) {
        const idx = ny * COLS + nx;
        colony.homePhero[idx] = Math.max(colony.homePhero[idx], NEST_SEED * 0.85);
      }
    }
  }

  private _spawnAnts(colonyId: number, nestX: number, nestY: number): Ant[] {
    const { px, py } = cellCenter(nestX, nestY);
    return Array.from({ length: this.numAnts }, () => ({
      x: px, y: py,
      cx: nestX, cy: nestY,
      tx: nestX, ty: nestY,
      prevCx: nestX, prevCy: nestY,
      state: "searching" as AntState,
      hasFood: false,
      tank: this.params.tankMax,
      colonyId,
    }));
  }

  get allAnts(): Ant[] {
    return this.colonies.flatMap(c => c.ants);
  }

  setAntCount(n: number) {
    for (const colony of this.colonies) {
      const { nestX, nestY } = colony;
      const { px, py } = cellCenter(nestX, nestY);
      if (n > colony.ants.length) {
        const toAdd = n - colony.ants.length;
        for (let i = 0; i < toAdd; i++) {
          colony.ants.push({
            x: px, y: py,
            cx: nestX, cy: nestY,
            tx: nestX, ty: nestY,
            prevCx: nestX, prevCy: nestY,
            state: "searching",
            hasFood: false,
            tank: this.params.tankMax,
            colonyId: colony.id,
          });
        }
      } else if (n < colony.ants.length) {
        colony.ants.splice(n);
      }
    }
    this.numAnts = n;
  }

  get totalFoodCollected(): number {
    return this.colonies.reduce((s, c) => s + c.foodCollected, 0);
  }

  /** Total food units still standing in the maze. */
  get standingFoodUnits(): number {
    return this.foodSources.reduce((sum, source) => sum + source.remaining, 0);
  }

  /**
   * Top the maze back up towards the larder it was configured with. New units
   * merge into an existing pile when one is already there, so a stripped source
   * can come back rather than only ever being replaced by a new one elsewhere.
   */
  private _growFood() {
    const planned = planFoodSpawn(
      {
        standingUnits: this.standingFoodUnits,
        region: { minX: 1, minY: 1, maxX: COLS - 2, maxY: ROWS - 2 },
        memory: this.foodMemory.entries,
        canPlaceAt: (x, y) =>
          this.grid[y][x] === 1 &&
          !this.colonies.some(c => c.nestX === x && c.nestY === y),
      },
      mazeFoodSpawnConfig(this.numFoodSources, this.foodPerSource),
      () => this.rng.next(),
    );

    for (const { x, y, units } of planned) {
      const existing = this.foodSources.find(s => s.x === x && s.y === y);
      if (existing) {
        existing.remaining += units;
        existing.total += units;
      } else {
        this.foodSources.push({ x, y, remaining: units, total: units });
      }
      this.foodMemory.remember(x, y);
    }
  }

  step() {
    this.tick++;
    if (this.params.replenish && isSpawnTick(this.tick, MAZE_FOOD_SPAWN)) this._growFood();
    const decay = 1 - this.params.evapRate;
    for (const colony of this.colonies) {
      for (let i = 0; i < colony.homePhero.length; i++) {
        colony.homePhero[i] *= decay;
        colony.foodPhero[i] *= decay;
        colony.cautPhero[i] *= decay;
      }
      this._seedNest(colony);
      // Re-seed discovered food sources that still have food
      for (const srcIdx of colony.discoveredSources) {
        const src = this.foodSources[srcIdx];
        if (src.remaining > 0) {
          colony.foodPhero[src.y * COLS + src.x] = NEST_SEED;
        }
      }
      for (const ant of colony.ants) this._moveAnt(ant, colony);
    }
  }

  private _moveAnt(ant: Ant, colony: Colony) {
    const { tankMax, trailPower } = this.params;
    const { px: tpx, py: tpy } = cellCenter(ant.tx, ant.ty);
    const dx = tpx - ant.x, dy = tpy - ant.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > ARRIVE_THRESH) {
      const idx = ant.cy * COLS + ant.cx;
      if (ant.tank > 0) {
        const deposit = Math.min(ant.tank, DEPOSIT_RATE);
        if (ant.state === "searching") {
          colony.homePhero[idx] += deposit;
        } else {
          colony.foodPhero[idx] += deposit;
        }
        ant.tank -= deposit;
      } else if (this.params.cautionary) {
        colony.cautPhero[idx] += DEPOSIT_RATE;
      }
      const scale = V / dist;
      ant.x += dx * scale;
      ant.y += dy * scale;
      return;
    }

    ant.x = tpx; ant.y = tpy;
    ant.cx = ant.tx; ant.cy = ant.ty;

    // Check food sources
    if (ant.state === "searching") {
      const srcIdx = this.foodSources.findIndex(s => s.x === ant.cx && s.y === ant.cy);
      if (srcIdx >= 0) {
        const src = this.foodSources[srcIdx];
        colony.discoveredSources.add(srcIdx);
        if (src.remaining > 0) {
          src.remaining--;
          if (src.remaining === 0) this.foodMemory.remember(src.x, src.y);
          colony.foodPhero[src.y * COLS + src.x] = NEST_SEED;
          ant.state = "returning";
          ant.hasFood = true;
          ant.tank = tankMax;
          const [ntx, nty] = [ant.prevCx, ant.prevCy];
          ant.prevCx = ant.cx; ant.prevCy = ant.cy;
          ant.tx = ntx; ant.ty = nty;
          return;
        }
        // depleted — fall through, keep searching
      }
    }

    // Check nest
    if (ant.state === "returning" && ant.cx === colony.nestX && ant.cy === colony.nestY) {
      ant.state = "searching";
      ant.hasFood = false;
      ant.tank = tankMax;
      colony.foodCollected++;
      const [ntx, nty] = [ant.prevCx, ant.prevCy];
      ant.prevCx = ant.cx; ant.prevCy = ant.cy;
      ant.tx = ntx; ant.ty = nty;
      return;
    }

    if (ant.manual) {
      ant.tx = ant.cx; ant.ty = ant.cy;
      return;
    }

    const noBack = openNeighbours(this.grid, ant.cx, ant.cy, ant.prevCx, ant.prevCy);
    const candidates = noBack.length > 0 ? noBack : openNeighbours(this.grid, ant.cx, ant.cy);
    const phero = ant.state === "searching" ? colony.foodPhero : colony.homePhero;
    const next = powerChoice(this.rng, candidates, phero, trailPower, this.params.cautionary ? colony.cautPhero : undefined, trailPower);

    ant.prevCx = ant.cx; ant.prevCy = ant.cy;
    ant.tx = next[0]; ant.ty = next[1];
  }
}
