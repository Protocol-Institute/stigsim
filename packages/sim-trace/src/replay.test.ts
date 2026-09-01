import assert from "node:assert/strict";
import test from "node:test";
import { Simulation, DEFAULT_PARAMS, makeSeeds, fingerprint } from "@stigsim/sim-core";
import type { RunConfig } from "@stigsim/sim-core";
import { MetricsRecorder, buildTrace, Replayer } from "./index";
import type { Trace } from "./index";

function config(overrides: Partial<RunConfig> = {}): RunConfig {
  return {
    seeds: makeSeeds("replay-test"),
    numAnts: 20,
    params: DEFAULT_PARAMS,
    loopRate: 0.1,
    numColonies: 1,
    numFoodSources: 2,
    foodPerSource: 400,
    ...overrides,
  };
}

/** A 1200-tick run containing a wall edit, a food drop, and a slider change. */
function recordRun(): { trace: Trace; sim: Simulation } {
  const sim = new Simulation(config());
  const rec = new MetricsRecorder();

  const editable = (() => {
    for (let y = 2; y < 28; y++) {
      for (let x = 2; x < 28; x++) {
        if (sim.grid[y][x] !== 1) continue;
        if (sim.colonies.some(c => c.nestX === x && c.nestY === y)) continue;
        if (sim.foodSources.some(s => s.x === x && s.y === y)) continue;
        return [x, y] as [number, number];
      }
    }
    throw new Error("no editable cell");
  })();

  for (let i = 0; i < 400; i++) { sim.step(); rec.maybeSample(sim); }
  sim.enqueue({ kind: "setWall", x: editable[0], y: editable[1], open: false });
  for (let i = 0; i < 400; i++) { sim.step(); rec.maybeSample(sim); }
  sim.enqueue({ kind: "setParam", key: "evapRate", value: 0.012 });
  sim.enqueue({ kind: "setCautionary", value: true });
  for (let i = 0; i < 400; i++) { sim.step(); rec.maybeSample(sim); }

  return { trace: buildTrace(sim, rec), sim };
}

test("a replay reproduces the recorded run exactly", () => {
  const { trace, sim } = recordRun();
  const r = new Replayer(trace);
  while (r.step());

  assert.equal(r.divergedAt, null);
  assert.equal(r.tick, trace.endTick);
  assert.equal(fingerprint(r.sim), fingerprint(sim));
  assert.equal(r.sim.totalFoodCollected, sim.totalFoodCollected);
  assert.deepEqual(r.sim.commandLog, trace.commands);
});

test("step stops at the end tick", () => {
  const { trace } = recordRun();
  const r = new Replayer(trace);
  while (r.step());
  assert.equal(r.atEnd, true);
  assert.equal(r.step(), false);
  assert.equal(r.tick, trace.endTick);
});

test("seeking forward matches stepping there", () => {
  const { trace } = recordRun();
  const stepped = new Replayer(trace);
  for (let i = 0; i < 900; i++) stepped.step();

  const sought = new Replayer(trace);
  sought.seek(900);

  assert.equal(sought.tick, 900);
  assert.equal(fingerprint(sought.sim), fingerprint(stepped.sim));
});

test("seeking backward rebuilds and lands on the same state", () => {
  const { trace } = recordRun();
  const r = new Replayer(trace);
  r.seek(1000);
  const at1000 = fingerprint(r.sim);
  r.seek(300);
  assert.equal(r.tick, 300);
  r.seek(1000);
  assert.equal(fingerprint(r.sim), at1000);
});

test("seeking past the end clamps", () => {
  const { trace } = recordRun();
  const r = new Replayer(trace);
  r.seek(999999);
  assert.equal(r.tick, trace.endTick);
  r.seek(-50);
  assert.equal(r.tick, 0);
});

test("a corrupted fingerprint is reported at the tick it fails", () => {
  const { trace } = recordRun();
  assert.ok(trace.fingerprints.length >= 2);
  const target = trace.fingerprints[1];
  const tampered: Trace = {
    ...trace,
    fingerprints: trace.fingerprints.map(f => f.t === target.t ? { ...f, h: "deadbeef" } : f),
  };

  const r = new Replayer(tampered);
  while (r.step());
  assert.equal(r.divergedAt, target.t);
  assert.ok(r.tick < tampered.endTick, "replay should stop at the divergence");
});

test("continueAfterDivergence lets playback finish", () => {
  const { trace } = recordRun();
  const target = trace.fingerprints[1];
  const tampered: Trace = {
    ...trace,
    fingerprints: trace.fingerprints.map(f => f.t === target.t ? { ...f, h: "deadbeef" } : f),
  };

  const r = new Replayer(tampered);
  while (r.step());
  assert.equal(r.divergedAt, target.t);

  r.continueAfterDivergence();
  while (r.step());
  assert.equal(r.tick, tampered.endTick);
});

test("reset returns to tick zero", () => {
  const { trace } = recordRun();
  const r = new Replayer(trace);
  r.seek(700);
  r.reset();
  assert.equal(r.tick, 0);
  assert.equal(r.divergedAt, null);
});

test("a backward seek after continueAfterDivergence re-arms fingerprint checking", () => {
  const { trace } = recordRun();
  const target = trace.fingerprints[1];
  const tampered: Trace = {
    ...trace,
    fingerprints: trace.fingerprints.map(f => f.t === target.t ? { ...f, h: "deadbeef" } : f),
  };

  const r = new Replayer(tampered);
  while (r.step());
  assert.equal(r.divergedAt, target.t);

  r.continueAfterDivergence();
  while (r.step());
  assert.equal(r.tick, tampered.endTick);

  // Seeking backward rebuilds the replay from tick 0 — a fresh playthrough
  // that should verify fingerprints again, not carry forward the earlier
  // "continue anyway" decision.
  r.seek(300);
  while (r.step());
  assert.equal(
    r.divergedAt,
    target.t,
    "a fresh playthrough after a backward seek should detect the same tampered checkpoint again",
  );
});

test("a paused edit replays at the same point as the live run", () => {
  const sim = new Simulation(config());
  const rec = new MetricsRecorder();

  // Pause partway through tick 100, edit, and resume — this is the
  // flushPending path, not enqueue. The run crosses the tick-500 fingerprint
  // boundary so a divergence is caught even before the final-checkpoint fix.
  for (let i = 0; i < 100; i++) { sim.step(); rec.maybeSample(sim); }
  sim.enqueue({ kind: "setParam", key: "evapRate", value: 0.02 });
  sim.flushPending();
  for (let i = 0; i < 900; i++) { sim.step(); rec.maybeSample(sim); }

  const trace = buildTrace(sim, rec);
  const r = new Replayer(trace);
  while (r.step());

  assert.equal(r.divergedAt, null, "replay diverged from the live run after a paused edit");
  assert.equal(r.tick, trace.endTick);
  assert.equal(fingerprint(r.sim), fingerprint(sim));
  assert.equal(r.sim.totalFoodCollected, sim.totalFoodCollected);
});

test("a trace saved during a pause, without resuming, does not falsely report divergence", () => {
  // R1 regression: flushPending() records the paused edit at `tick + 1` (it
  // belongs to the next tick's top-of-tick command drain) but applies it to
  // `sim` immediately, so `sim`'s live state is already past what tick
  // `sim.tick` looked like before the edit. If buildTrace appends a tail
  // fingerprint at `sim.tick` here, that hash describes post-edit state,
  // while replay — which stops at `endTick` without ever draining the
  // `tick + 1` command — is still pre-edit at that same tick. The two
  // disagree and a faithful recording is reported as diverged.
  const sim = new Simulation(config());
  const rec = new MetricsRecorder();

  // 137 is deliberately not a multiple of FINGERPRINT_INTERVAL (500), so no
  // interval checkpoint has just fired and buildTrace's tail-append logic is
  // exercised.
  for (let i = 0; i < 137; i++) { sim.step(); rec.maybeSample(sim); }
  sim.enqueue({ kind: "setParam", key: "evapRate", value: 0.02 });
  sim.flushPending();

  // Save the trace right here, without stepping any further.
  const trace = buildTrace(sim, rec);

  const r = new Replayer(trace);
  while (r.step());

  // r.sim is not expected to fingerprint-match the live sim here: the trace's
  // endTick is 137, and replay correctly stops there without ever draining
  // the `t: 138` command, so r.sim is pre-edit while the live sim already has
  // the paused edit applied. What matters is that this faithful recording is
  // not flagged as diverged.
  assert.equal(r.divergedAt, null, "a trace saved during a pause should not report divergence");
  assert.equal(r.tick, trace.endTick);
});

test("a trace shorter than the fingerprint interval still detects a tampered checkpoint", () => {
  const sim = new Simulation(config());
  const rec = new MetricsRecorder();
  for (let i = 0; i < 200; i++) { sim.step(); rec.maybeSample(sim); }
  const trace = buildTrace(sim, rec);

  assert.equal(trace.fingerprints.length, 1, "a short trace should still carry an end-of-trace fingerprint");
  assert.equal(trace.fingerprints[0].t, 200);

  const tampered: Trace = {
    ...trace,
    fingerprints: trace.fingerprints.map(f => ({ ...f, h: "deadbeef" })),
  };
  const r = new Replayer(tampered);
  while (r.step());
  assert.equal(r.divergedAt, 200, "a tampered checkpoint in a short trace should be reported");
});

test("reset alone re-arms fingerprint checking after continueAfterDivergence", () => {
  const { trace } = recordRun();
  const target = trace.fingerprints[1];
  const tampered: Trace = {
    ...trace,
    fingerprints: trace.fingerprints.map(f => f.t === target.t ? { ...f, h: "deadbeef" } : f),
  };

  const r = new Replayer(tampered);
  while (r.step());
  r.continueAfterDivergence();
  while (r.step());

  r.reset();
  while (r.step());
  assert.equal(r.divergedAt, target.t);
});
