import assert from "node:assert/strict";
import test from "node:test";
import {
  ModeRegistry,
  defineMode,
  isModeId,
  isModeVersion,
  type ModeConfigResult,
} from "./index";

interface CounterConfig {
  initial: number;
}

class CounterRuntime {
  tick = 0;
  value: number;

  constructor(config: CounterConfig) {
    this.value = config.initial;
  }

  step(): void {
    this.tick++;
    this.value++;
  }
}

function parseCounterConfig(value: unknown): ModeConfigResult<CounterConfig> {
  if (typeof value !== "object" || value === null || Array.isArray(value) ||
      !Number.isSafeInteger((value as { initial?: unknown }).initial)) {
    return { ok: false, error: "Counter config needs an integer initial value." };
  }
  return { ok: true, value: { initial: (value as { initial: number }).initial } };
}

const counterV1 = defineMode({
  id: "test/counter",
  version: 1,
  parseConfig: parseCounterConfig,
  create: (config: CounterConfig) => new CounterRuntime(config),
});

test("defineMode preserves the typed factory and boundary parser", () => {
  const parsed = counterV1.parseConfig({ initial: 4, ignored: true });
  assert.deepEqual(parsed, { ok: true, value: { initial: 4 } });
  assert.deepEqual(counterV1.parseConfig({ initial: 1.5 }), {
    ok: false,
    error: "Counter config needs an integer initial value.",
  });
  assert.deepEqual(counterV1.parseConfig([]), {
    ok: false,
    error: "Counter config needs an integer initial value.",
  });
  assert.deepEqual(counterV1.parseConfig(null), {
    ok: false,
    error: "Counter config needs an integer initial value.",
  });

  assert.ok(parsed.ok);
  const runtime = counterV1.create(parsed.value);
  runtime.step();
  assert.deepEqual({ tick: runtime.tick, value: runtime.value }, { tick: 1, value: 5 });
});

test("mode identities accept stable names and positive integer versions", () => {
  for (const id of ["maze", "online-war", "vendor/custom-mode", "m2"]) {
    assert.equal(isModeId(id), true, id);
  }
  for (const id of ["", "Maze", "two words", "/maze", "maze/", "maze_2", "a".repeat(101), 1]) {
    assert.equal(isModeId(id), false, String(id));
  }

  for (const version of [1, 2, Number.MAX_SAFE_INTEGER]) assert.equal(isModeVersion(version), true);
  for (const version of [0, -1, 1.5, Number.NaN, "1"]) assert.equal(isModeVersion(version), false);
});

test("defineMode rejects an invalid identity immediately", () => {
  assert.throws(
    () => defineMode({ ...counterV1, id: "Bad Mode" }),
    /Invalid mode id/,
  );
  assert.throws(
    () => defineMode({ ...counterV1, version: 0 }),
    /Invalid mode version/,
  );
});

test("ModeRegistry resolves exact behavior versions and refuses duplicates", () => {
  const counterV2 = defineMode({ ...counterV1, version: 2 });
  const registry = new ModeRegistry()
    .register(counterV1)
    .register(counterV2);

  assert.equal(registry.resolve("test/counter", 1), counterV1);
  assert.equal(registry.resolve("test/counter", 2), counterV2);
  assert.equal(registry.resolve("test/counter", 3), undefined);
  assert.equal(registry.resolve("other", 1), undefined);
  assert.throws(() => registry.register(counterV1), /already registered/);
});

test("ModeRegistry reconstructs a runtime from a canonical parsed reference", () => {
  const result = new ModeRegistry().register(counterV1).create({
    id: "test/counter",
    version: 1,
    config: { initial: 7, ignored: true },
  });
  assert.ok(result.ok);
  assert.deepEqual(result.instance.reference, {
    id: "test/counter",
    version: 1,
    config: { initial: 7 },
  });
  assert.equal((result.instance.runtime as CounterRuntime).value, 7);
});

test("ModeRegistry reports invalid, unknown, and malformed references", () => {
  const registry = new ModeRegistry().register(counterV1);
  assert.deepEqual(registry.create({ id: "Bad Mode", version: 1, config: {} }), {
    ok: false,
    error: "Mode reference has an invalid identity.",
  });
  assert.deepEqual(registry.create({ id: "test/counter", version: 2, config: {} }), {
    ok: false,
    error: "Mode test/counter@2 is not registered.",
  });
  assert.deepEqual(registry.create({ id: "test/counter", version: 1, config: {} }), {
    ok: false,
    error: "Counter config needs an integer initial value.",
  });
});

test("ModeRegistry validates definitions even when defineMode was bypassed", () => {
  const registry = new ModeRegistry();
  assert.throws(
    () => registry.register({ ...counterV1, id: "bad id" }),
    /Invalid mode id/,
  );
  assert.throws(
    () => registry.register({ ...counterV1, version: -1 }),
    /Invalid mode version/,
  );
});
