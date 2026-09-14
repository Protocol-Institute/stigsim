import assert from "node:assert/strict";
import test from "node:test";
import {
  Simulation, DEFAULT_PARAMS, DEFAULT_DOCTRINE, DEPOSIT_RATE,
  TOPOLOGY_MIMICRY, TOPOLOGY_OPEN, TOPOLOGY_PRIVATE, TOPOLOGY_SENSING,
  cloneDoctrine, makeSeeds, readPair,
} from "./index";
import type { Doctrine, RunConfig, Topology } from "./index";

function config(overrides: Partial<RunConfig> = {}): RunConfig {
  return {
    seeds: makeSeeds("topology-play"),
    numAnts: 1,
    params: DEFAULT_PARAMS,
    loopRate: 0.1,
    numColonies: 2,
    numFoodSources: 1,
    foodPerSource: 500,
    ...overrides,
  };
}

function allSpoilers(): Doctrine {
  const d = cloneDoctrine(DEFAULT_DOCTRINE);
  d.evapRate = 0;
  d.spoilerFraction = 1;
  d.mimicRate = 0.5;
  return d;
}

/** A run under one topology, set by command; colony 0 runs `doctrine0`, colony 1 is all spoilers. */
function play(topology: Topology, doctrine0: Doctrine = allSpoilers(), ticks = 5): Simulation {
  const sim = new Simulation(config());
  sim.enqueue({ kind: "setTopology", topology });
  sim.enqueue({ kind: "setDoctrine", colony: 0, doctrine: doctrine0 });
  sim.enqueue({ kind: "setDoctrine", colony: 1, doctrine: allSpoilers() });
  sim.flushPending();
  for (let i = 0; i < ticks; i++) sim.step();
  return sim;
}

test("setTopology reaches the simulation for every option", () => {
  for (const t of [TOPOLOGY_PRIVATE, TOPOLOGY_SENSING, TOPOLOGY_MIMICRY, TOPOLOGY_OPEN]) {
    const sim = new Simulation(config());
    sim.enqueue({ kind: "setTopology", topology: t });
    sim.step();
    assert.deepEqual(sim.topology, t);
    assert.deepEqual(sim.commandLog.map(c => c.cmd.kind), ["setTopology"]);
  }
});

test("option 1: a mimic deposit reaches nobody", () => {
  const sim = play(TOPOLOGY_PRIVATE);
  const [a, b] = sim.colonies;
  assert.equal(b.field.get("food", a.nestX, a.nestY), 0);
  assert.equal(a.field.get("food", a.nestX, a.nestY), 0);
});

test("option 2: the opponent's trail is readable but nothing is written across", () => {
  // Colony 0 forages normally, so its departing ant lays home into its nest
  // cell; colony 1 can read that under this option but cannot write there.
  const sim = play(TOPOLOGY_SENSING, cloneDoctrine(DEFAULT_DOCTRINE));
  const [a, b] = sim.colonies;
  assert.equal(a.field.get("food", b.nestX, b.nestY), 0, "mimicry is off: colony 1's spoiler laid nothing into colony 0");
  const homeAtNest = a.field.get("home", a.nestX, a.nestY);
  assert.ok(homeAtNest > 0, "colony 0 laid home leaving its nest");
  assert.deepEqual(readPair(sim, b, "home", a.nestX, a.nestY), [0, homeAtNest]);
});

test("option 3: a mimic deposit lands in the opponent's layer at the capped rate", () => {
  const sim = play(TOPOLOGY_MIMICRY);
  const [a, b] = sim.colonies;
  assert.equal(b.field.get("food", a.nestX, a.nestY), 3 * 0.5 * DEPOSIT_RATE);
  assert.deepEqual(readPair(sim, b, "food", a.nestX, a.nestY), [3 * 0.5 * DEPOSIT_RATE, 0],
    "the victim reads it as its own");
});

test("option 4: the deposit is the spoiler's own, summed into one field for everyone", () => {
  const sim = play(TOPOLOGY_OPEN);
  const [a, b] = sim.colonies;
  const laid = 3 * 0.5 * DEPOSIT_RATE;
  assert.equal(a.field.get("food", a.nestX, a.nestY), laid);
  assert.equal(b.field.get("food", a.nestX, a.nestY), 0);
  assert.deepEqual(readPair(sim, b, "food", a.nestX, a.nestY), [laid, 0], "b reads the sum with no origin");
  assert.deepEqual(readPair(sim, b, "home", a.nestX, a.nestY), [0, 0], "home stays private under the open option");
});
