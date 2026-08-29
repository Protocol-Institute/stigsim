import assert from "node:assert/strict";
import test from "node:test";
import {
  Simulation, DEFAULT_PARAMS, makeSeeds, MetricsRecorder,
  buildTrace, serializeTrace, parseTrace, traceToRunConfig, traceFilename,
  TRACE_FORMAT, TRACE_VERSION, SIM_VERSION, FINGERPRINT_INTERVAL, fingerprint,
} from "./index";
import type { RunConfig, Trace } from "./index";

function config(overrides: Partial<RunConfig> = {}): RunConfig {
  return {
    seeds: makeSeeds("trace-test"),
    numAnts: 15,
    params: DEFAULT_PARAMS,
    loopRate: 0.1,
    numColonies: 1,
    numFoodSources: 2,
    foodPerSource: 400,
    ...overrides,
  };
}

function runSim(steps = 1200) {
  const sim = new Simulation(config());
  const rec = new MetricsRecorder();
  for (let i = 0; i < steps; i++) { sim.step(); rec.maybeSample(sim); }
  return { sim, rec };
}

test("a built trace carries the header, seeds, and config", () => {
  const { sim, rec } = runSim();
  const trace = buildTrace(sim, rec, "2026-08-27T00:00:00.000Z");

  assert.equal(trace.format, TRACE_FORMAT);
  assert.equal(trace.version, TRACE_VERSION);
  assert.equal(trace.simVersion, SIM_VERSION);
  assert.equal(trace.createdAt, "2026-08-27T00:00:00.000Z");
  assert.deepEqual(trace.run.seeds, makeSeeds("trace-test"));
  assert.equal(trace.run.config.numAnts, 15);
  assert.equal(trace.run.config.foodPerSource, 400);
  assert.equal(trace.endTick, 1200);
  assert.ok(trace.fingerprints.length >= 2);
  assert.ok(trace.metrics.samples.length > 0);
  assert.equal(trace.metrics.interval, rec.interval);
  assert.equal(trace.metrics.truncated, false);
});

test("a trace shorter than the fingerprint interval still gets an end-of-trace checkpoint", () => {
  const sim = new Simulation(config());
  const rec = new MetricsRecorder();
  for (let i = 0; i < 200; i++) { sim.step(); rec.maybeSample(sim); }

  assert.equal(sim.fingerprints.length, 0, "sanity: no interval checkpoint has fired yet");
  const trace = buildTrace(sim, rec);
  assert.deepEqual(trace.fingerprints, [{ t: 200, h: fingerprint(sim) }]);
});

test("buildTrace does not duplicate a checkpoint that already lands on the final tick", () => {
  const sim = new Simulation(config());
  const rec = new MetricsRecorder();
  for (let i = 0; i < FINGERPRINT_INTERVAL; i++) { sim.step(); rec.maybeSample(sim); }

  assert.equal(sim.fingerprints.length, 1, "sanity: the run ends exactly on a checkpoint tick");
  const trace = buildTrace(sim, rec);
  assert.deepEqual(trace.fingerprints, sim.fingerprints);
});

test("commands are captured in the trace at their recorded ticks", () => {
  const sim = new Simulation(config());
  const rec = new MetricsRecorder();
  for (let i = 0; i < 30; i++) { sim.step(); rec.maybeSample(sim); }
  sim.enqueue({ kind: "setParam", key: "trailPower", value: 9 });
  for (let i = 0; i < 30; i++) { sim.step(); rec.maybeSample(sim); }

  const trace = buildTrace(sim, rec);
  assert.deepEqual(trace.commands, [{ t: 31, cmd: { kind: "setParam", key: "trailPower", value: 9 } }]);
});

test("a built trace's metrics samples do not change when the simulation advances afterwards", () => {
  const sim = new Simulation(config());
  const rec = new MetricsRecorder();
  for (let i = 0; i < 30; i++) { sim.step(); rec.maybeSample(sim); }

  const trace = buildTrace(sim, rec);
  const samplesBefore = trace.metrics.samples.length;

  for (let i = 0; i < 30; i++) { sim.step(); rec.maybeSample(sim); }

  assert.equal(trace.metrics.samples.length, samplesBefore);
});

test("a trace round-trips through serialize and parse", () => {
  const { sim, rec } = runSim();
  const trace = buildTrace(sim, rec, "2026-08-27T00:00:00.000Z");
  const result = parseTrace(serializeTrace(trace));

  assert.ok(result.ok, result.ok ? "" : result.error);
  assert.deepEqual(result.trace, trace);
  assert.equal(result.warning, undefined);
});

test("traceToRunConfig rebuilds a simulation that reproduces the original", () => {
  const { sim, rec } = runSim(600);
  const trace = buildTrace(sim, rec);

  const rebuilt = new Simulation(traceToRunConfig(trace));
  for (let i = 0; i < 600; i++) rebuilt.step();

  assert.deepEqual(rebuilt.fingerprints, sim.fingerprints);
  assert.equal(rebuilt.totalFoodCollected, sim.totalFoodCollected);
});

test("traceFilename uses the master seed, and falls back when there is none", () => {
  const { sim, rec } = runSim(200);
  const trace = buildTrace(sim, rec);
  assert.equal(traceFilename(trace), "stigsim-trace-test-200.trace.json");

  const anonymous: Trace = { ...trace, run: { ...trace.run, seeds: { ...trace.run.seeds, master: null } } };
  assert.equal(traceFilename(anonymous), "stigsim-custom-200.trace.json");
});

test("parseTrace rejects malformed input with a specific message", () => {
  const cases: [string, RegExp][] = [
    ["not json at all", /could not be read as JSON/i],
    ["[]", /not a Stigsim trace/i],
    ["{}", /not a Stigsim trace/i],
    [JSON.stringify({ format: "something-else", version: 1 }), /not a Stigsim trace/i],
  ];
  for (const [text, pattern] of cases) {
    const result = parseTrace(text);
    assert.ok(!result.ok, `should have rejected: ${text}`);
    assert.match(result.error, pattern);
  }
});

test("parseTrace refuses a newer format version", () => {
  const { sim, rec } = runSim(100);
  const trace = { ...buildTrace(sim, rec), version: TRACE_VERSION + 1 };
  const result = parseTrace(JSON.stringify(trace));
  assert.ok(!result.ok);
  assert.match(result.error, /newer version/i);
});

test("parseTrace rejects a trace with a broken command", () => {
  const { sim, rec } = runSim(100);
  const trace = buildTrace(sim, rec);
  const broken = { ...trace, commands: [{ t: 5, cmd: { kind: "setWall", x: "nope", y: 2, open: true } }] };
  const result = parseTrace(JSON.stringify(broken));
  assert.ok(!result.ok);
  assert.match(result.error, /command/i);
});

test("parseTrace rejects a trace with a malformed metrics sample", () => {
  const { sim, rec } = runSim(100);
  const trace = buildTrace(sim, rec);
  const broken = { ...trace, metrics: { ...trace.metrics, samples: [1, "x", {}] } };
  const result = parseTrace(JSON.stringify(broken));
  assert.ok(!result.ok);
  assert.match(result.error, /metrics sample/i);
});

test("parseTrace rejects missing or malformed seeds and config", () => {
  const { sim, rec } = runSim(100);
  const trace = buildTrace(sim, rec);

  const noSeeds = JSON.stringify({ ...trace, run: { ...trace.run, seeds: { master: null, maze: "a" } } });
  const noSeedsResult = parseTrace(noSeeds);
  assert.ok(!noSeedsResult.ok);
  assert.match(noSeedsResult.error, /seed/i);

  // The message names the field that failed, so someone handed a trace that
  // will not load can tell what is wrong with it.
  const badConfig = JSON.stringify({ ...trace, run: { ...trace.run, config: { ...trace.run.config, numAnts: -3 } } });
  const badConfigResult = parseTrace(badConfig);
  assert.ok(!badConfigResult.ok);
  assert.match(badConfigResult.error, /ant count/i);

  const noConfig = JSON.stringify({ ...trace, run: { ...trace.run, config: null } });
  const noConfigResult = parseTrace(noConfig);
  assert.ok(!noConfigResult.ok);
  assert.match(noConfigResult.error, /config/i);
});

test("parseTrace loads a trace from a different sim version but warns", () => {
  const { sim, rec } = runSim(100);
  const trace = { ...buildTrace(sim, rec), simVersion: SIM_VERSION + 1 };
  const result = parseTrace(JSON.stringify(trace));
  assert.ok(result.ok, result.ok ? "" : result.error);
  assert.match(result.warning ?? "", /recorded under a different/i);
});

// ─── Loader bounds ───────────────────────────────────────────────────────────

/** A minimal well-formed trace whose config can be poked at. */
function traceWith(configOverrides: Record<string, unknown> = {}, paramOverrides: Record<string, unknown> = {}) {
  const { sim, rec } = runSim(10);
  const t = buildTrace(sim, rec) as unknown as Record<string, unknown>;
  const run = t.run as { config: Record<string, unknown> };
  run.config = { ...run.config, ...configOverrides };
  run.config.params = { ...(run.config.params as object), ...paramOverrides };
  return JSON.stringify(t);
}

test("the loader rejects an ant count that would exhaust memory", () => {
  // new Replayer(trace) allocates numAnts ants per colony immediately. At the
  // measured ~131 bytes per ant, 1e9 asks the heap for about 131 GB and takes
  // the tab down before anything can report a problem.
  const result = parseTrace(traceWith({ numAnts: 1e9 }));
  assert.equal(result.ok, false);
});

test("the loader rejects params that stall a tick or amplify pheromone", () => {
  assert.equal(parseTrace(traceWith({}, { trailPower: 1e12 })).ok, false);
  assert.equal(parseTrace(traceWith({}, { trailPower: 2.3 })).ok, false);
  assert.equal(parseTrace(traceWith({}, { evapRate: -1 })).ok, false);
  assert.equal(parseTrace(traceWith({}, { tankMax: 0 })).ok, false);
});

test("the loader rejects out-of-range colony, source, and food counts", () => {
  assert.equal(parseTrace(traceWith({ numColonies: 99 })).ok, false);
  assert.equal(parseTrace(traceWith({ numFoodSources: 1e9 })).ok, false);
  assert.equal(parseTrace(traceWith({ foodPerSource: 1e12 })).ok, false);
});

test("the loader still accepts everything the sliders can produce", () => {
  assert.equal(parseTrace(traceWith({ numAnts: 100, numColonies: 4, numFoodSources: 8, foodPerSource: 10000 },
    { evapRate: 0.001, trailPower: 10, tankMax: 16000 })).ok, true);
  assert.equal(parseTrace(traceWith({ numAnts: 1, numColonies: 1, numFoodSources: 1, foodPerSource: 50 },
    { evapRate: 0.02, trailPower: 1, tankMax: 1600 })).ok, true);
});

test("the loader checks the shape of each metrics colony entry", () => {
  const { sim, rec } = runSim(10);
  const t = buildTrace(sim, rec) as unknown as Record<string, unknown>;
  const metrics = t.metrics as { samples: Record<string, unknown>[] };
  assert.ok(metrics.samples.length > 0, "expected at least one sample");
  metrics.samples[0].colonies = [1, 2, 3];
  assert.equal(parseTrace(JSON.stringify(t)).ok, false);
});
