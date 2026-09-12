import assert from "node:assert/strict";
import test from "node:test";
import { Simulation, DEFAULT_PARAMS, makeSeeds, fingerprint } from "@stigsim/sim-core";
import type { RunConfig } from "@stigsim/sim-core";
import { MetricsRecorder, buildTrace, serializeTrace, parseTrace, traceToRunConfig } from "./index";

function config(overrides: Partial<RunConfig> = {}): RunConfig {
  return {
    seeds: makeSeeds("layout-trace"),
    numAnts: 6,
    params: DEFAULT_PARAMS,
    loopRate: 0.1,
    numColonies: 2,
    numFoodSources: 3,
    foodPerSource: 400,
    ...overrides,
  };
}

function traceFor(cfg: RunConfig, steps = 50) {
  const sim = new Simulation(cfg);
  const rec = new MetricsRecorder();
  for (let i = 0; i < steps; i++) { sim.step(); rec.maybeSample(sim); }
  return { sim, trace: buildTrace(sim, rec) };
}

test("a trace records the layout and hands it back as run config", () => {
  const { trace } = traceFor(config({ layout: "mirrored" }));
  assert.equal(trace.run.config.layout, "mirrored");
  const parsed = parseTrace(serializeTrace(trace));
  assert.ok(parsed.ok);
  assert.equal(traceToRunConfig(parsed.trace).layout, "mirrored");
});

test("a run with no layout records the random layout explicitly", () => {
  const { trace } = traceFor(config());
  assert.equal(trace.run.config.layout, "random");
});

test("a trace written before layouts existed still loads and replays on the random layout", () => {
  const { sim, trace } = traceFor(config());
  const legacy = JSON.parse(serializeTrace(trace)) as { run: { config: Record<string, unknown> } };
  delete legacy.run.config.layout;
  const parsed = parseTrace(JSON.stringify(legacy));
  assert.ok(parsed.ok, "legacy trace rejected");
  const replay = new Simulation(traceToRunConfig(parsed.trace));
  assert.equal(replay.layout, "random");
  for (let i = 0; i < 50; i++) replay.step();
  assert.equal(fingerprint(replay), fingerprint(sim));
});

test("a mirrored trace replays to the same fingerprint", () => {
  const { sim, trace } = traceFor(config({ layout: "mirrored" }));
  const parsed = parseTrace(serializeTrace(trace));
  assert.ok(parsed.ok);
  const replay = new Simulation(traceToRunConfig(parsed.trace));
  for (let i = 0; i < 50; i++) replay.step();
  assert.equal(fingerprint(replay), fingerprint(sim));
});

test("an unknown layout is rejected by name", () => {
  const { trace } = traceFor(config());
  const bad = JSON.parse(serializeTrace(trace)) as { run: { config: Record<string, unknown> } };
  bad.run.config.layout = "hexagonal";
  const parsed = parseTrace(JSON.stringify(bad));
  assert.equal(parsed.ok, false);
  if (!parsed.ok) assert.match(parsed.error, /layout/);
});
