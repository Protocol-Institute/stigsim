import assert from "node:assert/strict";
import test from "node:test";
import { InfiniteSimulation } from "./sim";

test("structural world state survives a persistence round trip", () => {
  const original = new InfiniteSimulation();
  original.setWall(4, 5, true);
  const food = original.addFood(8, 9, 321);

  const removedLow = original.addColony(0, 0, { name: "Removed low" });
  const colony = original.addColony(2, 3, { name: "Durable", numAnts: 3 });
  const removedHigh = original.addColony(4, 6, { name: "Removed high" });
  original.removeColony(removedLow.id);
  original.removeColony(removedHigh.id);

  for (let i = 0; i < 125; i++) original.step();

  // Set the partial amount after stepping, not before. Ants forage during
  // those 125 steps, and whether one reaches (8,9) from (2,3) in time is a
  // coin toss — which made this assertion fail roughly one run in eight
  // while looking like a persistence bug.
  food.remaining = 111;
  colony.foodCollected = 47;
  colony.setAt("food", 50, 50, 500);

  const restored = new InfiniteSimulation();
  restored.restorePersistence(original.serializePersistence());

  const restoredColony = restored.colonies[0];
  const restoredFood = restored.foodSources[0];
  const nextColony = restored.addColony(10, 10, { name: "Next" });

  assert.equal(restored.walls.has("4,5"), true);
  assert.equal(restoredFood.remaining, 111);
  assert.equal(restoredFood.total, 321);
  assert.equal(restoredColony.id, colony.id);
  assert.equal(nextColony.id, 3);
  assert.equal(restored.tick - restoredColony.bornAtTick, 125);
  assert.equal(restoredColony.foodCollected, 47);
  assert.equal(restoredColony.ants.length, 3);
  assert.equal(restoredColony.getAt("food", 50, 50), 0);
});
