import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_ONLINE_WAR_SETTINGS } from "../../../shared/war-contract";
import { settingsForOnlineWarSetup } from "./online-war-setup";

test("opening random-opponent setup generates a fresh seed", () => {
  const settings = { ...DEFAULT_ONLINE_WAR_SETTINGS, masterSeed: "previous-seed" };
  assert.deepEqual(settingsForOnlineWarSetup("random", settings, () => "fresh-seed"), {
    ...settings,
    masterSeed: "fresh-seed",
  });
});

test("opening human setup preserves its current settings", () => {
  const settings = { ...DEFAULT_ONLINE_WAR_SETTINGS, masterSeed: "chosen-seed" };
  assert.equal(settingsForOnlineWarSetup("human", settings, () => "unused-seed"), settings);
});
