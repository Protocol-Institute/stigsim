import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_ONLINE_WAR_SETTINGS } from "../../shared/war-contract";
import { WarSimulation } from "../../src/modes/war/war-simulation";
import { snapshotWarMatch, validOnlineWarSettings, validWarDoctrine } from "./war";

test("online match settings enforce bounded server workloads", () => {
  assert.equal(validOnlineWarSettings(DEFAULT_ONLINE_WAR_SETTINGS), true);
  assert.equal(validOnlineWarSettings({ ...DEFAULT_ONLINE_WAR_SETTINGS, startingAnts: 101 }), false);
  assert.equal(validOnlineWarSettings({ ...DEFAULT_ONLINE_WAR_SETTINGS, foodPerSource: 51 }), false);
  assert.equal(validOnlineWarSettings({ ...DEFAULT_ONLINE_WAR_SETTINGS, loopRate: Number.NaN }), false);
});

test("online doctrine validation matches the controls exposed to players", () => {
  assert.equal(validWarDoctrine({ evapRate: 0.005, trailPower: 2.5, tankMax: 8_000, cautionary: true }), true);
  assert.equal(validWarDoctrine({ evapRate: 0.005, trailPower: 2.25, tankMax: 8_000, cautionary: true }), false);
  assert.equal(validWarDoctrine({ evapRate: 0.005, trailPower: 2.5, tankMax: 8_001, cautionary: true }), false);
});

test("wire snapshots contain the shared WarSimulation state", () => {
  const war = new WarSimulation({
    masterSeed: "snapshot-test",
    startingAnts: 2,
    foodSources: 1,
    foodPerSource: 100,
    loopRate: 0.05,
  });
  war.step();
  const snapshot = snapshotWarMatch({ war, phase: "running", settings: DEFAULT_ONLINE_WAR_SETTINGS });

  assert.equal(snapshot.tick, 1);
  assert.equal(snapshot.phase, "running");
  assert.equal(snapshot.colonies.length, 2);
  assert.equal(snapshot.grid.length > 0, true);
  assert.equal(snapshot.colonies[0].homePhero.length, snapshot.grid.length * snapshot.grid[0].length);
  assert.equal(snapshot.colonies[0].ants.length, 2);
});
