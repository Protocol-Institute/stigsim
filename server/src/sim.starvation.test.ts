import assert from "node:assert/strict";
import test from "node:test";
import { ENERGY_MAX, InfiniteSimulation } from "./sim";

test("a colony without food permanently dies when all ants starve", () => {
  const sim = new InfiniteSimulation();
  const colony = sim.addColony(0, 0, { name: "Hungry", numAnts: 5 });

  for (let i = 0; i < ENERGY_MAX - 1; i++) {
    assert.deepEqual(sim.step(), []);
  }

  assert.equal(colony.ants.length, 5);
  assert.deepEqual(sim.step(), [
    { id: colony.id, name: "Hungry", lifespanTicks: ENERGY_MAX },
  ]);
  assert.equal(sim.colonies.length, 0);

  // Death is permanent: later ticks do not recreate the colony or its ants.
  assert.deepEqual(sim.step(), []);
  assert.equal(sim.colonies.length, 0);
});

test("returning food to the nest restores an ant's energy", () => {
  const sim = new InfiniteSimulation();
  const colony = sim.addColony(0, 0, { name: "Fed", numAnts: 1 });
  const ant = colony.ants[0];
  sim.addFood(0, 0, 1);

  // The ant collects food at the nest, then completes its return on the next
  // simulation step.
  sim.step();
  assert.equal(ant.energy, ENERGY_MAX - 1);
  sim.step();

  assert.equal(ant.energy, ENERGY_MAX);
  assert.equal(colony.foodCollected, 1);
  assert.equal(sim.colonies.length, 1);
});
