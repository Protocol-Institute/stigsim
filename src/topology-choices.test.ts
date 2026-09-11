import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_DOCTRINE, TOPOLOGY_MIMICRY, TOPOLOGY_OPEN, TOPOLOGY_PRIVATE, TOPOLOGY_SENSING, cloneDoctrine, isDoctrine } from "@stigsim/sim-core";
import { choiceFor, conformDoctrine, TOPOLOGY_CHOICES } from "./topology-choices";

function saboteurPoacher() {
  const d = cloneDoctrine(DEFAULT_DOCTRINE);
  d.spoilerFraction = 0.2;
  d.mimicRate = 0.9;
  d.forager.follow.searching.food.enemy = 3;
  return d;
}

test("conformDoctrine zeroes spoilers and mimicry where mimicry is impossible", () => {
  const d = conformDoctrine(saboteurPoacher(), TOPOLOGY_PRIVATE);
  assert.equal(d.spoilerFraction, 0);
  assert.equal(d.mimicRate, 0);
  assert.equal(d.forager.follow.searching.food.enemy, 0);
  assert.equal(isDoctrine(d), true);
});

test("conformDoctrine keeps poaching under sensing but clears spoilers", () => {
  const d = conformDoctrine(saboteurPoacher(), TOPOLOGY_SENSING);
  assert.equal(d.spoilerFraction, 0);
  assert.equal(d.forager.follow.searching.food.enemy, 3);
});

test("conformDoctrine keeps spoilers under mimicry and clamps the rate to the cap", () => {
  const d = conformDoctrine(saboteurPoacher(), TOPOLOGY_MIMICRY);
  assert.equal(d.spoilerFraction, 0.2);
  assert.equal(d.mimicRate, TOPOLOGY_MIMICRY.maxMimicRate);
  assert.equal(d.forager.follow.searching.food.enemy, 3);
});

test("conformDoctrine clears poaching under the open option, where origin collapses", () => {
  const d = conformDoctrine(saboteurPoacher(), TOPOLOGY_OPEN);
  assert.equal(d.spoilerFraction, 0.2);
  assert.equal(d.forager.follow.searching.food.enemy, 0);
});

test("conformDoctrine does not touch the input", () => {
  const input = saboteurPoacher();
  conformDoctrine(input, TOPOLOGY_PRIVATE);
  assert.equal(input.spoilerFraction, 0.2);
});

test("choiceFor maps each named option back to its choice", () => {
  for (const c of TOPOLOGY_CHOICES) assert.equal(choiceFor(c.topology), c);
});
