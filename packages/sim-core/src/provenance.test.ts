import assert from "node:assert/strict";
import test from "node:test";
import {
  Simulation, DEFAULT_PARAMS, DEFAULT_DOCTRINE, DEPOSIT_RATE, TOPOLOGY_MIMICRY, TOPOLOGY_OPEN,
  cloneDoctrine, makeSeeds, mimicMassReceived,
} from "./index";
import type { Doctrine, RunConfig, Topology } from "./index";

function config(overrides: Partial<RunConfig> = {}): RunConfig {
  return {
    seeds: makeSeeds("provenance"),
    numAnts: 1,
    params: DEFAULT_PARAMS,
    loopRate: 0.1,
    numColonies: 2,
    numFoodSources: 1,
    foodPerSource: 500,
    ...overrides,
  };
}

/** Colony 0's doctrine: every ant a spoiler, laying mimic food at half rate, never evaporating. */
function spoilers(): Doctrine {
  const d = cloneDoctrine(DEFAULT_DOCTRINE);
  d.evapRate = 0;
  d.spoilerFraction = 1;
  d.mimicRate = 0.5;
  return d;
}

/** Colony 1's doctrine: a forager that mimics nothing, so everything it receives came from the other side. */
function victim(evapRate: number): Doctrine {
  const d = cloneDoctrine(DEFAULT_DOCTRINE);
  d.evapRate = evapRate;
  return d;
}

function play(topology: Topology, victimEvap = 0): Simulation {
  const sim = new Simulation(config());
  sim.enqueue({ kind: "setTopology", topology });
  sim.enqueue({ kind: "setDoctrine", colony: 0, doctrine: spoilers() });
  sim.enqueue({ kind: "setDoctrine", colony: 1, doctrine: victim(victimEvap) });
  sim.flushPending();
  for (let i = 0; i < 5; i++) sim.step();
  return sim;
}

test("with provenance on, the victim keeps a sublayer per spoiler colony", () => {
  const sim = play(TOPOLOGY_MIMICRY);
  const [a, b] = sim.colonies;
  const fromA = b.received.get(a.id);
  assert.ok(fromA, "colony 1 records what colony 0 laid into it");
  assert.equal(fromA.get("food", a.nestX, a.nestY), 3 * 0.5 * DEPOSIT_RATE);
  assert.equal(fromA.get("food", a.nestX, a.nestY), b.field.get("food", a.nestX, a.nestY),
    "the sublayer mirrors the deposit in the real layer");
  assert.equal(a.received.size, 0, "colony 0 received nothing");
  assert.equal(mimicMassReceived(b), 3 * 0.5 * DEPOSIT_RATE);
  assert.equal(mimicMassReceived(a), 0);
});

test("the sublayer decays at the victim's rate, like the layer it mirrors", () => {
  const sim = play(TOPOLOGY_MIMICRY, 0.5);
  const [a, b] = sim.colonies;
  const fromA = b.received.get(a.id)!;
  const v = fromA.get("food", a.nestX, a.nestY);
  assert.ok(v > 0 && v < 3 * 0.5 * DEPOSIT_RATE, "decayed but present");
  assert.equal(v, b.field.get("food", a.nestX, a.nestY));
});

test("with provenance off, nothing is recorded", () => {
  const sim = play({ ...TOPOLOGY_MIMICRY, visible: { ...TOPOLOGY_MIMICRY.visible }, provenance: false });
  assert.equal(sim.colonies[1].received.size, 0);
  assert.equal(sim.colonies[1].field.get("food", sim.colonies[0].nestX, sim.colonies[0].nestY), 3 * 0.5 * DEPOSIT_RATE,
    "the real deposit still lands");
});

test("under the open option there is no target to attribute to", () => {
  const sim = play({ ...TOPOLOGY_OPEN, visible: { ...TOPOLOGY_OPEN.visible }, provenance: true });
  assert.equal(sim.colonies[0].received.size, 0);
  assert.equal(sim.colonies[1].received.size, 0);
});
