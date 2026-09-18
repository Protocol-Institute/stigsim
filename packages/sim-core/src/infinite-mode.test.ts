import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_INFINITE_COLONY_PARAMS,
  INFINITE_ENERGY_MAX,
  INFINITE_MODE_ID,
  INFINITE_MODE_VERSION,
  InfiniteSimulation,
  ModeRegistry,
  infiniteMode,
  parseInfiniteModeConfig,
} from "./index";

test("infinite@1 validates its identity and legacy-compatible host config", () => {
  assert.equal(infiniteMode.id, INFINITE_MODE_ID);
  assert.equal(infiniteMode.version, INFINITE_MODE_VERSION);
  assert.deepEqual(parseInfiniteModeConfig({ randomSeed: null, colorCount: 8, ignored: true }), {
    ok: true,
    value: { randomSeed: null, colorCount: 8 },
  });
  assert.deepEqual(parseInfiniteModeConfig({ randomSeed: "research", colorCount: 3 }), {
    ok: true,
    value: { randomSeed: "research", colorCount: 3 },
  });
  for (const value of [
    null,
    [],
    { randomSeed: 3, colorCount: 8 },
    { randomSeed: "", colorCount: 8 },
    { randomSeed: "x".repeat(201), colorCount: 8 },
    { randomSeed: null, colorCount: 0 },
    { randomSeed: null, colorCount: 257 },
    { randomSeed: null, colorCount: 1.5 },
  ]) {
    assert.equal(parseInfiniteModeConfig(value).ok, false);
  }

  const created = new ModeRegistry().register(infiniteMode).create({
    id: INFINITE_MODE_ID,
    version: INFINITE_MODE_VERSION,
    config: { randomSeed: "research", colorCount: 3 },
  });
  assert.equal(created.ok, true);
  if (created.ok) assert.ok(created.instance.runtime instanceof InfiniteSimulation);
});

test("seeded Infinite runtimes reproduce movement and serialized state", () => {
  const first = infiniteMode.create({ randomSeed: "infinite-seeded", colorCount: 8 });
  const second = infiniteMode.create({ randomSeed: "infinite-seeded", colorCount: 8 });
  for (const sim of [first, second]) {
    sim.addColony(0, 0, { numAnts: 4, name: "Seeded" });
    sim.addFood(3, 0, 100);
  }
  for (let tick = 0; tick < 500; tick++) {
    assert.deepEqual(first.step(), second.step());
    assert.deepEqual(first.serializeTick(), second.serializeTick());
  }
  assert.deepEqual(first.serializePhero(), second.serializePhero());
});

test("dynamic world edits preserve nests, food totals, ids, and defaults", () => {
  const sim = new InfiniteSimulation(() => 0, 2);
  sim.setWall(0, 0, true);
  sim.setWall(1, 1, true);
  const first = sim.addColony(0, 0);
  assert.deepEqual(first.params, {
    ...DEFAULT_INFINITE_COLONY_PARAMS,
    colorIdx: 0,
    name: "Colony 1",
  });
  assert.equal(sim.walls.has("0,0"), false);
  sim.toggleWall(0, 0);
  sim.setWall(0, 0, true);
  assert.equal(sim.walls.has("0,0"), false);

  sim.toggleWall(2, 2);
  assert.equal(sim.isOpen(2, 2), false);
  sim.toggleWall(2, 2);
  assert.equal(sim.isOpen(2, 2), true);
  sim.setWall(2, 2, true);
  sim.setWall(2, 2, false);

  const food = sim.addFood(1, 1, 10);
  assert.equal(sim.walls.has("1,1"), false);
  assert.equal(sim.addFood(1, 1, 7), food);
  assert.deepEqual(food, { x: 1, y: 1, remaining: 17, total: 17 });
  assert.equal(sim.removeFood(99, 99), false);
  assert.equal(sim.removeFood(1, 1), true);

  const second = sim.addColony(4, 4, { name: "Named", numAnts: 1 });
  const third = sim.addColony(8, 8, { name: "Third", numAnts: 0 });
  assert.equal(second.params.colorIdx, 1);
  assert.equal(third.params.colorIdx, 0);
  sim.removeColony(99);
  sim.removeColony(second.id);
  assert.deepEqual(sim.colonies.map(colony => colony.id), [first.id, third.id]);
});

test("persistence restores durable state but intentionally respawns volatile ants and fields", () => {
  const original = new InfiniteSimulation(() => 0);
  original.setWall(4, 5, true);
  const removed = original.addColony(0, 0, { name: "Removed" });
  const durable = original.addColony(2, 3, { name: "Durable", numAnts: 3 });
  original.removeColony(removed.id);
  const food = original.addFood(8, 9, 321);
  for (let i = 0; i < 125; i++) original.step();
  food.remaining = 111;
  durable.foodCollected = 47;
  durable.setAt("food", 50, 50, 500);

  const snapshot = original.serializePersistence();
  snapshot.foodSources.push({ x: 10, y: 10, remaining: 0, total: 10 });
  const restored = new InfiniteSimulation(() => 0);
  restored.restorePersistence(snapshot);
  const restoredColony = restored.colonies[0];
  const next = restored.addColony(10, 10, { name: "Next" });

  assert.equal(restored.walls.has("4,5"), true);
  assert.deepEqual(restored.foodSources, [{ x: 8, y: 9, remaining: 111, total: 321 }]);
  assert.equal(restoredColony.id, durable.id);
  assert.equal(restored.tick - restoredColony.bornAtTick, 125);
  assert.equal(restoredColony.foodCollected, 47);
  assert.equal(restoredColony.ants.length, 3);
  assert.equal(restoredColony.getAt("food", 50, 50), 0);
  assert.equal(next.id, 2);

  assert.throws(() => restored.restoreColony(snapshot.colonies[0]), /Duplicate/);
  assert.throws(() => restored.restoreNextColonyId(-1), /Invalid/);
  assert.throws(() => restored.restoreNextColonyId(1.5), /Invalid/);
  restored.restoreNextColonyId(20);
  assert.equal(restored.addColony(20, 20).id, 20);
});

test("starvation, feeding, source depletion, and trapped ants retain legacy timing", () => {
  const hungry = new InfiniteSimulation(() => 0);
  const colony = hungry.addColony(0, 0, { name: "Hungry", numAnts: 1 });
  colony.ants[0].energy = 2;
  assert.deepEqual(hungry.step(), []);
  assert.deepEqual(hungry.step(), [{ id: colony.id, name: "Hungry", lifespanTicks: 2 }]);
  assert.deepEqual(hungry.step(), []);

  const fed = new InfiniteSimulation(() => 0);
  const fedColony = fed.addColony(0, 0, { name: "Fed", numAnts: 1 });
  fed.addFood(0, 0, 1);
  fed.step();
  assert.equal(fed.foodSources.length, 0);
  assert.equal(fedColony.discoveredSources.size, 0);
  fed.step();
  assert.equal(fedColony.ants[0].energy, INFINITE_ENERGY_MAX);
  assert.equal(fedColony.foodCollected, 1);

  const trapped = new InfiniteSimulation(() => 0);
  const trappedColony = trapped.addColony(0, 0, { numAnts: 1 });
  const ant = trappedColony.ants[0];
  for (const [x, y] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) trapped.setWall(x, y, true);
  trapped.step();
  assert.deepEqual([ant.tx, ant.ty], [0, 0]);
});

test("chunk eviction bookkeeping and pheromone wire encoding retain legacy behavior", () => {
  const sim = new InfiniteSimulation(() => 0);
  const colony = sim.addColony(0, 0, { numAnts: 0, name: "Phero" });
  colony.decayAll(0);
  colony.takeClearedChunks();

  colony.setAt("home", 100, 100, 10);
  colony.decayAll(0);
  colony.setAt("home", 100, 100, 10);
  colony.decayAll(0);
  assert.deepEqual(colony.takeClearedChunks(), ["3,3"]);
  assert.deepEqual(colony.takeClearedChunks(), []);

  colony.setAt("home", 100, 100, 1_500);
  colony.setAt("food", 101, 100, 500);
  colony.setAt("caut", 102, 100, 300);
  const phero = sim.serializePhero();
  const chunk = phero[0].chunks.find(value => value.key === "3,3");
  assert.ok(chunk);
  assert.equal(Math.max(...chunk.home), 255);
  assert.equal(Math.max(...chunk.food), 128);

  colony.setAt("home", 200, 200, 0.09);
  assert.equal(sim.serializePhero()[0].chunks.some(value => value.key === "6,6"), false);
  colony.setAt("home", 300, 300, 10);
  colony.decayAll(0);
  assert.ok(colony.recentlyClearedChunks.size > 0);
  sim.dropPheroBookkeeping();
  assert.equal(colony.recentlyClearedChunks.size, 0);
});

test("caution deposition and serializers expose the same public wire shapes", () => {
  const sim = new InfiniteSimulation(() => 0);
  const colony = sim.addColony(0, 0, {
    numAnts: 1,
    cautionary: true,
    tankMax: 0,
    name: "Cautious",
  });
  const ant = colony.ants[0];
  ant.tx = 1;
  ant.ty = 0;
  sim.step();
  assert.ok(colony.getAt("caut", 0, 0) > 0);

  assert.deepEqual(sim.serializeInit(), {
    walls: [],
    colonies: [colony.info()],
    foodSources: [],
  });
  assert.deepEqual(sim.serializeTick().fc, [{ id: colony.id, n: 0, ageTicks: 1 }]);
  assert.deepEqual(sim.serializeTick().ants, [{
    cid: colony.id,
    wx: Math.round(ant.wx),
    wy: Math.round(ant.wy),
    f: 0,
  }]);
});
