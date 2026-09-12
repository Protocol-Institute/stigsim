import assert from "node:assert/strict";
import test from "node:test";
import { DenseGrid, WallSet, inBounds, pathDistances } from "./world";
import type { CellType, Occupancy } from "./types";

test("pathDistances counts orthogonal steps and marks unreachable cells -1", () => {
  // A 5x3 corridor with a wall in the middle column, top two rows.
  const cells: CellType[][] = [
    [1, 1, 0, 1, 1],
    [1, 1, 0, 1, 1],
    [1, 1, 1, 1, 1],
  ];
  const d = pathDistances(new DenseGrid(cells), 0, 0);
  assert.equal(d[0], 0);
  assert.equal(d[1], 1);
  assert.equal(d[2 * 5 + 2], 4);
  assert.equal(d[0 * 5 + 4], 8);
  assert.equal(d[0 * 5 + 2], -1, "a wall is unreachable");
});

test("pathDistances from a closed cell reaches nothing, and refuses an unbounded world", () => {
  const d = pathDistances(new DenseGrid([[0, 1]]), 0, 0);
  assert.deepEqual([...d], [-1, -1]);
  assert.throws(() => pathDistances(new WallSet(null), 0, 0), RangeError);
});

/** A 4x3 grid (4 wide, 3 tall) with one open cell at (1, 1). */
function grid(): CellType[][] {
  return [
    [0, 0, 0, 0],
    [0, 1, 0, 0],
    [0, 0, 0, 0],
  ];
}

test("bounds are derived from the nested array", () => {
  assert.deepEqual(new DenseGrid(grid()).bounds, { cols: 4, rows: 3 });
  assert.deepEqual(new DenseGrid([]).bounds, { cols: 0, rows: 0 });
});

test("reports open cells and treats everything outside as closed", () => {
  const world = new DenseGrid(grid());

  assert.equal(world.isOpen(1, 1), true);
  assert.equal(world.isOpen(0, 0), false);

  assert.equal(world.isOpen(-1, 1), false);
  assert.equal(world.isOpen(4, 1), false);
  assert.equal(world.isOpen(1, -1), false);
  assert.equal(world.isOpen(1, 3), false);
});

test("setOpen writes inside the grid and is dropped outside", () => {
  const world = new DenseGrid(grid());

  world.setOpen(2, 2, true);
  assert.equal(world.isOpen(2, 2), true);

  world.setOpen(1, 1, false);
  assert.equal(world.isOpen(1, 1), false);

  // Out of bounds: silently dropped, and no row is grown into existence.
  world.setOpen(-1, 0, true);
  world.setOpen(0, 9, true);
  assert.equal(world.cells.length, 3);
  assert.equal(world.isOpen(-1, 0), false);
});

test("cells stay the same array the caller passed in", () => {
  const cells = grid();
  const world = new DenseGrid(cells);

  assert.equal(world.cells, cells);

  // The renderer and the maze generator still read this array directly during
  // the migration, so writes have to land in it rather than in a copy.
  world.setOpen(3, 0, true);
  assert.equal(cells[0][3], 1);
});

test("inBounds admits every coordinate of an unbounded world", () => {
  const unbounded: Occupancy = {
    bounds: null,
    isOpen: () => true,
    setOpen: () => {},
  };

  assert.equal(inBounds(unbounded, 0, 0), true);
  assert.equal(inBounds(unbounded, -10_000, 99_999), true);
});

test("inBounds respects the edges of a bounded world", () => {
  const world = new DenseGrid(grid());

  assert.equal(inBounds(world, 0, 0), true);
  assert.equal(inBounds(world, 3, 2), true);
  assert.equal(inBounds(world, 4, 2), false);
  assert.equal(inBounds(world, 3, 3), false);
  assert.equal(inBounds(world, -1, 0), false);
  assert.equal(inBounds(world, 0, -1), false);
});

test("an unbounded wall set is open everywhere it holds no wall", () => {
  const world = new WallSet();

  assert.equal(world.bounds, null);
  assert.equal(world.isOpen(0, 0), true);
  assert.equal(world.isOpen(-99_999, 250_000), true);

  world.setOpen(4, 5, false);
  assert.equal(world.isOpen(4, 5), false);
  assert.equal(world.wallCount, 1);
  assert.deepEqual(world.wallKeys(), ["4,5"]);

  world.setOpen(4, 5, true);
  assert.equal(world.isOpen(4, 5), true);
  assert.equal(world.wallCount, 0);
});

test("re-walling a cell records it once", () => {
  const world = new WallSet();
  world.setOpen(1, 1, false);
  world.setOpen(1, 1, false);
  assert.equal(world.wallCount, 1);
});

test("a bounded wall set closes everything outside its bounds", () => {
  const world = new WallSet({ cols: 4, rows: 3 });

  assert.equal(world.isOpen(3, 2), true);
  assert.equal(world.isOpen(4, 2), false);
  assert.equal(world.isOpen(3, 3), false);
  assert.equal(world.isOpen(-1, 0), false);

  // Out of bounds is closed by geometry, so nothing needs recording.
  world.setOpen(9, 9, false);
  assert.equal(world.wallCount, 0);
});
