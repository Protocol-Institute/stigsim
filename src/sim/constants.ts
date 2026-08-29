// ─────────────────────────────────────────────────────────────────────────────
// Fixed dimensions and rates of the maze model. Shared by the simulation and
// the renderer that draws it.
// ─────────────────────────────────────────────────────────────────────────────

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

// ─── Continuous movement ────────────────────────────────────────────────────
// An ant senses the field at three points ahead of it and steers, rather than
// choosing between the four cells it touches.

/** How far ahead the sensors reach, in pixels. */
export const SENSOR_DIST = CELL * 1.15;
/** Angle of the left and right sensors either side of the heading, radians. */
export const SENSOR_ANGLE = 0.55;
/** Most an ant may turn in one step, radians. */
export const TURN_RATE = 0.55;
/** Random jitter added to the heading each step, radians. */
export const WANDER = 0.10;

/**
 * Pheromone laid per pixel travelled.
 *
 * Deposit is measured against distance rather than time. While every ant moves
 * at the same speed the two are identical, but as soon as terrain changes speed
 * a slow ant would lay far more pheromone per metre of path than a fast one,
 * and the colony would learn to prefer whatever ground was hardest to cross.
 * Calibrated so an ant at full speed lays exactly what it used to per step.
 */
export const DEPOSIT_PER_PX = DEPOSIT_RATE / V;
