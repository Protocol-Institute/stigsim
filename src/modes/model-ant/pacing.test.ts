import test from 'node:test';
import assert from 'node:assert/strict';
import { RunPacing, PACING } from './pacing';
const usage = (tokens: number) => ({ requests: 1, inputTokens: tokens, outputTokens: 0, totalTokens: tokens });
test('growing context increases request spacing and obeys a rolling token budget', () => {
  let now = 0; const pacing = new RunPacing(() => now);
  assert.equal(pacing.delayMs(), 0);
  pacing.succeeded(usage(10000)); const firstDelay = pacing.delayMs();
  now += firstDelay; assert.equal(pacing.delayMs(), 0);
  pacing.succeeded(usage(20000)); assert.ok(pacing.delayMs() > firstDelay);
  const budget = new RunPacing(() => now);
  budget.succeeded(usage(150000));
  now += 10000;
  assert.ok(budget.delayMs() >= 50000);
  now += budget.delayMs(); assert.equal(budget.delayMs(), 0);
});
test('rate-limit cooldown preserves timing, caps automatic retries, and clears the streak on success', () => {
  let now = 0; const pacing = new RunPacing(() => now);
  assert.equal(pacing.rateLimited(), false);
  assert.equal(pacing.delayMs(), PACING.cooldownMs);
  now += 30000; assert.equal(pacing.delayMs(), 30000);
  now += 30000; assert.equal(pacing.delayMs(), 0);
  assert.equal(pacing.rateLimited(), false);
  assert.equal(pacing.rateLimited(), true);
  assert.equal(pacing.consecutiveRateLimits, 3);
  now += 60000; pacing.succeeded(usage(1000));
  assert.equal(pacing.consecutiveRateLimits, 0);
});
test('an existing run with unknown recent timestamps waits once, rather than forgetting the model context', () => {
  let now = 0; const pacing = new RunPacing(() => now);
  pacing.resumeExistingRun(); assert.equal(pacing.delayMs(), 60000);
  now += 30000; pacing.resumeExistingRun(); assert.equal(pacing.delayMs(), 30000);
  now += 30000; pacing.resumeExistingRun(); assert.equal(pacing.delayMs(), 0);
});
