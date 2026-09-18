import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  MAX_TICKS,
  defineMode,
  type ModeConfigResult,
} from "@stigsim/sim-core";
import {
  ModeTraceRecorder,
  ModeTraceRegistry,
  ModeTraceReplayer,
  MODE_TRACE_FORMAT,
  MODE_TRACE_VERSION,
  SIM_VERSION,
  defineTraceMode,
  mazeTraceMode,
  parseModeTrace,
  serializeModeTrace,
  type ModeTrace,
} from "./index";

interface CounterConfig { initial: number }
interface CounterCommand { kind: "add"; value: number }

class CounterRuntime {
  tick = 0;
  total: number;

  constructor(config: CounterConfig) {
    this.total = config.initial;
  }

  step(): void {
    this.tick++;
    this.total++;
  }
}

function parseCounterConfig(value: unknown): ModeConfigResult<CounterConfig> {
  if (typeof value !== "object" || value === null ||
      !Number.isSafeInteger((value as { initial?: unknown }).initial)) {
    return { ok: false, error: "Counter config needs an integer initial value." };
  }
  return { ok: true, value: { initial: (value as { initial: number }).initial } };
}

function parseCounterCommand(value: unknown): ModeConfigResult<CounterCommand> {
  if (typeof value !== "object" || value === null ||
      (value as { kind?: unknown }).kind !== "add" ||
      !Number.isSafeInteger((value as { value?: unknown }).value)) {
    return { ok: false, error: "Counter command needs an integer value." };
  }
  return { ok: true, value: { kind: "add", value: (value as { value: number }).value } };
}

const counterMode = defineMode({
  id: "test/counter",
  version: 1,
  parseConfig: parseCounterConfig,
  create: (config: CounterConfig) => new CounterRuntime(config),
});

const counterTraceMode = defineTraceMode({
  mode: counterMode,
  parseCommand: parseCounterCommand,
  applyCommand: (runtime: CounterRuntime, command: CounterCommand) => { runtime.total += command.value; },
  fingerprint: (runtime: CounterRuntime) => `${runtime.tick}:${runtime.total}`,
});

function registry(): ModeTraceRegistry {
  return new ModeTraceRegistry().register(counterTraceMode);
}

function recordedCounter() {
  const recorder = new ModeTraceRecorder(
    counterTraceMode,
    { initial: 4, ignored: true },
    "2026-09-16T10:00:00.000Z",
    2,
  );
  recorder.step();
  recorder.command({ kind: "add", value: 10, ignored: true });
  for (let i = 0; i < 4; i++) recorder.step();
  return recorder;
}

test("mode traces record canonical config, commands, checkpoints, and a final fingerprint", () => {
  const recorder = recordedCounter();
  const trace = recorder.build();

  assert.equal(recorder.runtime.total, 19);
  assert.deepEqual(trace, {
    format: MODE_TRACE_FORMAT,
    version: MODE_TRACE_VERSION,
    simVersion: SIM_VERSION,
    createdAt: "2026-09-16T10:00:00.000Z",
    mode: { id: "test/counter", version: 1, config: { initial: 4 } },
    commands: [{ t: 2, cmd: { kind: "add", value: 10 } }],
    fingerprints: [
      { t: 2, h: "2:16" },
      { t: 4, h: "4:18" },
      { t: 5, h: "5:19" },
    ],
    endTick: 5,
  });
  assert.deepEqual(JSON.parse(serializeModeTrace(trace)), trace);
});

test("mode trace replay applies commands at their recorded tick and supports seeking", () => {
  const trace = recordedCounter().build();
  const parsed = parseModeTrace(serializeModeTrace(trace), registry());
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;

  const replay = new ModeTraceReplayer<CounterRuntime>(parsed.trace, registry());
  replay.seek(4);
  assert.equal(replay.runtime.total, 18);
  replay.seek(1);
  assert.equal(replay.runtime.total, 5);
  replay.seek(99);
  assert.equal(replay.runtime.total, 19);
  assert.equal(replay.atEnd, true);
  assert.equal(replay.step(), false);
  replay.reset();
  assert.equal(replay.tick, 0);
  assert.equal(replay.divergedAt, null);
});

test("mode replay detects a changed fingerprint and can continue", () => {
  const trace = recordedCounter().build();
  trace.fingerprints[0].h = "wrong";
  const replay = new ModeTraceReplayer<CounterRuntime>(trace, registry());
  while (replay.step());
  assert.equal(replay.divergedAt, 2);
  replay.continueAfterDivergence();
  while (replay.step());
  assert.equal(replay.tick, trace.endTick);
  replay.seek(0);
  while (replay.step());
  assert.equal(replay.divergedAt, 2);
});

test("the generic reader upgrades and replays the unchanged golden Maze trace", () => {
  const fixture = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "golden.trace.json");
  const text = readFileSync(fixture, "utf8");
  const modes = new ModeTraceRegistry().register(mazeTraceMode);
  const parsed = parseModeTrace(text, modes);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.upgradedLegacy, true);
  assert.deepEqual(
    parsed.trace.commands.map(command => (command.cmd as { kind: string }).kind),
    ["setWall", "setDoctrine", "setAdoption", "setDoctrine", "setAntCount"],
  );

  const replay = new ModeTraceReplayer(parsed.trace, modes);
  while (replay.step());
  assert.equal(replay.divergedAt, null);
  assert.equal(replay.tick, parsed.trace.endTick);
});

test("mode trace parsing reports malformed envelope, identity, config, commands, and checkpoints", () => {
  const base = recordedCounter().build() as unknown as Record<string, unknown>;
  const parse = (value: unknown) => parseModeTrace(JSON.stringify(value), registry());
  const changes: unknown[] = [
    null,
    { ...base, format: "other" },
    { ...base, version: "1" },
    { ...base, version: MODE_TRACE_VERSION - 1 },
    { ...base, version: MODE_TRACE_VERSION + 1 },
    { ...base, simVersion: "2" },
    { ...base, createdAt: 7 },
    { ...base, mode: null },
    { ...base, mode: { id: "War", version: 1, config: { initial: 4 } } },
    { ...base, mode: { id: "not-registered", version: 1, config: { initial: 4 } } },
    { ...base, mode: { id: "test/counter", version: 1, config: { initial: Number.NaN } } },
    { ...base, mode: { id: "test/counter", version: 1, config: {} } },
    { ...base, endTick: -1 },
    { ...base, endTick: MAX_TICKS + 1 },
    { ...base, commands: null },
    { ...base, commands: [null] },
    { ...base, commands: [{ t: 0, cmd: { kind: "add", value: 1 } }] },
    { ...base, commands: [{ t: 1, cmd: { kind: "add", value: Number.NaN } }] },
    { ...base, commands: [{ t: 1, cmd: { kind: "subtract", value: 1 } }] },
    { ...base, fingerprints: null },
    { ...base, fingerprints: [null] },
    { ...base, fingerprints: [{ t: 99, h: "hash" }] },
  ];
  for (const changed of changes) {
    assert.equal(parse(changed).ok, false, `accepted ${JSON.stringify(changed)}`);
  }
  assert.equal(parseModeTrace("not json", registry()).ok, false);
  assert.equal(parseModeTrace(JSON.stringify({ format: "other" }), registry()).ok, false);
});

test("mode trace parsing preserves simulation-version warnings", () => {
  const trace = { ...recordedCounter().build(), simVersion: SIM_VERSION + 1 };
  const result = parseModeTrace(serializeModeTrace(trace), registry());
  assert.equal(result.ok, true);
  if (result.ok) assert.match(result.warning ?? "", /different simulation version/i);
});

test("registries reject duplicate trace identities", () => {
  const modes = registry();
  assert.equal(modes.resolve("test/counter", 1)?.id, "test/counter");
  assert.equal(modes.resolve("missing", 1), undefined);
  assert.throws(() => modes.register(counterTraceMode), /already registered/);
});

test("recorders reject invalid inputs and runtimes that violate one-tick stepping", () => {
  assert.throws(() => new ModeTraceRecorder(counterTraceMode, {}, "now"), /integer initial/);
  assert.throws(() => new ModeTraceRecorder(counterTraceMode, { initial: 0 }, "now", 0), /positive integer/);
  const recorder = new ModeTraceRecorder(counterTraceMode, { initial: 0 });
  assert.throws(() => recorder.command({ kind: "subtract", value: 1 }), /integer value/);

  class LeapRuntime extends CounterRuntime {
    override step(): void { this.tick += 2; }
  }
  const leap = defineTraceMode({
    ...counterTraceMode,
    mode: defineMode({ ...counterMode, id: "test/leap", create: (config: CounterConfig) => new LeapRuntime(config) }),
  });
  assert.throws(() => new ModeTraceRecorder(leap, { initial: 0 }).step(), /exactly one tick/);

  class StalledRuntime extends CounterRuntime {
    override step(): void {}
  }
  const stalled = defineTraceMode({
    ...counterTraceMode,
    mode: defineMode({ ...counterMode, id: "test/stalled", create: (config: CounterConfig) => new StalledRuntime(config) }),
  });
  assert.equal(new ModeTraceRecorder(stalled, { initial: 0 }).step(), false);
});

test("non-JSON canonical values are refused at config and command boundaries", () => {
  const badConfig = defineTraceMode({
    ...counterTraceMode,
    mode: defineMode({
      ...counterMode,
      id: "test/bad-config",
      parseConfig: (): ModeConfigResult<{ initial: number }> => ({ ok: true, value: { initial: Number.NaN } }),
    }),
  });
  assert.throws(() => new ModeTraceRecorder(badConfig, {}), /lossless JSON/);

  const badCommand = defineTraceMode({
    ...counterTraceMode,
    mode: defineMode({ ...counterMode, id: "test/bad-command" }),
    parseCommand: (): ModeConfigResult<{ kind: "add"; value: number }> =>
      ({ ok: true, value: { kind: "add", value: Number.NaN } }),
  });
  const recorder = new ModeTraceRecorder(badCommand, { initial: 0 });
  assert.throws(() => recorder.command({}), /lossless JSON/);

  const modes = new ModeTraceRegistry().register(badConfig).register(badCommand);
  const configTrace = { ...recordedCounter().build(), mode: { id: "test/bad-config", version: 1, config: {} } };
  assert.equal(parseModeTrace(serializeModeTrace(configTrace), modes).ok, false);
  const commandTrace: ModeTrace = {
    ...recordedCounter().build(),
    mode: { id: "test/bad-command", version: 1, config: { initial: 0 } },
    commands: [{ t: 1, cmd: {} }],
  };
  assert.equal(parseModeTrace(serializeModeTrace(commandTrace), modes).ok, false);
});

test("a command recorded after the last step is retained without a false tail checkpoint", () => {
  const recorder = new ModeTraceRecorder(counterTraceMode, { initial: 0 }, "now", 10);
  recorder.step();
  recorder.command({ kind: "add", value: 2 });
  const trace = recorder.build();
  assert.deepEqual(trace.commands, [{ t: 2, cmd: { kind: "add", value: 2 } }]);
  assert.deepEqual(trace.fingerprints, []);
});

test("mode hooks cannot mutate the canonical recipe or recorded commands", () => {
  const mutating = defineTraceMode({
    mode: defineMode({
      ...counterMode,
      id: "test/mutating",
      create: (config: CounterConfig) => {
        const runtime = new CounterRuntime(config);
        config.initial = 99;
        return runtime;
      },
    }),
    parseCommand: parseCounterCommand,
    applyCommand: (runtime: CounterRuntime, command: CounterCommand) => {
      runtime.total += command.value;
      command.value = 99;
    },
    fingerprint: (runtime: CounterRuntime) => `${runtime.tick}:${runtime.total}`,
  });
  const recorder = new ModeTraceRecorder(mutating, { initial: 4 });
  recorder.command({ kind: "add", value: 2 });
  recorder.step();
  const trace = recorder.build();
  assert.deepEqual(trace.mode.config, { initial: 4 });
  assert.deepEqual(trace.commands, [{ t: 1, cmd: { kind: "add", value: 2 } }]);

  const modes = new ModeTraceRegistry().register(mutating);
  const replay = new ModeTraceReplayer<CounterRuntime>(trace, modes);
  replay.step();
  assert.equal(replay.runtime.total, 7);
  replay.reset();
  replay.step();
  assert.equal(replay.runtime.total, 7);
  assert.deepEqual(replay.trace.commands, [{ t: 1, cmd: { kind: "add", value: 2 } }]);
});

test("replayer constructors reject unregistered or malformed traces", () => {
  const trace = recordedCounter().build();
  assert.throws(() => new ModeTraceReplayer(trace, new ModeTraceRegistry()), /not registered/);
  const bad = { ...trace, endTick: -1 };
  assert.throws(() => new ModeTraceReplayer(bad, registry()), /end tick/);
});
