import assert from "node:assert/strict";
import test from "node:test";
import { generateMaze } from "./maze";
import { makeRng } from "./rng";
import { COLS, ROWS, COLONY_NESTS } from "./constants";

test("the same seed produces an identical grid", () => {
  const a = generateMaze(0.1, makeRng("maze-seed-1"));
  const b = generateMaze(0.1, makeRng("maze-seed-1"));
  assert.deepEqual(a, b);
});

test("different seeds produce different grids", () => {
  const a = generateMaze(0.1, makeRng("maze-seed-1"));
  const b = generateMaze(0.1, makeRng("maze-seed-2"));
  assert.notDeepEqual(a, b);
});

test("every nest corner is open regardless of seed", () => {
  const grid = generateMaze(0.1, makeRng("nest-check"));
  for (const [x, y] of COLONY_NESTS) assert.equal(grid[y][x], 1);
});

test("the grid is the declared size and holds only 0 or 1", () => {
  const grid = generateMaze(0.25, makeRng("shape-check"));
  assert.equal(grid.length, ROWS);
  for (const row of grid) {
    assert.equal(row.length, COLS);
    for (const cell of row) assert.ok(cell === 0 || cell === 1);
  }
});

test("a higher loop rate opens at least as many cells", () => {
  const count = (g: number[][]) => g.flat().filter(c => c === 1).length;
  const sparse = count(generateMaze(0.0, makeRng("loops")));
  const dense = count(generateMaze(0.4, makeRng("loops")));
  assert.ok(dense > sparse, `expected ${dense} > ${sparse}`);
});

// ─── Mirrored layout ─────────────────────────────────────────────────────────

const rotated = (g: number[][]) => g.map((row, y) => row.map((_, x) => g[ROWS - 1 - y][COLS - 1 - x]));

/** Open cells reachable from (sx, sy) by orthogonal steps. */
function reachable(g: number[][], sx: number, sy: number): number {
  const seen = new Set<number>([sy * COLS + sx]);
  const queue: [number, number][] = [[sx, sy]];
  while (queue.length) {
    const [x, y] = queue.shift()!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
      if (g[ny][nx] !== 1 || seen.has(ny * COLS + nx)) continue;
      seen.add(ny * COLS + nx);
      queue.push([nx, ny]);
    }
  }
  return seen.size;
}

test("a mirrored maze equals its own 180-degree rotation at every loop rate", () => {
  for (const loopRate of [0, 0.1, 0.5]) {
    const grid = generateMaze(loopRate, makeRng(`mirror-${loopRate}`), "mirrored");
    assert.deepEqual(grid, rotated(grid), `loop rate ${loopRate}`);
  }
});

test("a mirrored maze is connected: every open cell is reachable from nest 0", () => {
  for (const seed of ["a", "b", "c", "d", "e"]) {
    const grid = generateMaze(0, makeRng(seed), "mirrored");
    const open = grid.flat().filter(c => c === 1).length;
    assert.equal(reachable(grid, 1, 1), open, `seed ${seed}`);
  }
});

test("a mirrored maze keeps the centre open, and at loop rate 0 the centre is the only crossing", () => {
  const grid = generateMaze(0, makeRng("centre"), "mirrored");
  const cx = (COLS - 1) / 2, cy = (ROWS - 1) / 2;
  assert.equal(grid[cy][cx], 1);
  const cut = grid.map(row => row.slice());
  cut[cy][cx] = 0;
  const open = cut.flat().filter(c => c === 1).length;
  assert.ok(reachable(cut, 1, 1) < open, "closing the centre did not split the maze");
});

test("the mirrored layout is deterministic per seed and differs across seeds", () => {
  assert.deepEqual(generateMaze(0.1, makeRng("m1"), "mirrored"), generateMaze(0.1, makeRng("m1"), "mirrored"));
  assert.notDeepEqual(generateMaze(0.1, makeRng("m1"), "mirrored"), generateMaze(0.1, makeRng("m2"), "mirrored"));
});

test("the random layout is exactly what the generator produced before layouts existed", () => {
  const explicit = generateMaze(0.1, makeRng("maze-seed-1"), "random");
  const implicit = generateMaze(0.1, makeRng("maze-seed-1"));
  assert.deepEqual(explicit, implicit);
  assert.notDeepEqual(explicit, generateMaze(0.1, makeRng("maze-seed-1"), "mirrored"));
});

test("every nest corner is open in a mirrored maze", () => {
  const grid = generateMaze(0.2, makeRng("nest-mirror"), "mirrored");
  for (const [x, y] of COLONY_NESTS) assert.equal(grid[y][x], 1);
});
