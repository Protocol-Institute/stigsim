import assert from "node:assert/strict";
import test from "node:test";
import {
  angleDelta,
  bilinearWeights,
  normalizeAngle,
  sampleField,
  splatDeposit,
} from "./field";
import { hashSeed, Rng } from "./rng";

const CELL = 16;

/** Sum of the four shares, which must always be the whole. */
function weightSum(px: number, py: number): number {
  const w = bilinearWeights(px, py, CELL);
  return w.w00 + w.w10 + w.w01 + w.w11;
}

test("a point's shares always add up to one", () => {
  for (const [px, py] of [[0, 0], [8, 8], [13, 5], [40, 72], [-3, 19], [255.5, 1.25]]) {
    assert.ok(Math.abs(weightSum(px, py) - 1) < 1e-12, `shares at ${px},${py}`);
  }
});

test("a point on a cell centre belongs entirely to that cell", () => {
  // Cell (2,3) has its centre at (2.5 * 16, 3.5 * 16).
  const w = bilinearWeights(2 * CELL + CELL / 2, 3 * CELL + CELL / 2, CELL);

  assert.equal(w.x0, 2);
  assert.equal(w.y0, 3);
  assert.ok(Math.abs(w.w00 - 1) < 1e-12, "all weight on the containing cell");
  assert.ok(w.w10 + w.w01 + w.w11 < 1e-12);
});

test("a point midway between four centres splits evenly", () => {
  // The corner where cells (1,1) (2,1) (1,2) (2,2) meet.
  const w = bilinearWeights(2 * CELL, 2 * CELL, CELL);

  for (const share of [w.w00, w.w10, w.w01, w.w11]) {
    assert.ok(Math.abs(share - 0.25) < 1e-12, `expected an even split, got ${share}`);
  }
});

test("sampling a flat field returns that value everywhere", () => {
  const read = () => 7;
  for (const [px, py] of [[8, 8], [13, 27], [100.5, 4.25]]) {
    assert.ok(Math.abs(sampleField(px, py, CELL, read) - 7) < 1e-12);
  }
});

test("sampling interpolates between neighbouring cells", () => {
  // A ramp along x: cell value equals its column.
  const read = (cx: number) => cx;

  const atCentre = sampleField(2 * CELL + CELL / 2, CELL / 2, CELL, read);
  const halfway = sampleField(3 * CELL, CELL / 2, CELL, read);

  assert.ok(Math.abs(atCentre - 2) < 1e-12, "on a centre, the cell's own value");
  assert.ok(Math.abs(halfway - 2.5) < 1e-12, "between two centres, the midpoint");
});

test("a deposit is conserved across the cells it lands on", () => {
  let total = 0;
  splatDeposit(37, 44, CELL, 20, () => true, (_x, _y, amount) => { total += amount; });

  assert.ok(Math.abs(total - 20) < 1e-12, `laid ${total} of 20`);
});

test("solid cells take no deposit and their share goes to open ground", () => {
  // Point sits between cells (1,1) (2,1) (1,2) (2,2); wall off the left column.
  const laid = new Map<string, number>();
  const isOpen = (cx: number) => cx !== 1;

  splatDeposit(2 * CELL, 2 * CELL, CELL, 12, isOpen, (cx, cy, amount) => {
    laid.set(`${cx},${cy}`, (laid.get(`${cx},${cy}`) ?? 0) + amount);
  });

  const total = [...laid.values()].reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(total - 12) < 1e-12, "the whole deposit still lands");
  assert.ok(!laid.has("1,1") && !laid.has("1,2"), "nothing lands in rock");
  assert.ok(Math.abs((laid.get("2,1") ?? 0) - 6) < 1e-12, "the wall's share is shared out");
  assert.ok(Math.abs((laid.get("2,2") ?? 0) - 6) < 1e-12);
});

test("a deposit with nowhere open to land is dropped, not lost in a loop", () => {
  let calls = 0;
  splatDeposit(37, 44, CELL, 20, () => false, () => { calls++; });
  assert.equal(calls, 0);
});

test("a deposit of nothing writes nothing", () => {
  let calls = 0;
  splatDeposit(37, 44, CELL, 0, () => true, () => { calls++; });
  splatDeposit(37, 44, CELL, -5, () => true, () => { calls++; });
  assert.equal(calls, 0);
});

test("turning takes the short way round", () => {
  const nearly = Math.PI * 2 - 0.1;

  assert.ok(Math.abs(angleDelta(0, 0.5) - 0.5) < 1e-12);
  assert.ok(Math.abs(angleDelta(0, nearly) - -0.1) < 1e-12, "turn back, not the long way");
  assert.ok(Math.abs(angleDelta(nearly, 0.1) - 0.2) < 1e-12, "and across the wrap point");
  assert.ok(Math.abs(angleDelta(0, Math.PI)) - Math.PI < 1e-12);
});

test("headings normalise into a single turn", () => {
  assert.ok(Math.abs(normalizeAngle(0.5) - 0.5) < 1e-12);
  assert.ok(Math.abs(normalizeAngle(-0.5) - (Math.PI * 2 - 0.5)) < 1e-12);
  assert.ok(Math.abs(normalizeAngle(Math.PI * 4 + 1) - 1) < 1e-12);
  for (const angle of [-30, -1, 0, 1, 7, 100]) {
    const n = normalizeAngle(angle);
    assert.ok(n >= 0 && n < Math.PI * 2, `${angle} normalised to ${n}`);
  }
});

test("the same seed replays the same stream", () => {
  const a = new Rng("alpha");
  const b = new Rng("alpha");
  const c = new Rng("beta");

  const seqA = Array.from({ length: 12 }, () => a.next());
  const seqB = Array.from({ length: 12 }, () => b.next());
  const seqC = Array.from({ length: 12 }, () => c.next());

  assert.deepEqual(seqA, seqB, "same seed, same run");
  assert.notDeepEqual(seqA, seqC, "different seeds diverge");
  assert.equal(hashSeed("alpha"), hashSeed("alpha"), "seed hashing is stable");
});

test("draws are uniform enough to steer by", () => {
  const rng = new Rng("distribution");
  const buckets = new Array(10).fill(0);
  const n = 100_000;

  for (let i = 0; i < n; i++) {
    const v = rng.next();
    assert.ok(v >= 0 && v < 1, `draw ${v} outside [0,1)`);
    buckets[Math.floor(v * 10)]++;
  }

  for (const [i, count] of buckets.entries()) {
    assert.ok(Math.abs(count - n / 10) < n / 100, `bucket ${i} held ${count}`);
  }
});

test("shuffling produces a permutation, not a resampling", () => {
  const rng = new Rng("shuffle");
  const items = [1, 2, 3, 4, 5, 6, 7, 8];
  const shuffled = rng.shuffle([...items]);

  assert.equal(shuffled.length, items.length);
  assert.deepEqual([...shuffled].sort((a, b) => a - b), items, "same elements");
});
