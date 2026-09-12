import assert from "node:assert/strict";
import test from "node:test";
import {
  Simulation, DEFAULT_PARAMS, DEFAULT_DOCTRINE, DenseField, DenseGrid, cloneDoctrine, makeSeeds,
} from "./index";
import type { CellType, RunConfig, WorldSpec } from "./index";

function config(overrides: Partial<RunConfig> = {}): RunConfig {
  return {
    seeds: makeSeeds("adoption-test"),
    numAnts: 8,
    params: DEFAULT_PARAMS,
    loopRate: 0.1,
    numColonies: 2,
    numFoodSources: 1,
    foodPerSource: 500,
    ...overrides,
  };
}

/** A 9x9 room with the nest and one food source a few cells apart, so round trips are quick. */
function room(): WorldSpec {
  const size = 9;
  const cells: CellType[][] = Array.from({ length: size }, (_, y) =>
    Array.from({ length: size }, (_, x) =>
      (x === 0 || y === 0 || x === size - 1 || y === size - 1 ? 0 : 1) as CellType));
  return {
    occupancy: new DenseGrid(cells),
    nests: [[1, 1], [7, 7], [7, 1], [1, 7]],
    createField: () => new DenseField(size, size),
  };
}

function refs(sim: Simulation, colony: number) {
  return Object.fromEntries([...sim.colonies[colony].doctrineRefs].sort((a, b) => a[0] - b[0]));
}

test("a fresh simulation runs the default doctrine at version 0 in every colony", () => {
  const sim = new Simulation(config());
  for (const colony of sim.colonies) {
    assert.deepEqual(colony.doctrine, DEFAULT_DOCTRINE);
    assert.equal(colony.doctrineVersion, 0);
    assert.deepEqual([...colony.doctrines.keys()], [0]);
    assert.ok(colony.ants.every(a => a.doctrineVersion === 0 && a.role === "forager"));
  }
  assert.deepEqual(refs(sim, 0), { 0: 8 });
  assert.equal(sim.adoption, "instant");
  assert.equal(sim.topology.read, "private");
});

test("under instant adoption a doctrine change re-stamps every ant at the tick boundary", () => {
  const sim = new Simulation(config());
  const d = cloneDoctrine(DEFAULT_DOCTRINE);
  d.forager.follow.searching.food.own = 7;
  sim.enqueue({ kind: "setDoctrine", colony: 1, doctrine: d });
  assert.equal(sim.colonies[1].doctrineVersion, 0, "not applied before the step");
  sim.step();
  const colony = sim.colonies[1];
  assert.equal(colony.doctrineVersion, 1);
  assert.equal(colony.doctrine.forager.follow.searching.food.own, 7);
  assert.ok(colony.ants.every(a => a.doctrineVersion === 1));
  assert.deepEqual([...colony.doctrines.keys()], [1], "the unreferenced old version is dropped");
  assert.deepEqual(refs(sim, 1), { 1: 8 });
  // Colony 0 is untouched.
  assert.equal(sim.colonies[0].doctrineVersion, 0);
  assert.deepEqual(sim.commandLog.map(c => c.cmd.kind), ["setDoctrine"]);
});

test("the stored doctrine is a copy, not the caller's object", () => {
  const sim = new Simulation(config());
  const d = cloneDoctrine(DEFAULT_DOCTRINE);
  sim.enqueue({ kind: "setDoctrine", colony: 0, doctrine: d });
  sim.step();
  d.evapRate = 0.9;
  assert.equal(sim.colonies[0].doctrine.evapRate, 0.005);
});

test("under nest adoption ants keep their doctrine until they come home", () => {
  const sim = new Simulation(config({ numColonies: 1 }), { world: room() });
  sim.enqueue({ kind: "setAdoption", mode: "nest" });
  sim.step();
  assert.equal(sim.adoption, "nest");

  const d = cloneDoctrine(DEFAULT_DOCTRINE);
  d.evapRate = 0.01;
  sim.enqueue({ kind: "setDoctrine", colony: 0, doctrine: d });
  sim.step();
  const colony = sim.colonies[0];
  assert.equal(colony.doctrineVersion, 1);
  assert.ok(colony.ants.every(a => a.doctrineVersion === 0), "nobody has been home yet");
  assert.deepEqual([...colony.doctrines.keys()], [0, 1]);
  assert.deepEqual(refs(sim, 0), { 0: 8, 1: 0 });

  // Run until the first ant delivers food; it adopts at that nest event.
  let adopted = 0;
  for (let i = 0; i < 6000 && adopted === 0; i++) {
    sim.step();
    adopted = colony.ants.filter(a => a.doctrineVersion === 1).length;
  }
  assert.ok(adopted > 0, "expected at least one ant to come home within 6000 ticks");
  assert.equal(colony.ants.filter(a => a.doctrineVersion === 0).length, 8 - adopted);
  assert.deepEqual([...colony.doctrines.keys()], [0, 1], "both versions live while ants hold both");
  assert.deepEqual(refs(sim, 0), { 0: 8 - adopted, 1: adopted });
});

test("setAntCount keeps the reference counts honest", () => {
  const sim = new Simulation(config({ numColonies: 1 }));
  sim.enqueue({ kind: "setAntCount", n: 12 });
  sim.step();
  assert.deepEqual(refs(sim, 0), { 0: 12 });
  assert.ok(sim.colonies[0].ants.every(a => a.doctrineVersion === 0));
  sim.enqueue({ kind: "setAntCount", n: 3 });
  sim.step();
  assert.deepEqual(refs(sim, 0), { 0: 3 });
});

test("removeAnts releases every removed ant's doctrine reference", () => {
  const sim = new Simulation(config({ numColonies: 1, numAnts: 4 }));
  const removed = sim.removeAnts(0, ant => ant === sim.colonies[0].ants[1]);
  assert.equal(removed, 1);
  assert.equal(sim.colonies[0].ants.length, 3);
  assert.deepEqual(refs(sim, 0), { 0: 3 });
});

test("a doctrine for a colony the run does not have is ignored", () => {
  const sim = new Simulation(config({ numColonies: 1 }));
  sim.enqueue({ kind: "setDoctrine", colony: 3, doctrine: DEFAULT_DOCTRINE });
  assert.doesNotThrow(() => sim.step());
  assert.equal(sim.colonies[0].doctrineVersion, 0);
});

test("setTopology stores a copy", () => {
  const sim = new Simulation(config());
  const t = { read: "private" as const, mimicEnemy: false, visible: { home: false, food: false }, maxMimicRate: 0.25, provenance: false };
  sim.enqueue({ kind: "setTopology", topology: t });
  sim.step();
  assert.equal(sim.topology.maxMimicRate, 0.25);
  t.maxMimicRate = 0.75;
  assert.equal(sim.topology.maxMimicRate, 0.25);
});
