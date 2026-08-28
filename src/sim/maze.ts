import { COLS, ROWS, COLONY_NESTS } from "./constants";
import type { CellType } from "./types";
import { shuffleInPlace, type Rng } from "./rng";

export function generateMaze(loopRate: number, rng: Rng): CellType[][] {
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
