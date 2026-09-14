import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_DOCTRINE, MAX_LAY_GAIN, cloneDoctrine, doctrineNumbers, isDoctrine, makeRoleTable,
} from "./doctrine";
import { MAX_TRAIL_POWER } from "./constants";

test("the default doctrine validates and is the Deneubourg point", () => {
  assert.equal(isDoctrine(DEFAULT_DOCTRINE), true);
  assert.equal(DEFAULT_DOCTRINE.forager.follow.searching.food.own, 5);
  assert.equal(DEFAULT_DOCTRINE.forager.follow.returning.home.own, 5);
  assert.equal(DEFAULT_DOCTRINE.forager.lay.searching.home.own, 1);
  assert.equal(DEFAULT_DOCTRINE.forager.lay.returning.food.own, 1);
  assert.equal(DEFAULT_DOCTRINE.spoilerFraction, 0);
  assert.equal(DEFAULT_DOCTRINE.mimicRate, 0);
  assert.equal(DEFAULT_DOCTRINE.evapRate, 0.005);
});

test("makeRoleTable fills every entry and defaults unspecified ones to zero", () => {
  const t = makeRoleTable({ follow: { searching: { food: { own: 3 } } } });
  assert.equal(t.follow.searching.food.own, 3);
  assert.equal(t.follow.searching.food.enemy, 0);
  assert.equal(t.follow.returning.home.own, 0);
  assert.deepEqual(t.lay.returning.food, { own: 0, mimic: 0 });
});

test("doctrineNumbers lists 35 numbers in a fixed order", () => {
  const n = doctrineNumbers(DEFAULT_DOCTRINE);
  assert.equal(n.length, 35);
  // forager, searching, food, own is the 3rd follow entry (home/own, home/enemy, food/own).
  assert.equal(n[2], 5);
  assert.deepEqual(n.slice(32), [0, 0, 0.005]);
});

test("cloneDoctrine returns an independent copy", () => {
  const c = cloneDoctrine(DEFAULT_DOCTRINE);
  c.forager.follow.searching.food.own = 9;
  assert.equal(DEFAULT_DOCTRINE.forager.follow.searching.food.own, 5);
  assert.equal(isDoctrine(c), true);
});

function mutate(edit: (d: ReturnType<typeof cloneDoctrine>) => void) {
  const d = cloneDoctrine(DEFAULT_DOCTRINE);
  edit(d);
  return d;
}

test("isDoctrine rejects each violation individually", () => {
  assert.equal(isDoctrine(null), false);
  assert.equal(isDoctrine({}), false);
  assert.equal(isDoctrine({ ...cloneDoctrine(DEFAULT_DOCTRINE), extra: 1 }), false);
  const missing = cloneDoctrine(DEFAULT_DOCTRINE) as unknown as Record<string, unknown>;
  delete missing.mimicRate;
  assert.equal(isDoctrine(missing), false);
  assert.equal(isDoctrine(mutate(d => { (d as unknown as { v: number }).v = 2; })), false);
  assert.equal(isDoctrine(mutate(d => { d.forager.follow.searching.food.own = 2.3; })), false);
  assert.equal(isDoctrine(mutate(d => { d.forager.follow.searching.food.own = MAX_TRAIL_POWER + 0.5; })), false);
  assert.equal(isDoctrine(mutate(d => { d.forager.follow.searching.food.own = -MAX_TRAIL_POWER; })), true);
  assert.equal(isDoctrine(mutate(d => {
    d.forager.follow.searching.food.own = 20;
    d.forager.follow.searching.home.enemy = 13;
  })), false, "row sum above MAX_TRAIL_POWER");
  assert.equal(isDoctrine(mutate(d => { d.forager.lay.searching.home.own = MAX_LAY_GAIN + 1; })), false);
  assert.equal(isDoctrine(mutate(d => { d.forager.lay.searching.home.own = 1.5; })), false);
  assert.equal(isDoctrine(mutate(d => { d.forager.lay.searching.food.mimic = 1; })), false, "foragers never mimic");
  assert.equal(isDoctrine(mutate(d => { d.spoiler.lay.searching.food.mimic = 1; })), true);
  assert.equal(isDoctrine(mutate(d => { d.spoiler.lay.searching.food.mimic = 2; })), false);
  assert.equal(isDoctrine(mutate(d => { d.spoilerFraction = 1.5; })), false);
  assert.equal(isDoctrine(mutate(d => { d.mimicRate = -0.1; })), false);
  assert.equal(isDoctrine(mutate(d => { d.evapRate = 2; })), false);
  assert.equal(isDoctrine(mutate(d => { d.evapRate = Number.NaN; })), false);
  const badRow = cloneDoctrine(DEFAULT_DOCTRINE) as unknown as { forager: { follow: Record<string, unknown> } };
  delete badRow.forager.follow.returning;
  assert.equal(isDoctrine(badRow), false);
});
