import assert from "node:assert/strict";
import test from "node:test";
import {
  Simulation, DEFAULT_PARAMS, makeSeeds, fingerprint, FINGERPRINT_INTERVAL,
  DEFAULT_DOCTRINE, TOPOLOGY_PRIVATE, cloneDoctrine,
} from "./index";
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
      if (!b.occupancy.isOpen(x, y)) continue;
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
  // One cell, one channel, the smallest perturbation that survives a float32
  // round trip. (28, 12) was flat index 400 when the field was one flat array.
  b.colonies[0].field.add("food", 28, 12, 1e-6);
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

test("one differing doctrine atom changes the fingerprint before anything moves", () => {
  const c = config();
  const a = new Simulation(c);
  const b = new Simulation(c);
  const d = cloneDoctrine(DEFAULT_DOCTRINE);
  d.evapRate = 0.006;
  b.enqueue({ kind: "setDoctrine", colony: 0, doctrine: d });
  b.flushPending();
  assert.notEqual(fingerprint(a), fingerprint(b));
});

test("a differing role, adoption mode, or topology changes the fingerprint", () => {
  const c = config();
  const base = fingerprint(new Simulation(c));

  const role = new Simulation(c);
  role.colonies[0].ants[0].role = "spoiler";
  assert.notEqual(fingerprint(role), base);

  const adoption = new Simulation(c);
  adoption.enqueue({ kind: "setAdoption", mode: "nest" });
  adoption.flushPending();
  assert.notEqual(fingerprint(adoption), base);

  const topology = new Simulation(c);
  topology.topology = { ...TOPOLOGY_PRIVATE, visible: { home: false, food: false }, maxMimicRate: 0.5 };
  assert.notEqual(fingerprint(topology), base);
});

test("under nest adoption the fingerprint sees every version ants still hold", () => {
  const c = config();
  const a = new Simulation(c);
  const b = new Simulation(c);
  for (const s of [a, b]) { s.enqueue({ kind: "setAdoption", mode: "nest" }); s.flushPending(); }
  // Both colonies bump to version 1 with a pending doctrine no ant has
  // adopted, and only the pending doctrines' numbers differ, so the version
  // counter alone cannot explain a divergence: the hash must be reading the
  // held doctrines themselves.
  const d1 = cloneDoctrine(DEFAULT_DOCTRINE);
  d1.evapRate = 0.006;
  const d2 = cloneDoctrine(DEFAULT_DOCTRINE);
  d2.forager.follow.searching.food.own = 6;
  a.enqueue({ kind: "setDoctrine", colony: 0, doctrine: d1 });
  b.enqueue({ kind: "setDoctrine", colony: 0, doctrine: d2 });
  a.flushPending();
  b.flushPending();
  assert.equal(a.colonies[0].doctrineVersion, b.colonies[0].doctrineVersion);
  assert.ok(a.colonies[0].ants.every(x => x.doctrineVersion === 0));
  assert.ok(b.colonies[0].ants.every(x => x.doctrineVersion === 0));
  assert.notEqual(fingerprint(a), fingerprint(b));

  // The same pending doctrine on both sides hashes the same.
  const twin = new Simulation(c);
  twin.enqueue({ kind: "setAdoption", mode: "nest" });
  twin.flushPending();
  twin.enqueue({ kind: "setDoctrine", colony: 0, doctrine: d1 });
  twin.flushPending();
  assert.equal(fingerprint(a), fingerprint(twin));
});
