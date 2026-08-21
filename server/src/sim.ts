// ─────────────────────────────────────────────────────────────────────────────
// Infinite-world ant simulation engine (server side, authoritative).
// Chunked sparse pheromone fields over an unbounded grid.
// ─────────────────────────────────────────────────────────────────────────────

import {
  CELL,
  CHUNK_SIZE,
  COLONY_COLORS,
  DEFAULT_COLONY_PARAMS,
  type ColonyInfo,
  type ColonyParams,
  type FoodSourceWire,
} from "../../shared/infinite-contract";

const CELL_PX = CELL;

const NEST_SEED = 1000;
const DEPOSIT_RATE = 20;
const V = 4;
const ARRIVE_THRESH = V + 1;

// At 50 simulation steps per second, an unfed ant has about 90 seconds to
// discover food and return it to the nest.
export const ENERGY_MAX = 4_500;

type AntState = "searching" | "returning";

export interface FoodSource extends FoodSourceWire {}

export interface DeadColony {
  id: number;
  name: string;
  lifespanTicks: number;
}

export interface PersistedColony {
  id: number;
  nestX: number;
  nestY: number;
  params: ColonyParams;
  foodCollected: number;
  ageTicks: number;
}

export interface PersistedWorld {
  version: 1;
  nextColonyId: number;
  walls: string[];
  colonies: PersistedColony[];
  foodSources: FoodSourceWire[];
}

interface PheroChunk {
  home: Float32Array;
  food: Float32Array;
  caut: Float32Array;
}

function chunkCoord(worldVal: number): number {
  return Math.floor(worldVal / CHUNK_SIZE);
}
function localCoord(worldVal: number): number {
  return ((worldVal % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
}
function chunkKey(cx: number, cy: number): string {
  return `${cx},${cy}`;
}

class InfiniteColony implements ColonyInfo {
  id: number;
  nestX: number;
  nestY: number;
  params: ColonyParams;
  foodCollected = 0;
  bornAtTick: number;
  discoveredSources: Set<string> = new Set(); // "x,y" coordinate keys
  pheroChunks: Map<string, PheroChunk> = new Map();
  recentlyClearedChunks: string[] = []; // chunks deleted since last phero broadcast
  ants: Ant[] = [];

  constructor(id: number, nestX: number, nestY: number, params: ColonyParams, bornAtTick: number) {
    this.id = id;
    this.nestX = nestX;
    this.nestY = nestY;
    this.params = params;
    this.bornAtTick = bornAtTick;
  }

  private getOrCreate(cx: number, cy: number): PheroChunk {
    const key = chunkKey(cx, cy);
    let c = this.pheroChunks.get(key);
    if (!c) {
      const sz = CHUNK_SIZE * CHUNK_SIZE;
      c = { home: new Float32Array(sz), food: new Float32Array(sz), caut: new Float32Array(sz) };
      this.pheroChunks.set(key, c);
    }
    return c;
  }

  getAt(type: "home" | "food" | "caut", x: number, y: number): number {
    const chunk = this.pheroChunks.get(chunkKey(chunkCoord(x), chunkCoord(y)));
    if (!chunk) return 0;
    return chunk[type][localCoord(y) * CHUNK_SIZE + localCoord(x)];
  }

  addAt(type: "home" | "food" | "caut", x: number, y: number, amount: number) {
    const chunk = this.getOrCreate(chunkCoord(x), chunkCoord(y));
    chunk[type][localCoord(y) * CHUNK_SIZE + localCoord(x)] += amount;
  }

  setAt(type: "home" | "food" | "caut", x: number, y: number, value: number) {
    const chunk = this.getOrCreate(chunkCoord(x), chunkCoord(y));
    chunk[type][localCoord(y) * CHUNK_SIZE + localCoord(x)] = value;
  }

  maxAt(type: "home" | "food" | "caut", x: number, y: number, value: number) {
    const chunk = this.getOrCreate(chunkCoord(x), chunkCoord(y));
    const idx = localCoord(y) * CHUNK_SIZE + localCoord(x);
    if (value > chunk[type][idx]) chunk[type][idx] = value;
  }

  decayAll(factor: number) {
    const toDelete: string[] = [];
    for (const [key, chunk] of this.pheroChunks) {
      let sig = false;
      for (let i = 0; i < chunk.home.length; i++) {
        chunk.home[i] *= factor;
        chunk.food[i] *= factor;
        chunk.caut[i] *= factor;
        if (chunk.home[i] > 0.05 || chunk.food[i] > 0.05) sig = true;
      }
      if (!sig) toDelete.push(key);
    }
    for (const k of toDelete) {
      this.pheroChunks.delete(k);
      this.recentlyClearedChunks.push(k); // tell clients to erase this chunk
    }
  }

  info(): ColonyInfo {
    return { id: this.id, nestX: this.nestX, nestY: this.nestY, params: this.params, foodCollected: this.foodCollected };
  }
}

interface Ant {
  wx: number; wy: number;   // pixel position in world space
  cx: number; cy: number;   // current cell
  tx: number; ty: number;   // target cell
  prevCx: number; prevCy: number;
  state: AntState;
  hasFood: boolean;
  tank: number;
  colonyId: number;
  energy: number;           // starvation counter; resets on food delivery
}

const DIRS4: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

function cellCenter(cx: number, cy: number) {
  return { px: cx * CELL_PX + CELL_PX / 2, py: cy * CELL_PX + CELL_PX / 2 };
}

function openNeighbours(
  walls: Set<string>,
  x: number,
  y: number,
  exX?: number,
  exY?: number,
): [number, number][] {
  return DIRS4
    .map(([dx, dy]) => [x + dx, y + dy] as [number, number])
    .filter(([nx, ny]) => !walls.has(`${nx},${ny}`) && !(nx === exX && ny === exY));
}

function powerChoice(
  cells: [number, number][],
  colony: InfiniteColony,
  pheroType: "home" | "food",
  power: number,
  cautionary: boolean,
): [number, number] {
  const scores = cells.map(([cx, cy]) => {
    const trail = Math.pow(colony.getAt(pheroType, cx, cy) + 1, power);
    const caution = cautionary ? Math.pow(colony.getAt("caut", cx, cy) + 1, power) : 1;
    return trail / caution;
  });
  const total = scores.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < cells.length; i++) {
    r -= scores[i];
    if (r <= 0) return cells[i];
  }
  return cells[cells.length - 1];
}

export class InfiniteSimulation {
  walls: Set<string> = new Set();   // "x,y" for wall cells; default = open
  colonies: InfiniteColony[] = [];
  foodSources: FoodSource[] = [];
  tick = 0;
  private nextColonyId = 0;

  isOpen(x: number, y: number): boolean {
    return !this.walls.has(`${x},${y}`);
  }

  toggleWall(x: number, y: number) {
    // Cannot wall-off a nest
    if (this.colonies.some(c => c.nestX === x && c.nestY === y)) return;
    const key = `${x},${y}`;
    if (this.walls.has(key)) this.walls.delete(key);
    else this.walls.add(key);
  }

  setWall(x: number, y: number, isWall: boolean) {
    if (this.colonies.some(c => c.nestX === x && c.nestY === y)) return;
    const key = `${x},${y}`;
    if (isWall) this.walls.add(key);
    else this.walls.delete(key);
  }

  addColony(nestX: number, nestY: number, params: Partial<ColonyParams> = {}): InfiniteColony {
    const id = this.nextColonyId++;
    const fullParams: ColonyParams = {
      ...DEFAULT_COLONY_PARAMS,
      ...params,
      colorIdx: id % COLONY_COLORS.length,
      name: params.name ?? `Colony ${id + 1}`,
    };
    return this._createColony(id, nestX, nestY, fullParams, this.tick, 0);
  }

  restoreColony(data: PersistedColony): InfiniteColony {
    if (this.colonies.some(colony => colony.id === data.id)) {
      throw new Error(`Duplicate persisted colony id: ${data.id}`);
    }
    this.nextColonyId = Math.max(this.nextColonyId, data.id + 1);
    return this._createColony(
      data.id,
      data.nestX,
      data.nestY,
      { ...DEFAULT_COLONY_PARAMS, ...data.params },
      this.tick - Math.max(0, data.ageTicks),
      Math.max(0, data.foodCollected),
    );
  }

  restoreNextColonyId(nextColonyId: number) {
    if (!Number.isSafeInteger(nextColonyId) || nextColonyId < 0) {
      throw new Error(`Invalid persisted next colony id: ${nextColonyId}`);
    }
    this.nextColonyId = Math.max(this.nextColonyId, nextColonyId);
  }

  restorePersistence(data: PersistedWorld) {
    for (const wall of data.walls) this.walls.add(wall);
    for (const colony of data.colonies) this.restoreColony(colony);
    this.restoreNextColonyId(data.nextColonyId);
    for (const food of data.foodSources) {
      if (food.remaining <= 0) continue;
      const source = this.addFood(food.x, food.y, food.remaining);
      source.total = Math.max(source.remaining, food.total);
    }
  }

  private _createColony(
    id: number,
    nestX: number,
    nestY: number,
    params: ColonyParams,
    bornAtTick: number,
    foodCollected: number,
  ): InfiniteColony {
    // Restored ants intentionally start fresh at their durable nest.
    this.walls.delete(`${nestX},${nestY}`);
    const colony = new InfiniteColony(id, nestX, nestY, params, bornAtTick);
    colony.foodCollected = foodCollected;
    this._seedNest(colony);

    const { px, py } = cellCenter(nestX, nestY);
    for (let i = 0; i < params.numAnts; i++) {
      colony.ants.push({
        wx: px, wy: py,
        cx: nestX, cy: nestY,
        tx: nestX, ty: nestY,
        prevCx: nestX, prevCy: nestY,
        state: "searching",
        hasFood: false,
        tank: params.tankMax,
        colonyId: id,
        energy: ENERGY_MAX,
      });
    }
    this.colonies.push(colony);
    return colony;
  }

  removeColony(id: number) {
    const idx = this.colonies.findIndex(c => c.id === id);
    if (idx >= 0) this.colonies.splice(idx, 1);
  }

  addFood(x: number, y: number, units: number): FoodSource {
    // Ensure food cell is open
    this.walls.delete(`${x},${y}`);
    const existing = this.foodSources.find(s => s.x === x && s.y === y);
    if (existing) {
      existing.remaining += units;
      existing.total += units;
      return existing;
    }
    const src: FoodSource = { x, y, remaining: units, total: units };
    this.foodSources.push(src);
    return src;
  }

  removeFood(x: number, y: number): boolean {
    const idx = this.foodSources.findIndex(s => s.x === x && s.y === y);
    if (idx < 0) return false;
    this.foodSources.splice(idx, 1);
    return true;
  }

  step(): DeadColony[] {
    this.tick++;
    const dead: DeadColony[] = [];

    for (const colony of this.colonies) {
      colony.decayAll(1 - colony.params.evapRate);
      this._seedNest(colony);

      // Re-seed discovered food sources
      for (const key of colony.discoveredSources) {
        const src = this.foodSources.find(s => `${s.x},${s.y}` === key);
        if (src) colony.setAt("food", src.x, src.y, NEST_SEED);
      }

      for (const ant of colony.ants) this._moveAnt(ant, colony);

      // Remove starved ants
      colony.ants = colony.ants.filter(a => a.energy > 0);

      // Detect colony death
      if (colony.ants.length === 0) {
        dead.push({ id: colony.id, name: colony.params.name, lifespanTicks: this.tick - colony.bornAtTick });
      }
    }

    // Remove dead colonies
    if (dead.length > 0) {
      const deadIds = new Set(dead.map(d => d.id));
      this.colonies = this.colonies.filter(c => !deadIds.has(c.id));
    }

    return dead;
  }

  private _seedNest(colony: InfiniteColony) {
    colony.setAt("home", colony.nestX, colony.nestY, NEST_SEED);
    for (const [dx, dy] of DIRS4) {
      const nx = colony.nestX + dx, ny = colony.nestY + dy;
      if (this.isOpen(nx, ny)) {
        colony.maxAt("home", nx, ny, NEST_SEED * 0.85);
      }
    }
  }

  private _moveAnt(ant: Ant, colony: InfiniteColony) {
    // Drain energy every step
    ant.energy--;

    const { params } = colony;
    const { px: tpx, py: tpy } = cellCenter(ant.tx, ant.ty);
    const dx = tpx - ant.wx, dy = tpy - ant.wy;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > ARRIVE_THRESH) {
      if (ant.tank > 0) {
        const deposit = Math.min(ant.tank, DEPOSIT_RATE);
        if (ant.state === "searching") colony.addAt("home", ant.cx, ant.cy, deposit);
        else colony.addAt("food", ant.cx, ant.cy, deposit);
        ant.tank -= deposit;
      } else if (params.cautionary) {
        colony.addAt("caut", ant.cx, ant.cy, DEPOSIT_RATE);
      }
      const scale = V / dist;
      ant.wx += dx * scale;
      ant.wy += dy * scale;
      return;
    }

    ant.wx = tpx; ant.wy = tpy;
    ant.cx = ant.tx; ant.cy = ant.ty;

    if (ant.state === "searching") {
      const srcIdx = this.foodSources.findIndex(s => s.x === ant.cx && s.y === ant.cy && s.remaining > 0);
      if (srcIdx >= 0) {
        const src = this.foodSources[srcIdx];
        colony.discoveredSources.add(`${src.x},${src.y}`);
        src.remaining--;
        if (src.remaining <= 0) {
          this.foodSources.splice(srcIdx, 1);
          for (const c of this.colonies) c.discoveredSources.delete(`${src.x},${src.y}`);
        } else {
          colony.setAt("food", src.x, src.y, NEST_SEED);
        }
        ant.state = "returning";
        ant.hasFood = true;
        ant.tank = params.tankMax;
        const [ntx, nty] = [ant.prevCx, ant.prevCy];
        ant.prevCx = ant.cx; ant.prevCy = ant.cy;
        ant.tx = ntx; ant.ty = nty;
        return;
      }
    }

    if (ant.state === "returning" && ant.cx === colony.nestX && ant.cy === colony.nestY) {
      ant.state = "searching";
      ant.hasFood = false;
      ant.tank = params.tankMax;
      ant.energy = ENERGY_MAX; // fed at the nest
      colony.foodCollected++;
      const [ntx, nty] = [ant.prevCx, ant.prevCy];
      ant.prevCx = ant.cx; ant.prevCy = ant.cy;
      ant.tx = ntx; ant.ty = nty;
      return;
    }

    const noBack = openNeighbours(this.walls, ant.cx, ant.cy, ant.prevCx, ant.prevCy);
    const candidates = noBack.length > 0 ? noBack : openNeighbours(this.walls, ant.cx, ant.cy);
    if (candidates.length === 0) return;

    const pheroType: "home" | "food" = ant.state === "searching" ? "food" : "home";
    const next = powerChoice(candidates, colony, pheroType, params.trailPower, params.cautionary);
    ant.prevCx = ant.cx; ant.prevCy = ant.cy;
    ant.tx = next[0]; ant.ty = next[1];
  }

  // ── Serialization ──────────────────────────────────────────────────────────

  serializeInit() {
    return {
      walls: Array.from(this.walls),
      colonies: this.colonies.map(c => c.info()),
      foodSources: this.foodSources.map(s => ({ x: s.x, y: s.y, remaining: s.remaining, total: s.total })),
    };
  }

  serializePersistence(): PersistedWorld {
    return {
      version: 1,
      nextColonyId: this.nextColonyId,
      walls: Array.from(this.walls),
      colonies: this.colonies.map(colony => ({
        ...colony.info(),
        ageTicks: Math.max(0, this.tick - colony.bornAtTick),
      })),
      foodSources: this.foodSources.map(source => ({
        x: source.x,
        y: source.y,
        remaining: source.remaining,
        total: source.total,
      })),
    };
  }

  serializeTick() {
    return {
      ants: this.colonies.flatMap(c =>
        c.ants.map(a => ({
          cid: a.colonyId,
          wx: Math.round(a.wx),
          wy: Math.round(a.wy),
          f: a.hasFood ? 1 : 0,
        }))
      ),
      foodSources: this.foodSources.map(s => ({ x: s.x, y: s.y, r: s.remaining, t: s.total })),
      fc: this.colonies.map(c => ({
        id: c.id,
        n: c.foodCollected,
        ageTicks: Math.max(0, this.tick - c.bornAtTick),
      })),
    };
  }

  serializePhero() {
    return this.colonies.map(colony => {
      // Drain cleared list — client must erase these chunks
      const cleared = colony.recentlyClearedChunks.splice(0);

      const chunks: { key: string; home: number[]; food: number[] }[] = [];
      for (const [key, chunk] of colony.pheroChunks) {
        let maxH = 0, maxF = 0;
        for (let i = 0; i < chunk.home.length; i++) {
          if (chunk.home[i] > maxH) maxH = chunk.home[i];
          if (chunk.food[i] > maxF) maxF = chunk.food[i];
        }
        if (maxH < 0.1 && maxF < 0.1) continue;

        // Absolute scaling: NEST_SEED (1000) → 255, so pheromone strength
        // is visually proportional to absolute level, not per-chunk max.
        const n = CHUNK_SIZE * CHUNK_SIZE;
        const home = new Array<number>(n);
        const food = new Array<number>(n);
        for (let i = 0; i < n; i++) {
          home[i] = Math.min(255, Math.round((chunk.home[i] / NEST_SEED) * 255));
          food[i] = Math.min(255, Math.round((chunk.food[i] / NEST_SEED) * 255));
        }
        chunks.push({ key, home, food });
      }
      return { id: colony.id, chunks, cleared };
    });
  }
}
