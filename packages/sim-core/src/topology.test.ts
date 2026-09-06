import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_TOPOLOGY, TOPOLOGY_MIMICRY, TOPOLOGY_OPEN, TOPOLOGY_PRIVATE, TOPOLOGY_SENSING,
  cloneTopology, isTopology,
} from "./topology";

test("the private topology is the default and validates", () => {
  assert.equal(DEFAULT_TOPOLOGY, TOPOLOGY_PRIVATE);
  assert.equal(isTopology(TOPOLOGY_PRIVATE), true);
  assert.deepEqual(TOPOLOGY_PRIVATE, {
    read: "private", mimicEnemy: false, visible: { home: false, food: false }, maxMimicRate: 1, provenance: false,
  });
});

test("the cross-colony options are not accepted until the engine implements them", () => {
  // Widened in the task that lands the shared and separable reads.
  assert.equal(isTopology(TOPOLOGY_SENSING), false);
  assert.equal(isTopology(TOPOLOGY_MIMICRY), false);
  assert.equal(isTopology(TOPOLOGY_OPEN), false);
});

test("isTopology rejects malformed input", () => {
  assert.equal(isTopology(null), false);
  assert.equal(isTopology({}), false);
  assert.equal(isTopology({ ...TOPOLOGY_PRIVATE, extra: true }), false);
  assert.equal(isTopology({ ...TOPOLOGY_PRIVATE, read: "sideways" }), false);
  assert.equal(isTopology({ ...TOPOLOGY_PRIVATE, maxMimicRate: 2 }), false);
  assert.equal(isTopology({ ...TOPOLOGY_PRIVATE, maxMimicRate: Number.NaN }), false);
  assert.equal(isTopology({ ...TOPOLOGY_PRIVATE, visible: { home: false } }), false);
  assert.equal(isTopology({ ...TOPOLOGY_PRIVATE, visible: { home: 1, food: false } }), false);
  assert.equal(isTopology({ ...TOPOLOGY_PRIVATE, provenance: "yes" }), false);
});

test("cloneTopology returns an independent copy", () => {
  const c = cloneTopology(TOPOLOGY_PRIVATE);
  c.visible.home = true;
  assert.equal(TOPOLOGY_PRIVATE.visible.home, false);
});
