import assert from "node:assert/strict";
import test from "node:test";
import {
  InfiniteSimulation,
  infinitePersistenceCodec,
  infiniteWireCodec,
} from "./index";

test("Infinite wire codecs preserve the deployed message shapes", () => {
  const sim = new InfiniteSimulation(() => 0);
  const colony = sim.addColony(2, 3, { name: "Wire", numAnts: 1 });
  sim.addFood(4, 5, 10);

  assert.deepEqual(infiniteWireCodec.init(sim), {
    type: "init",
    walls: [],
    colonies: [colony.info()],
    foodSources: [{ x: 4, y: 5, remaining: 10, total: 10 }],
  });
  assert.deepEqual(infiniteWireCodec.tick(sim), {
    type: "tick",
    ...sim.serializeTick(),
  });
  assert.deepEqual(infiniteWireCodec.phero(sim), {
    type: "phero",
    colonies: sim.serializePhero(),
  });
});

test("Infinite persistence v1 round-trips through its explicit boundary", () => {
  const original = new InfiniteSimulation(() => 0);
  original.setWall(7, 8, true);
  const colony = original.addColony(2, 3, { name: "Durable", numAnts: 2 });
  colony.foodCollected = 12;
  original.addFood(4, 5, 30).remaining = 19;
  for (let tick = 0; tick < 25; tick++) original.step();

  const encoded = infinitePersistenceCodec.encode(original);
  assert.equal(encoded.version, infinitePersistenceCodec.version);
  const restored = new InfiniteSimulation(() => 0);
  assert.deepEqual(infinitePersistenceCodec.restore(restored, JSON.parse(JSON.stringify(encoded))), {
    ok: true,
    value: undefined,
  });
  assert.deepEqual(infinitePersistenceCodec.encode(restored), encoded);
});

test("Infinite persistence migrates the deployed unversioned seed shape", () => {
  const sim = new InfiniteSimulation(() => 0, 4);
  const result = infinitePersistenceCodec.restore(sim, {
    walls: ["1,2"],
    colonies: [
      { nestX: 3, nestY: 4, params: { name: "Assigned", numAnts: 1 } },
      {
        id: 7,
        nestX: 5,
        nestY: 6,
        params: { name: "Restored", numAnts: 1, colorIdx: 3 },
        foodCollected: -4,
        ageTicks: -8,
      },
    ],
    nextColonyId: 10,
    foodSources: [
      { x: 8, y: 9, remaining: 12, total: 30 },
      { x: 9, y: 10, remaining: 0, total: 30 },
    ],
  });

  assert.deepEqual(result, { ok: true, value: undefined });
  assert.deepEqual(sim.colonies.map(colony => ({
    id: colony.id,
    name: colony.params.name,
    food: colony.foodCollected,
    age: sim.tick - colony.bornAtTick,
  })), [
    { id: 0, name: "Assigned", food: 0, age: 0 },
    { id: 7, name: "Restored", food: 0, age: 0 },
  ]);
  assert.deepEqual(sim.foodSources, [{ x: 8, y: 9, remaining: 12, total: 30 }]);
  assert.equal(sim.addColony(0, 0).id, 10);
});

test("Infinite persistence rejects malformed or newer state before restoring it", () => {
  for (const value of [
    null,
    { version: 2, walls: [], colonies: [], foodSources: [] },
    { version: 1, nextColonyId: -1, walls: [], colonies: [], foodSources: [] },
    { version: 1, nextColonyId: 1, walls: [3], colonies: [], foodSources: [] },
    { version: 1, nextColonyId: 1, walls: [], colonies: [{ nestX: 0, nestY: 0, params: {} }], foodSources: [] },
    { walls: [], colonies: [{ nestX: "x", nestY: 0, params: {} }], foodSources: [] },
    { walls: [], colonies: [], foodSources: [{ x: 0, y: 0, remaining: "many", total: 2 }] },
    { walls: ["would,mutate"], colonies: [], foodSources: [], nextColonyId: 1.5 },
  ]) {
    const sim = new InfiniteSimulation(() => 0);
    const result = infinitePersistenceCodec.restore(sim, value);
    assert.equal(result.ok, false);
    assert.deepEqual(sim.serializeInit(), { walls: [], colonies: [], foodSources: [] });
  }
});
