import assert from "node:assert/strict";
import test from "node:test";
import {
  defineMode,
  type ModeConfigResult,
} from "@stigsim/sim-core";
import {
  MODE_RUN_RECORD_FORMAT,
  MODE_RUN_RECORD_VERSION,
  ModeRecordingRegistry,
  ModeRunRecorder,
  ModeTraceRegistry,
  ModeTraceReplayer,
  defineRecordingMode,
  defineResearchChannel,
  defineTraceMode,
  modeRunChannelToNdjson,
  modeRunCommandsToNdjson,
  modeRunRecordToTrace,
  parseModeRunRecord,
  serializeModeRunRecord,
  type ModeRunRecord,
} from "./index";

interface CounterConfig {
  initial: number;
}

interface CounterCommand {
  kind: "add";
  value: number;
}

class CounterRuntime {
  tick = 0;
  total: number;

  constructor(initial: number) {
    this.total = initial;
  }

  step(): void {
    this.tick++;
    this.total++;
  }
}

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function parseConfig(value: unknown): ModeConfigResult<CounterConfig> {
  const candidate = object(value);
  return candidate && Number.isSafeInteger(candidate.initial)
    ? { ok: true, value: { initial: candidate.initial as number } }
    : { ok: false, error: "Counter config is invalid." };
}

function parseCommand(value: unknown): ModeConfigResult<CounterCommand> {
  const candidate = object(value);
  return candidate?.kind === "add" && Number.isSafeInteger(candidate.value)
    ? { ok: true, value: { kind: "add", value: candidate.value as number } }
    : { ok: false, error: "Counter command is invalid." };
}

function parseTotal(value: unknown): ModeConfigResult<{ total: number }> {
  const candidate = object(value);
  return candidate && Number.isSafeInteger(candidate.total)
    ? { ok: true, value: { total: candidate.total as number } }
    : { ok: false, error: "Counter observation is invalid." };
}

const counterMode = defineMode({
  id: "research-counter",
  version: 1,
  parseConfig,
  create: (config: CounterConfig) => new CounterRuntime(config.initial),
});

const counterTrace = defineTraceMode({
  mode: counterMode,
  parseCommand,
  applyCommand: (runtime, command) => { runtime.total += command.value; },
  fingerprint: runtime => `${runtime.tick}:${runtime.total}`,
});

const counterRecording = defineRecordingMode({
  trace: counterTrace,
  channels: {
    state: defineResearchChannel({
      version: 1,
      defaultInterval: 2,
      defaultCapacity: 10,
      capture: (runtime: CounterRuntime) => ({ total: runtime.total }),
      parse: parseTotal,
    }),
  },
  outcome: {
    version: 1,
    capture: (runtime: CounterRuntime) => ({ total: runtime.total }),
    parse: parseTotal,
  },
});

function registry(): ModeRecordingRegistry {
  return new ModeRecordingRegistry().register(counterRecording);
}

function recordedCounter(): ModeRunRecord<CounterConfig, CounterCommand> {
  const recorder = new ModeRunRecorder(counterRecording, { initial: 3, ignored: true }, {
    createdAt: "2026-09-18T12:00:00.000Z",
    fingerprintInterval: 2,
    participants: [
      { id: "player-1", kind: "player", label: "Researcher", slot: "colony-0" },
      { id: "bot-1", kind: "bot", slot: "colony-1" },
    ],
    channels: { state: { interval: 2, capacity: 2 } },
  });
  recorder.command(
    { kind: "participant", participantId: "player-1" },
    { kind: "add", value: 5, ignored: true },
  );
  recorder.command(
    { kind: "system", systemId: "match-controller" },
    { kind: "add", value: 2 },
  );
  for (let i = 0; i < 5; i++) assert.equal(recorder.step(), true);
  return recorder.build();
}

test("run records combine replay commands, provenance, research channels, and outcome", () => {
  const record = recordedCounter();
  assert.equal(record.format, MODE_RUN_RECORD_FORMAT);
  assert.equal(record.version, MODE_RUN_RECORD_VERSION);
  assert.deepEqual(record.mode.config, { initial: 3 });
  assert.deepEqual(record.commands.map(command => [command.t, command.sequence]), [[1, 0], [1, 1]]);
  assert.deepEqual(record.commands.map(command => command.source), [
    { kind: "participant", participantId: "player-1" },
    { kind: "system", systemId: "match-controller" },
  ]);
  assert.equal(record.channels.state.truncated, true);
  assert.deepEqual(record.channels.state.samples, [
    { t: 4, data: { total: 14 } },
    { t: 5, data: { total: 15 } },
  ]);
  assert.deepEqual(record.outcome, { version: 1, data: { total: 15 } });
});

test("a run record round-trips and converts back to an exactly replayable mode trace", () => {
  const record = recordedCounter();
  const parsed = parseModeRunRecord(serializeModeRunRecord(record), registry());
  assert.ok(parsed.ok);
  assert.deepEqual(parsed.record, record);

  const traceRegistry = new ModeTraceRegistry().register(counterTrace);
  const replay = new ModeTraceReplayer<CounterRuntime>(modeRunRecordToTrace(parsed.record), traceRegistry);
  while (replay.step());
  assert.equal(replay.divergedAt, null);
  assert.equal(replay.runtime.total, 15);
});

test("NDJSON helpers expose commands and individual channel samples", () => {
  const record = recordedCounter();
  const commands = modeRunCommandsToNdjson(record).split("\n").map(line => JSON.parse(line));
  const samples = modeRunChannelToNdjson(record, "state").split("\n").map(line => JSON.parse(line));
  assert.equal(commands.length, 2);
  assert.equal(commands[0].source.participantId, "player-1");
  assert.deepEqual(samples, record.channels.state.samples);
  assert.throws(() => modeRunChannelToNdjson(record, "missing"), /no missing channel/i);
});

test("invalid provenance is refused before a command mutates the runtime", () => {
  const recorder = new ModeRunRecorder(counterRecording, { initial: 0 }, {
    participants: [{ id: "known", kind: "player" }],
  });
  assert.throws(() => recorder.command(
    { kind: "participant", participantId: "unknown" },
    { kind: "add", value: 100 },
  ), /invalid source/i);
  assert.equal(recorder.runtime.total, 0);
});

test("building a live record does not change later sampling", () => {
  const recorder = new ModeRunRecorder(counterRecording, { initial: 0 }, {
    channels: { state: { interval: 2, capacity: 10 } },
  });
  recorder.step();
  assert.deepEqual(recorder.build().channels.state.samples.map(sample => sample.t), [1]);
  recorder.step();
  assert.deepEqual(recorder.build().channels.state.samples.map(sample => sample.t), [2]);
});

test("record parsing rejects tampered provenance, ordering, samples, and schemas", () => {
  const base = recordedCounter();
  const cases: Array<[string, (value: ModeRunRecord) => void, RegExp]> = [
    ["participant", value => { value.participants.push({ id: "player-1", kind: "bot" }); }, /participant/i],
    ["source", value => { value.commands[0].source = { kind: "participant", participantId: "missing" }; }, /source/i],
    ["sequence", value => { value.commands[1].sequence = 4; }, /sequence/i],
    ["channel version", value => { value.channels.state.version = 2; }, /state channel/i],
    ["sample", value => { value.channels.state.samples[0].data = { total: 1.5 }; }, /state sample/i],
    ["unknown channel", value => { value.channels.unknown = value.channels.state; }, /unknown channel/i],
    ["outcome", value => { value.outcome!.version = 2; }, /outcome/i],
  ];
  for (const [name, mutate, wanted] of cases) {
    const value = structuredClone(base);
    mutate(value);
    const parsed = parseModeRunRecord(JSON.stringify(value), registry());
    assert.equal(parsed.ok, false, name);
    if (!parsed.ok) assert.match(parsed.error, wanted, name);
  }
});

test("record definitions validate channel metadata and registry identity", () => {
  assert.throws(() => defineResearchChannel({
    version: 0,
    defaultInterval: 1,
    defaultCapacity: 1,
    capture: (_runtime: CounterRuntime) => ({ total: 0 }),
    parse: parseTotal,
  }), /version/i);
  assert.throws(() => defineResearchChannel({
    version: 1,
    defaultInterval: 0,
    defaultCapacity: 1,
    capture: (_runtime: CounterRuntime) => ({ total: 0 }),
    parse: parseTotal,
  }), /interval/i);
  const modes = registry();
  assert.throws(() => modes.register(counterRecording), /already registered/i);
  assert.throws(() => new ModeRunRecorder(counterRecording, { initial: 0 }, {
    channels: { missing: false } as never,
  }), /no missing research channel/i);
});
