import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizeUsage, formatTokenTotal, formatEstimatedCost } from './usage';
const rates = { mini: { input: 0.25, output: 2 }, sonnet: { input: 3, output: 15 } };
test('cost uses input and output rates per million, sums models and includes repeated-context input', () => {
  const result = summarizeUsage([
    { model: 'mini', usage: { requests: 2, inputTokens: 1000000, outputTokens: 100000, totalTokens: 1100000 } },
    { model: 'sonnet', usage: { requests: 1, inputTokens: 1000000, outputTokens: 100000, totalTokens: 1100000 } },
  ], rates);
  assert.equal(result.estimatedCostUsd, 4.95);
  assert.equal(result.requests, 3);
  assert.equal(formatTokenTotal(result), '2,200,000');
  assert.equal(formatEstimatedCost(result), '$4.95');
  assert.equal(result.costComplete, true);
  assert.equal(result.tokensComplete, true);
});
test('missing usage and unknown prices produce a partial subtotal, not a false zero or complete total', () => {
  const result = summarizeUsage([
    { model: 'mini', usage: { requests: 1, inputTokens: 1000, outputTokens: 100, totalTokens: 1100 } },
    { model: 'mini', usage: { requests: 1, inputTokens: null, outputTokens: null, totalTokens: null } },
    { model: 'unknown', usage: { requests: 1, inputTokens: 1000, outputTokens: 100, totalTokens: 1100 } },
  ], rates);
  assert.equal(formatTokenTotal(result), '2,200+');
  assert.equal(result.costComplete, false);
  assert.equal(result.unpricedRecords, 2);
  assert.equal(formatEstimatedCost(result), '$0.0004');
  assert.equal(formatEstimatedCost(summarizeUsage([{ model: 'unknown' }], rates)), '—');
});
test('fresh runs start at zero and tiny costs stay visible', () => {
  const empty = summarizeUsage([], rates);
  assert.equal(formatTokenTotal(empty), '0');
  assert.equal(formatEstimatedCost(empty), '$0.00');
  assert.equal(empty.tokensComplete && empty.costComplete, true);
  assert.equal(formatEstimatedCost(summarizeUsage([{ model: 'mini', usage: {
    requests: 1, inputTokens: 1, outputTokens: 1, totalTokens: 2,
  } }], rates)), '<$0.0001');
});

test('decision model cost counts only input, even if output usage is unavailable', () => {
  const rates = { jev: { input: 0.042, output: 0 } };
  const result = summarizeUsage([{ model: 'jev', usage: {
    requests: 1, inputTokens: 1000000, outputTokens: 1000, totalTokens: 1001000,
  } }], rates);
  assert.equal(result.estimatedCostUsd, 0.042);
  assert.equal(result.costComplete, true);
  const missingOutput = summarizeUsage([{ model: 'jev', usage: {
    requests: 1, inputTokens: 1000000, outputTokens: null, totalTokens: null,
  } }], rates);
  assert.equal(missingOutput.estimatedCostUsd, 0.042);
  assert.equal(missingOutput.costComplete, true);
  assert.equal(missingOutput.tokensComplete, false);
});
