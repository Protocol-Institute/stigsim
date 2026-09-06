import assert from "node:assert/strict";
import test from "node:test";
import {
  Simulation, DEFAULT_PARAMS, DEFAULT_DOCTRINE, DEPOSIT_RATE, DEPOSITS_PER_CELL,
  TOPOLOGY_MIMICRY, TOPOLOGY_OPEN, cloneDoctrine, makeSeeds,
} from "./index";
import type { Doctrine, RunConfig } from "./index";

function config(overrides: Partial<RunConfig> = {}): RunConfig {
  return {
    seeds: makeSeeds("lay-test"),
    numAnts: 1,
    params: DEFAULT_PARAMS,
    loopRate: 0.1,
    numColonies: 2,
    numFoodSources: 1,
    foodPerSource: 500,
    ...overrides,
  };
}

/** A doctrine that never evaporates, so deposits can be counted exactly. */
function still(edit: (d: Doctrine) => void = () => {}): Doctrine {
  const d = cloneDoctrine(DEFAULT_DOCTRINE);
  d.evapRate = 0;
  edit(d);
  return d;
}

/** Applies a doctrine to every colony before the first step. */
function start(sim: Simulation, doctrine: Doctrine) {
  for (const colony of sim.colonies) sim.enqueue({ kind: "setDoctrine", colony: colony.id, doctrine });
  sim.flushPending();
}

test("an ant deposits three times into the cell it leaves", () => {
  const sim = new Simulation(config());
  start(sim, still());
  const colony = sim.colonies[0];
  // Tick 1 chooses a target; ticks 2, 3, 4 transit at distances 16, 12, 8 and
  // deposit; tick 5 arrives at distance 4 without depositing.
  for (let i = 0; i < 5; i++) sim.step();
  assert.equal(DEPOSITS_PER_CELL, 3);
  assert.equal(colony.field.get("home", colony.nestX, colony.nestY), DEPOSITS_PER_CELL * DEPOSIT_RATE);
  assert.equal(colony.field.get("food", colony.nestX, colony.nestY), 0, "a searching ant lays home, not food");
});

test("a lay gain scales the deposit", () => {
  const sim = new Simulation(config());
  start(sim, still(d => { d.forager.lay.searching.home.own = 2; }));
  const colony = sim.colonies[0];
  for (let i = 0; i < 5; i++) sim.step();
  assert.equal(colony.field.get("home", colony.nestX, colony.nestY), 3 * 2 * DEPOSIT_RATE);
});

test("a zero lay gain stops laying", () => {
  const sim = new Simulation(config());
  start(sim, still(d => { d.forager.lay.searching.home.own = 0; }));
  const colony = sim.colonies[0];
  for (let i = 0; i < 5; i++) sim.step();
  assert.equal(colony.field.get("home", colony.nestX, colony.nestY), 0);
});

test("the tank drains by what was laid and stops deposits at zero", () => {
  const sim = new Simulation(config({ params: { ...DEFAULT_PARAMS, tankMax: 50 } }));
  start(sim, still());
  const colony = sim.colonies[0];
  const ant = colony.ants[0];
  for (let i = 0; i < 5; i++) sim.step();
  // 20, 20, then the remaining 10.
  assert.equal(colony.field.get("home", colony.nestX, colony.nestY), 50);
  assert.equal(ant.tank, 0);
  const next: [number, number] = [ant.cx, ant.cy];
  for (let i = 0; i < 4; i++) sim.step();
  assert.equal(colony.field.get("home", next[0], next[1]), 0, "an empty tank lays nothing");
});

test("spoilers are the first floor(fraction * total) ants by index", () => {
  const sim = new Simulation(config({ numAnts: 8, numColonies: 1 }));
  start(sim, still(d => { d.spoilerFraction = 0.25; }));
  assert.deepEqual(sim.colonies[0].ants.map(a => a.role),
    ["spoiler", "spoiler", "forager", "forager", "forager", "forager", "forager", "forager"]);
  // Under instant adoption a fraction change re-roles at the tick boundary.
  sim.enqueue({ kind: "setDoctrine", colony: 0, doctrine: still(d => { d.spoilerFraction = 0.5; }) });
  sim.step();
  assert.equal(sim.colonies[0].ants.filter(a => a.role === "spoiler").length, 4);
});

test("under nest adoption a role change waits for the nest event", () => {
  const sim = new Simulation(config({ numAnts: 8, numColonies: 1 }));
  sim.enqueue({ kind: "setAdoption", mode: "nest" });
  sim.enqueue({ kind: "setDoctrine", colony: 0, doctrine: still(d => { d.spoilerFraction = 0.5; }) });
  sim.step();
  assert.ok(sim.colonies[0].ants.every(a => a.role === "forager"), "nobody has been home");
});

test("setAntCount roles new ants against the new total", () => {
  const sim = new Simulation(config({ numAnts: 4, numColonies: 1 }));
  start(sim, still(d => { d.spoilerFraction = 0.5; }));
  assert.deepEqual(sim.colonies[0].ants.map(a => a.role), ["spoiler", "spoiler", "forager", "forager"]);
  sim.enqueue({ kind: "setAntCount", n: 8 });
  sim.step();
  // Existing ants keep their roles; ants 4..7 sit above floor(0.5 * 8) = 4.
  assert.deepEqual(sim.colonies[0].ants.map(a => a.role),
    ["spoiler", "spoiler", "forager", "forager", "forager", "forager", "forager", "forager"]);
});

/** Everyone is a spoiler laying only mimic food while searching. */
function allSpoilers(mimicRate: number): Doctrine {
  return still(d => {
    d.spoilerFraction = 1;
    d.mimicRate = mimicRate;
  });
}

test("a mimic deposit charges the tank but lands nowhere under the private topology", () => {
  const sim = new Simulation(config());
  start(sim, allSpoilers(0.5));
  const [a, b] = sim.colonies;
  for (let i = 0; i < 5; i++) sim.step();
  assert.equal(a.ants[0].tank, DEFAULT_PARAMS.tankMax - 3 * 0.5 * DEPOSIT_RATE);
  assert.equal(a.field.get("food", a.nestX, a.nestY), 0);
  assert.equal(b.field.get("food", a.nestX, a.nestY), 0);
});

test("under separable mimicry the deposit lands in the other colony's layer", () => {
  const sim = new Simulation(config());
  sim.topology = TOPOLOGY_MIMICRY; // maxMimicRate 0.5; set directly to keep the test independent of the command path
  start(sim, allSpoilers(0.5));
  const [a, b] = sim.colonies;
  for (let i = 0; i < 5; i++) sim.step();
  assert.equal(b.field.get("food", a.nestX, a.nestY), 3 * 0.5 * DEPOSIT_RATE);
  assert.equal(a.field.get("food", a.nestX, a.nestY), 0);
});

test("under the open topology the deposit lands in the spoiler's own layer", () => {
  const sim = new Simulation(config());
  sim.topology = TOPOLOGY_OPEN;
  start(sim, allSpoilers(0.5));
  const [a, b] = sim.colonies;
  for (let i = 0; i < 5; i++) sim.step();
  assert.equal(a.field.get("food", a.nestX, a.nestY), 3 * 0.5 * DEPOSIT_RATE);
  assert.equal(b.field.get("food", a.nestX, a.nestY), 0);
});

test("the topology's cap clamps the mimic rate", () => {
  const sim = new Simulation(config());
  sim.topology = { ...TOPOLOGY_MIMICRY, visible: { ...TOPOLOGY_MIMICRY.visible }, maxMimicRate: 0.25 };
  start(sim, allSpoilers(1));
  const [a, b] = sim.colonies;
  for (let i = 0; i < 5; i++) sim.step();
  assert.equal(b.field.get("food", a.nestX, a.nestY), 3 * 0.25 * DEPOSIT_RATE);
});

test("with three colonies a mimic deposit is split between the other two", () => {
  const sim = new Simulation(config({ numColonies: 3 }));
  sim.topology = TOPOLOGY_MIMICRY;
  start(sim, allSpoilers(0.5));
  const [a, b, c] = sim.colonies;
  for (let i = 0; i < 5; i++) sim.step();
  assert.equal(b.field.get("food", a.nestX, a.nestY), 3 * 0.5 * DEPOSIT_RATE / 2);
  assert.equal(c.field.get("food", a.nestX, a.nestY), 3 * 0.5 * DEPOSIT_RATE / 2);
});

test("a mimic deposit stops at an empty tank like any other", () => {
  const sim = new Simulation(config({ params: { ...DEFAULT_PARAMS, tankMax: 25 } }));
  sim.topology = TOPOLOGY_MIMICRY;
  start(sim, allSpoilers(0.5));
  const [a, b] = sim.colonies;
  for (let i = 0; i < 5; i++) sim.step();
  // 10, 10, then the remaining 5.
  assert.equal(b.field.get("food", a.nestX, a.nestY), 25);
  assert.equal(a.ants[0].tank, 0);
});

test("the mimic rate is colony-level: spoilers already out use a new rate at once, even under nest adoption", () => {
  const sim = new Simulation(config());
  sim.topology = TOPOLOGY_MIMICRY;
  start(sim, allSpoilers(0.5));
  const [a, b] = sim.colonies;
  // Tick 1 chooses a target; tick 2 lays the first mimic frame at 0.5 * DEPOSIT_RATE.
  sim.step(); sim.step();
  assert.equal(b.field.get("food", a.nestX, a.nestY), 0.5 * DEPOSIT_RATE);
  // Switch to nest adoption and halve the rate. The ant is mid-transit and does
  // not adopt, yet its next two frames lay at the new colony-level rate.
  sim.enqueue({ kind: "setAdoption", mode: "nest" });
  sim.enqueue({ kind: "setDoctrine", colony: 0, doctrine: allSpoilers(0.25) });
  sim.step(); sim.step();
  // start()'s own setDoctrine already bumped the colony (and, under the
  // default instant adoption, the ant) to version 1 before this test's second
  // setDoctrine (to version 2) ever ran. "Not adopted" means the ant is still
  // on that pre-existing version 1, not on the fresh version 2 — not on 0,
  // which nothing here ever holds. See the final-fix report for this branch's
  // discussion with the review lead: the brief's literal expected value of 0
  // undercounts start()'s own bump.
  assert.equal(a.ants[0].doctrineVersion, 1, "not adopted: still mid-trip, holding the version from before this setDoctrine");
  assert.equal(b.field.get("food", a.nestX, a.nestY), (0.5 + 0.25 + 0.25) * DEPOSIT_RATE);
});

test("role assignment spends no random draws", () => {
  const a = new Simulation(config({ numAnts: 8, numColonies: 1 }));
  const b = new Simulation(config({ numAnts: 8, numColonies: 1 }));
  start(a, still());
  start(b, still(d => { d.spoilerFraction = 0.5; }));
  assert.equal(a.antsDraws, b.antsDraws);
  a.step(); b.step();
  assert.equal(a.antsDraws, b.antsDraws);
});
