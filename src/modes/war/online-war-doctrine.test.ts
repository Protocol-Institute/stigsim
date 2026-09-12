import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_DOCTRINE, cloneDoctrine } from "@stigsim/sim-core";
import { sameWarDoctrine } from "./online-war-doctrine";

test("an echoed doctrine acknowledges the pending local edit", () => {
  const pending = cloneDoctrine(DEFAULT_DOCTRINE);
  pending.forager.follow.searching.food.own = 7.5;
  assert.equal(sameWarDoctrine(pending, cloneDoctrine(pending)), true);
});

test("a stale snapshot does not acknowledge a newer local edit", () => {
  const pending = cloneDoctrine(DEFAULT_DOCTRINE);
  pending.forager.follow.searching.food.own = 7.5;
  assert.equal(sameWarDoctrine(pending, DEFAULT_DOCTRINE), false);
});
