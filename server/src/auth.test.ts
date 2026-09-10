import assert from "node:assert/strict";
import test from "node:test";
import { allowCodeRequest, issueCode, normalizeEmail, resetAuthForTests, verifyCode, verifySession } from "./auth";

test.beforeEach(() => resetAuthForTests());

test("normalizes plausible email addresses", () => {
  assert.equal(normalizeEmail(" Person@Example.COM "), "person@example.com");
  assert.equal(normalizeEmail("not-an-email"), null);
});

test("a code creates a signed session and can only be used once", () => {
  const now = 1_000;
  const { code } = issueCode("person@example.com", now);
  const token = verifyCode("person@example.com", code, now + 1);
  assert.ok(token);
  assert.deepEqual(verifySession(token, now + 2)?.email, "person@example.com");
  assert.equal(verifyCode("person@example.com", code, now + 3), null);
});

test("codes expire and signed sessions reject tampering", () => {
  const { code } = issueCode("person@example.com", 1_000);
  assert.equal(verifyCode("person@example.com", code, 1_000 + 10 * 60 * 1_000 + 1), null);
  assert.equal(verifySession("payload.signature"), null);
});

test("sessions expire after thirty days", () => {
  const now = 1_000;
  const email = "person@example.com";
  const token = verifyCode(email, issueCode(email, now).code, now);
  assert.ok(token);
  assert.ok(verifySession(token, now + 30 * 24 * 60 * 60 * 1_000 - 1));
  assert.equal(verifySession(token, now + 30 * 24 * 60 * 60 * 1_000 + 1), null);
});

test("requests are throttled per email address", () => {
  assert.ok(issueCode("person@example.com", 1_000).code);
  assert.ok(issueCode("person@example.com", 1_001).retryAfterMs);
});

test("one source cannot spray sign-in codes across email addresses", () => {
  for (let index = 0; index < 5; index++) assert.equal(allowCodeRequest("127.0.0.1", 1_000 + index), true);
  assert.equal(allowCodeRequest("127.0.0.1", 2_000), false);
  assert.equal(allowCodeRequest("127.0.0.1", 1_000 + 10 * 60 * 1_000), true);
});
