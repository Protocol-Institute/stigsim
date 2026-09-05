import assert from "node:assert/strict";
import test from "node:test";
import { appHref, normalizePathname, resolveAppRoute } from "./routes";

test("normalizes trailing slashes without changing the root", () => {
  assert.equal(normalizePathname("/"), "/");
  assert.equal(normalizePathname("/maze/"), "/maze");
  assert.equal(normalizePathname("/multiplayer/example///"), "/multiplayer/example");
});

test("resolves every public simulation route explicitly", () => {
  assert.equal(resolveAppRoute("/"), "index");
  assert.equal(resolveAppRoute("/maze"), "maze");
  assert.equal(resolveAppRoute("/war"), "war");
  assert.equal(resolveAppRoute("/multiplayer"), "multiplayer");
  assert.equal(resolveAppRoute("/multiplayer/ABC123"), "multiplayer");
  assert.equal(resolveAppRoute("/infinite"), "infinite");
});

test("does not silently route unknown paths to the maze", () => {
  assert.equal(resolveAppRoute("/something-else"), "not-found");
});

test("resolves routes when the app is deployed below the domain root", () => {
  assert.equal(normalizePathname("/stigsim/maze/", "/stigsim/"), "/maze");
  assert.equal(resolveAppRoute("/stigsim/", "/stigsim/"), "index");
  assert.equal(resolveAppRoute("/stigsim/infinite", "/stigsim/"), "infinite");
  assert.equal(resolveAppRoute("/stigsim/multiplayer/ABC123", "/stigsim/"), "multiplayer");
});

test("builds links relative to the configured app base", () => {
  assert.equal(appHref("/", "/stigsim/"), "/stigsim/");
  assert.equal(appHref("/maze", "/stigsim/"), "/stigsim/maze");
});
