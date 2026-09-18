import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_DOCTRINE, TOPOLOGY_MIMICRY, cloneDoctrine } from "@stigsim/sim-core";
import { DEFAULT_ONLINE_WAR_SETTINGS } from "../../shared/war-contract";
import { WarSimulation } from "../../src/modes/war/war-simulation";
import { createOnlineWarRecorder } from "../../src/modes/war/online-war-recording";
import { createWarReplay } from "../../src/modes/war/war-run-record";
import { completedWarRecord, normalizeWarDoctrine, parsePersistedWarMatch, persistedWarMatch, randomOpponentDoctrine, validOnlineWarSettings, validWarDoctrine } from "./war";

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

test("completed records retain compact results and advertise separate replay data", () => {
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
  assert.equal(record.replayAvailable, true);
});

test("persisted Online War envelopes bind a compact summary to its exact run", () => {
  const settings = { ...DEFAULT_ONLINE_WAR_SETTINGS, masterSeed: "persisted-run-test", startingAnts: 1 };
  const recorder = createOnlineWarRecorder(settings);
  recorder.runtime.simulation.colonies[1].ants.length = 0;
  recorder.step();
  const summary = completedWarRecord({
    id: "ABCDE",
    war: recorder.runtime,
    settings,
    players: [
      { token: "one", socket: null, ready: true, name: "Alpha" },
      { token: "two", socket: null, ready: true, name: "Beta" },
    ],
  });
  const runRecord = recorder.build();
  const parsed = parsePersistedWarMatch(persistedWarMatch(summary, runRecord));
  assert.deepEqual(parsed?.summary, summary);
  assert.deepEqual(parsed?.runRecord, runRecord);

  const mismatched = parsePersistedWarMatch(persistedWarMatch(
    { ...summary, settings: { ...summary.settings, masterSeed: "other-seed" } },
    runRecord,
  ));
  assert.equal(mismatched?.summary.replayAvailable, false);
  assert.equal(mismatched?.runRecord, undefined);
});

test("capacity-limited Online War records retain their terminal state and replay exactly", () => {
  const settings = {
    ...DEFAULT_ONLINE_WAR_SETTINGS,
    masterSeed: "capacity-limited-online-run",
    startingAnts: 1,
    foodSources: 1,
    foodPerSource: 50,
    loopRate: 0,
  };
  const recorder = createOnlineWarRecorder(settings, [], true, {
    metrics: { interval: 3, capacity: 2 },
    agents: { interval: 5, capacity: 2 },
    fields: { interval: 7, capacity: 2 },
  });

  while (recorder.runtime.result === null && recorder.runtime.tick < 10_000) {
    assert.equal(recorder.step(), true);
  }
  assert.notEqual(recorder.runtime.result, null, "the deterministic fixture must complete");

  const runRecord = recorder.build();
  for (const [name, channel] of Object.entries(runRecord.channels)) {
    assert.equal(channel.truncated, true, `${name} should report lost early samples`);
    assert.equal(channel.samples.length, channel.capacity, `${name} should remain bounded`);
    assert.equal(channel.samples.at(-1)?.t, runRecord.endTick, `${name} should retain the terminal sample`);
  }
  const terminalMetrics = runRecord.channels.metrics.samples.at(-1)?.data as {
    result: number | "draw" | null;
  };
  assert.equal(terminalMetrics.result, recorder.runtime.result);
  assert.deepEqual(runRecord.outcome?.data, {
    winner: recorder.runtime.result,
    tick: runRecord.endTick,
    colonies: (runRecord.channels.metrics.samples.at(-1)?.data as { colonies: unknown }).colonies,
  });

  const summary = completedWarRecord({
    id: "CAP01",
    war: recorder.runtime,
    settings,
    players: [
      { token: "one", socket: null, ready: true, name: "Researcher" },
      { token: "bot", socket: null, ready: true, name: "Generated opponent", isBot: true },
    ],
  });
  const persisted = JSON.parse(JSON.stringify(persistedWarMatch(summary, runRecord))) as unknown;
  const parsed = parsePersistedWarMatch(persisted);
  assert.equal(parsed?.summary.replayAvailable, true);
  assert.ok(parsed?.runRecord);

  const replay = createWarReplay(parsed.runRecord);
  while (replay.step());
  assert.equal(replay.divergedAt, null);
  assert.equal(replay.runtime.tick, runRecord.endTick);
  assert.equal(replay.runtime.fingerprint(), recorder.runtime.fingerprint());
});
