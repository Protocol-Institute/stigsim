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

// Defaults below were chosen by sweeping the real model across 32 seeds; see
// the tuning notes in CONTRIBUTING.md.

/** How far ahead the sensors reach, in pixels — about one cell. */
export const SENSOR_DIST = CELL;
/**
 * Angle of the left and right sensors either side of the heading, radians.
 *
 * The sensitive one. Below about 0.5 the three sensors sit too close together
 * to tell directions apart and ants barely follow trails at all; the useful
 * band is roughly 0.8 to 1.0.
 */
export const SENSOR_ANGLE = 0.9;
/**
 * Most an ant may turn in one step, radians. Above about 0.6 ants turn faster
 * than they travel and trails stop holding their shape.
 */
export const TURN_RATE = 0.55;
/**
 * Random jitter added to the heading each step, radians. Zero makes a colony
 * too committed to explore; much above 0.2 drowns the signal it follows.
 */
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
