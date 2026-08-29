import assert from "node:assert/strict";
import test from "node:test";
import { InfiniteSimulation } from "./sim";
import { DEFAULT_FOOD_SPAWN, type FoodSpawnConfig } from "../../shared/food-spawn";

const CONFIG: FoodSpawnConfig = {
  ...DEFAULT_FOOD_SPAWN,
  capacityUnits: 1_000,
  maxSourcesPerAttempt: 2,
  minUnits: 100,
  maxUnits: 200,
  clusterChance: 0,
};

/** Deterministic stand-in for Math.random so placements are reproducible. */
function cycle(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}

test("a blank world still has somewhere to grow food", () => {
  const sim = new InfiniteSimulation();
  const region = sim.spawnRegion();

  assert.ok(region.maxX > region.minX && region.maxY > region.minY, "region has area");
  assert.ok(region.minX <= 0 && region.maxX >= 0, "region covers the origin");
});

test("the spawn region tracks what the world contains, plus a margin", () => {
  const sim = new InfiniteSimulation();
  sim.setWall(40, 40, true);
  sim.addColony(-10, -10);

  const region = sim.spawnRegion(5);

  assert.equal(region.minX, -15);
  assert.equal(region.minY, -15);
  assert.equal(region.maxX, 45);
  assert.equal(region.maxY, 45);
});

test("food never grows on walls, nests, or an existing source", () => {
  const sim = new InfiniteSimulation();
  sim.setWall(3, 3, true);
  const colony = sim.addColony(5, 5);
  sim.addFood(7, 7, 100);

  assert.equal(sim.canGrowFoodAt(3, 3), false, "wall");
  assert.equal(sim.canGrowFoodAt(colony.nestX, colony.nestY), false, "nest");
  assert.equal(sim.canGrowFoodAt(7, 7), false, "occupied");
  assert.equal(sim.canGrowFoodAt(9, 9), true, "open ground");
});

test("growth stops at the carrying capacity and resumes as food is eaten", () => {
  const sim = new InfiniteSimulation();
  sim.addColony(0, 0);
  const random = cycle([0.9, 0.4, 0.2, 0.6, 0.35, 0.75, 0.15, 0.55]);

  for (let i = 0; i < 40; i++) sim.growFood(CONFIG, random);
  const filled = sim.standingFoodUnits;

  assert.ok(filled > 0, "expected food to appear");
  assert.ok(filled <= CONFIG.capacityUnits, `${filled} units exceeds capacity`);
  assert.deepEqual(sim.growFood(CONFIG, random), [], "at capacity, nothing more grows");

  // Eat most of it; headroom reopens.
  for (const source of sim.foodSources) source.remaining = 1;
  assert.ok(sim.growFood(CONFIG, random).length > 0, "growth resumes below capacity");
});

test("growth reports the sources it created so they can be broadcast", () => {
  const sim = new InfiniteSimulation();
  const created = sim.growFood(CONFIG, cycle([0.9, 0.4, 0.2, 0.6, 0.35]));

  assert.ok(created.length > 0);
  for (const source of created) {
    assert.ok(source.remaining > 0);
    assert.equal(source.remaining, source.total, "a new source is full");
    assert.ok(
      sim.foodSources.some(s => s.x === source.x && s.y === source.y),
      "the reported source is in the world",
    );
  }
});

test("an eaten site is remembered, so groves regrow where food has been", () => {
  const sim = new InfiniteSimulation();
  sim.addFood(20, 20, 1);
  assert.deepEqual(sim.foodMemory.entries.at(-1), { x: 20, y: 20 });

  // Clustered growth with a tight radius should land beside the remembered site
  // rather than anywhere in the (much larger) region.
  const clustered = sim.growFood(
    { ...CONFIG, clusterChance: 1, clusterRadius: 3, maxSourcesPerAttempt: 1 },
    cycle([0.0, 0.0, 0.5, 0.5]),
  );

  assert.equal(clustered.length, 1);
  assert.ok(Math.abs(clustered[0].x - 20) <= 3, `x ${clustered[0].x} near the grove`);
  assert.ok(Math.abs(clustered[0].y - 20) <= 3, `y ${clustered[0].y} near the grove`);
});

test("a world restored from a snapshot remembers where its food is", () => {
  const sim = new InfiniteSimulation();
  sim.restorePersistence({
    version: 1,
    nextColonyId: 1,
    walls: [],
    colonies: [],
    foodSources: [{ x: 12, y: -4, remaining: 50, total: 100 }],
  });

  assert.deepEqual(
    sim.foodMemory.entries.map(s => ({ x: s.x, y: s.y })),
    [{ x: 12, y: -4 }],
    "restored food seeds the grove memory, so growth resumes where it left off",
  );
});
