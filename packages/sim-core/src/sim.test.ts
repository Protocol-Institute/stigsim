import assert from "node:assert/strict";
import test from "node:test";
import {
  Simulation, DEFAULT_PARAMS, COLS, ROWS, DIRS4, makeSeeds, DenseField, DenseGrid,
} from "./index";
import type { CellType, RunConfig, WorldSpec } from "./index";

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

/** Every cell's openness, row-major, for comparing two worlds. */
function openness(sim: Simulation): boolean[] {
  const out: boolean[] = [];
  for (let y = 0; y < sim.bounds.rows; y++) {
    for (let x = 0; x < sim.bounds.cols; x++) out.push(sim.occupancy.isOpen(x, y));
  }
  return out;
}

test("a fresh simulation has a maze, one colony, and one food source", () => {
  const sim = build();
  assert.equal(sim.bounds.rows, ROWS);
  assert.equal(sim.bounds.cols, COLS);
  assert.equal(sim.colonies.length, 1);
  assert.equal(sim.foodSources.length, 1);
  assert.equal(sim.allAnts.length, 20);
  assert.equal(sim.totalFoodCollected, 0);
});

test("the nest cell and every food source sit on open ground", () => {
  const sim = build();
  const nest = sim.colonies[0];
  assert.equal(sim.occupancy.isOpen(nest.nestX, nest.nestY), true);
  for (const src of sim.foodSources) {
    assert.equal(sim.occupancy.isOpen(src.x, src.y), true);
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

test("setAntCount keeps manual control on the ant it was given to", () => {
  const sim = new Simulation(config({ numAnts: 5, numColonies: 2 }));
  sim.enqueue({ kind: "setManualAnt", index: 7 });
  sim.step();
  const controlled = sim.allAnts[7];
  assert.equal(controlled.manual, true);

  // Flat order is colony 0's ants then colony 1's, so growing colony 0 pushes
  // the controlled ant — colony 1's third — from index 7 to index 10.
  sim.setAntCount(8);
  assert.equal(sim.manualAntIndex, 10);
  assert.equal(sim.allAnts[10], controlled);

  // And shrinking pulls it back, to index 5 at three ants per colony.
  sim.setAntCount(3);
  assert.equal(sim.manualAntIndex, 5);
  assert.equal(sim.allAnts[5], controlled);
  assert.equal(sim.allAnts.filter(a => a.manual).length, 1);
});

test("setAntCount clears manual control when it shrinks the ant away", () => {
  const sim = new Simulation(config({ numAnts: 5, numColonies: 2 }));
  sim.enqueue({ kind: "setManualAnt", index: 7 });
  sim.step();

  // Two per colony drops colony 1's third ant, which is the controlled one.
  sim.setAntCount(2);
  assert.equal(sim.manualAntIndex, null);
  assert.equal(sim.allAnts.filter(a => a.manual).length, 0);
});

test("moveManualAnt still drives the controlled ant across a resize", () => {
  const sim = new Simulation(config({ numAnts: 5, numColonies: 2 }));
  sim.enqueue({ kind: "setManualAnt", index: 7 });
  sim.step();
  const controlled = sim.allAnts[7];

  sim.setAntCount(8);
  const impostor = sim.allAnts[7];
  assert.notEqual(impostor, controlled);
  const before: [number, number] = [impostor.tx, impostor.ty];

  const dir = DIRS4.find(([dx, dy]) => sim.occupancy.isOpen(controlled.cx + dx, controlled.cy + dy));
  assert.ok(dir, "expected the controlled ant to have somewhere to go");
  sim.enqueue({ kind: "moveManualAnt", dx: dir[0], dy: dir[1] });
  sim.flushPending();

  assert.deepEqual([controlled.tx, controlled.ty], [controlled.cx + dir[0], controlled.cy + dir[1]]);
  assert.deepEqual([impostor.tx, impostor.ty], before);
});

test("the same seeds produce an identical run", () => {
  const c = config();
  const a = new Simulation(c);
  const b = new Simulation(c);
  for (let i = 0; i < 500; i++) { a.step(); b.step(); }
  assert.equal(a.totalFoodCollected, b.totalFoodCollected);
  assert.deepEqual(openness(a), openness(b));
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

  assert.deepEqual(openness(a), openness(b));
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

test("a caller can supply a world that is not a maze", () => {
  // A 9x9 room walled only at its border. Nothing here comes from generateMaze,
  // which is the point: the simulation no longer builds its own world, it just
  // defaults to one.
  const size = 9;
  const cells: CellType[][] = Array.from({ length: size }, (_, y) =>
    Array.from({ length: size }, (_, x) =>
      (x === 0 || y === 0 || x === size - 1 || y === size - 1 ? 0 : 1) as CellType));

  const room: WorldSpec = {
    occupancy: new DenseGrid(cells),
    nests: [[1, 1], [7, 7], [7, 1], [1, 7]],
    createField: () => new DenseField(size, size),
  };

  const sim = new Simulation(config({ numAnts: 12, foodPerSource: 200 }), room);

  assert.deepEqual(sim.bounds, { cols: size, rows: size });
  assert.equal(sim.colonies[0].nestX, 1);
  assert.equal(sim.colonies[0].nestY, 1);
  assert.equal(sim.foodSources.length, 1);
  assert.equal(sim.occupancy.isOpen(0, 0), false, "the border stays walled");

  for (let i = 0; i < 2000; i++) sim.step();
  assert.ok(
    sim.totalFoodCollected > 0,
    `expected foraging in the open room, got ${sim.totalFoodCollected}`,
  );
});

test("an unbounded world is refused", () => {
  const unbounded: WorldSpec = {
    occupancy: { bounds: null, isOpen: () => true, setOpen: () => {} },
    nests: [[0, 0]],
    createField: () => new DenseField(4, 4),
  };

  // Placing food walks the whole world and the fingerprint hashes it, and
  // neither has a meaning over unbounded space. The chunked backing settles
  // that; until then this is refused rather than silently wrong.
  assert.throws(() => new Simulation(config(), unbounded), RangeError);
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
