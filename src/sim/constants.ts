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
