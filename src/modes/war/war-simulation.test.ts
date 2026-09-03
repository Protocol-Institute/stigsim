import assert from "node:assert/strict";
import test from "node:test";
import { CELL, DEFAULT_PARAMS, type Ant, type Colony } from "@stigsim/sim-core";
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
  assert.equal(war.getAntSnapshot(ant)?.doctrine.trailPower, DEFAULT_PARAMS.trailPower);
  war.step();
  war.step();
  assert.equal(war.getAntSnapshot(ant)?.phase, "retreating");
  assert.equal(war.getAntSnapshot(ant)?.doctrine.trailPower, DEFAULT_PARAMS.trailPower);

  forceAtNest(ant, colony);
  war.step();
  assert.equal(war.getAntSnapshot(ant)?.doctrine.trailPower, changed.trailPower);
  assert.equal(war.getAntSnapshot(ant)?.doctrineVersion, 1);
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
