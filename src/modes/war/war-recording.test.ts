import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_DOCTRINE,
  cloneDoctrine,
} from "@stigsim/sim-core";
import {
  ModeRecordingRegistry,
  ModeRunRecorder,
  ModeTraceRegistry,
  ModeTraceReplayer,
  modeRunRecordToTrace,
  parseModeRunRecord,
  serializeModeRunRecord,
} from "@stigsim/sim-trace";
import { warModeConfig } from "./war-mode";
import {
  parseWarAgentObservation,
  parseWarFieldObservation,
  parseWarMetricsObservation,
  warRecordingMode,
} from "./war-recording";
import {
  DEFAULT_WAR_SETTINGS,
  WarSimulation,
  type WarMatchSettings,
} from "./war-simulation";
import { warTraceMode } from "./war-trace";

const SETTINGS: WarMatchSettings = {
  ...DEFAULT_WAR_SETTINGS,
  masterSeed: "war-research-record",
  startingAnts: 4,
  foodSources: 2,
  foodPerSource: 300,
};

test("War research recording captures metrics, agents, fields, and player commands", () => {
  const recorder = new ModeRunRecorder(warRecordingMode, warModeConfig(SETTINGS), {
    createdAt: "2026-09-18T13:00:00.000Z",
    fingerprintInterval: 10,
    participants: [
      { id: "colony-red", kind: "player", slot: "colony-0" },
      { id: "colony-blue", kind: "bot", slot: "colony-1" },
    ],
    channels: {
      metrics: { interval: 10, capacity: 2 },
      agents: { interval: 15, capacity: 3 },
      fields: { interval: 20, capacity: 2 },
    },
  });
  for (let tick = 0; tick < 30; tick++) {
    if (tick === 5) {
      const doctrine = cloneDoctrine(DEFAULT_DOCTRINE);
      doctrine.evapRate = 0.02;
      recorder.command(
        { kind: "participant", participantId: "colony-red" },
        { kind: "set-doctrine", colonyId: 0, doctrine },
      );
    }
    assert.equal(recorder.step(), true);
  }
  const record = recorder.build();

  assert.deepEqual(record.commands.map(command => [command.t, command.sequence]), [[6, 0]]);
  assert.deepEqual(record.channels.metrics.samples.map(sample => sample.t), [20, 30]);
  assert.equal(record.channels.metrics.truncated, true);
  assert.deepEqual(record.channels.agents.samples.map(sample => sample.t), [15, 30]);
  assert.deepEqual(record.channels.fields.samples.map(sample => sample.t), [20, 30]);
  const field = record.channels.fields.samples[0].data as {
    colonies: Array<{ home: number[]; food: number[]; caut: number[] }>;
  };
  assert.equal(field.colonies[0].home.length, 31 * 31);
  assert.equal(field.colonies[0].food.length, 31 * 31);
  assert.equal(field.colonies[0].caut.length, 31 * 31);
  assert.equal(record.outcome, undefined);

  const parsed = parseModeRunRecord(
    serializeModeRunRecord(record),
    new ModeRecordingRegistry().register(warRecordingMode),
  );
  assert.ok(parsed.ok);
  const modes = new ModeTraceRegistry().register(warTraceMode);
  const replay = new ModeTraceReplayer<WarSimulation>(modeRunRecordToTrace(parsed.record), modes);
  while (replay.step());
  assert.equal(replay.divergedAt, null);
  assert.equal(replay.runtime.fingerprint(), recorder.runtime.fingerprint());
});

test("War recording captures a versioned completed outcome", () => {
  const recorder = new ModeRunRecorder(warRecordingMode, warModeConfig({
    ...SETTINGS,
    masterSeed: "war-research-outcome",
    startingAnts: 0,
  }), {
    channels: { fields: false, agents: false },
  });
  assert.equal(recorder.step(), true);
  const record = recorder.build();
  assert.deepEqual(record.outcome, {
    version: 1,
    data: {
      winner: "draw",
      tick: 1,
      colonies: record.channels.metrics.samples[0].data &&
        (record.channels.metrics.samples[0].data as { colonies: unknown }).colonies,
    },
  });
});

test("War research channel parsers reject malformed observations", () => {
  assert.equal(parseWarMetricsObservation({
    result: null,
    foodRemaining: [-1],
    colonies: [],
  }).ok, false);
  assert.equal(parseWarAgentObservation({
    colonies: [{ id: 0, ants: [{ id: -1 }] }, { id: 1, ants: [] }],
  }).ok, false);
  assert.equal(parseWarFieldObservation({
    colonies: [
      { id: 0, home: [], food: [], caut: [], received: [] },
      { id: 1, home: [], food: [], caut: [], received: [] },
    ],
  }).ok, false);
});
