import assert from "node:assert/strict";
import test from "node:test";
import {
  Simulation, DEFAULT_PARAMS, DEFAULT_DOCTRINE, ODOR_LEVEL, NEST_HALO,
  TOPOLOGY_OPEN, TOPOLOGY_SENSING, cloneDoctrine, deterministicPow, makeRng, makeSeeds,
} from "./index";
import { STATE_CHANNEL, chooseNext, odor, readPair, scoreCell } from "./score";
import type { RunConfig } from "./index";

function config(overrides: Partial<RunConfig> = {}): RunConfig {
  return {
    seeds: makeSeeds("score-test"),
    numAnts: 20,
    params: DEFAULT_PARAMS,
    loopRate: 0.1,
    numColonies: 2,
    numFoodSources: 2,
    foodPerSource: 500,
    ...overrides,
  };
}

/** An open cell at least two steps from every nest and not a food source: no odor lands there. */
function plainCell(sim: Simulation): [number, number] {
  for (let y = 2; y < sim.bounds.rows - 2; y++) {
    for (let x = 2; x < sim.bounds.cols - 2; x++) {
      if (!sim.occupancy.isOpen(x, y)) continue;
      if (sim.colonies.some(c => Math.abs(c.nestX - x) + Math.abs(c.nestY - y) <= 1)) continue;
      if (sim.foodSources.some(s => s.x === x && s.y === y)) continue;
      return [x, y];
    }
  }
  throw new Error("no plain cell");
}

/** The rule this generalises: (trail + 1) ^ power over one channel of the colony's own field. */
const legacy = (value: number, power: number) => deterministicPow(value + 1, power);

test("with the default doctrine and a private field the score is the old rule bit for bit", () => {
  const sim = new Simulation(config());
  const colony = sim.colonies[0];
  const [x, y] = plainCell(sim);
  for (const v of [0, 0.5, 1, 61, 123.456, 1000, 5000]) {
    colony.field.set("food", x, y, v);
    colony.field.set("home", x, y, v * 0.37);
    const searching = scoreCell(sim, colony, DEFAULT_DOCTRINE.forager, "searching", x, y);
    assert.ok(Object.is(searching, legacy(colony.field.get("food", x, y), 5)), `searching at ${v}`);
    const returning = scoreCell(sim, colony, DEFAULT_DOCTRINE.forager, "returning", x, y);
    assert.ok(Object.is(returning, legacy(colony.field.get("home", x, y), 5)), `returning at ${v}`);
  }
});

test("a negative exponent repels", () => {
  const sim = new Simulation(config());
  const colony = sim.colonies[0];
  const [x, y] = plainCell(sim);
  const table = cloneDoctrine(DEFAULT_DOCTRINE).forager;
  table.follow.searching.food.own = -2;
  colony.field.set("food", x, y, 99);
  assert.equal(scoreCell(sim, colony, table, "searching", x, y), 1 / (100 * 100));
});

test("searching ants steer by food and returning ants by home", () => {
  assert.equal(STATE_CHANNEL.searching, "food");
  assert.equal(STATE_CHANNEL.returning, "home");
});

test("nest odor is private to the colony and haloed to its neighbours", () => {
  const sim = new Simulation(config());
  const [a, b] = sim.colonies;
  assert.equal(odor(a, sim.foodSources, "returning", a.nestX, a.nestY), ODOR_LEVEL);
  assert.equal(odor(a, sim.foodSources, "returning", a.nestX + 1, a.nestY), ODOR_LEVEL * NEST_HALO);
  assert.equal(odor(a, sim.foodSources, "returning", a.nestX + 1, a.nestY + 1), 0, "diagonals are not neighbours");
  assert.equal(odor(a, sim.foodSources, "returning", a.nestX + 2, a.nestY), 0);
  assert.equal(odor(b, sim.foodSources, "returning", a.nestX, a.nestY), 0, "another colony's nest has no smell");
  assert.equal(odor(a, sim.foodSources, "searching", a.nestX, a.nestY), 0, "a searching ant does not smell home");
});

test("food odor is on a live source and gone when it is empty", () => {
  const sim = new Simulation(config());
  const src = sim.foodSources[0];
  const colony = sim.colonies[0];
  assert.equal(odor(colony, sim.foodSources, "searching", src.x, src.y), ODOR_LEVEL);
  assert.equal(odor(colony, sim.foodSources, "searching", src.x + 1, src.y), 0, "no halo on food");
  assert.equal(odor(colony, sim.foodSources, "returning", src.x, src.y), 0, "a returning ant does not smell food");
  src.remaining = 0;
  assert.equal(odor(colony, sim.foodSources, "searching", src.x, src.y), 0);
});

test("odor enters the read, so it pulls regardless of trail strength", () => {
  const sim = new Simulation(config());
  const colony = sim.colonies[0];
  const nest = scoreCell(sim, colony, DEFAULT_DOCTRINE.forager, "returning", colony.nestX, colony.nestY);
  assert.ok(Object.is(nest, legacy(ODOR_LEVEL, 5)));
});

test("readPair follows the topology's read mode and visibility", () => {
  const sim = new Simulation(config());
  const [a, b] = sim.colonies;
  const [x, y] = plainCell(sim);
  a.field.set("food", x, y, 10);
  b.field.set("food", x, y, 3);
  a.field.set("home", x, y, 7);
  b.field.set("home", x, y, 2);

  assert.deepEqual(readPair(sim, a, "food", x, y), [10, 0], "private: own only");

  sim.topology = TOPOLOGY_SENSING;
  assert.deepEqual(readPair(sim, a, "food", x, y), [10, 3], "separable: own and the others' sum");
  assert.deepEqual(readPair(sim, b, "home", x, y), [2, 7]);

  sim.topology = TOPOLOGY_OPEN;
  assert.deepEqual(readPair(sim, a, "food", x, y), [13, 0], "shared: one sum, no origin");
  assert.deepEqual(readPair(sim, a, "home", x, y), [7, 0], "home is invisible under the open option");
});

test("chooseNext spends exactly one draw and returns a candidate", () => {
  const sim = new Simulation(config());
  const colony = sim.colonies[0];
  const [x, y] = plainCell(sim);
  const cells: [number, number][] = [[x, y], [x + 1, y], [x, y + 1]];
  const rng = makeRng("choose");
  const before = rng.draws;
  const next = chooseNext(sim, colony, DEFAULT_DOCTRINE.forager, "searching", cells, rng);
  assert.equal(rng.draws - before, 1);
  assert.ok(cells.some(([cx, cy]) => cx === next[0] && cy === next[1]));
});

test("the nest and food cells are no longer written into the field", () => {
  const sim = new Simulation(config({ numColonies: 1 }));
  const colony = sim.colonies[0];
  sim.step();
  assert.equal(colony.field.get("home", colony.nestX, colony.nestY), 0, "no ant has left the nest yet, so nothing is there");
  // At the first pickup the old engine set the source cell to 1000 food
  // pheromone; nothing has returned through it yet, so it now reads zero.
  let carrier = null as null | { lastSourceX: number | null; lastSourceY: number | null };
  for (let i = 0; i < 4000 && carrier === null; i++) {
    sim.step();
    carrier = colony.ants.find(a => a.hasFood) ?? null;
  }
  assert.ok(carrier && carrier.lastSourceX !== null && carrier.lastSourceY !== null, "expected a pickup within 4000 ticks");
  assert.equal(colony.field.get("food", carrier.lastSourceX, carrier.lastSourceY), 0);
});

test("each colony's layer decays at its own doctrine's rate", () => {
  const sim = new Simulation(config());
  const [a, b] = sim.colonies;
  const still = cloneDoctrine(DEFAULT_DOCTRINE);
  still.evapRate = 0;
  const fast = cloneDoctrine(DEFAULT_DOCTRINE);
  fast.evapRate = 0.5;
  sim.enqueue({ kind: "setDoctrine", colony: 0, doctrine: still });
  sim.enqueue({ kind: "setDoctrine", colony: 1, doctrine: fast });
  sim.step();
  const [x, y] = plainCell(sim);
  a.field.set("food", x, y, 100);
  b.field.set("food", x, y, 100);
  sim.step();
  assert.equal(a.field.get("food", x, y), 100);
  assert.equal(b.field.get("food", x, y), 50);
});

test("ants still collect food within 4000 steps", () => {
  const sim = new Simulation(config({ numColonies: 1 }));
  for (let i = 0; i < 4000; i++) sim.step();
  assert.ok(sim.totalFoodCollected > 0, `expected foraging, got ${sim.totalFoodCollected}`);
});
