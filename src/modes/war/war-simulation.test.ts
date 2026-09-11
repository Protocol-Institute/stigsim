import assert from "node:assert/strict";
import test from "node:test";
import {
  CELL, DEFAULT_DOCTRINE, DEFAULT_PARAMS, TOPOLOGY_MIMICRY,
  cloneDoctrine, fingerprint, type Ant, type Colony,
} from "@stigsim/sim-core";
import { WarSimulation } from "./war-simulation";

function forceAtNest(ant: Ant, colony: Colony) {
  ant.cx = colony.nestX;
  ant.cy = colony.nestY;
  ant.tx = colony.nestX;
  ant.ty = colony.nestY;
  ant.x = colony.nestX * CELL + CELL / 2;
  ant.y = colony.nestY * CELL + CELL / 2;
  ant.state = "returning";
}

test("a War match starts with its selected topology and full per-colony doctrines", () => {
  const saboteur = cloneDoctrine(DEFAULT_DOCTRINE);
  saboteur.spoilerFraction = 0.25;
  saboteur.mimicRate = 0.5;
  const war = new WarSimulation(
    { masterSeed: "full-doctrine", startingAnts: 8, topology: TOPOLOGY_MIMICRY },
    [saboteur, DEFAULT_DOCTRINE],
  );

  assert.deepEqual(war.simulation.topology, TOPOLOGY_MIMICRY);
  assert.equal(war.getFullDoctrine(0).spoilerFraction, 0.25);
  assert.equal(war.simulation.colonies[0].ants.filter(ant => ant.role === "spoiler").length, 2);
  assert.ok(war.simulation.colonies[1].ants.every(ant => ant.role === "forager"));
});

test("doctrine changes wait until an ant returns to its nest", () => {
  const war = new WarSimulation(
    { masterSeed: "doctrine-test", startingAnts: 1 },
    [DEFAULT_PARAMS, DEFAULT_PARAMS],
    { maxEnergy: 3, retreatEnergy: 2, minDepartEnergy: 2 },
  );
  const colony = war.simulation.colonies[0];
  const ant = colony.ants[0];
  const changed = { ...DEFAULT_PARAMS, trailPower: 8, tankMax: 8800 };

  war.setDoctrine(0, changed);
  assert.equal(war.getMetrics(0).doctrineChanged, true);
  assert.equal(war.getAntSnapshot(ant)?.doctrine.trailPower, DEFAULT_PARAMS.trailPower);
  war.step();
  war.step();
  assert.equal(war.getAntSnapshot(ant)?.phase, "retreating");
  assert.equal(war.getAntSnapshot(ant)?.doctrine.trailPower, DEFAULT_PARAMS.trailPower);

  forceAtNest(ant, colony);
  war.step();
  assert.equal(war.getAntSnapshot(ant)?.doctrine.trailPower, changed.trailPower);
  assert.equal(war.getAntSnapshot(ant)?.doctrineVersion, 1);
  assert.equal(war.getMetrics(0).doctrineAdopted, 1);
  assert.equal(war.getMetrics(0).doctrineChanged, false);
});

test("metrics account for every living ant and current doctrine adoption", () => {
  const war = new WarSimulation({ masterSeed: "metrics-test", startingAnts: 3 });
  const initial = war.getMetrics(0);

  assert.deepEqual(initial, {
    population: 3,
    foodCollected: 0,
    reserve: 18,
    hatching: 0,
    searching: 3,
    carrying: 0,
    retreating: 0,
    waiting: 0,
    lowEnergy: 0,
    births: 0,
    deaths: 0,
    doctrineChanged: false,
    doctrineAdopted: 3,
  });

  war.setDoctrine(0, { ...DEFAULT_PARAMS, trailPower: 7 });
  const changed = war.getMetrics(0);
  assert.equal(changed.doctrineChanged, true);
  assert.equal(changed.doctrineAdopted, 0);
  assert.equal(changed.searching + changed.carrying + changed.retreating + changed.waiting, changed.population);
});

test("movement consumes energy and low-energy ants retreat", () => {
  const war = new WarSimulation(
    { masterSeed: "energy-test", startingAnts: 1 },
    undefined,
    { maxEnergy: 3, retreatEnergy: 2, minDepartEnergy: 2 },
  );
  const ant = war.simulation.colonies[0].ants[0];
  war.step();
  assert.equal(war.getAntSnapshot(ant)?.energy, 3);
  war.step();
  assert.equal(war.getAntSnapshot(ant)?.energy, 2);
  // Retreat begins on the step that reaches the threshold, an intentional
  // improvement over the prototype's one-step delay.
  assert.equal(war.getAntSnapshot(ant)?.phase, "retreating");
  assert.equal(ant.hasFood, false);
});

test("an ant refuels from its colony reserve at the nest", () => {
  const war = new WarSimulation(
    { masterSeed: "refuel-test", startingAnts: 1 },
    undefined,
    {
      maxEnergy: 3,
      retreatEnergy: 2,
      minDepartEnergy: 2,
      startingReservePerAnt: 1,
      energyPerFood: 10,
    },
  );
  const colony = war.simulation.colonies[0];
  const ant = colony.ants[0];
  war.step();
  war.step();
  forceAtNest(ant, colony);
  war.step();

  assert.equal(war.getAntSnapshot(ant)?.energy, 3);
  assert.equal(war.getAntSnapshot(ant)?.phase, "searching");
  assert.equal(war.getMetrics(0).reserve, 0.9);
});

test("an under-fueled ant waits at the nest and keeps consuming energy", () => {
  const war = new WarSimulation(
    { masterSeed: "waiting-test", startingAnts: 1 },
    undefined,
    {
      maxEnergy: 1000,
      retreatEnergy: 990,
      minDepartEnergy: 1000,
      startingReservePerAnt: 0,
      reproductionCheckSteps: 10_000,
    },
  );
  for (let i = 0; i < 100 && war.getMetrics(0).waiting === 0; i++) war.step();
  assert.equal(war.getMetrics(0).waiting, 1);
  const ant = war.simulation.colonies[0].ants[0];
  const before = war.getAntSnapshot(ant)!.energy;
  war.step();
  assert.equal(war.getAntSnapshot(ant)!.energy, before - 0.25);
});

test("a waiting ant refuels before departing on the following step", () => {
  const war = new WarSimulation(
    { masterSeed: "waiting-departure-test", startingAnts: 2 },
    undefined,
    {
      maxEnergy: 1000,
      retreatEnergy: 990,
      minDepartEnergy: 1000,
      startingReservePerAnt: 0,
      reproductionCheckSteps: 10_000,
    },
  );
  const colony = war.simulation.colonies[0];
  for (let i = 0; i < 1000 && war.getMetrics(0).waiting === 0; i++) war.step();
  const waitingAnt = colony.ants.find(ant => war.getAntSnapshot(ant)?.phase === "waiting");
  assert.ok(waitingAnt);

  const deliveringAnt = colony.ants.find(ant => ant !== waitingAnt);
  assert.ok(deliveringAnt);
  forceAtNest(deliveringAnt, colony);
  deliveringAnt.hasFood = true;
  war.step();

  const nestPosition = [waitingAnt.x, waitingAnt.y];
  war.step();
  assert.equal(war.getAntSnapshot(waitingAnt)?.phase, "searching");
  assert.deepEqual([waitingAnt.x, waitingAnt.y], nestPosition);

  const energyBeforeDeparture = war.getAntSnapshot(waitingAnt)!.energy;
  war.step();
  assert.notDeepEqual([waitingAnt.x, waitingAnt.y], nestPosition);
  assert.equal(war.getAntSnapshot(waitingAnt)!.energy, energyBeforeDeparture - 1);
});

test("refueling never drives a colony reserve below zero", () => {
  const war = new WarSimulation({ masterSeed: "neg-36", startingAnts: 3 });
  for (let step = 0; step < 2000 && war.result === null; step++) {
    war.step();
    assert.ok(war.getMetrics(0).reserve >= 0, `colony 0 reserve was negative at step ${step + 1}`);
    assert.ok(war.getMetrics(1).reserve >= 0, `colony 1 reserve was negative at step ${step + 1}`);
  }
});

test("food deliveries add to the colony reserve", () => {
  const war = new WarSimulation(
    { masterSeed: "delivery-test", startingAnts: 20 },
    undefined,
    {
      maxEnergy: 100_000,
      retreatEnergy: 1,
      minDepartEnergy: 2,
      startingReservePerAnt: 0,
      energyPerFood: Number.POSITIVE_INFINITY,
      reproductionCost: 1_000_000,
    },
  );
  for (let i = 0; i < 4000 && war.getMetrics(0).foodCollected === 0; i++) war.step();
  const metrics = war.getMetrics(0);
  assert.ok(metrics.foodCollected > 0);
  assert.equal(metrics.reserve, metrics.foodCollected * 20);
});

test("surplus reserve develops and hatches new ants deterministically", () => {
  const options = {
    maxEnergy: 100,
    retreatEnergy: 10,
    minDepartEnergy: 20,
    startingReservePerAnt: 10,
    reproductionCost: 1,
    reproductionCheckSteps: 1,
    hatchSteps: 2,
    safetyReservePerAnt: 0,
    emergencyPopulationLimit: 2,
  };
  const first = new WarSimulation({ masterSeed: "brood-test", startingAnts: 1 }, undefined, options);
  const second = new WarSimulation({ masterSeed: "brood-test", startingAnts: 1 }, undefined, options);

  for (let i = 0; i < 5; i++) {
    first.step();
    second.step();
    assert.deepEqual(first.getMetrics(0), second.getMetrics(0));
  }
  assert.equal(first.getMetrics(0).population, 2);
  assert.equal(first.getMetrics(0).births, 1);
});

test("the reproduction clock keeps advancing while a colony has no live ants", () => {
  const war = new WarSimulation({ masterSeed: "empty-colony-clock", startingAnts: 1 });
  const colony = war.simulation.colonies[0];
  colony.ants.length = 0;

  const runtime = war as unknown as {
    colonyRuntime: Array<{ reproductionClock: number }>;
  };
  const before = runtime.colonyRuntime[0].reproductionClock;

  war.step();

  assert.equal(runtime.colonyRuntime[0].reproductionClock, before + 1);
});

test("an empty colony uses its pending doctrine for pheromone evaporation", () => {
  const war = new WarSimulation({ masterSeed: "empty-evaporation", startingAnts: 1 });
  const colony = war.simulation.colonies[0];
  colony.ants.length = 0;
  war.setDoctrine(0, { ...DEFAULT_PARAMS, evapRate: 0.02 });

  const cell = [0, 0] as const;
  colony.field.set("home", cell[0], cell[1], 100);
  war.step();

  assert.ok(Math.abs(colony.field.get("home", cell[0], cell[1]) - 98) < 0.001);
});

test("same-seed War Mode remains deterministic through doctrine changes", () => {
  const settings = {
    masterSeed: "long-war-equivalence",
    startingAnts: 8,
    foodSources: 4,
    foodPerSource: 2_000,
  };
  const first = new WarSimulation(settings);
  const second = new WarSimulation(settings);
  const changes = new Map([
    [400, [0, { ...DEFAULT_PARAMS, evapRate: 0.012, trailPower: 7 }] as const],
    [1_200, [1, { ...DEFAULT_PARAMS, tankMax: 12_000, cautionary: true }] as const],
    [2_100, [0, { ...DEFAULT_PARAMS, evapRate: 0.003, tankMax: 8_800 }] as const],
  ]);

  for (let tick = 0; tick < 3_000; tick++) {
    const change = changes.get(tick);
    if (change) {
      first.setDoctrine(change[0], change[1]);
      second.setDoctrine(change[0], change[1]);
    }
    first.step();
    second.step();

    if ((tick + 1) % 100 === 0) {
      assert.equal(fingerprint(first.simulation), fingerprint(second.simulation));
      assert.deepEqual(first.getMetrics(0), second.getMetrics(0));
      assert.deepEqual(first.getMetrics(1), second.getMetrics(1));
      for (const colonyId of [0, 1]) {
        assert.deepEqual(
          first.simulation.colonies[colonyId].ants.map(ant => first.getAntSnapshot(ant)),
          second.simulation.colonies[colonyId].ants.map(ant => second.getAntSnapshot(ant)),
        );
      }
    }
  }
  assert.equal(first.result, second.result);
});

test("colony 0 can win and a decided match no longer advances", () => {
  const war = new WarSimulation({ masterSeed: "colony-zero-wins", startingAnts: 1 });
  war.simulation.colonies[1].ants.length = 0;

  war.step();
  assert.equal(war.result, 0);
  const decidedAt = war.simulation.tick;

  war.step();
  assert.equal(war.simulation.tick, decidedAt);
  assert.equal(war.result, 0);
});

test("ant death ends a match when neither colony survives", () => {
  const war = new WarSimulation(
    { masterSeed: "extinction-test", startingAnts: 1 },
    undefined,
    {
      maxEnergy: 1,
      retreatEnergy: 0,
      minDepartEnergy: 1,
      startingReservePerAnt: 0,
      reproductionCheckSteps: 100,
    },
  );
  war.step();
  war.step();
  assert.equal(war.getMetrics(0).deaths, 1);
  assert.equal(war.getMetrics(1).deaths, 1);
  assert.equal(war.result, "draw");
});
