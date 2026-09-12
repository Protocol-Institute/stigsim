import assert from "node:assert/strict";
import test from "node:test";
import { contestedWeight, pickMirroredFood, safeWeight } from "./food-layout";
import { FOOD_BOUNDARY_SCALE, FOOD_MIN_SEPARATION } from "./constants";
import { makeRng } from "./rng";
import { DenseGrid, pathDistances } from "./world";
import type { CellType } from "./types";

/** A fully open n-by-n grid with nests at the top-left and bottom-right corners. */
function openWorld(n: number) {
  const cells: CellType[][] = Array.from({ length: n }, () => Array(n).fill(1));
  const occ = new DenseGrid(cells);
  const distances = [pathDistances(occ, 0, 0), pathDistances(occ, n - 1, n - 1)];
  const eligible: [number, number][] = [];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) eligible.push([x, y]);
  return { cols: n, rows: n, eligible, distances };
}

const image = (n: number, [x, y]: readonly [number, number]) => [n - 1 - x, n - 1 - y] as const;
const has = (cells: readonly (readonly [number, number])[], [x, y]: readonly [number, number]) =>
  cells.some(c => c[0] === x && c[1] === y);

test("contested weight is 1 on the equidistant set and falls to 1/e one scale off it", () => {
  assert.equal(contestedWeight(10, 10), 1);
  assert.ok(Math.abs(contestedWeight(10, 10 + FOOD_BOUNDARY_SCALE) - Math.exp(-1)) < 1e-12);
  assert.equal(contestedWeight(10 + FOOD_BOUNDARY_SCALE, 10), contestedWeight(10, 10 + FOOD_BOUNDARY_SCALE));
  assert.ok(contestedWeight(0, 3 * FOOD_BOUNDARY_SCALE) < 1e-3, "three scales off is negligible");
  assert.ok(contestedWeight(0, 100) >= 0);
});

test("safe weight is 1 at the shortest distance and falls to 1/e one scale beyond it", () => {
  assert.equal(safeWeight(7, 7), 1);
  assert.ok(Math.abs(safeWeight(7 + FOOD_BOUNDARY_SCALE, 7) - Math.exp(-1)) < 1e-12);
});

test("every placement is closed under rotation", () => {
  const world = openWorld(15);
  for (const count of [1, 2, 3, 4, 5, 6, 9]) {
    const picked = pickMirroredFood({ ...world, count, rng: makeRng(`closed-${count}`) });
    assert.equal(picked.length, count, `count ${count}`);
    for (const p of picked) assert.ok(has(picked, image(15, p)), `count ${count}: ${p} lacks its image`);
  }
});

test("an odd count puts one source on the centre cell", () => {
  const world = openWorld(15);
  for (const count of [1, 3, 5]) {
    const picked = pickMirroredFood({ ...world, count, rng: makeRng("centre") });
    assert.ok(has(picked, [7, 7]), `count ${count}`);
  }
  const even = pickMirroredFood({ ...world, count: 2, rng: makeRng("centre") });
  assert.ok(!has(even, [7, 7]));
});

test("an odd count with no eligible centre drops the unpaired source rather than breaking symmetry", () => {
  const world = openWorld(15);
  const eligible = world.eligible.filter(([x, y]) => !(x === 7 && y === 7));
  const picked = pickMirroredFood({ ...world, eligible, count: 3, rng: makeRng("no-centre") });
  assert.equal(picked.length, 2);
  for (const p of picked) assert.ok(has(picked, image(15, p)));
});

test("no two sources sit within the minimum separation", () => {
  const world = openWorld(21);
  const picked = pickMirroredFood({ ...world, count: 12, rng: makeRng("spread") });
  for (let i = 0; i < picked.length; i++) {
    for (let j = i + 1; j < picked.length; j++) {
      const d = Math.abs(picked[i][0] - picked[j][0]) + Math.abs(picked[i][1] - picked[j][1]);
      assert.ok(d >= FOOD_MIN_SEPARATION, `${picked[i]} and ${picked[j]} are ${d} apart`);
    }
  }
});

test("a count above two spends its first pair near the nests and the rest near the boundary", () => {
  // On an open grid the equidistant set is the anti-diagonal x + y = n - 1,
  // and the nests are the corners. Over many seeds the safe pair should sit
  // much nearer its nest than any contested pair, and contested pairs should
  // hug the anti-diagonal.
  const n = 21;
  const world = openWorld(n);
  let safeNearer = 0, contestedOnBoundary = 0, trials = 0;
  for (let s = 0; s < 60; s++) {
    const picked = pickMirroredFood({ ...world, count: 4, rng: makeRng(`mix-${s}`) });
    const [safeA, , contA] = picked;
    const nearest = ([x, y]: readonly [number, number]) => Math.min(x + y, 2 * (n - 1) - x - y);
    const offBoundary = ([x, y]: readonly [number, number]) => Math.abs(x + y - (n - 1));
    trials++;
    if (nearest(safeA) < nearest(contA)) safeNearer++;
    if (offBoundary(contA) <= FOOD_BOUNDARY_SCALE) contestedOnBoundary++;
  }
  assert.ok(safeNearer / trials > 0.8, `safe pair nearer its nest in only ${safeNearer}/${trials}`);
  assert.ok(contestedOnBoundary / trials > 0.8, `contested pair near the boundary in only ${contestedOnBoundary}/${trials}`);
});

test("with a single distance field every weight is 1 and placement still pairs", () => {
  const world = openWorld(11);
  const picked = pickMirroredFood({ ...world, distances: [world.distances[0]], count: 4, rng: makeRng("one-nest") });
  assert.equal(picked.length, 4);
  for (const p of picked) assert.ok(has(picked, image(11, p)));
});

test("placement is deterministic per seed", () => {
  const world = openWorld(15);
  assert.deepEqual(
    pickMirroredFood({ ...world, count: 5, rng: makeRng("same") }),
    pickMirroredFood({ ...world, count: 5, rng: makeRng("same") }),
  );
});

test("pairs whose members are unreachable from a nest are never chosen", () => {
  // Wall off the bottom-right corner so nest 1 can reach nothing.
  const n = 9;
  const cells: CellType[][] = Array.from({ length: n }, () => Array(n).fill(1));
  cells[n - 2][n - 1] = 0; cells[n - 1][n - 2] = 0;
  cells[1][0] = 0; cells[0][1] = 0;
  const occ = new DenseGrid(cells);
  const distances = [pathDistances(occ, 0, 0), pathDistances(occ, n - 1, n - 1)];
  const eligible: [number, number][] = [];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (cells[y][x]) eligible.push([x, y]);
  const picked = pickMirroredFood({ cols: n, rows: n, eligible, distances, count: 2, rng: makeRng("cut") });
  assert.equal(picked.length, 0);
});
