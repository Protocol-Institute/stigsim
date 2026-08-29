import assert from "node:assert/strict";
import test from "node:test";
import { Simulation, DEFAULT_PARAMS, COLS, ROWS, DIRS4, makeSeeds } from "./index";
import type { RunConfig } from "./index";

function config(overrides: Partial<RunConfig> = {}): RunConfig {
  return {
    seeds: makeSeeds("test-master"),
    numAnts: 20,
    params: DEFAULT_PARAMS,
    loopRate: 0.1,
    numColonies: 1,
    numFoodSources: 1,
    foodPerSource: 500,
    ...overrides,
  };
}

function build() {
  return new Simulation(config());
}

test("a fresh simulation has a maze, one colony, and one food source", () => {
  const sim = build();
  assert.equal(sim.grid.length, ROWS);
  assert.equal(sim.grid[0].length, COLS);
  assert.equal(sim.colonies.length, 1);
  assert.equal(sim.foodSources.length, 1);
  assert.equal(sim.allAnts.length, 20);
  assert.equal(sim.totalFoodCollected, 0);
});

test("the nest cell and every food source sit on open ground", () => {
  const sim = build();
  const nest = sim.colonies[0];
  assert.equal(sim.grid[nest.nestY][nest.nestX], 1);
  for (const src of sim.foodSources) {
    assert.equal(sim.grid[src.y][src.x], 1);
  }
});

test("ants collect food within 4000 steps", () => {
  const sim = build();
  for (let i = 0; i < 4000; i++) sim.step();
  assert.ok(
    sim.totalFoodCollected > 0,
    `expected some food collected, got ${sim.totalFoodCollected}`,
  );
});

test("setAntCount grows and shrinks every colony", () => {
  const sim = new Simulation(config({ numAnts: 10, numColonies: 2, numFoodSources: 2 }));
  assert.equal(sim.allAnts.length, 20);
  sim.setAntCount(30);
  assert.equal(sim.allAnts.length, 60);
  sim.setAntCount(5);
  assert.equal(sim.allAnts.length, 10);
});

test("the same seeds produce an identical run", () => {
  const c = config();
  const a = new Simulation(c);
  const b = new Simulation(c);
  for (let i = 0; i < 500; i++) { a.step(); b.step(); }
  assert.equal(a.totalFoodCollected, b.totalFoodCollected);
  assert.deepEqual(a.grid, b.grid);
  assert.deepEqual(
    a.allAnts.map(x => [x.cx, x.cy]),
    b.allAnts.map(x => [x.cx, x.cy]),
  );
});

test("holding the maze and food seeds fixed while varying ants keeps the map", () => {
  const base = config();
  const varied: RunConfig = {
    ...base,
    seeds: { ...base.seeds, master: null, ants: "deadbeef" },
  };
  const a = new Simulation(base);
  const b = new Simulation(varied);

  assert.deepEqual(a.grid, b.grid);
  assert.deepEqual(
    a.foodSources.map(s => [s.x, s.y]),
    b.foodSources.map(s => [s.x, s.y]),
  );

  for (let i = 0; i < 500; i++) { a.step(); b.step(); }
  assert.notDeepEqual(
    a.allAnts.map(x => [x.cx, x.cy]),
    b.allAnts.map(x => [x.cx, x.cy]),
  );
});

test("an ant sealed into its cell does not crash the simulation", () => {
  // Sealing the last open neighbour of an occupied cell is a permitted edit:
  // applySetWall refuses only nest and food cells. The server simulation has
  // always guarded the empty-candidate case; the client did not, and a trace
  // that records these four strokes is enough to reach it.
  const sim = new Simulation(config());
  for (let i = 0; i < 80; i++) sim.step();

  const blocked = (x: number, y: number) =>
    x < 0 || x >= COLS || y < 0 || y >= ROWS ||
    sim.colonies.some(c => c.nestX === x && c.nestY === y) ||
    sim.foodSources.some(s => s.x === x && s.y === y);

  const ant = sim.allAnts.find(a =>
    !blocked(a.cx, a.cy) &&
    DIRS4.every(([dx, dy]) => !blocked(a.cx + dx, a.cy + dy)));
  assert.ok(ant, "expected an ant whose four neighbours are all wallable");

  for (const [dx, dy] of DIRS4) {
    sim.apply({ kind: "setWall", x: ant.cx + dx, y: ant.cy + dy, open: false });
  }

  assert.doesNotThrow(() => { for (let i = 0; i < 60; i++) sim.step(); });
});
