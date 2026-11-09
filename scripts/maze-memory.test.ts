import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { request as httpRequest } from "node:http";
import { MemoryRun } from "./maze-memory-run";
import { localMemoryServer } from "./maze-memory-server";
import { askModel, type ProviderConfig } from "./maze-memory-provider";
import { STARTER } from "../src/modes/maze-memory/starter";
import { PRACTICE_SEEDS } from "../src/modes/maze-memory/contract";
import { metrics } from "../src/modes/maze-memory/record";
import { validateRecord, replayFrame } from "../src/modes/maze-memory/replay";
const config: ProviderConfig = {
  model: "typesafeai-test",
  base: "",
  decisionBase: "http://fake.test/typesafe/v1",
  token: "secret-never-export",
};
const limits = { movesPerMaze: 4000, requests: 4000 },
  manifest = { name: "Practice", seeds: [PRACTICE_SEEDS[0]] };
const response = (move: string) =>
  Response.json({
    model: "test-fixture",
    answers: { action: { type: "choice", choice: move, confidence: 0.9 } },
    usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 },
  });
const oracle: typeof fetch = async (_u, init) => {
  const p = JSON.parse(String(init!.body)),
    o = p.state.observation,
    c = p.state.localContext.passageUses;
  return response(
    ["N", "E", "S", "W"]
      .filter((d) => o.exits[d])
      .sort(
        (a, b) =>
          c[a] - c[b] ||
          ["N", "E", "S", "W"].indexOf(a) - ["N", "E", "S", "W"].indexOf(b),
      )[0],
  );
};
test("model choice alone moves the ant; failed and duplicate requests cannot commit writes twice", async () => {
  let calls = 0;
  const payloads: any[] = [];
  const run = new MemoryRun(
    STARTER,
    limits,
    manifest,
    "practice",
    config,
    async (_u, init) => {
      calls++;
      payloads.push(JSON.parse(String(init!.body)));
      return response("N");
    },
  );
  await run.step(0, 0);
  assert.equal(run.trial.tick, 1);
  assert.deepEqual(run.trial.position, { x: 1, y: 1 });
  assert.deepEqual(run.trial.environment.export(), {});
  assert.equal(run.record.attempts[0].applied, true);
  assert.equal(run.snapshot().busy, false);
  await run.step(0, 0);
  assert.equal(calls, 1);
  assert.equal(JSON.stringify(payloads[0]).includes(PRACTICE_SEEDS[0]), false);
  const fail = new MemoryRun(
    STARTER,
    limits,
    manifest,
    "practice",
    config,
    async () => Response.json({}, { status: 429 }),
  );
  await fail.step(0, 0);
  assert.equal(fail.record.status, "provider-unavailable");
  assert.equal(fail.record.outcomes.length, 0);
  assert.equal(fail.trial.tick, 0);
  assert.deepEqual(fail.trial.environment.export(), {});
  assert.equal(metrics(fail.record).tokensPerSolution, null);
  const invalid = new MemoryRun(
    STARTER,
    limits,
    manifest,
    "practice",
    config,
    async () => response("bad"),
  );
  await invalid.step(0, 0);
  assert.equal(invalid.record.outcomes[0].status, "invalid-response");
  assert.equal(invalid.record.status, "complete");
  assert.equal(invalid.trial.tick, 0);
  assert.equal(invalid.record.attempts[0].applied, false);
});
test("cancellation after a response reserves usage but commits neither movement nor memory", async () => {
  let resolve!: (value: Response) => void, called!: () => void;
  const ready = new Promise<void>((r) => (called = r));
  const run = new MemoryRun(
    STARTER,
    limits,
    manifest,
    "practice",
    config,
    async () => {
      called();
      return new Promise<Response>((r) => (resolve = r));
    },
  );
  const pending = run.step(0, 0);
  await ready;
  await assert.rejects(run.step(0, 0));
  run.cancel();
  resolve(response("E"));
  await pending;
  assert.equal(run.record.status, "cancelled");
  assert.equal(run.trial.tick, 0);
  assert.deepEqual(run.trial.environment.export(), {});
  assert.equal(run.record.attempts[0].applied, false);
  assert.equal(metrics(run.record).inputTokens, 10);
  validateRecord(run.record);
});
test("100-maze sequential batches reset notes and preserve complete versus budget-interrupted accounting", async () => {
  const seen: any[] = [];
  const run = new MemoryRun(
    STARTER,
    { movesPerMaze: 1, requests: 100 },
    {
      name: "100-maze test",
      seeds: Array.from({ length: 100 }, (_, i) => `memory-test:${i}`),
    },
    "evaluation",
    config,
    async (_u, init) => {
      const p = JSON.parse(String(init!.body));
      seen.push(p.state.observation.environment);
      return oracle(_u, init);
    },
  );
  while (run.record.status === "running")
    await run.step(run.record.currentMaze, run.trial.tick);
  assert.equal(run.record.outcomes.length, 100);
  assert.equal(run.record.status, "complete");
  assert.equal(run.record.attempts.length, 100);
  assert.ok(
    seen.every(
      (o) =>
        o.cell === null && Object.values(o.passages).every((v) => v === null),
    ),
  );
  validateRecord(run.record);
  const stop = new MemoryRun(
    STARTER,
    { movesPerMaze: 4000, requests: 1 },
    manifest,
    "practice",
    config,
    oracle,
  );
  await stop.step(0, 0);
  await stop.step(0, 1);
  assert.equal(stop.record.status, "request-budget");
  assert.equal(metrics(stop.record).tokensPerSolution, null);
  const budgetRecord = validateRecord(stop.record);
  budgetRecord.status = "complete";
  assert.throws(() => validateRecord(budgetRecord));
});
test("full completion can be replayed with JSON memory; tampered observations or outcomes are rejected without executing source", async () => {
  const run = new MemoryRun(
    STARTER,
    limits,
    manifest,
    "practice",
    config,
    oracle,
  );
  while (run.record.status === "running") await run.step(0, run.trial.tick);
  assert.equal(run.record.outcomes[0].status, "solved");
  assert.equal(
    metrics(run.record).tokensPerSolution,
    run.record.attempts.length * 12,
  );
  const record = validateRecord(run.record),
    frame = replayFrame(record, 0, run.trial.tick);
  assert.equal(frame.view.solved, true);
  assert.deepEqual(
    frame.view.observation.environment,
    run.trial.observation().environment,
  );
  assert.equal(
    replayFrame(record, 0, 0).view.observation.environment.cell,
    null,
  );
  const noExecution = structuredClone(record);
  noExecution.strategy.source = 'throw Error("never execute imported code")';
  assert.equal(replayFrame(noExecution, 0, frame.max).view.solved, true);
  const corrupt = structuredClone(record);
  corrupt.attempts[0].observation.environment.passages.E = { visits: 999 };
  assert.throws(() => validateRecord(corrupt));
  const outcome = structuredClone(record);
  outcome.outcomes[0].moves++;
  assert.throws(() => validateRecord(outcome));
  assert.equal(JSON.stringify(record).includes(config.token!), false);
});
test("invalid private state and code errors are zero-score outcomes before inference", async () => {
  let calls = 0;
  const run = new MemoryRun(
    {
      ...STARTER,
      source: `function prepare(){return {instructions:'x',state:{secret:1}}}`,
    },
    limits,
    manifest,
    "practice",
    config,
    async () => {
      calls++;
      return response("E");
    },
  );
  await run.step(0, 0);
  assert.equal(calls, 0);
  assert.equal(run.record.outcomes[0].status, "code-error");
  assert.equal(metrics(run.record).solved, 0);
  validateRecord(run.record);
});
test("chat adapter forces one movement tool and validates incomplete/refused output", async () => {
  const run = new MemoryRun(
      STARTER,
      limits,
      manifest,
      "practice",
      config,
      oracle,
    ),
    o = run.trial.observation(),
    p = { instructions: "Explore", context: {}, writes: [] };
  const chat = { ...config, model: "chat-model", base: "http://fake.test/v1" };
  const good = await askModel(
    chat,
    p,
    o,
    new AbortController().signal,
    async () =>
      Response.json({
        choices: [
          {
            message: {
              tool_calls: [
                {
                  function: { name: "choose_move", arguments: '{"move":"E"}' },
                },
              ],
            },
          },
        ],
        usage: { prompt_tokens: 3, completion_tokens: 2 },
      }),
  );
  assert.equal(good.move, "E");
  assert.equal(good.totalTokens, 5);
  await assert.rejects(
    askModel(chat, p, o, new AbortController().signal, async () =>
      Response.json({
        choices: [
          {
            finish_reason: "length",
            message: {
              tool_calls: [
                {
                  function: { name: "choose_move", arguments: '{"move":"E"}' },
                },
              ],
            },
          },
        ],
      }),
    ),
  );
});
test("loopback server rejects foreign origins, serializes inference across sessions and exports without credentials", async () => {
  let resolve!: (r: Response) => void, called!: () => void;
  const ready = new Promise<void>((r) => (called = r));
  const server = localMemoryServer(config, async () => {
    called();
    return new Promise<Response>((r) => (resolve = r));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/local-maze-memory`;
  const post = (path: string, body: unknown) =>
    fetch(base + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  try {
    assert.equal(
      (
        await fetch(base + "/status", {
          headers: { Origin: "https://foreign.test" },
        })
      ).status,
      403,
    );
    assert.equal(
      await new Promise<number>((resolve, reject) => {
        const req = httpRequest(
          base + "/status",
          { headers: { Host: "foreign.test" } },
          (res) => {
            res.resume();
            resolve(res.statusCode!);
          },
        );
        req.on("error", reject);
        req.end();
      }),
      403,
    );
    const create = async () =>
      (
        await post("/runs", {
          strategy: STARTER,
          limits,
          mode: "practice",
          index: 0,
        })
      ).json();
    const a = await create(),
      b = await create();
    const pending = post("/runs/" + a.runId + "/step", {
      maze: 0,
      step: 0,
      revision: 0,
    });
    await ready;
    assert.equal(
      (
        await post("/runs/" + b.runId + "/step", {
          maze: 0,
          step: 0,
          revision: 0,
        })
      ).status,
      409,
    );
    resolve(response("E"));
    assert.equal((await pending).status, 200);
    const exported = await (
      await fetch(base + "/runs/" + a.runId + "/export")
    ).json();
    assert.equal(exported.attempts.length, 1);
    assert.equal(JSON.stringify(exported).includes(config.token!), false);
    validateRecord(exported);
    assert.equal(
      (
        await post("/runs", {
          strategy: STARTER,
          limits,
          mode: "practice",
          index: 99,
        })
      ).status,
      400,
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test("replay shows sequential writes accurately, including multiple changes to one note", async () => {
  const run = new MemoryRun(
    {
      ...STARTER,
      source: `function prepare(){return {instructions:'Go',writes:[{target:'cell',value:{phase:1}},{target:'cell',value:{phase:2}}]};}`,
    },
    { movesPerMaze: 1, requests: 1 },
    manifest,
    "practice",
    config,
    async () => response("N"),
  );
  await run.step(0, 0);
  const frame = replayFrame(validateRecord(run.record), 0, 1);
  assert.deepEqual(frame.changes, [
    { target: "cell", before: null, after: { phase: 1 } },
    { target: "cell", before: { phase: 1 }, after: { phase: 2 } },
  ]);
});

test("step revisions prevent duplicate zero-movement failures from starting another paid maze", async () => {
  let calls = 0;
  const run = new MemoryRun(
    STARTER,
    { movesPerMaze: 1, requests: 3 },
    { name: "Revision test", seeds: ["revision:1", "revision:2"] },
    "evaluation",
    config,
    async () => response(++calls === 1 ? "invalid" : "E"),
  );
  await run.step(0, 0, 0);
  assert.equal(run.revision, 1);
  await run.step(0, 0, 0);
  assert.equal(calls, 1);
  assert.equal(run.record.currentMaze, 0);
  await run.step(0, 0, 1);
  assert.equal(calls, 2);
  assert.equal(run.record.currentMaze, 1);
});

test("cost per solution includes unsuccessful maze spending and withholds unknown/incomplete scores", async () => {
  const run = new MemoryRun(
    STARTER,
    { movesPerMaze: 1, requests: 1 },
    manifest,
    "practice",
    config,
    oracle,
  );
  await run.step(0, 0);
  const r = structuredClone(run.record);
  r.manifest.seeds.push("another-maze");
  r.outcomes.push({
    ...r.outcomes[0],
    maze: 1,
    seed: "another-maze",
    status: "solved",
  });
  r.attempts.push(structuredClone(r.attempts[0]));
  assert.equal(metrics(r).tokensPerSolution, 24);
  r.attempts[1].usage.inputTokens = null;
  assert.equal(metrics(r).tokensPerSolution, null);
  r.status = "cancelled";
  assert.equal(metrics(r).complete, false);
  assert.equal(metrics(r).tokensPerSolution, null);
});
