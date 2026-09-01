import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseTrace, Replayer, SIM_VERSION } from "./index";

const fixture = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "golden.trace.json");

test("the golden trace replays without diverging", () => {
  const result = parseTrace(readFileSync(fixture, "utf8"));
  assert.ok(result.ok, result.ok ? "" : result.error);
  assert.equal(result.warning, undefined);
  assert.equal(result.trace.simVersion, SIM_VERSION);

  const r = new Replayer(result.trace);
  while (r.step());

  assert.equal(
    r.divergedAt,
    null,
    `The golden trace diverged at tick ${r.divergedAt}.

This means simulation behaviour changed. Either the change was
unintended, or a mutation path was added without routing it through the
command bus, or the change was deliberate. If deliberate, bump
SIM_VERSION in packages/sim-trace/src/trace.ts and regenerate the fixture with
"pnpm golden".`,
  );
  assert.equal(r.tick, result.trace.endTick);
});

test("the golden trace still contains its recorded interventions", () => {
  const result = parseTrace(readFileSync(fixture, "utf8"));
  assert.ok(result.ok);
  assert.deepEqual(
    result.trace.commands.map(c => c.cmd.kind),
    ["setWall", "setParam", "setCautionary", "setParam", "setAntCount"],
  );
});
