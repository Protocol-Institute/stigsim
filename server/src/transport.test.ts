import assert from "node:assert/strict";
import test from "node:test";
import {
  foodRemovedMessage,
  foodUpsertMessage,
  makeIdempotentCleanup,
  removeFoodAndCreateMessage,
  shouldSendVolatileFrame,
  TokenBucket,
} from "./transport";

test("volatile snapshots are dropped when a client send queue is backed up", () => {
  const limit = 512 * 1024;

  assert.equal(shouldSendVolatileFrame(0, limit), true);
  assert.equal(shouldSendVolatileFrame(limit, limit), true);
  assert.equal(shouldSendVolatileFrame(limit + 1, limit), false);
});

test("food edit broadcasts contain one constant-size delta", () => {
  const upsert = foodUpsertMessage({ x: 10, y: -20, remaining: 500, total: 500 });
  const removed = foodRemovedMessage(10, -20);

  assert.deepEqual(upsert, {
    type: "foodUpsert",
    foodSource: { x: 10, y: -20, remaining: 500, total: 500 },
  });
  assert.deepEqual(removed, { type: "foodRemoved", x: 10, y: -20 });
  assert.equal(JSON.stringify(upsert).includes("foodSources"), false);
});

test("food edit token bucket allows a small burst and then refills", () => {
  const limiter = new TokenBucket(2, 1, 1_000);

  assert.equal(limiter.tryTake(1_000), true);
  assert.equal(limiter.tryTake(1_000), true);
  assert.equal(limiter.tryTake(1_000), false);
  assert.equal(limiter.tryTake(1_999), false);
  assert.equal(limiter.tryTake(2_000), true);
});

test("removing nonexistent food emits no delta", () => {
  const noChange = { removeFood: () => false };
  const changed = { removeFood: () => true };

  assert.equal(removeFoodAndCreateMessage(noChange, 4, 5), null);
  assert.deepEqual(
    removeFoodAndCreateMessage(changed, 4, 5),
    { type: "foodRemoved", x: 4, y: 5 },
  );
});

test("connection cleanup runs once across error and close paths", () => {
  let cleanupCount = 0;
  const cleanup = makeIdempotentCleanup(() => { cleanupCount++; });

  cleanup(); // error
  cleanup(); // later close

  assert.equal(cleanupCount, 1);
});
