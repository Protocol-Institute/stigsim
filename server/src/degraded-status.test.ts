import assert from "node:assert/strict";
import test from "node:test";
import { ThrottledFailureReporter } from "./degraded-status";

test("database warnings are throttled and recovery is reported once", () => {
  const warnings: unknown[] = [];
  let recoveries = 0;
  const reporter = new ThrottledFailureReporter(
    60_000,
    error => warnings.push(error),
    () => { recoveries++; },
  );

  reporter.reportFailure("first", 1_000);
  reporter.reportFailure("suppressed", 30_000);
  reporter.reportFailure("minute later", 61_000);
  assert.deepEqual(warnings, ["first", "minute later"]);

  reporter.reportSuccess();
  reporter.reportSuccess();
  assert.equal(recoveries, 1);

  reporter.reportFailure("new outage", 62_000);
  assert.deepEqual(warnings, ["first", "minute later", "new outage"]);
});
