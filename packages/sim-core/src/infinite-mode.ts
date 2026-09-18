import {
  ARRIVE_THRESH,
  CELL,
  DEPOSIT_RATE,
  DIRS4,
  NEST_HALO,
  ODOR_LEVEL,
  V,
} from "./constants";
import { ChunkedField } from "./chunked-field";
import { defineMode } from "./sdk";
import { makeRng } from "./rng";
import type { Channel, ModeConfigResult } from "./types";

export const INFINITE_MODE_ID = "infinite";
export const INFINITE_MODE_VERSION = 1;
export const INFINITE_ENERGY_MAX = 4_500;
const INFINITE_BEACON_LEVEL = ODOR_LEVEL;

export interface InfiniteColonyParams {
  numAnts: number;
  evapRate: number;
  trailPower: number;
  tankMax: number;
  cautionary: boolean;
  colorIdx: number;
  name: string;
}

export const DEFAULT_INFINITE_COLONY_PARAMS: InfiniteColonyParams = {
  numAnts: 20,
  evapRate: 0.005,
  trailPower: 5,
  tankMax: 6400,
  cautionary: false,
  colorIdx: 0,
  name: "Colony",
};

export interface InfiniteColonyInfo {
  id: number;
  nestX: number;
  nestY: number;
  params: InfiniteColonyParams;
  foodCollected: number;
}

export interface InfiniteFoodSource {
  x: number;
  y: number;
  remaining: number;
  total: number;
}

export interface InfiniteDeadColony {
  id: number;
  name: string;
  lifespanTicks: number;
}

export interface InfinitePersistedColony {
  id: number;
  nestX: number;
  nestY: number;
  params: InfiniteColonyParams;
  foodCollected: number;
  ageTicks: number;
}

export interface InfinitePersistedWorld {
  version: 1;
  nextColonyId: number;
  walls: string[];
  colonies: InfinitePersistedColony[];
  foodSources: InfiniteFoodSource[];
}

export interface InfiniteAnt {
  wx: number;
  wy: number;
  cx: number;
  cy: number;
  tx: number;
  ty: number;
  prevCx: number;
  prevCy: number;
  state: "searching" | "returning";
  hasFood: boolean;
  tank: number;
  colonyId: number;
  energy: number;
}

export interface InfiniteModeConfig {
  /** Null preserves the legacy server's Math.random stream. */
  randomSeed: string | null;
  colorCount: number;
}

export class InfiniteColony implements InfiniteColonyInfo {
  foodCollected = 0;
  readonly discoveredSources = new Set<string>();
  readonly recentlyClearedChunks = new Set<string>();
  ants: InfiniteAnt[] = [];
  private readonly field = new ChunkedField();

  constructor(
    readonly id: number,
    readonly nestX: number,
    readonly nestY: number,
    readonly params: InfiniteColonyParams,
    readonly bornAtTick: number,
  ) {}

  getAt(type: Channel, x: number, y: number): number {
    return this.field.get(type, x, y);
  }

  addAt(type: Channel, x: number, y: number, amount: number): void {
    this.field.add(type, x, y, amount);
  }

  setAt(type: Channel, x: number, y: number, value: number): void {
    this.field.set(type, x, y, value);
  }

  maxAt(type: Channel, x: number, y: number, value: number): void {
    this.field.max(type, x, y, value);
  }

  decayAll(factor: number): void {
    this.field.decay(factor);
    for (const key of this.field.drainEvicted()) this.recentlyClearedChunks.add(key);
  }

  takeClearedChunks(): string[] {
    const keys = [...this.recentlyClearedChunks];
    this.recentlyClearedChunks.clear();
    return keys;
  }

  info(): InfiniteColonyInfo {
    return {
      id: this.id,
      nestX: this.nestX,
      nestY: this.nestY,
      params: this.params,
      foodCollected: this.foodCollected,
    };
  }

  chunks() {
    return this.field.chunkEntries();
  }
}

function cellCenter(cx: number, cy: number) {
  return { px: cx * CELL + CELL / 2, py: cy * CELL + CELL / 2 };
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
  random: () => number,
): [number, number] {
  const scores = cells.map(([cx, cy]) => {
    // Math.pow is intentional compatibility with the legacy, non-replayable
    // server runtime. Seeded Infinite traces can move to deterministicPow only
    // under a new mode behavior version.
    const trail = Math.pow(colony.getAt(pheroType, cx, cy) + 1, power);
    const caution = cautionary ? Math.pow(colony.getAt("caut", cx, cy) + 1, power) : 1;
    return trail / caution;
  });
  const total = scores.reduce((a, b) => a + b, 0);
  let choice = random() * total;
  for (let i = 0; i < cells.length; i++) {
    choice -= scores[i];
    if (choice <= 0) return cells[i];
  }
  return cells[cells.length - 1];
}

export class InfiniteSimulation {
  readonly walls = new Set<string>();
  colonies: InfiniteColony[] = [];
  readonly foodSources: InfiniteFoodSource[] = [];
  tick = 0;
  private nextColonyId = 0;

  constructor(
    private readonly random: () => number = () => Math.random(),
    private readonly colorCount = 8,
  ) {}

  isOpen(x: number, y: number): boolean {
    return !this.walls.has(`${x},${y}`);
  }

  toggleWall(x: number, y: number): void {
    if (this.colonies.some(colony => colony.nestX === x && colony.nestY === y)) return;
    const key = `${x},${y}`;
    if (this.walls.has(key)) this.walls.delete(key);
    else this.walls.add(key);
  }

  setWall(x: number, y: number, isWall: boolean): void {
    if (this.colonies.some(colony => colony.nestX === x && colony.nestY === y)) return;
    const key = `${x},${y}`;
    if (isWall) this.walls.add(key);
    else this.walls.delete(key);
  }

  addColony(
    nestX: number,
    nestY: number,
    params: Partial<InfiniteColonyParams> = {},
  ): InfiniteColony {
    const id = this.nextColonyId++;
    const fullParams: InfiniteColonyParams = {
      ...DEFAULT_INFINITE_COLONY_PARAMS,
      ...params,
      colorIdx: id % this.colorCount,
      name: params.name ?? `Colony ${id + 1}`,
    };
    return this.createColony(id, nestX, nestY, fullParams, this.tick, 0);
  }

  restoreColony(data: InfinitePersistedColony): InfiniteColony {
    if (this.colonies.some(colony => colony.id === data.id)) {
      throw new Error(`Duplicate persisted colony id: ${data.id}`);
    }
    this.nextColonyId = Math.max(this.nextColonyId, data.id + 1);
    return this.createColony(
      data.id,
      data.nestX,
      data.nestY,
      { ...DEFAULT_INFINITE_COLONY_PARAMS, ...data.params },
      this.tick - Math.max(0, data.ageTicks),
      Math.max(0, data.foodCollected),
    );
  }

  restoreNextColonyId(nextColonyId: number): void {
    if (!Number.isSafeInteger(nextColonyId) || nextColonyId < 0) {
      throw new Error(`Invalid persisted next colony id: ${nextColonyId}`);
    }
    this.nextColonyId = Math.max(this.nextColonyId, nextColonyId);
  }

  restorePersistence(data: InfinitePersistedWorld): void {
    for (const wall of data.walls) this.walls.add(wall);
    for (const colony of data.colonies) this.restoreColony(colony);
    this.restoreNextColonyId(data.nextColonyId);
    for (const food of data.foodSources) {
      if (food.remaining <= 0) continue;
      const source = this.addFood(food.x, food.y, food.remaining);
      source.total = Math.max(source.remaining, food.total);
    }
  }

  private createColony(
    id: number,
    nestX: number,
    nestY: number,
    params: InfiniteColonyParams,
    bornAtTick: number,
    foodCollected: number,
  ): InfiniteColony {
    this.walls.delete(`${nestX},${nestY}`);
    const colony = new InfiniteColony(id, nestX, nestY, params, bornAtTick);
    colony.foodCollected = foodCollected;
    this.seedNest(colony);

    const { px, py } = cellCenter(nestX, nestY);
    for (let i = 0; i < params.numAnts; i++) {
      colony.ants.push({
        wx: px,
        wy: py,
        cx: nestX,
        cy: nestY,
        tx: nestX,
        ty: nestY,
        prevCx: nestX,
        prevCy: nestY,
        state: "searching",
        hasFood: false,
        tank: params.tankMax,
        colonyId: id,
        energy: INFINITE_ENERGY_MAX,
      });
    }
    this.colonies.push(colony);
    return colony;
  }

  removeColony(id: number): void {
    const index = this.colonies.findIndex(colony => colony.id === id);
    if (index >= 0) this.colonies.splice(index, 1);
  }

  addFood(x: number, y: number, units: number): InfiniteFoodSource {
    this.walls.delete(`${x},${y}`);
    const existing = this.foodSources.find(source => source.x === x && source.y === y);
    if (existing) {
      existing.remaining += units;
      existing.total += units;
      return existing;
    }
    const source = { x, y, remaining: units, total: units };
    this.foodSources.push(source);
    return source;
  }

  removeFood(x: number, y: number): boolean {
    const index = this.foodSources.findIndex(source => source.x === x && source.y === y);
    if (index < 0) return false;
    this.foodSources.splice(index, 1);
    return true;
  }

  step(): InfiniteDeadColony[] {
    this.tick++;
    const dead: InfiniteDeadColony[] = [];
    for (const colony of this.colonies) {
      colony.decayAll(1 - colony.params.evapRate);
      this.seedNest(colony);
      for (const key of colony.discoveredSources) {
        const source = this.foodSources.find(food => `${food.x},${food.y}` === key);
        if (source) colony.setAt("food", source.x, source.y, INFINITE_BEACON_LEVEL);
      }
      for (const ant of colony.ants) this.moveAnt(ant, colony);
      colony.ants = colony.ants.filter(ant => ant.energy > 0);
      if (colony.ants.length === 0) {
        dead.push({
          id: colony.id,
          name: colony.params.name,
          lifespanTicks: this.tick - colony.bornAtTick,
        });
      }
    }
    if (dead.length > 0) {
      const deadIds = new Set(dead.map(colony => colony.id));
      this.colonies = this.colonies.filter(colony => !deadIds.has(colony.id));
    }
    return dead;
  }

  private seedNest(colony: InfiniteColony): void {
    colony.setAt("home", colony.nestX, colony.nestY, INFINITE_BEACON_LEVEL);
    for (const [dx, dy] of DIRS4) {
      const x = colony.nestX + dx;
      const y = colony.nestY + dy;
      if (this.isOpen(x, y)) {
        colony.maxAt("home", x, y, INFINITE_BEACON_LEVEL * NEST_HALO);
      }
    }
  }

  private moveAnt(ant: InfiniteAnt, colony: InfiniteColony): void {
    ant.energy--;
    const { params } = colony;
    const { px: targetX, py: targetY } = cellCenter(ant.tx, ant.ty);
    const dx = targetX - ant.wx;
    const dy = targetY - ant.wy;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance > ARRIVE_THRESH) {
      if (ant.tank > 0) {
        const deposit = Math.min(ant.tank, DEPOSIT_RATE);
        if (ant.state === "searching") colony.addAt("home", ant.cx, ant.cy, deposit);
        else colony.addAt("food", ant.cx, ant.cy, deposit);
        ant.tank -= deposit;
      } else if (params.cautionary) {
        colony.addAt("caut", ant.cx, ant.cy, DEPOSIT_RATE);
      }
      const scale = V / distance;
      ant.wx += dx * scale;
      ant.wy += dy * scale;
      return;
    }

    ant.wx = targetX;
    ant.wy = targetY;
    ant.cx = ant.tx;
    ant.cy = ant.ty;

    if (ant.state === "searching") {
      const sourceIndex = this.foodSources.findIndex(source =>
        source.x === ant.cx && source.y === ant.cy && source.remaining > 0
      );
      if (sourceIndex >= 0) {
        const source = this.foodSources[sourceIndex];
        const sourceKey = `${source.x},${source.y}`;
        colony.discoveredSources.add(sourceKey);
        source.remaining--;
        if (source.remaining <= 0) {
          this.foodSources.splice(sourceIndex, 1);
          for (const other of this.colonies) other.discoveredSources.delete(sourceKey);
        } else {
          colony.setAt("food", source.x, source.y, INFINITE_BEACON_LEVEL);
        }
        ant.state = "returning";
        ant.hasFood = true;
        ant.tank = params.tankMax;
        const [nextX, nextY] = [ant.prevCx, ant.prevCy];
        ant.prevCx = ant.cx;
        ant.prevCy = ant.cy;
        ant.tx = nextX;
        ant.ty = nextY;
        return;
      }
    }

    if (ant.state === "returning" && ant.cx === colony.nestX && ant.cy === colony.nestY) {
      ant.state = "searching";
      ant.hasFood = false;
      ant.tank = params.tankMax;
      ant.energy = INFINITE_ENERGY_MAX;
      colony.foodCollected++;
      const [nextX, nextY] = [ant.prevCx, ant.prevCy];
      ant.prevCx = ant.cx;
      ant.prevCy = ant.cy;
      ant.tx = nextX;
      ant.ty = nextY;
      return;
    }

    const noBack = openNeighbours(this.walls, ant.cx, ant.cy, ant.prevCx, ant.prevCy);
    const candidates = noBack.length > 0
      ? noBack
      : openNeighbours(this.walls, ant.cx, ant.cy);
    if (candidates.length === 0) return;
    const pheroType = ant.state === "searching" ? "food" : "home";
    const next = powerChoice(
      candidates,
      colony,
      pheroType,
      params.trailPower,
      params.cautionary,
      this.random,
    );
    ant.prevCx = ant.cx;
    ant.prevCy = ant.cy;
    ant.tx = next[0];
    ant.ty = next[1];
  }

  serializeInit() {
    return {
      walls: [...this.walls],
      colonies: this.colonies.map(colony => colony.info()),
      foodSources: this.foodSources.map(source => ({ ...source })),
    };
  }

  serializePersistence(): InfinitePersistedWorld {
    return {
      version: 1,
      nextColonyId: this.nextColonyId,
      walls: [...this.walls],
      colonies: this.colonies.map(colony => ({
        ...colony.info(),
        ageTicks: Math.max(0, this.tick - colony.bornAtTick),
      })),
      foodSources: this.foodSources.map(source => ({ ...source })),
    };
  }

  serializeTick() {
    return {
      ants: this.colonies.flatMap(colony => colony.ants.map(ant => ({
        cid: ant.colonyId,
        wx: Math.round(ant.wx),
        wy: Math.round(ant.wy),
        f: ant.hasFood ? 1 : 0,
      }))),
      foodSources: this.foodSources.map(source => ({
        x: source.x,
        y: source.y,
        r: source.remaining,
        t: source.total,
      })),
      fc: this.colonies.map(colony => ({
        id: colony.id,
        n: colony.foodCollected,
        ageTicks: Math.max(0, this.tick - colony.bornAtTick),
      })),
    };
  }

  dropPheroBookkeeping(): void {
    for (const colony of this.colonies) colony.recentlyClearedChunks.clear();
  }

  serializePhero() {
    return this.colonies.map(colony => {
      const cleared = colony.takeClearedChunks();
      const chunks: { key: string; home: number[]; food: number[] }[] = [];
      for (const chunk of colony.chunks()) {
        let maxHome = 0;
        let maxFood = 0;
        for (let i = 0; i < chunk.home.length; i++) {
          if (chunk.home[i] > maxHome) maxHome = chunk.home[i];
          if (chunk.food[i] > maxFood) maxFood = chunk.food[i];
        }
        if (maxHome < 0.1 && maxFood < 0.1) continue;
        const home = new Array<number>(chunk.home.length);
        const food = new Array<number>(chunk.food.length);
        for (let i = 0; i < chunk.home.length; i++) {
          home[i] = Math.min(255, Math.round(chunk.home[i] / INFINITE_BEACON_LEVEL * 255));
          food[i] = Math.min(255, Math.round(chunk.food[i] / INFINITE_BEACON_LEVEL * 255));
        }
        chunks.push({ key: chunk.key, home, food });
      }
      return { id: colony.id, chunks, cleared };
    });
  }
}

export function parseInfiniteModeConfig(value: unknown): ModeConfigResult<InfiniteModeConfig> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, error: "Infinite mode config must be an object." };
  }
  const config = value as Record<string, unknown>;
  if (config.randomSeed !== null &&
      (typeof config.randomSeed !== "string" || config.randomSeed.length < 1 ||
       config.randomSeed.length > 200)) {
    return { ok: false, error: "Infinite mode config has an invalid random seed." };
  }
  if (!Number.isSafeInteger(config.colorCount) || (config.colorCount as number) < 1 ||
      (config.colorCount as number) > 256) {
    return { ok: false, error: "Infinite mode config has an invalid color count." };
  }
  return {
    ok: true,
    value: { randomSeed: config.randomSeed, colorCount: config.colorCount as number },
  };
}

export const infiniteMode = defineMode({
  id: INFINITE_MODE_ID,
  version: INFINITE_MODE_VERSION,
  parseConfig: parseInfiniteModeConfig,
  create: (config: InfiniteModeConfig) => new InfiniteSimulation(
    config.randomSeed === null ? () => Math.random() : makeRng(config.randomSeed),
    config.colorCount,
  ),
});
