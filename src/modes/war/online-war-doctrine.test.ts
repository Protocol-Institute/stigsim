import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_WAR_DOCTRINE } from "../../../shared/war-doctrine";
import { sameWarDoctrine } from "./online-war-doctrine";

test("an echoed doctrine acknowledges the pending local edit", () => {
  const pending = { ...DEFAULT_WAR_DOCTRINE, trailPower: 7.5, cautionary: true };
  assert.equal(sameWarDoctrine(pending, { ...pending }), true);
});

test("a stale snapshot does not acknowledge a newer local edit", () => {
  const pending = { ...DEFAULT_WAR_DOCTRINE, trailPower: 7.5 };
  assert.equal(sameWarDoctrine(pending, DEFAULT_WAR_DOCTRINE), false);
});
