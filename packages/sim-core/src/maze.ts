import { COLS, ROWS, COLONY_NESTS, DEFAULT_LAYOUT } from "./constants";
import type { CellType, MazeLayout, WorldSpec } from "./types";
import { DenseField } from "./field";
import { DenseGrid } from "./world";
import { shuffleInPlace, type Rng } from "./rng";

export function generateMaze(loopRate: number, rng: Rng, layout: MazeLayout = DEFAULT_LAYOUT): CellType[][] {
  return layout === "mirrored" ? generateMirroredMaze(loopRate, rng) : generateRandomMaze(loopRate, rng);
}

/**
 * One spanning tree carved from the top-left corner, then loops opened at
 * random. This is the original generator and its draw sequence is fixed:
 * every trace recorded before layouts existed replays through it.
 */
function generateRandomMaze(loopRate: number, rng: Rng): CellType[][] {
  const grid: CellType[][] = Array.from({ length: ROWS }, () => Array(COLS).fill(0));
  const visited = Array.from({ length: ROWS }, () => Array(COLS).fill(false));

  function carve(cx: number, cy: number) {
    visited[cy][cx] = true;
    grid[cy][cx] = 1;
    const dirs: [number, number][] = [[0, -2], [0, 2], [-2, 0], [2, 0]];
    shuffleInPlace(dirs, rng);
    for (const [dx, dy] of dirs) {
      const nx = cx + dx, ny = cy + dy;
      if (nx >= 0 && nx < COLS && ny >= 0 && ny < ROWS && !visited[ny][nx]) {
        grid[cy + dy / 2][cx + dx / 2] = 1;
        carve(nx, ny);
      }
    }
  }

  carve(1, 1);
  for (let y = 1; y < ROWS - 1; y++)
    for (let x = 1; x < COLS - 1; x++)
      if (grid[y][x] === 0 && rng() < loopRate) grid[y][x] = 1;
  // Ensure all colony nest corners are open
  for (const [nx, ny] of COLONY_NESTS) grid[ny][nx] = 1;
  return grid;
}

/**
 * The same carver, constrained so the grid equals its own 180-degree rotation
 * about the centre cell.
 *
 * Every cell and wall the carver opens is opened together with its image, and
 * the image cell is marked visited, so the tree grown from nest 0 and its
 * rotated copy grown from nest 1 never carve into each other. They meet at
 * exactly one place: the centre cell is its own image, so the carver can only
 * ever reach it directly, and the mirrored carve that opens the wall into it
 * from one side opens the wall into it from the other side at the same
 * moment. That makes the maze connected with the centre as its only crossing
 * at loop rate 0; the loop pass, which opens walls in rotated pairs, adds
 * further crossings symmetrically. The nest corners are each other's images,
 * so forcing them open keeps the symmetry.
 */
function generateMirroredMaze(loopRate: number, rng: Rng): CellType[][] {
  const grid: CellType[][] = Array.from({ length: ROWS }, () => Array(COLS).fill(0));
  const visited = Array.from({ length: ROWS }, () => Array(COLS).fill(false));
  const ix = (x: number) => COLS - 1 - x;
  const iy = (y: number) => ROWS - 1 - y;

  function open(x: number, y: number) {
    grid[y][x] = 1;
    grid[iy(y)][ix(x)] = 1;
  }

  function carve(cx: number, cy: number) {
    visited[cy][cx] = true;
    visited[iy(cy)][ix(cx)] = true;
    open(cx, cy);
    const dirs: [number, number][] = [[0, -2], [0, 2], [-2, 0], [2, 0]];
    shuffleInPlace(dirs, rng);
    for (const [dx, dy] of dirs) {
      const nx = cx + dx, ny = cy + dy;
      if (nx >= 0 && nx < COLS && ny >= 0 && ny < ROWS && !visited[ny][nx]) {
        open(cx + dx / 2, cy + dy / 2);
        carve(nx, ny);
      }
    }
  }

  carve(1, 1);
  // Loop pass over one representative of each rotated pair, so a pair is
  // decided by one draw and opened or left together.
  for (let y = 1; y < ROWS - 1; y++)
    for (let x = 1; x < COLS - 1; x++) {
      if (y * COLS + x > iy(y) * COLS + ix(x)) continue;
      if (grid[y][x] === 0 && rng() < loopRate) open(x, y);
    }
  for (const [nx, ny] of COLONY_NESTS) grid[ny][nx] = 1;
  return grid;
}

/**
 * The maze sandbox as a world a Simulation can be handed.
 *
 * This is what a Simulation builds for itself by default, so it is also the
 * shape any other world has to take: somewhere open, nests, and a way to
 * allocate a colony's field.
 */
export function mazeWorld(loopRate: number, rng: Rng, layout: MazeLayout = DEFAULT_LAYOUT): WorldSpec {
  return {
    occupancy: new DenseGrid(generateMaze(loopRate, rng, layout)),
    nests: COLONY_NESTS,
    createField: () => new DenseField(COLS, ROWS),
  };
}
