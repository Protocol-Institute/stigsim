import assert from "node:assert/strict";
import test from "node:test";
import {
  makeRng, makeSeeds, deriveStreamSeed, generateMasterSeed,
  shuffleInPlace, deterministicPow, isHalfStep,
} from "./rng";

test("the same seed produces the same sequence", () => {
  const a = makeRng("abc123");
  const b = makeRng("abc123");
  for (let i = 0; i < 1000; i++) assert.equal(a(), b());
});

test("different seeds produce different sequences", () => {
  const a = makeRng("abc123");
  const b = makeRng("abc124");
  let same = 0;
  for (let i = 0; i < 1000; i++) if (a() === b()) same++;
  assert.ok(same < 5, `expected near-zero collisions, got ${same}`);
});

test("draws stay in [0, 1)", () => {
  const r = makeRng("range-check");
  for (let i = 0; i < 10000; i++) {
    const v = r();
    assert.ok(v >= 0 && v < 1, `out of range: ${v}`);
  }
});

test("the mean of many draws is near 0.5", () => {
  const r = makeRng("uniformity");
  let sum = 0;
  const n = 200000;
  for (let i = 0; i < n; i++) sum += r();
  assert.ok(Math.abs(sum / n - 0.5) < 0.005, `mean was ${sum / n}`);
});

test("streams derived from one master differ from each other", () => {
  const seeds = makeSeeds("quiet-ember-4417");
  assert.equal(seeds.master, "quiet-ember-4417");
  const distinct = new Set([seeds.maze, seeds.food, seeds.ants]);
  assert.equal(distinct.size, 3);
});

test("stream derivation is stable across calls", () => {
  assert.equal(deriveStreamSeed("m", "ants"), deriveStreamSeed("m", "ants"));
  assert.notEqual(deriveStreamSeed("m", "ants"), deriveStreamSeed("m", "maze"));
});

test("generated master seeds are non-empty and vary", () => {
  const seeds = new Set(Array.from({ length: 50 }, () => generateMasterSeed()));
  assert.ok(seeds.size > 40, `expected varied seeds, got ${seeds.size} distinct`);
  for (const s of seeds) assert.ok(s.length > 0);
});

test("shuffleInPlace is a permutation and is seed-stable", () => {
  const a = [1, 2, 3, 4, 5, 6, 7, 8];
  const b = [1, 2, 3, 4, 5, 6, 7, 8];
  shuffleInPlace(a, makeRng("shuf"));
  shuffleInPlace(b, makeRng("shuf"));
  assert.deepEqual(a, b);
  assert.deepEqual([...a].sort((x, y) => x - y), [1, 2, 3, 4, 5, 6, 7, 8]);
});

test("deterministicPow matches Math.pow across the slider's value set", () => {
  for (let power = 1; power <= 10; power += 0.5) {
    for (const base of [1, 1.5, 2, 7, 21.25, 101, 1001]) {
      const ours = deterministicPow(base, power);
      const theirs = Math.pow(base, power);
      const relative = Math.abs(ours - theirs) / theirs;
      assert.ok(
        relative < 1e-12,
        `power ${power} base ${base}: ${ours} vs ${theirs} (rel ${relative})`,
      );
    }
  }
});

test("deterministicPow is stable across repeated calls", () => {
  const first = deterministicPow(37.125, 7.5);
  for (let i = 0; i < 100; i++) assert.equal(deterministicPow(37.125, 7.5), first);
});

// ─── deterministicPow domain ─────────────────────────────────────────────────

test("deterministicPow matches Math.pow closely on its domain", () => {
  for (const [base, power] of [[2, 3], [2, 2.5], [4, 0.5], [1.5, 8], [3, 10]] as [number, number][]) {
    const got = deterministicPow(base, power);
    const want = Math.pow(base, power);
    assert.ok(Math.abs(got - want) / want < 1e-12, `${base}^${power}: ${got} vs ${want}`);
  }
});

test("deterministicPow inverts negative exponents instead of aliasing them", () => {
  assert.ok(Math.abs(deterministicPow(2, -1.5) - 0.35355339059327373) < 1e-15);
  assert.ok(Math.abs(deterministicPow(2, -2) - 0.25) < 1e-15);
});

test("deterministicPow refuses exponents it cannot compute exactly", () => {
  // 2.3 used to silently return 2^2.5, an answer that looks plausible and is
  // 15% wrong. A trace carrying such a value must fail loudly instead.
  assert.throws(() => deterministicPow(2, 2.3), RangeError);
  assert.throws(() => deterministicPow(2, NaN), RangeError);
  assert.throws(() => deterministicPow(2, Infinity), RangeError);
});

test("deterministicPow cost is logarithmic, so a large exponent cannot stall a tick", () => {
  const started = Date.now();
  assert.ok(Number.isFinite(deterministicPow(1.0000001, 1e9)));
  assert.ok(Date.now() - started < 1000);
});

test("isHalfStep accepts multiples of a half and nothing else", () => {
  for (const v of [0, 0.5, 1, 2.5, -1.5, 10]) assert.equal(isHalfStep(v), true, `${v}`);
  for (const v of [0.25, 2.3, NaN, Infinity]) assert.equal(isHalfStep(v), false, `${v}`);
});

// ─── Draw counting ───────────────────────────────────────────────────────────

test("an rng counts the draws taken from it, excluding warm-up", () => {
  const r = makeRng("draw-count");
  assert.equal(r.draws, 0);
  for (let i = 0; i < 7; i++) r();
  assert.equal(r.draws, 7);
});
