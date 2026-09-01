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
