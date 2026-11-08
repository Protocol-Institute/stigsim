import test from "node:test";
import assert from "node:assert/strict";
import { mazeMemoryMode } from "./engine";
import { STARTER } from "./starter";
import { prepare } from "./prepare";
import { parseWrites } from "./environment";
import { parseStrategy, PRACTICE_SEEDS, type CodeUsage } from "./contract";
const trial = () =>
  mazeMemoryMode.create({ seed: PRACTICE_SEEDS[0], stepLimit: 4000 });
const usage = (): CodeUsage => ({ calls: 0, fuel: 0, observationBytes: 0 });
test("local notes are copied, shared across passage directions, and conditional on actual movement", () => {
  const t = trial(),
    o = t.observation();
  assert.equal("seed" in o, false);
  assert.equal("grid" in o, false);
  assert.deepEqual(o.environment, { cell: null, passages: { E: null } });
  const writes = parseWrites([
    { target: "cell", value: { text: "chalk", list: ["E", true] } },
    { target: "E", when: "chosen", value: { visits: 1 } },
  ]);
  t.apply("N", writes);
  assert.deepEqual(t.observation().environment.cell, {
    text: "chalk",
    list: ["E", true],
  });
  assert.equal(t.observation().environment.passages.E, null);
  t.apply("E", writes);
  assert.deepEqual(t.observation().environment.passages.W, { visits: 1 });
  const read = t.observation().environment.passages.W as { visits: number };
  read.visits = 99;
  assert.deepEqual(t.observation().environment.passages.W, { visits: 1 });
  t.apply(
    "W",
    parseWrites([{ target: "W", when: "chosen", value: { visits: 2 } }]),
  );
  assert.deepEqual(t.observation().environment.passages.E, { visits: 2 });
  t.apply("N", parseWrites([{ target: "cell", value: null }]));
  assert.equal(t.observation().environment.cell, null);
});
test("invalid/remote/oversized notes cannot partially commit", () => {
  const t = trial();
  for (const value of [
    [{ target: "remote", value: 1 }],
    [{ target: "cell", slot: 0, set: 1 }],
    [{ target: "cell", value: "é".repeat(1100) }],
    Array.from({ length: 5 }, () => ({
      target: "cell",
      value: "x".repeat(1800),
    })),
    [{ target: "cell", when: "chosen", value: "wrong" }],
  ])
    assert.throws(() => parseWrites(value));
  assert.throws(() =>
    t.apply(
      "E",
      parseWrites([
        { target: "cell", value: "must roll back" },
        { target: "N", value: "blocked" },
      ]),
    ),
  );
  assert.equal(t.tick, 0);
  assert.deepEqual(t.environment.export(), {});
  let deep: unknown = 0;
  for (let i = 0; i < 40; i++) deep = [deep];
  assert.throws(() => parseWrites([{ target: "cell", value: deep }]));
});
test("preparation gets local information in a fresh resource-limited VM and never chooses movement", async () => {
  const t = trial();
  const source = `let visits=0;function prepare(o){visits++;o.position.x=999;return {instructions:'Explore',context:{visits,network:typeof fetch,clock:typeof Date},writes:[]};}`;
  const a = await prepare(source, t.observation(), usage()),
    b = await prepare(source, t.observation(), usage());
  assert.deepEqual(a.context, b.context);
  assert.deepEqual(a.context, {
    visits: 1,
    network: "undefined",
    clock: "undefined",
  });
  assert.equal(t.position.x, 1);
  for (const source of [
    `function prepare(){return {instructions:'x',state:null};}`,
    `function prepare(){return {instructions:'x',move:'E'};}`,
    `function prepare(){while(true){}}`,
    `function prepare(){return {instructions:'x',context:Math.random()};}`,
  ])
    await assert.rejects(prepare(source, t.observation(), usage()));
  const budget = usage();
  budget.fuel = 32001;
  await assert.rejects(prepare(STARTER.source, t.observation(), budget));
  assert.throws(() => parseStrategy({ ...STARTER, source: "x".repeat(32001) }));
});

test("maze-wide storage accounting matches UTF-8 serialization and rolls back oversized writes", async () => {
  const { EnvironmentMemory, MARK_LIMITS } = await import("./environment");
  const env = new EnvironmentMemory(),
    o = trial().observation();
  let rejected = false;
  for (let i = 0; i < 600; i++) {
    const local = { ...o, position: { x: i, y: 1 } },
      write = parseWrites([
        { target: "cell", value: { note: "é".repeat(995) } },
      ]);
    try {
      env.commit(local, write, "N");
    } catch {
      rejected = true;
      assert.equal(env.local(local).cell, null);
      break;
    }
  }
  assert.equal(rejected, true);
  const before = env.export(),
    size = new TextEncoder().encode(JSON.stringify(before)).length;
  assert.ok(size <= MARK_LIMITS.mazeBytes);
  env.commit(o, parseWrites([{ target: "cell", value: null }]), "N");
  assert.ok(
    new TextEncoder().encode(JSON.stringify(env.export())).length < size,
  );
});
