import {
  COLS, ROWS, CELL, V, ARRIVE_THRESH, NEST_SEED, DEPOSIT_RATE,
  COLONY_NESTS, DIRS4,
} from "./constants";
import type { Ant, AntState, CellType, Colony, FoodSource, SimParams } from "./types";
import { generateMaze } from "./maze";

export const cellCenter = (gx: number, gy: number) => ({ px: gx * CELL + CELL / 2, py: gy * CELL + CELL / 2 });

export function computeHighwayScore(sim: Simulation): number {
  const open: number[] = [];
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (sim.grid[y][x] === 1) {
        const idx = y * COLS + x;
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

export function openNeighbours(grid: CellType[][], x: number, y: number, exX?: number, exY?: number): [number, number][] {
  return DIRS4
    .map(([dx, dy]) => [x + dx, y + dy] as [number, number])
    .filter(([nx, ny]) =>
      nx >= 0 && nx < COLS && ny >= 0 && ny < ROWS &&
      grid[ny][nx] === 1 && !(nx === exX && ny === exY)
    );
}

export function powerChoice(
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
  let r = Math.random() * total;
  for (let i = 0; i < cells.length; i++) { r -= scores[i]; if (r <= 0) return cells[i]; }
  return cells[cells.length - 1];
}

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

  constructor(
    numAnts: number,
    params: SimParams,
    loopRate: number = 0.1,
    numColonies: number = 1,
    numFoodSources: number = 1,
    foodPerSource: number = 500,
  ) {
    this.numAnts = numAnts;
    this.params = { ...params };
    this.loopRate = loopRate;
    this.numColonies = numColonies;
    this.numFoodSources = numFoodSources;
    this.foodPerSource = foodPerSource;
    this.grid = generateMaze(loopRate);
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
    // Fisher-Yates shuffle
    for (let i = open.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [open[i], open[j]] = [open[j], open[i]];
    }
    const count = Math.min(this.numFoodSources, open.length);
    return open.slice(0, count).map(([x, y]) => ({
      x, y,
      remaining: this.foodPerSource,
      total: this.foodPerSource,
    }));
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

  step() {
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
    const next = powerChoice(candidates, phero, trailPower, this.params.cautionary ? colony.cautPhero : undefined, trailPower);

    ant.prevCx = ant.cx; ant.prevCy = ant.cy;
    ant.tx = next[0]; ant.ty = next[1];
  }
}
