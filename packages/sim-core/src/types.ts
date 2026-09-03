export interface SimParams {
  evapRate: number;
  trailPower: number;
  tankMax: number;
  cautionary: boolean;
}

export const DEFAULT_PARAMS: SimParams = {
  evapRate: 0.005,
  trailPower: 5,
  tankMax: 6400,
  cautionary: false,
};

export type CellType = 0 | 1;
export type AntState = "searching" | "returning";

export type Channel = "home" | "food" | "caut";

/**
 * The three pheromone channels of one colony, behind one object so the engine
 * never learns how they are stored.
 *
 * They live together rather than as three separate fields because a chunked
 * backing keeps all three in one chunk: a single map lookup, better locality,
 * and eviction decided across channels at once.
 */
export interface FieldSet {
  get(ch: Channel, cx: number, cy: number): number;
  add(ch: Channel, cx: number, cy: number, amount: number): void;
  set(ch: Channel, cx: number, cy: number, value: number): void;
  max(ch: Channel, cx: number, cy: number, value: number): void;

  /**
   * Multiply every stored cell by `factor`. A backing may drop regions it no
   * longer needs as a result, reporting them through drainEvicted.
   */
  decay(factor: number): void;

  /**
   * Region keys the backing dropped since the last drain. A backing that never
   * drops anything always returns empty.
   */
  drainEvicted(): readonly string[];

  /**
   * Every stored word, in the backing's canonical order.
   *
   * This is how fingerprint hashes a field without knowing its shape. Dense
   * yields exactly three arrays — home, food, caut — each cols*rows in
   * row-major order, which is the order fingerprint has always hashed. A
   * chunked backing's order is canonical for itself and deliberately not
   * comparable to dense: an evicted zero chunk does not hash like a dense run
   * of zeros, so runs on different backings are compared by trajectory rather
   * than by fingerprint.
   */
  layers(): readonly Float32Array[];
}

/**
 * Where cells are open, without committing to bounded or unbounded space.
 *
 * The maze records which cells are open inside a fixed grid; Infinite Mode
 * records which cells are walls in unbounded space and treats everything else
 * as open. Both answer isOpen, and no caller needs to know which it holds.
 */
export interface Occupancy {
  isOpen(cx: number, cy: number): boolean;
  setOpen(cx: number, cy: number, open: boolean): void;
  /** Iteration bounds, or null when the world is unbounded. */
  readonly bounds: { cols: number; rows: number } | null;
}

/**
 * A world handed to a Simulation: where things are open, where nests sit, and
 * how to allocate a colony's field.
 */
export interface WorldSpec {
  readonly occupancy: Occupancy;
  /** Nest cell per colony id, in id order. */
  readonly nests: readonly (readonly [number, number])[];
  /** A fresh, zeroed field set for one colony. */
  createField(): FieldSet;
}

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
  field: FieldSet;
  /**
   * Dense views of the three channels.
   *
   * Temporary. The fingerprint, the metrics and the renderer still index these
   * arrays directly; they move onto FieldSet in the commit that drops the dense
   * compatibility views, and these go with them. Read-only because they are
   * backed by the field rather than owned.
   */
  readonly homePhero: Float32Array;
  readonly foodPhero: Float32Array;
  readonly cautPhero: Float32Array;
  ants: Ant[];
  foodCollected: number;
  discoveredSources: Set<number>;
  /** A trailing window of completed round trips, newest last. */
  recentTrips: { steps: number; sx: number; sy: number }[];
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
  /** Cells traversed since the ant last left the nest. Observation only. */
  stepsSinceNest: number;
  /** Where the ant last picked up food, for the trip-efficiency metric. */
  lastSourceX: number | null;
  lastSourceY: number | null;
}

export interface RunSeeds {
  /** Null when the three streams were seeded independently. */
  master: string | null;
  maze: string;
  food: string;
  ants: string;
}

export interface RunConfig {
  seeds: RunSeeds;
  numAnts: number;
  params: SimParams;
  loopRate: number;
  numColonies: number;
  numFoodSources: number;
  foodPerSource: number;
}
