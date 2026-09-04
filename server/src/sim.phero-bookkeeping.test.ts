import assert from "node:assert/strict";
import test from "node:test";
import { InfiniteSimulation } from "./sim";

/**
 * Creating a colony seeds its nest, which allocates chunks of its own. Evict
 * and drain those so a test observes only the chunks it causes itself.
 */
function settle(colony: { decayAll(f: number): void; takeClearedChunks(): string[] }) {
  colony.decayAll(0);
  colony.takeClearedChunks();
}

test("cleared chunks are recorded once and drained on take", () => {
  const sim = new InfiniteSimulation();
  const colony = sim.addColony(0, 0, { numAnts: 0, name: "Bookkeeping" });
  settle(colony);

  // (100, 100) lands in chunk (3, 3) at a chunk size of 32.
  colony.setAt("home", 100, 100, 10);
  colony.decayAll(0);
  assert.equal(colony.recentlyClearedChunks.size, 1);

  // The same chunk allocated and evicted again is still one key to erase.
  colony.setAt("home", 100, 100, 10);
  colony.decayAll(0);
  assert.equal(colony.recentlyClearedChunks.size, 1);

  assert.deepEqual(colony.takeClearedChunks(), ["3,3"]);
  assert.deepEqual(colony.takeClearedChunks(), []);
});

test("repeated eviction of one chunk does not accumulate", () => {
  const sim = new InfiniteSimulation();
  const colony = sim.addColony(0, 0, { numAnts: 0, name: "Churn" });
  settle(colony);

  colony.setAt("home", 100, 100, 10);
  colony.decayAll(0);
  const afterOneCycle = colony.recentlyClearedChunks.size;

  for (let i = 0; i < 5_000; i++) {
    colony.setAt("home", 100, 100, 10);
    colony.decayAll(0);
  }

  // The client erases by key, so what matters is the set of chunks to erase,
  // not how many times each was evicted. A list here would grow one entry per
  // cycle for as long as the world runs undrained.
  assert.equal(colony.recentlyClearedChunks.size, afterOneCycle);
});

test("dropping phero bookkeeping clears every colony", () => {
  const sim = new InfiniteSimulation();
  const a = sim.addColony(0, 0, { numAnts: 0, name: "A" });
  const b = sim.addColony(200, 200, { numAnts: 0, name: "B" });

  for (const colony of [a, b]) {
    colony.setAt("home", colony.nestX + 100, colony.nestY + 100, 10);
    colony.decayAll(0);
    assert.ok(colony.recentlyClearedChunks.size > 0);
  }

  sim.dropPheroBookkeeping();

  assert.equal(a.recentlyClearedChunks.size, 0);
  assert.equal(b.recentlyClearedChunks.size, 0);
});
