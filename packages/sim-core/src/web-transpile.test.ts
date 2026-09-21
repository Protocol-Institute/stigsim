import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { line4, strandCells, transpileWeb, isConnected, reachableFrom } from "./web-transpile";
import { buildWeb } from "./web";
import type { Point, Strand } from "./web";
import { makeRng } from "./rng";
import { COLONY_NESTS, COLS, ROWS } from "./constants";

const nestAnchors = (): Point[] =>
  COLONY_NESTS.map(([x, y]) => ({ x: x / (COLS - 1), y: y / (ROWS - 1) }));

const strand = (from: Point, to: Point, over: Partial<Strand> = {}): Strand => ({
  kind: "radius", from, to, span: "taut", sticky: false, step: 0, ...over,
});

/** Every consecutive pair differs by exactly one orthogonal step. */
function isFourConnected(cells: readonly (readonly [number, number])[]): boolean {
  for (let i = 1; i < cells.length; i++) {
    const dx = Math.abs(cells[i][0] - cells[i - 1][0]);
    const dy = Math.abs(cells[i][1] - cells[i - 1][1]);
    if (dx + dy !== 1) return false;
  }
  return true;
}

test("line4 hits both endpoints and never steps diagonally", () => {
  const cases: [number, number, number, number][] = [
    [0, 0, 0, 0], [0, 0, 5, 0], [0, 0, 0, 5], [0, 0, 5, 5],
    [5, 5, 0, 0], [2, 9, 9, 2], [30, 0, 0, 30], [3, 7, 11, 9],
  ];
  for (const [x0, y0, x1, y1] of cases) {
    const cells = line4(x0, y0, x1, y1);
    assert.deepEqual(cells[0], [x0, y0], `start of ${x0},${y0}->${x1},${y1}`);
    assert.deepEqual(cells[cells.length - 1], [x1, y1], `end of ${x0},${y0}->${x1},${y1}`);
    assert.ok(isFourConnected(cells), `${x0},${y0}->${x1},${y1} steps diagonally`);
    // Taxicab: one cell per orthogonal step, plus the start.
    assert.equal(cells.length, 1 + Math.abs(x1 - x0) + Math.abs(y1 - y0));
  }
});

test("a curved strand stays four-connected through its bend", () => {
  for (const span of ["sag", "arc"] as const) {
    const cells = strandCells(
      strand({ x: 0.1, y: 0.2 }, { x: 0.9, y: 0.8 }, { span }), COLS, ROWS,
    );
    assert.ok(cells.length > 2, `${span} produced no path`);
    assert.ok(isFourConnected(cells), `${span} steps diagonally`);
  }
});

test("a strand that starts and ends in one cell is still a cell", () => {
  const cells = strandCells(strand({ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }, { span: "arc" }), COLS, ROWS);
  assert.equal(cells.length, 1);
});

test("strand endpoints are clamped into the grid", () => {
  const cells = strandCells(strand({ x: -5, y: -5 }, { x: 5, y: 5 }), COLS, ROWS);
  for (const [x, y] of cells) {
    assert.ok(x >= 0 && x < COLS && y >= 0 && y < ROWS, `${x},${y} escaped the grid`);
  }
});

test("a transpiled web is one connected component that reaches every nest", () => {
  // Many seeds: connectivity is the invariant the whole design rests on, and a
  // web that strands a colony is a broken match rather than a hard one.
  for (const seed of ["orb", "silk", "web-3", "web-4", "web-5", "drift", "anchor"]) {
    const plan = buildWeb(makeRng(seed), nestAnchors(), { radii: 8, turns: 3 });
    const { grid } = transpileWeb(plan, COLS, ROWS);

    assert.ok(isConnected(grid), `${seed} produced a disconnected web`);
    for (const [nx, ny] of COLONY_NESTS) {
      assert.equal(grid[ny][nx], 1, `${seed} left nest ${nx},${ny} walled in`);
    }

    // Reachability from one nest, which is what an ant actually needs.
    const seen = reachableFrom(grid, COLONY_NESTS[0][0], COLONY_NESTS[0][1]);
    for (const [nx, ny] of COLONY_NESTS) {
      assert.ok(seen[ny][nx], `${seed}: nest ${nx},${ny} is unreachable from nest 0`);
    }
  }
});

test("sticky cells are always open cells, and a dry strand clears them", () => {
  const plan = buildWeb(makeRng("orb"), nestAnchors(), { radii: 8, turns: 3 });
  const { grid, sticky } = transpileWeb(plan, COLS, ROWS);

  let stickyCount = 0;
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (!sticky[y][x]) continue;
      stickyCount++;
      assert.equal(grid[y][x], 1, `sticky cell ${x},${y} is a wall`);
    }
  }
  assert.ok(stickyCount > 0, "the orb-weaver laid no sticky strands at all");

  // Dry wins: a radius crossing the capture spiral stays walkable, which is
  // what keeps a continuous dry path from the rim to the hub.
  const crossing = transpileWeb({
    anchors: [], hub: { x: 0.5, y: 0.5 },
    strands: [
      strand({ x: 0, y: 0.5 }, { x: 1, y: 0.5 }, { sticky: true, kind: "capture" }),
      strand({ x: 0.5, y: 0 }, { x: 0.5, y: 1 }, { sticky: false, kind: "radius" }),
    ],
  }, COLS, ROWS);
  const mid = Math.floor(ROWS / 2);
  assert.equal(crossing.sticky[mid][Math.floor(COLS / 2)], false, "the dry radius was severed");
});

test("reachableFrom returns nothing when the start is a wall", () => {
  const grid = transpileWeb({
    anchors: [], hub: { x: 0, y: 0 },
    strands: [strand({ x: 0, y: 0 }, { x: 0.2, y: 0 })],
  }, COLS, ROWS).grid;
  const seen = reachableFrom(grid, COLS - 1, ROWS - 1);
  assert.ok(seen.every(row => row.every(v => !v)));
});

test("an empty grid counts as connected", () => {
  const grid = transpileWeb({ anchors: [], hub: { x: 0, y: 0 }, strands: [] }, COLS, ROWS).grid;
  assert.equal(isConnected(grid), true);
});

test("a disconnected grid is reported as such", () => {
  const { grid } = transpileWeb({
    anchors: [], hub: { x: 0, y: 0 },
    strands: [
      strand({ x: 0, y: 0 }, { x: 0.2, y: 0 }),
      strand({ x: 0.8, y: 1 }, { x: 1, y: 1 }),
    ],
  }, COLS, ROWS);
  assert.equal(isConnected(grid), false);
});

test("the web modules contain no implementation-defined math", () => {
  // Math.sin, Math.cos, Math.atan2 and Math.pow are all implementation-defined
  // in ECMAScript, which is why deterministicPow exists. A web placed by angle
  // would differ between browsers and so would the run that used it. CI cannot
  // run Safari, so this stands in for the cross-browser check.
  for (const file of ["web.ts", "web-transpile.ts"]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    for (const banned of ["Math.sin", "Math.cos", "Math.tan", "Math.atan", "Math.pow"]) {
      assert.ok(!code.includes(banned), `${file} uses ${banned}`);
    }
  }
});
