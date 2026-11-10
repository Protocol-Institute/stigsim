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
  for (const route of ["strategy-lab", "maze-memory"] as const) {
    assert.equal(resolveAppRoute(`/${route}/`), route);
    assert.equal(resolveAppRoute(`/stigsim/${route}`, "/stigsim/"), route);
  }
  assert.equal(resolveAppRoute("/maze"), "maze");
  assert.equal(resolveAppRoute("/highway-lab/"), "highway-lab");
  assert.equal(resolveAppRoute("/stigsim/highway-lab", "/stigsim/"), "highway-lab");
  assert.equal(resolveAppRoute("/model-ant"), "model-ant");
  assert.equal(resolveAppRoute("/swarm-ant/"), "swarm-ant");
  assert.equal(resolveAppRoute("/war"), "war");
  assert.equal(resolveAppRoute("/delivery-lab/"), "delivery-lab");
  assert.equal(resolveAppRoute("/stigsim/delivery-lab", "/stigsim/"), "delivery-lab");
  assert.equal(resolveAppRoute("/model-war/"), "model-war");
  assert.equal(resolveAppRoute("/stigsim/model-war", "/stigsim/"), "model-war");
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

test("overview and onboarding resolve in preview builds", () => {
  assert.equal(resolveAppRoute("/levels"), "levels");
  assert.equal(resolveAppRoute("/stigsim/levels/", "/stigsim/"), "levels");
  assert.equal(resolveAppRoute("/onboarding"), "onboarding");
  assert.equal(resolveAppRoute("/stigsim/onboarding/", "/stigsim/"), "onboarding");
});
