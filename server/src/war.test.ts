import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_DOCTRINE, TOPOLOGY_MIMICRY, cloneDoctrine } from "@stigsim/sim-core";
import { DEFAULT_ONLINE_WAR_SETTINGS } from "../../shared/war-contract";
import { WarSimulation } from "../../src/modes/war/war-simulation";
import { completedWarRecord, normalizeWarDoctrine, randomOpponentDoctrine, validOnlineWarSettings, validWarDoctrine } from "./war";

test("online match settings enforce bounded server workloads", () => {
  assert.equal(validOnlineWarSettings(DEFAULT_ONLINE_WAR_SETTINGS), true);
  assert.equal(validOnlineWarSettings({ ...DEFAULT_ONLINE_WAR_SETTINGS, startingAnts: 101 }), false);
  assert.equal(validOnlineWarSettings({ ...DEFAULT_ONLINE_WAR_SETTINGS, foodPerSource: 51 }), false);
  assert.equal(validOnlineWarSettings({ ...DEFAULT_ONLINE_WAR_SETTINGS, loopRate: Number.NaN }), false);
  assert.equal(validOnlineWarSettings({ ...DEFAULT_ONLINE_WAR_SETTINGS, tankMax: 8_001 }), false);
  assert.equal(validOnlineWarSettings({ ...DEFAULT_ONLINE_WAR_SETTINGS, topology: { ...TOPOLOGY_MIMICRY, maxMimicRate: 2 } }), false);
  assert.equal(validOnlineWarSettings({
    ...DEFAULT_ONLINE_WAR_SETTINGS,
    topology: { ...TOPOLOGY_MIMICRY, visible: { ...TOPOLOGY_MIMICRY.visible }, provenance: false },
  }), false);
});

test("online match settings accept both map layouts and nothing else", () => {
  assert.equal(DEFAULT_ONLINE_WAR_SETTINGS.layout, "mirrored");
  assert.equal(validOnlineWarSettings({ ...DEFAULT_ONLINE_WAR_SETTINGS, layout: "random" }), true);
  assert.equal(validOnlineWarSettings({ ...DEFAULT_ONLINE_WAR_SETTINGS, layout: "hexagonal" }), false);
  const { layout: _dropped, ...withoutLayout } = DEFAULT_ONLINE_WAR_SETTINGS;
  assert.equal(validOnlineWarSettings(withoutLayout), false);
});

test("online match settings accept both adoption modes and nothing else", () => {
  assert.equal(DEFAULT_ONLINE_WAR_SETTINGS.adoption, "nest");
  assert.equal(validOnlineWarSettings({ ...DEFAULT_ONLINE_WAR_SETTINGS, adoption: "instant" }), true);
  assert.equal(validOnlineWarSettings({ ...DEFAULT_ONLINE_WAR_SETTINGS, adoption: "eventually" }), false);
  const { adoption: _dropped, ...withoutAdoption } = DEFAULT_ONLINE_WAR_SETTINGS;
  assert.equal(validOnlineWarSettings(withoutAdoption), false);
  const war = new WarSimulation({ ...DEFAULT_ONLINE_WAR_SETTINGS, adoption: "instant" });
  assert.equal(war.simulation.adoption, "instant");
});

test("online doctrine validation matches the controls exposed to players", () => {
  assert.equal(validWarDoctrine(DEFAULT_DOCTRINE), true);
  const invalid = cloneDoctrine(DEFAULT_DOCTRINE);
  invalid.forager.follow.searching.food.own = 2.25;
  assert.equal(validWarDoctrine(invalid), false);
  const excessiveFollow = cloneDoctrine(DEFAULT_DOCTRINE);
  excessiveFollow.forager.follow.searching.food.own = 10.5;
  assert.equal(validWarDoctrine(excessiveFollow), false);
  const excessiveLay = cloneDoctrine(DEFAULT_DOCTRINE);
  excessiveLay.forager.lay.searching.home.own = 2;
  assert.equal(validWarDoctrine(excessiveLay), false);
  const zeroEvaporation = cloneDoctrine(DEFAULT_DOCTRINE);
  zeroEvaporation.evapRate = 0;
  assert.equal(validWarDoctrine(zeroEvaporation), false);
  const excessiveSpoilers = cloneDoctrine(DEFAULT_DOCTRINE);
  excessiveSpoilers.spoilerFraction = 0.55;
  assert.equal(validWarDoctrine(excessiveSpoilers), false);
  assert.equal(validWarDoctrine({ ...DEFAULT_DOCTRINE, cautionary: true }), false);
});

test("online doctrines are conformed to the match topology", () => {
  const doctrine = cloneDoctrine(DEFAULT_DOCTRINE);
  doctrine.spoilerFraction = 0.2;
  doctrine.mimicRate = 0.5;
  doctrine.forager.follow.searching.food.enemy = 2;
  const normalized = normalizeWarDoctrine(doctrine, DEFAULT_ONLINE_WAR_SETTINGS.topology);
  assert.equal(normalized.spoilerFraction, 0);
  assert.equal(normalized.mimicRate, 0);
  assert.equal(normalized.forager.follow.searching.food.enemy, 0);
});

test("random-opponent doctrine is deterministic from the match seed", () => {
  const first = randomOpponentDoctrine("amber-lattice-1234");
  const second = randomOpponentDoctrine("amber-lattice-1234");
  const different = randomOpponentDoctrine("amber-lattice-1235");

  assert.deepEqual(first, second);
  assert.notDeepEqual(first, different);
  assert.equal(validWarDoctrine(first), true);
});

test("completed records retain results without replay snapshots", () => {
  const war = new WarSimulation({ masterSeed: "history-test", startingAnts: 1 });
  war.simulation.colonies[1].ants.length = 0;
  war.step();
  const record = completedWarRecord({
    id: "ABCDE",
    war,
    settings: DEFAULT_ONLINE_WAR_SETTINGS,
    players: [
      { token: "one", socket: null, ready: true, name: "Alpha" },
      { token: "two", socket: null, ready: true, name: "Beta" },
    ],
  });

  assert.equal(record.matchId, "ABCDE");
  assert.equal(record.winner, 0);
  assert.deepEqual(record.playerNames, ["Alpha", "Beta"]);
  assert.equal(record.finalMetrics.length, 2);
  assert.equal("checkpoints" in record, false);
});
