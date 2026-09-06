import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_DOCTRINE, TOPOLOGY_MIMICRY, TOPOLOGY_OPEN, TOPOLOGY_PRIVATE, TOPOLOGY_SENSING, isDoctrine,
} from "@stigsim/sim-core";
import { PRESETS, withExponent } from "./doctrine-presets";

test("every preset is a valid doctrine with a unique name", () => {
  for (const p of PRESETS) assert.equal(isDoctrine(p.doctrine), true, p.name);
  assert.equal(new Set(PRESETS.map(p => p.name)).size, PRESETS.length);
});

test("withExponent sets both steering exponents and nothing else", () => {
  const d = withExponent(DEFAULT_DOCTRINE, 8);
  assert.equal(d.forager.follow.searching.food.own, 8);
  assert.equal(d.forager.follow.returning.home.own, 8);
  assert.equal(d.forager.follow.searching.home.own, 0);
  assert.equal(DEFAULT_DOCTRINE.forager.follow.searching.food.own, 5, "the base is untouched");
});

test("presets whose atoms are inert under a topology say so", () => {
  const by = Object.fromEntries(PRESETS.map(p => [p.name, p]));
  assert.equal(by.Poacher.available(TOPOLOGY_PRIVATE), false);
  assert.equal(by.Poacher.available(TOPOLOGY_SENSING), true);
  assert.equal(by.Poacher.available(TOPOLOGY_OPEN), false, "there is no enemy origin to poach under the open option");
  assert.equal(by.Saboteur.available(TOPOLOGY_PRIVATE), false);
  assert.equal(by.Saboteur.available(TOPOLOGY_MIMICRY), true);
  assert.equal(by.Saboteur.available(TOPOLOGY_OPEN), true);
  assert.equal(by.Highway.available(TOPOLOGY_PRIVATE), true);
});
