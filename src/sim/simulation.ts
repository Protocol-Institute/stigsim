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
  COLONY_NESTS,
  COLS,
  CELL,
  DEPOSIT_PER_PX,
  NEST_SEED,
  ROWS,
  SENSOR_ANGLE,
  SENSOR_DIST,
  TURN_RATE,
  V,
  WANDER,
} from "./constants";
import { normalizeAngle, sampleField, splatDeposit } from "./field";
import { Facing, Terrain, TerrainLayer } from "./terrain";
import { generateWorld, type CellType, type WorldKind } from "./world";

export type { CellType, WorldKind } from "./world";

export interface SimParams {
  evapRate: number;
  trailPower: number;
  tankMax: number;
  cautionary: boolean;
  /** How far ahead an ant can smell, in pixels. */
  sensorDist: number;
  /** Angle of the outer antennae either side of the heading, radians. */
  sensorAngle: number;
  /**
   * Total food units the world sustains, when food replenishes.
   *
   * This is the only food quantity worth setting for a living world: how many
   * separate piles that total is broken into, and how big each one is, is the
   * world's business and comes out random.
   */
  foodCapacity: number;
  /**
   * Whether eaten food grows back.
   *
   * On, the world holds itself at `foodCapacity` and the run lasts as long as
   * you let it. Off, that same total is laid out once as `numFoodSources` piles
   * of `foodPerSource`, and the run ends when they are gone — which is the
   * cleaner comparison between two settings.
   */
  replenish: boolean;
}

export const DEFAULT_PARAMS: SimParams = {
  evapRate: 0.005,
  trailPower: 5,
  // Sized against the room, not the old maze: a gland has to outlast a search
  // and the walk home, and this floor is 96 cells across.
  tankMax: 25_600,
  cautionary: false,
  sensorDist: SENSOR_DIST,
  sensorAngle: SENSOR_ANGLE,
  foodCapacity: 3_000,
  // On by default now the worlds are places rather than test rigs: a fixed
  // larder in a room this size is eaten long before a trail network forms.
  // Growth draws from the seeded stream, so runs stay reproducible either way.
  replenish: true,
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
 * Size piles against the total the world sustains.
 *
 * Pile size is a band rather than a number, so a total breaks into a random
 * number of random-sized piles instead of a tidy grid of identical ones. The
 * band is a fraction of the total so it scales: a small total gives a few small
 * piles, a large one gives many. A fixed minimum larger than the total would
 * mean headroom never reaches it and nothing would ever grow.
 */
export function foodSpawnConfig(capacityUnits: number): FoodSpawnConfig {
  // Bounded at both ends rather than a flat fraction. A pure fraction keeps the
  // pile count fixed and only fattens each pile, so a rich world looked exactly
  // like a poor one with the numbers scaled up. Capping the size means extra
  // food arrives as more patches instead, which is what a richer world is.
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const minUnits = clamp(Math.round(capacityUnits * 0.04), 25, 150);
  const maxUnits = Math.max(minUnits + 1, clamp(Math.round(capacityUnits * 0.15), 80, 600));
  return { ...MAZE_FOOD_SPAWN, capacityUnits, minUnits, maxUnits };
}

// Simulation steps between highway-score samples.
export const HIGHWAY_SAMPLE_EVERY = 15;

export const DEFAULT_NUM_COLONIES = 1;
// Only used when food does not replenish: a room-sized world with one larder
// is over almost as soon as it is found.
export const DEFAULT_NUM_FOOD_SOURCES = 4;
export const DEFAULT_FOOD_PER_SOURCE = 500;

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
  /** Position in pixels. Continuous — an ant is rarely on a cell centre. */
  x: number; y: number;
  /** Direction of travel in radians. */
  heading: number;
  /** The cell the ant is standing in, derived from its position each step. */
  cx: number; cy: number;
  state: AntState;
  hasFood: boolean;
  tank: number;
  colonyId: number;
  manual?: boolean;
}

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

export const cellCenter = (gx: number, gy: number) => ({ px: gx * CELL + CELL / 2, py: gy * CELL + CELL / 2 });

export class Simulation {
  numAnts: number;
  numColonies: number;
  numFoodSources: number;
  foodPerSource: number;
  params: SimParams;
  loopRate: number;
  worldKind: WorldKind;
  /** Cells where food prefers to appear, from the generator. */
  crumbZones: [number, number][];
  grid: CellType[][];
  colonies: Colony[];
  foodSources: FoodSource[];
  seed: string;
  rng: Rng;
  terrain: TerrainLayer;
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
    worldKind: WorldKind = "kitchen",
  ) {
    this.numAnts = numAnts;
    this.params = { ...params };
    this.loopRate = loopRate;
    this.numColonies = numColonies;
    this.numFoodSources = numFoodSources;
    this.foodPerSource = foodPerSource;
    this.seed = seed;
    this.rng = new Rng(seed);
    this.worldKind = worldKind;

    const world = generateWorld(worldKind, COLS, ROWS, this.rng, loopRate);
    this.grid = world.grid;
    this.terrain = world.terrain;
    this.crumbZones = world.crumbZones;
    this._nestSites = world.nests;
    this.colonies = this._initColonies();
    this.foodSources = this._placeFoodSources();
    for (const colony of this.colonies) this._seedNest(colony);
  }

  private _initColonies(): Colony[] {
    return Array.from({ length: this.numColonies }, (_, id) => {
      const [nestX, nestY] = this._nestSites[id] ?? COLONY_NESTS[id % COLONY_NESTS.length];
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
    // Crumbs collect where the generator says they collect — under the table,
    // by the bin, in the windfall. Falling back to open floor keeps the maze
    // working, which has no such places.
    const loam = open.filter(([x, y]) => this.terrain.at(x, y) === Terrain.Loam);
    const preferred = loam.length > 0 ? loam : open;

    // A living world is only told how much food it holds in total. How that
    // total is broken up — how many piles and how big each one — is the
    // world's business, and comes out different every seed.
    if (this.params.replenish) return this._scatterFood(preferred);

    this.rng.shuffle(preferred);
    const count = Math.min(this.numFoodSources, preferred.length);
    const open2 = preferred;
    return open2.slice(0, count).map(([x, y]) => {
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

  private _newAnt(colonyId: number, nestX: number, nestY: number): Ant {
    const { px, py } = cellCenter(nestX, nestY);
    return {
      x: px, y: py,
      // Leave the nest facing anywhere, so a colony fans out instead of
      // marching off as one column.
      heading: this.rng.next() * Math.PI * 2,
      cx: nestX, cy: nestY,
      state: "searching" as AntState,
      hasFood: false,
      tank: this.params.tankMax,
      colonyId,
    };
  }

  private _spawnAnts(colonyId: number, nestX: number, nestY: number): Ant[] {
    return Array.from({ length: this.numAnts }, () => this._newAnt(colonyId, nestX, nestY));
  }

  get allAnts(): Ant[] {
    return this.colonies.flatMap(c => c.ants);
  }

  setAntCount(n: number) {
    for (const colony of this.colonies) {
      const { nestX, nestY } = colony;
      if (n > colony.ants.length) {
        const toAdd = n - colony.ants.length;
        for (let i = 0; i < toAdd; i++) {
          colony.ants.push(this._newAnt(colony.id, nestX, nestY));
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

  /** Every open loam cell, or null when the world has none. */
  loamSites(): { x: number; y: number }[] | null {
    const sites: { x: number; y: number }[] = [];
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        if (this.terrain.at(x, y) === Terrain.Loam && this.grid[y][x] === 1) sites.push({ x, y });
      }
    }
    return sites.length > 0 ? sites : null;
  }

  /** Whether any loam has been painted, which confines food growth to it. */
  get hasLoam(): boolean {
    return this.loamSites() !== null;
  }

  /**
   * Break the world's total into a random number of random-sized piles.
   *
   * Uses the same policy that grows food later, so the world a run starts with
   * looks like a world that has been growing food for a while rather than like
   * a layout someone specified.
   */
  private _scatterFood(sites: [number, number][]): FoodSource[] {
    const config = foodSpawnConfig(this.foodCapacity);
    const spawnSites = sites.map(([x, y]) => ({ x, y }));
    const sources: FoodSource[] = [];

    // Keep planting until the world is full or nowhere is left to plant.
    for (let guard = 0; guard < 200; guard++) {
      const standing = sources.reduce((sum, s) => sum + s.remaining, 0);
      if (standing >= config.capacityUnits - config.minUnits) break;

      const planned = planFoodSpawn(
        {
          standingUnits: standing,
          region: { minX: 1, minY: 1, maxX: COLS - 2, maxY: ROWS - 2 },
          memory: this.foodMemory.entries,
          sites: spawnSites,
          canPlaceAt: (x, y) => !sources.some(s => s.x === x && s.y === y),
        },
        config,
        () => this.rng.next(),
      );
      if (planned.length === 0) break;

      for (const { x, y, units } of planned) {
        sources.push({ x, y, remaining: units, total: units });
        this.foodMemory.remember(x, y);
      }
    }

    return sources;
  }

  /** The total this world sustains, when food replenishes. */
  get foodCapacity(): number {
    return this.params.replenish
      ? this.params.foodCapacity
      : this.numFoodSources * this.foodPerSource;
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
    // Once any loam exists food grows only there, so hand the spawner the list
    // rather than making it find six cells in six thousand by throwing darts.
    const sites = this.loamSites();
    const planned = planFoodSpawn(
      {
        standingUnits: this.standingFoodUnits,
        region: { minX: 1, minY: 1, maxX: COLS - 2, maxY: ROWS - 2 },
        memory: this.foodMemory.entries,
        sites: sites ?? undefined,
        canPlaceAt: (x, y) =>
          this.grid[y][x] === 1 &&
          !this.colonies.some(c => c.nestX === x && c.nestY === y),
      },
      foodSpawnConfig(this.foodCapacity),
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
    // Ground decides how well it remembers. Where nothing has been painted the
    // whole field shares one decay factor, which is both faster and exactly the
    // old behaviour.
    const decay = this._decayFactors();
    for (const colony of this.colonies) {
      if (typeof decay === "number") {
        for (let i = 0; i < colony.homePhero.length; i++) {
          colony.homePhero[i] *= decay;
          colony.foodPhero[i] *= decay;
          colony.cautPhero[i] *= decay;
        }
      } else {
        for (let i = 0; i < colony.homePhero.length; i++) {
          const d = decay[i];
          colony.homePhero[i] *= d;
          colony.foodPhero[i] *= d;
          colony.cautPhero[i] *= d;
        }
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

  /**
   * Per-cell decay multipliers, or a single number when the world is plain.
   *
   * Rebuilt only when the painted terrain changes: this is a per-cell array
   * over the whole grid and recomputing it every step would cost more than the
   * decay it feeds.
   */
  private _decayCache: { evapRate: number; version: number; factors: Float32Array } | null = null;

  private _decayFactors(): number | Float32Array {
    const { evapRate } = this.params;
    if (this.terrain.isEmpty) return 1 - evapRate;

    const version = this.terrainVersion;
    if (this._decayCache?.evapRate !== evapRate || this._decayCache.version !== version) {
      const factors = new Float32Array(COLS * ROWS);
      for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
          // Ground that forgets faster multiplies the rate, not the survivor,
          // and the result is clamped so no surface can drive it negative.
          const rate = Math.min(1, evapRate * this.terrain.props(x, y).evap);
          factors[y * COLS + x] = 1 - rate;
        }
      }
      this._decayCache = { evapRate, version, factors };
    }
    return this._decayCache.factors;
  }

  /** Bumped whenever terrain is painted, to invalidate the decay cache. */
  terrainVersion = 0;

  /** Nest positions offered by the generator, best first. */
  private _nestSites: [number, number][] = [];

  /**
   * Bumped whenever anything the renderer caches changes — terrain or walls.
   * The ground layer is expensive to draw and static between edits.
   */
  worldVersion = 0;

  paintTerrain(cx: number, cy: number, terrain: Terrain, facing: Facing = Facing.East) {
    if (this.terrain.at(cx, cy) === terrain && this.terrain.facingAt(cx, cy) === facing) return;
    this.terrain.set(cx, cy, terrain, facing);
    this.terrainVersion++;
    this.worldVersion++;
  }

  /** Tell the renderer the grid was edited directly. */
  markWorldChanged() {
    this.worldVersion++;
  }

  /** Whether a cell is inside the maze and walkable. */
  isOpen(cx: number, cy: number): boolean {
    return cx >= 0 && cx < COLS && cy >= 0 && cy < ROWS && this.grid[cy][cx] === 1;
  }

  /**
   * Whether a cell may be entered while travelling in direction (dx, dy).
   *
   * Identical to isOpen everywhere except a scarp, which admits movement only
   * in the direction it falls.
   */
  canEnter(cx: number, cy: number, dx: number, dy: number): boolean {
    return this.isOpen(cx, cy) && this.terrain.canCross(cx, cy, dx, dy);
  }

  /** Field value at a point, blended across the cells around it. */
  private _sense(field: Float32Array, px: number, py: number): number {
    return sampleField(px, py, CELL, (cx, cy) =>
      this.isOpen(cx, cy) ? field[cy * COLS + cx] : 0,
    );
  }

  /**
   * Pick a turn by sampling the field ahead-left, ahead, and ahead-right.
   *
   * Weighting is the same power law the cell-hopping model used, so "trail
   * bias" keeps its meaning: at power 1 an ant barely prefers the strongest
   * reading, at power 10 it almost always takes it. A sensor sitting in rock
   * scores zero and is never chosen.
   */
  private _chooseTurn(ant: Ant, colony: Colony): number {
    const { trailPower, cautionary, sensorAngle, sensorDist } = this.params;
    const field = ant.state === "searching" ? colony.foodPhero : colony.homePhero;
    const offsets = [-sensorAngle, 0, sensorAngle];

    const weights = offsets.map(offset => {
      const angle = ant.heading + offset;
      const px = ant.x + Math.cos(angle) * sensorDist;
      const py = ant.y + Math.sin(angle) * sensorDist;
      const cx = Math.floor(px / CELL), cy = Math.floor(py / CELL);
      if (!this.canEnter(cx, cy, Math.cos(angle), Math.sin(angle))) return 0;

      const trail = Math.pow(this._sense(field, px, py) + 1, trailPower);
      const caution = cautionary
        ? Math.pow(this._sense(colony.cautPhero, px, py) + 1, trailPower)
        : 1;
      return trail / caution;
    });

    const total = weights[0] + weights[1] + weights[2];
    // Boxed in on all three sensors: turn hard and try again next step.
    if (total <= 0) return this.rng.next() < 0.5 ? -TURN_RATE : TURN_RATE;

    let r = this.rng.next() * total;
    for (let i = 0; i < 3; i++) {
      r -= weights[i];
      if (r <= 0) return Math.max(-TURN_RATE, Math.min(TURN_RATE, offsets[i]));
    }
    return 0;
  }

  /**
   * Advance along the heading, sliding along whatever it runs into rather than
   * stopping dead. Sliding gives wall-following for free, which is a real ant
   * behaviour and reads as competence rather than as collision handling.
   *
   * Returns the distance actually travelled.
   */
  private _advance(ant: Ant): number {
    const speed = V * this.terrain.props(ant.cx, ant.cy).speed;
    const stepX = Math.cos(ant.heading) * speed;
    const stepY = Math.sin(ant.heading) * speed;
    const fromX = ant.x, fromY = ant.y;

    const tryMove = (nx: number, ny: number, dx: number, dy: number): boolean => {
      if (!this.canEnter(Math.floor(nx / CELL), Math.floor(ny / CELL), dx, dy)) return false;
      ant.x = nx; ant.y = ny;
      return true;
    };

    if (!tryMove(ant.x + stepX, ant.y + stepY, stepX, stepY)) {
      // Blocked head-on: keep whichever component still fits.
      if (tryMove(ant.x + stepX, ant.y, stepX, 0)) {
        ant.heading = stepX > 0 ? 0 : Math.PI;
      } else if (tryMove(ant.x, ant.y + stepY, 0, stepY)) {
        ant.heading = stepY > 0 ? Math.PI / 2 : -Math.PI / 2;
      } else {
        // Cornered. Turn around and spend the step doing it.
        ant.heading = normalizeAngle(ant.heading + Math.PI);
        return 0;
      }
    }

    return Math.hypot(ant.x - fromX, ant.y - fromY);
  }

  /** Lay pheromone in proportion to ground actually covered. */
  private _deposit(ant: Ant, colony: Colony, distance: number) {
    if (distance <= 0) return;

    const field = ant.state === "searching" ? colony.homePhero : colony.foodPhero;
    // Deposit is per unit distance, so slow ground does not earn a stronger
    // trail. What ground does change is how much of the mark it keeps: mire
    // takes almost nothing, so no trail can be built across it.
    const wanted = distance * DEPOSIT_PER_PX * this.terrain.props(ant.cx, ant.cy).adhesion;
    if (wanted <= 0) return;

    if (ant.tank > 0) {
      const amount = Math.min(ant.tank, wanted);
      ant.tank -= amount;
      splatDeposit(ant.x, ant.y, CELL, amount,
        (cx, cy) => this.isOpen(cx, cy),
        (cx, cy, add) => { field[cy * COLS + cx] += add; });
    } else if (this.params.cautionary) {
      splatDeposit(ant.x, ant.y, CELL, wanted,
        (cx, cy) => this.isOpen(cx, cy),
        (cx, cy, add) => { colony.cautPhero[cy * COLS + cx] += add; });
    }
  }

  /** Food pickup and nest delivery, both resolved against the occupied cell. */
  private _handleCell(ant: Ant, colony: Colony) {
    const { tankMax } = this.params;

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
          ant.heading = normalizeAngle(ant.heading + Math.PI);
        }
      }
      return;
    }

    if (ant.cx === colony.nestX && ant.cy === colony.nestY) {
      ant.state = "searching";
      ant.hasFood = false;
      ant.tank = tankMax;
      colony.foodCollected++;
      ant.heading = normalizeAngle(ant.heading + Math.PI);
    }
  }

  private _moveAnt(ant: Ant, colony: Colony) {
    if (!ant.manual) {
      ant.heading = normalizeAngle(
        ant.heading
        + this._chooseTurn(ant, colony)
        + (this.rng.next() - 0.5) * 2 * WANDER,
      );
    }

    const travelled = this._advance(ant);
    this._deposit(ant, colony, travelled);

    ant.cx = Math.floor(ant.x / CELL);
    ant.cy = Math.floor(ant.y / CELL);
    this._handleCell(ant, colony);
  }
}
