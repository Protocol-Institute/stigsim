import assert from "node:assert/strict";
import test from "node:test";
import { calculateFixedSteps } from "./fixed-step";

test("fixed-step accumulation catches up ordinary timer delays", () => {
  let remainderMs = 0;
  let steps = 0;

  for (let i = 0; i < 100; i++) {
    const result = calculateFixedSteps(remainderMs, 28, 20, 5);
    remainderMs = result.remainderMs;
    steps += result.steps;
  }

  assert.equal(steps, 140);
  assert.equal(remainderMs, 0);
});

test("fixed-step accumulation caps runaway catch-up", () => {
  const result = calculateFixedSteps(0, 1_003, 20, 5);

  assert.equal(result.steps, 5);
  assert.equal(result.remainderMs, 3);
});
