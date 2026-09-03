import {
  COLS, ROWS, CELL, V, ARRIVE_THRESH, NEST_SEED, DEPOSIT_RATE,
  COLONY_NESTS, DIRS4, TRIP_WINDOW,
} from "./constants";
import type { Ant, AntState, CellType, Colony, FoodSource, SimParams } from "./types";
import type { RunConfig } from "./types";
import { generateMaze } from "./maze";
import { makeRng, deterministicPow, shuffleInPlace, type Rng } from "./rng";
import type { Command, TimedCommand } from "./commands";
import { fingerprint, FINGERPRINT_INTERVAL } from "./fingerprint";

export const cellCenter = (gx: number, gy: number) => ({ px: gx * CELL + CELL / 2, py: gy * CELL + CELL / 2 });

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
  rng: Rng,
  cautPhero?: Float32Array,
  cautPower?: number,
): [number, number] {
  const scores = cells.map(([cx, cy]) => {
    const idx = cy * COLS + cx;
    const trail = deterministicPow(phero[idx] + 1, power);
    const caution = (cautPhero && cautPower) ? deterministicPow(cautPhero[idx] + 1, cautPower) : 1;
    return trail / caution;
  });
  const total = scores.reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (let i = 0; i < cells.length; i++) { r -= scores[i]; if (r <= 0) return cells[i]; }
  return cells[cells.length - 1];
}

export class Simulation {
  readonly config: RunConfig;
  numAnts: number;
  numColonies: number;
  numFoodSources: number;
  foodPerSource: number;
  params: SimParams;
  loopRate: number;
  grid: CellType[][];
  colonies: Colony[];
  foodSources: FoodSource[];
  private antsRng: Rng;
  tick = 0;
  manualAntIndex: number | null = null;
  /** Incremented whenever a wall opens or closes, so caches can invalidate. */
  gridVersion = 0;
  readonly fingerprints: { t: number; h: string }[] = [];
  private pending: Command[] = [];
  private recorded: TimedCommand[] = [];
  private schedule: Map<number, Command[]> | null = null;

  constructor(config: RunConfig) {
    this.config = config;
    this.numAnts = config.numAnts;
    this.params = { ...config.params };
    this.loopRate = config.loopRate;
    this.numColonies = config.numColonies;
    this.numFoodSources = config.numFoodSources;
    this.foodPerSource = config.foodPerSource;
    this.antsRng = makeRng(config.seeds.ants);
    this.grid = generateMaze(config.loopRate, makeRng(config.seeds.maze));
    this.colonies = this._initColonies();
    this.foodSources = this._placeFoodSources(makeRng(config.seeds.food));
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
        recentTrips: [],
      };
    });
  }

  private _placeFoodSources(rng: Rng): FoodSource[] {
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
    shuffleInPlace(open, rng);
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
      stepsSinceNest: 0,
      lastSourceX: null,
      lastSourceY: null,
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
            stepsSinceNest: 0,
            lastSourceX: null,
            lastSourceY: null,
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

  get commandLog(): readonly TimedCommand[] {
    return this.recorded;
  }

  /** Draws taken from the ant stream. Part of the run's continuation state. */
  get antsDraws(): number {
    return this.antsRng.draws;
  }

  enqueue(cmd: Command) {
    this.pending.push(cmd);
  }

  /**
   * Applies queued commands immediately, without advancing time, so a paused
   * edit shows up on screen right away. Recorded one tick ahead of the
   * current tick: a paused edit happens after tick N's physics has already
   * run, and replay drains a tick's commands at the top of that tick, before
   * its physics runs. Stamping the command `t: N + 1` is what makes replay
   * apply it at the same point in the run where it actually happened — the
   * top of the next tick, which is exactly where nothing else occurs between
   * the pause and the resume.
   */
  flushPending() {
    if (this.schedule) return;
    const cmds = this.pending.splice(0, this.pending.length);
    for (const cmd of cmds) {
      this.apply(cmd);
      this.recorded.push({ t: this.tick + 1, cmd });
    }
  }

  /** Switches the simulation from live input to a recorded command schedule. */
  loadSchedule(cmds: TimedCommand[]) {
    this.schedule = new Map();
    for (const { t, cmd } of cmds) {
      const at = this.schedule.get(t);
      if (at) at.push(cmd);
      else this.schedule.set(t, [cmd]);
    }
    this.pending = [];
    this._runCommandsFor(this.tick);
  }

  private _runCommandsFor(tick: number) {
    const cmds = this.schedule
      ? this.schedule.get(tick) ?? []
      : this.pending.splice(0, this.pending.length);
    for (const cmd of cmds) {
      this.apply(cmd);
      this.recorded.push({ t: tick, cmd });
    }
  }

  apply(cmd: Command) {
    switch (cmd.kind) {
      case "setWall":       this._applySetWall(cmd.x, cmd.y, cmd.open); break;
      case "setFood":       this._applySetFood(cmd.x, cmd.y, cmd.amount); break;
      case "setParam":      this.params = { ...this.params, [cmd.key]: cmd.value }; break;
      case "setCautionary": this.params = { ...this.params, cautionary: cmd.value }; break;
      case "setAntCount":   this.setAntCount(cmd.n); break;
      case "setManualAnt":  this._applySetManualAnt(cmd.index); break;
      case "moveManualAnt": this._applyMoveManualAnt(cmd.dx, cmd.dy); break;
    }
  }

  private _applySetWall(gx: number, gy: number, open: boolean) {
    if (gx < 0 || gx >= COLS || gy < 0 || gy >= ROWS) return;
    if (this.colonies.some(c => c.nestX === gx && c.nestY === gy)) return;
    if (this.foodSources.some(s => s.x === gx && s.y === gy)) return;
    this.grid[gy][gx] = open ? 1 : 0;
    this.gridVersion++;
    if (!open) {
      for (const colony of this.colonies) {
        for (const ant of colony.ants) {
          if (ant.tx === gx && ant.ty === gy) { ant.tx = ant.cx; ant.ty = ant.cy; }
        }
      }
    }
  }

  private _applySetFood(gx: number, gy: number, amount: number) {
    if (gx < 0 || gx >= COLS || gy < 0 || gy >= ROWS) return;
    if (this.grid[gy][gx] === 0) return;
    if (this.colonies.some(c => c.nestX === gx && c.nestY === gy)) return;

    const srcIdx = this.foodSources.findIndex(s => s.x === gx && s.y === gy);
    if (amount <= 0) {
      if (srcIdx < 0) return;
      this.foodSources.splice(srcIdx, 1);
      for (const colony of this.colonies) {
        const updated = new Set<number>();
        for (const idx of colony.discoveredSources) {
          if (idx === srcIdx) continue;
          updated.add(idx > srcIdx ? idx - 1 : idx);
        }
        colony.discoveredSources = updated;
      }
      return;
    }
    if (srcIdx >= 0) {
      this.foodSources[srcIdx].remaining = amount;
      this.foodSources[srcIdx].total = amount;
      return;
    }
    this.foodSources.push({ x: gx, y: gy, remaining: amount, total: amount });
  }

  private _applySetManualAnt(index: number | null) {
    const all = this.allAnts;
    for (const ant of all) ant.manual = false;
    this.manualAntIndex = null;
    if (index === null) return;
    const ant = all[index];
    if (!ant) return;
    ant.manual = true;
    this.manualAntIndex = index;
  }

  private _applyMoveManualAnt(dx: number, dy: number) {
    if (this.manualAntIndex === null) return;
    const ant = this.allAnts[this.manualAntIndex];
    if (!ant) return;
    const nx = ant.cx + dx, ny = ant.cy + dy;
    if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) return;
    if (this.grid[ny][nx] !== 1) return;
    ant.prevCx = ant.cx;
    ant.prevCy = ant.cy;
    ant.tx = nx;
    ant.ty = ny;
  }

  step() {
    this.tick++;
    this._runCommandsFor(this.tick);

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

    if (this.tick % FINGERPRINT_INTERVAL === 0) {
      this.fingerprints.push({ t: this.tick, h: fingerprint(this) });
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
    ant.stepsSinceNest++;

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
          ant.lastSourceX = src.x;
          ant.lastSourceY = src.y;
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
      if (ant.lastSourceX !== null && ant.lastSourceY !== null) {
        colony.recentTrips.push({ steps: ant.stepsSinceNest, sx: ant.lastSourceX, sy: ant.lastSourceY });
        if (colony.recentTrips.length > TRIP_WINDOW) colony.recentTrips.shift();
      }
      ant.stepsSinceNest = 0;
      ant.lastSourceX = null;
      ant.lastSourceY = null;
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
    // An edit can seal every exit from a cell an ant is standing in, which
    // applySetWall permits: it refuses only nest and food cells. The ant waits
    // where it is until something opens up. The server simulation has always
    // had this guard; the client did not, and powerChoice returns undefined on
    // an empty list.
    if (candidates.length === 0) return;

    const phero = ant.state === "searching" ? colony.foodPhero : colony.homePhero;
    const next = powerChoice(
      candidates, phero, trailPower, this.antsRng,
      this.params.cautionary ? colony.cautPhero : undefined, trailPower,
    );

    ant.prevCx = ant.cx; ant.prevCy = ant.cy;
    ant.tx = next[0]; ant.ty = next[1];
  }
}
