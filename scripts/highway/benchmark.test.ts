import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, validateConfig, appendCell, HighwayDetector, runTrial, summarize } from './benchmark';

const config = { ...DEFAULT_CONFIG, maxTicks: 100, sampleEvery: 10, holdTicks: 20, deliveryWindow: 30, minDeliveries: 2, minShare: 1 };
const ants = [{ cx: 0, cy: 0, tx: 1, ty: 0 }];
test('requires one near-shortest actual route, deliveries and sustained occupancy', () => {
  const d = new HighwayDetector(config, 2);
  d.delivered(1, [2, 1, 0]);
  assert.equal(d.sample(10, ants, 5), null); // insufficient deliveries
  d.delivered(11, [2, 1, 0]);
  assert.equal(d.sample(20, ants, 5), null);
  assert.equal(d.sample(30, [{ cx: 3, cy: 0, tx: 4, ty: 0 }], 5), null); // resets
  d.delivered(31, [2, 1, 0]); d.delivered(32, [2, 1, 0]);
  assert.equal(d.sample(40, ants, 5), null);
  assert.equal(d.sample(50, ants, 5), null);
  d.delivered(55, [2, 1, 0]); d.delivered(56, [2, 1, 0]);
  assert.equal(d.sample(60, ants, 5)?.confirmedTick, 60);
});
test('rejects detours, branch unions and movement across a route chord', () => {
  const d = new HighwayDetector({ ...config, minDeliveries: 1 }, 2);
  d.delivered(1, [2, 7, 6, 5, 0]); // too long
  for (const t of [10, 20, 30]) assert.equal(d.sample(t, ants, 5), null);
  const e = new HighwayDetector({ ...config, minDeliveries: 1, deliveryWindow: 100, maxStretch: 3 }, 2);
  e.delivered(1, [2, 7, 6, 1, 0]);
  // Both cells are on the route, but edge 2 -> 1 is not.
  for (const t of [10, 20, 30]) assert.equal(e.sample(t, [{ cx: 2, cy: 0, tx: 1, ty: 0 }], 5), null);
});
test('stale deliveries cannot confirm stationary ants', () => {
  const d = new HighwayDetector({ ...config, minDeliveries: 1, deliveryWindow: 15 }, 2);
  d.delivered(1, [2, 1, 0]);
  for (const t of [10, 20, 30]) assert.equal(d.sample(t, ants, 5), null);
});
test('loop erasure preserves a contiguous route', () => {
  const route: number[] = [];
  for (const cell of [0, 1, 2, 7, 2, 1, 6, 5]) appendCell(route, cell);
  assert.deepEqual(route, [0, 1, 6, 5]);
});
test('validates workload and deterministic exponent bounds', () => {
  validateConfig(DEFAULT_CONFIG);
  for (const patch of [{ numAnts: 0 }, { maxTicks: NaN }, { trailPowers: [2.3] }, { evapRates: [2] }, { holdTicks: 21 }, { minShare: 0 }]) {
    assert.throws(() => validateConfig({ ...config, ...patch }));
  }
});
test('paired trials reproduce and keep environment fixed across ant settings', () => {
  const a = runTrial(config, 0, 0, 0.005, 5);
  assert.deepEqual(runTrial(config, 0, 0, 0.005, 5), a);
  const b = runTrial(config, 0, 1, 0.01, 3);
  assert.deepEqual(a.food, b.food);
  assert.equal(a.shortest, b.shortest);
  assert.equal(a.seeds.maze, b.seeds.maze);
  assert.equal(a.seeds.food, b.seeds.food);
  assert.notEqual(a.seeds.ants, b.seeds.ants);
  assert.ok(a.foodCapacity > config.numAnts * config.maxTicks);
  const ranked = summarize([a, { ...a, highway: { onsetTick: 10, confirmedTick: 30, route: [0, 1], share: 1 } }], 100);
  assert.equal(ranked[0].cappedMeanTicks, 65);
  assert.equal(ranked[0].successRate, 0.5);
});
test('a live trial can confirm and export a contiguous source-to-nest route', () => {
  const c = { ...DEFAULT_CONFIG, loopRate: 0.5, maxTicks: 10000, minShare: 0.05,
    maxStretch: 10, minDeliveries: 1, holdTicks: 20 };
  const result = runTrial(c, 0, 0, 0.005, 5);
  assert.ok(result.highway);
  const route = result.highway.route;
  assert.equal(route[0], result.food.y * 31 + result.food.x);
  assert.equal(route.at(-1), 32); // Maze nest (1, 1)
  assert.equal(new Set(route).size, route.length);
  for (let i = 1; i < route.length; i++) {
    assert.equal(Math.abs(route[i] % 31 - route[i - 1] % 31) +
      Math.abs(Math.floor(route[i] / 31) - Math.floor(route[i - 1] / 31)), 1);
  }
  assert.ok(result.firstDelivery! <= result.highway.onsetTick);
  assert.equal(result.highway.confirmedTick - result.highway.onsetTick, c.holdTicks);
});
test('browser observation preserves CLI outcomes and includes the final state', () => {
  const c = { ...DEFAULT_CONFIG, maxTicks: 100, holdTicks: 20, deliveryWindow: 20 };
  const ticks: number[] = [];
  const observed = runTrial(c, 0, 0, .005, 5, sim => ticks.push(sim.tick));
  assert.deepEqual(observed, runTrial(c, 0, 0, .005, 5));
  assert.equal(ticks.at(-1), observed.endTick);
  assert.ok(ticks.length > 1);
});
