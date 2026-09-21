/**
 * Lowering a web onto a grid: the ant-maze transpiler.
 *
 * The grid starts closed and strands open it, so the silk becomes the walkable
 * corridors and the gaps between strands become wall. That inversion is what
 * makes the result a web rather than a picture of one — the ants walk on the
 * silk, which is what a web is for.
 */
import type { CellType } from "./types";
import type { Point, Strand, WebPlan } from "./web";

export interface TranspiledWeb {
  grid: CellType[][];
  /**
   * Cells covered by a sticky strand. A strict subset of the open cells.
   * Nothing in the engine reads this yet; it is what a spider-god mode would
   * lower into pre-laid pheromone.
   */
  sticky: boolean[][];
}

/**
 * The cells of a line, stepping one axis at a time.
 *
 * Four-connected, and that is a correctness requirement rather than a
 * preference. `openNeighbours` filters `DIRS4`, so ants move only
 * orthogonally. A Bresenham line is eight-connected: it steps diagonally, and
 * a diagonal step leaves two open cells that are not neighbours of each other.
 * An ant that reaches one cannot continue, which is how you get a web that
 * looks perfect and cannot be walked.
 *
 * This visits dx + dy + 1 cells and never moves both axes at once. Ties go to
 * the y step, which is arbitrary but fixed, so the result is deterministic.
 */
export function line4(x0: number, y0: number, x1: number, y1: number): [number, number][] {
  let x = x0;
  let y = y0;
  const sx = x1 > x0 ? 1 : -1;
  const sy = y1 > y0 ? 1 : -1;
  let dx = Math.abs(x1 - x0);
  let dy = Math.abs(y1 - y0);

  const cells: [number, number][] = [];
  let n = 1 + dx + dy;
  let err = dx - dy;
  dx *= 2;
  dy *= 2;

  for (; n > 0; n--) {
    cells.push([x, y]);
    if (err > 0) { x += sx; err -= dy; }
    else { y += sy; err += dx; }
  }
  return cells;
}

/** A quadratic Bezier, used for the bend in a dangled or swung strand. */
function bezier(a: Point, control: Point, b: Point, t: number): Point {
  const u = 1 - t;
  return {
    x: u * u * a.x + 2 * u * t * control.x + t * t * b.x,
    y: u * u * a.y + 2 * u * t * control.y + t * t * b.y,
  };
}

/**
 * Where a strand bends.
 *
 * `sag` drops below the midpoint, which is what a dangling spider does under
 * its own weight. `arc` bows away from the origin, which is the shape of a
 * spiral segment between two radii. `taut` does not bend.
 */
function controlPoint(strand: Strand): Point | null {
  const mid = { x: (strand.from.x + strand.to.x) / 2, y: (strand.from.y + strand.to.y) / 2 };
  if (strand.span === "taut") return null;
  const dx = strand.to.x - strand.from.x;
  const dy = strand.to.y - strand.from.y;
  // +y is downward in grid space, so a sag adds to y.
  if (strand.span === "sag") return { x: mid.x, y: mid.y + Math.abs(dx) * 0.28 };
  return { x: mid.x - dy * 0.14, y: mid.y + dx * 0.14 };
}

const toCell = (p: Point, cols: number, rows: number): [number, number] => [
  Math.min(cols - 1, Math.max(0, Math.round(p.x * (cols - 1)))),
  Math.min(rows - 1, Math.max(0, Math.round(p.y * (rows - 1)))),
];

/**
 * Every cell one strand covers.
 *
 * A curved strand is sampled and the samples joined with `line4`, so the whole
 * path stays four-connected however it bends.
 */
export function strandCells(strand: Strand, cols: number, rows: number): [number, number][] {
  const control = controlPoint(strand);
  if (control === null) {
    const [x0, y0] = toCell(strand.from, cols, rows);
    const [x1, y1] = toCell(strand.to, cols, rows);
    return line4(x0, y0, x1, y1);
  }

  // Enough samples that consecutive ones are at most a cell apart; line4 fills
  // any gap left over, so this only has to be close.
  const span = Math.abs(strand.to.x - strand.from.x) * cols + Math.abs(strand.to.y - strand.from.y) * rows;
  const steps = Math.max(2, Math.ceil(span));
  const cells: [number, number][] = [];
  let prev = toCell(bezier(strand.from, control, strand.to, 0), cols, rows);
  cells.push(prev);
  for (let i = 1; i <= steps; i++) {
    const next = toCell(bezier(strand.from, control, strand.to, i / steps), cols, rows);
    if (next[0] === prev[0] && next[1] === prev[1]) continue;
    for (const cell of line4(prev[0], prev[1], next[0], next[1]).slice(1)) cells.push(cell);
    prev = next;
  }
  return cells;
}

/** Lower a plan onto a grid of the given size. */
export function transpileWeb(plan: WebPlan, cols: number, rows: number): TranspiledWeb {
  const grid: CellType[][] = Array.from({ length: rows }, () => Array<CellType>(cols).fill(0));
  const sticky: boolean[][] = Array.from({ length: rows }, () => Array<boolean>(cols).fill(false));

  // Two passes, because a dry strand crossing a sticky one must stay dry.
  //
  // This is the difference between a web that plays and one that does not. A
  // spider walks its radii and the capture spiral merely attaches to them, so
  // the crossing belongs to the radius. Letting sticky win instead severs
  // every spoke at every ring, which leaves no continuous dry path from the
  // rim to the hub and loses the whole fast-safe-travel-versus-slow-dangerous
  // -travel asymmetry that makes a web worth using as a maze.
  for (const strand of plan.strands) {
    for (const [x, y] of strandCells(strand, cols, rows)) {
      grid[y][x] = 1;
      if (strand.sticky) sticky[y][x] = true;
    }
  }
  for (const strand of plan.strands) {
    if (strand.sticky) continue;
    for (const [x, y] of strandCells(strand, cols, rows)) sticky[y][x] = false;
  }
  return { grid, sticky };
}

/**
 * The open cells reachable from a start, walking orthogonally.
 *
 * The transpiler's guarantee is that this reaches every open cell. Exposed
 * rather than kept in the tests because the layout will want to assert it at
 * generation time before handing a world to a match.
 */
export function reachableFrom(grid: CellType[][], sx: number, sy: number): boolean[][] {
  const rows = grid.length;
  const cols = grid[0].length;
  const seen: boolean[][] = Array.from({ length: rows }, () => Array<boolean>(cols).fill(false));
  if (grid[sy]?.[sx] !== 1) return seen;

  const queue: [number, number][] = [[sx, sy]];
  seen[sy][sx] = true;
  for (let head = 0; head < queue.length; head++) {
    const [x, y] = queue[head];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;
      if (seen[ny][nx] || grid[ny][nx] !== 1) continue;
      seen[ny][nx] = true;
      queue.push([nx, ny]);
    }
  }
  return seen;
}

/** True when every open cell is reachable from the first one. The invariant, checked. */
export function isConnected(grid: CellType[][]): boolean {
  let start: [number, number] | null = null;
  for (let y = 0; y < grid.length && !start; y++) {
    for (let x = 0; x < grid[y].length && !start; x++) if (grid[y][x] === 1) start = [x, y];
  }
  if (!start) return true;

  const seen = reachableFrom(grid, start[0], start[1]);
  for (let y = 0; y < grid.length; y++) {
    for (let x = 0; x < grid[y].length; x++) if (grid[y][x] === 1 && !seen[y][x]) return false;
  }
  return true;
}
