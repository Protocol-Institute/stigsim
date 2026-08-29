import assert from "node:assert/strict";
import test from "node:test";
import { Simulation, DEFAULT_PARAMS, makeSeeds, fingerprint, FINGERPRINT_INTERVAL } from "./index";
import type { RunConfig } from "./index";

function config(overrides: Partial<RunConfig> = {}): RunConfig {
  return {
    seeds: makeSeeds("fingerprint-test"),
    numAnts: 20,
    params: DEFAULT_PARAMS,
    loopRate: 0.1,
    numColonies: 2,
    numFoodSources: 3,
    foodPerSource: 500,
    ...overrides,
  };
}

test("a fingerprint is eight lowercase hex characters", () => {
  const h = fingerprint(new Simulation(config()));
  assert.match(h, /^[0-9a-f]{8}$/);
});

test("identical simulations fingerprint identically at every checkpoint", () => {
  const c = config();
  const a = new Simulation(c);
  const b = new Simulation(c);
  for (let i = 0; i < 2000; i++) {
    a.step();
    b.step();
    if (i % 250 === 0) assert.equal(fingerprint(a), fingerprint(b), `diverged at step ${i}`);
  }
  assert.equal(fingerprint(a), fingerprint(b));
});

test("the fingerprint changes as the simulation advances", () => {
  const sim = new Simulation(config());
  const start = fingerprint(sim);
  for (let i = 0; i < 100; i++) sim.step();
  assert.notEqual(fingerprint(sim), start);
});

test("a single differing wall changes the fingerprint", () => {
  const c = config();
  const a = new Simulation(c);
  const b = new Simulation(c);
  assert.equal(fingerprint(a), fingerprint(b));

  let target: [number, number] | null = null;
  for (let y = 2; y < 28 && !target; y++) {
    for (let x = 2; x < 28 && !target; x++) {
      if (b.grid[y][x] !== 1) continue;
      if (b.colonies.some(k => k.nestX === x && k.nestY === y)) continue;
      if (b.foodSources.some(s => s.x === x && s.y === y)) continue;
      target = [x, y];
    }
  }
  assert.ok(target);
  b.enqueue({ kind: "setWall", x: target[0], y: target[1], open: false });
  b.flushPending();
  assert.notEqual(fingerprint(a), fingerprint(b));
});

test("a differing pheromone value changes the fingerprint", () => {
  const c = config();
  const a = new Simulation(c);
  const b = new Simulation(c);
  for (let i = 0; i < 50; i++) { a.step(); b.step(); }
  assert.equal(fingerprint(a), fingerprint(b));
  b.colonies[0].foodPhero[400] += 1e-6;
  assert.notEqual(fingerprint(a), fingerprint(b));
});

test("differing ant seeds diverge in fingerprint", () => {
  const base = config();
  const a = new Simulation(base);
  const b = new Simulation({ ...base, seeds: { ...base.seeds, master: null, ants: "0f0f0f0f" } });
  for (let i = 0; i < 300; i++) { a.step(); b.step(); }
  assert.notEqual(fingerprint(a), fingerprint(b));
});

test("the simulation records a fingerprint every interval", () => {
  const sim = new Simulation(config());
  assert.deepEqual(sim.fingerprints, [] as { t: number; h: string }[]);
  for (let i = 0; i < FINGERPRINT_INTERVAL * 3; i++) sim.step();
  assert.equal(sim.fingerprints.length, 3);
  assert.deepEqual(
    sim.fingerprints.map(f => f.t),
    [FINGERPRINT_INTERVAL, FINGERPRINT_INTERVAL * 2, FINGERPRINT_INTERVAL * 3],
  );
  for (const f of sim.fingerprints) assert.match(f.h, /^[0-9a-f]{8}$/);
});

test("recorded fingerprints match a recomputation of the same run", () => {
  const c = config();
  const a = new Simulation(c);
  const b = new Simulation(c);
  for (let i = 0; i < FINGERPRINT_INTERVAL * 2; i++) {
    a.step();
    b.step();
  }
  assert.deepEqual(a.fingerprints, b.fingerprints);
});

test("the fingerprint covers the ant stream position, not just visible state", () => {
  const a = new Simulation(config());
  const b = new Simulation(config());
  for (let i = 0; i < 50; i++) { a.step(); b.step(); }
  assert.equal(fingerprint(a), fingerprint(b));

  // Burn one draw in `a` and nothing else. Every value the fingerprint used to
  // hash is still identical between the two, but the runs have permanently
  // diverged: from here they draw different numbers. A fingerprint that misses
  // this reports a match for as long as it takes the difference to surface,
  // which is exactly the "plausible wrong answer" it exists to prevent.
  (a as unknown as { antsRng: () => number }).antsRng();

  assert.notEqual(fingerprint(a), fingerprint(b));
});

test("a burned draw is caught at the next checkpoint rather than hundreds of ticks later", () => {
  const a = new Simulation(config());
  const b = new Simulation(config());
  (a as unknown as { antsRng: () => number }).antsRng();
  a.step();
  b.step();
  assert.notEqual(fingerprint(a), fingerprint(b));
});
