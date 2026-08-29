// ─── Maze dimensions ───────────────────────────────────────────────────────
export const COLS = 31;
export const ROWS = 31;
export const CELL = 16;
export const W = COLS * CELL;
export const H = ROWS * CELL;

// ─── Movement (fixed) ──────────────────────────────────────────────────────
export const V = 4;
export const ARRIVE_THRESH = V + 1;
export const NEST_SEED = 1000;
export const DEFAULT_NUM_ANTS = 20;
export const DEPOSIT_RATE = 20;

// ─── Colony nest corner positions (up to 4) ──────────────────────────────────
export const COLONY_NESTS: [number, number][] = [
  [1, 1],
  [COLS - 2, ROWS - 2],
  [COLS - 2, 1],
  [1, ROWS - 2],
];

export const DIRS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export const DEFAULT_NUM_COLONIES = 1;
export const DEFAULT_NUM_FOOD_SOURCES = 1;
export const DEFAULT_FOOD_PER_SOURCE = 500;

/** Completed round trips kept per colony for the trip-efficiency metric. */
export const TRIP_WINDOW = 50;

// ─── Limits on externally supplied values ────────────────────────────────────
//
// A trace is an ordinary file: it can be hand-edited, corrupted in transit, or
// written by another tool. These are the bounds the loader enforces before a
// trace is allowed to become a running simulation. They are chosen to keep the
// simulation cheap to step and numerically well-behaved, not to mirror the
// sliders, so a headless run can still explore well beyond what the interface
// offers.

/** Ants per colony. At four colonies this is 4000 ants, which still steps fast. */
export const MAX_ANTS_PER_COLONY = 1000;
export const MAX_COLONIES = COLONY_NESTS.length;
export const MAX_FOOD_SOURCES = 64;
export const MAX_FOOD_PER_SOURCE = 1e6;
/** Also the ceiling for a single setFood edit. */
export const MAX_FOOD_AMOUNT = 1e6;
/** Pheromone decays by `1 - evapRate`, so anything outside [0, 1] amplifies. */
export const MAX_EVAP_RATE = 1;
/**
 * Trail bias exponent. Pheromone saturates in the low thousands, and 5000^32
 * is around 1e118, so this leaves plenty of headroom below the point where
 * powerChoice's scores overflow to Infinity and every candidate ties.
 */
export const MAX_TRAIL_POWER = 32;
export const MAX_TANK = 1e6;
