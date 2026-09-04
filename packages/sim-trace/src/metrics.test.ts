import assert from "node:assert/strict";
import test from "node:test";
import { Simulation, DEFAULT_PARAMS, makeSeeds, COLS } from "@stigsim/sim-core";
import type { RunConfig } from "@stigsim/sim-core";
import {
  MetricsRecorder, METRICS_INTERVAL, shortestFromNest, metricsToCsv,
} from "./index";
import type { MetricsSample } from "./index";

function config(overrides: Partial<RunConfig> = {}): RunConfig {
  return {
    seeds: makeSeeds("metrics-test"),
    numAnts: 20,
    params: DEFAULT_PARAMS,
    loopRate: 0.1,
    numColonies: 2,
    numFoodSources: 2,
    foodPerSource: 500,
    ...overrides,
  };
}

test("shortestFromNest measures reachable cells and marks the rest -1", () => {
  const sim = new Simulation(config());
  const nest = sim.colonies[0];
  const dist = shortestFromNest(sim.occupancy, sim.bounds, nest.nestX, nest.nestY);

  assert.equal(dist.length, COLS * sim.bounds.rows);
  assert.equal(dist[nest.nestY * COLS + nest.nestX], 0);
  for (const src of sim.foodSources) {
    assert.ok(dist[src.y * COLS + src.x] > 0, "food should be reachable from the nest");
  }
  for (let y = 0; y < sim.bounds.rows; y++) {
    for (let x = 0; x < COLS; x++) {
      if (!sim.occupancy.isOpen(x, y)) assert.equal(dist[y * COLS + x], -1);
    }
  }
});

test("the recorder samples on the interval and not between", () => {
  const sim = new Simulation(config());
  const rec = new MetricsRecorder();
  assert.equal(rec.samples.length, 0);

  for (let i = 0; i < METRICS_INTERVAL - 1; i++) { sim.step(); rec.maybeSample(sim); }
  assert.equal(rec.samples.length, 0);

  sim.step(); rec.maybeSample(sim);
  assert.equal(rec.samples.length, 1);
  assert.equal(rec.samples[0].t, METRICS_INTERVAL);
});

test("each sample carries one entry per colony and per food source", () => {
  const sim = new Simulation(config());
  const rec = new MetricsRecorder();
  for (let i = 0; i < METRICS_INTERVAL; i++) { sim.step(); rec.maybeSample(sim); }

  const s = rec.samples[0];
  assert.equal(s.colonies.length, 2);
  assert.equal(s.foodRemaining.length, 2);
  for (const c of s.colonies) {
    assert.equal(typeof c.food, "number");
    assert.equal(typeof c.ratePerKTick, "number");
    assert.ok(c.highwayScore >= 0 && c.highwayScore <= 1);
    assert.ok(c.pheroMass.home >= 0);
    assert.ok(c.pheroEntropy.home >= 0);
    assert.ok(c.meanTripRatio === null || c.meanTripRatio >= 1 - 1e-9);
  }
});

test("the buffer caps and flags truncation", () => {
  const sim = new Simulation(config());
  const rec = new MetricsRecorder(METRICS_INTERVAL, 5);
  for (let i = 0; i < METRICS_INTERVAL * 8; i++) { sim.step(); rec.maybeSample(sim); }

  assert.equal(rec.samples.length, 5);
  assert.equal(rec.truncated, true);
  assert.deepEqual(
    rec.samples.map(s => s.t),
    [METRICS_INTERVAL * 4, METRICS_INTERVAL * 5, METRICS_INTERVAL * 6, METRICS_INTERVAL * 7, METRICS_INTERVAL * 8],
  );
});

test("metrics are reproducible for the same seed", () => {
  const c = config();
  const a = new Simulation(c), b = new Simulation(c);
  const ra = new MetricsRecorder(), rb = new MetricsRecorder();
  for (let i = 0; i < 1000; i++) {
    a.step(); ra.maybeSample(a);
    b.step(); rb.maybeSample(b);
  }
  assert.deepEqual(ra.samples, rb.samples);
});

test("trip ratios appear once ants complete round trips", () => {
  const sim = new Simulation(config({ numAnts: 60, numColonies: 1, numFoodSources: 1 }));
  const rec = new MetricsRecorder();
  for (let i = 0; i < 6000; i++) { sim.step(); rec.maybeSample(sim); }

  const withRatio = rec.samples.filter(s => s.colonies[0].meanTripRatio !== null);
  assert.ok(withRatio.length > 0, "expected at least one sample with a trip ratio");
  for (const s of withRatio) {
    const r = s.colonies[0].meanTripRatio as number;
    assert.ok(r >= 1 - 1e-9, `a realized trip cannot beat the shortest path: ${r}`);
  }
});

test("reset clears samples and the truncation flag", () => {
  const sim = new Simulation(config());
  const rec = new MetricsRecorder(METRICS_INTERVAL, 2);
  for (let i = 0; i < METRICS_INTERVAL * 5; i++) { sim.step(); rec.maybeSample(sim); }
  assert.equal(rec.truncated, true);
  rec.reset();
  assert.deepEqual(rec.samples, []);
  assert.equal(rec.truncated, false);
});

test("metricsToCsv emits a header and one row per tick per colony", () => {
  const samples: MetricsSample[] = [
    {
      t: 10,
      colonies: [
        {
          food: 3, ratePerKTick: 300, highwayScore: 0.5,
          pheroMass: { home: 1, food: 2, caut: 0 },
          pheroEntropy: { home: 0.1, food: 0.2, caut: 0 },
          meanTripRatio: 1.5,
        },
        {
          food: 1, ratePerKTick: 100, highwayScore: 0.25,
          pheroMass: { home: 3, food: 4, caut: 0 },
          pheroEntropy: { home: 0.3, food: 0.4, caut: 0 },
          meanTripRatio: null,
        },
      ],
      foodRemaining: [497, 499],
    },
  ];

  const csv = metricsToCsv(samples);
  const lines = csv.trim().split("\n");
  assert.equal(lines.length, 3);
  assert.equal(
    lines[0],
    "t,colony,food,ratePerKTick,highwayScore,pheroMassHome,pheroMassFood,pheroMassCaut,pheroEntropyHome,pheroEntropyFood,pheroEntropyCaut,meanTripRatio,foodRemaining0,foodRemaining1",
  );
  assert.equal(lines[1], "10,0,3,300,0.5,1,2,0,0.1,0.2,0,1.5,497,499");
  assert.equal(lines[2], "10,1,1,100,0.25,3,4,0,0.3,0.4,0,,497,499");
});

test("metricsToCsv pads rows when the source count changes mid-run", () => {
  const base = {
    food: 0, ratePerKTick: 0, highwayScore: 0,
    pheroMass: { home: 0, food: 0, caut: 0 },
    pheroEntropy: { home: 0, food: 0, caut: 0 },
    meanTripRatio: null,
  };
  const samples: MetricsSample[] = [
    { t: 10, colonies: [base], foodRemaining: [100] },
    { t: 20, colonies: [base], foodRemaining: [100, 200] },
  ];
  const lines = metricsToCsv(samples).trim().split("\n");
  assert.ok(lines[0].endsWith("foodRemaining0,foodRemaining1"));
  assert.ok(lines[1].endsWith(",100,"));
  assert.ok(lines[2].endsWith(",100,200"));
});

test("metricsToCsv on an empty sample list returns only a header", () => {
  const csv = metricsToCsv([]);
  assert.equal(csv.trim(), "t,colony,food,ratePerKTick,highwayScore,pheroMassHome,pheroMassFood,pheroMassCaut,pheroEntropyHome,pheroEntropyFood,pheroEntropyCaut,meanTripRatio");
});
