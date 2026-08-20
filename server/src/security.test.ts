import assert from "node:assert/strict";
import test from "node:test";
import { isAllowedWebSocketOrigin } from "./security";

const allowedOrigins = ["https://stigsim.protocol-institute.org"];

test("production WebSockets require an explicitly allowed Origin", () => {
  assert.equal(isAllowedWebSocketOrigin(undefined, allowedOrigins, true), false);
  assert.equal(isAllowedWebSocketOrigin("https://example.com", allowedOrigins, true), false);
  assert.equal(
    isAllowedWebSocketOrigin("https://stigsim.protocol-institute.org", allowedOrigins, true),
    true,
  );
});

test("local non-browser WebSocket clients may omit Origin", () => {
  assert.equal(isAllowedWebSocketOrigin(undefined, allowedOrigins, false), true);
  assert.equal(isAllowedWebSocketOrigin("https://example.com", allowedOrigins, false), false);
});
