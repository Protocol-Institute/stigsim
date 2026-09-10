import assert from "node:assert/strict";
import test from "node:test";
import { DenseField } from "@stigsim/sim-core";
import { DEFAULT_ONLINE_WAR_SETTINGS } from "../../shared/war-contract";
import { WarSimulation } from "../../src/modes/war/war-simulation";
import { completedWarRecord, randomOpponentDoctrine, snapshotWarMatch, validOnlineWarSettings, validWarDoctrine } from "./war";

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

test("random-opponent doctrine is deterministic from the match seed", () => {
  const first = randomOpponentDoctrine("amber-lattice-1234");
  const second = randomOpponentDoctrine("amber-lattice-1234");
  const different = randomOpponentDoctrine("amber-lattice-1235");

  assert.deepEqual(first, second);
  assert.notDeepEqual(first, different);
  assert.equal(validWarDoctrine(first), true);
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

test("wire snapshots round pheromones without changing simulation precision", () => {
  const war = new WarSimulation({ masterSeed: "snapshot-rounding-test", startingAnts: 1 });
  const field = war.simulation.colonies[0].field;
  assert.equal(field instanceof DenseField, true);
  if (!(field instanceof DenseField)) return;
  const home = field.layer("home");
  home[0] = 1 / 3;
  const authoritativeValue = home[0];

  const snapshot = snapshotWarMatch({ war, phase: "running", settings: DEFAULT_ONLINE_WAR_SETTINGS });

  assert.equal(snapshot.colonies[0].homePhero[0], 0.333);
  assert.equal(home[0], authoritativeValue);
  assert.notEqual(authoritativeValue, snapshot.colonies[0].homePhero[0]);
  assert.equal(JSON.stringify(snapshot).includes("0.3333333432674408"), false);
});

test("wire ant ids remain stable when an earlier ant leaves the array", () => {
  const war = new WarSimulation({ masterSeed: "stable-ant-id-test", startingAnts: 3 });
  const before = snapshotWarMatch({ war, phase: "running", settings: DEFAULT_ONLINE_WAR_SETTINGS });
  war.simulation.colonies[0].ants.splice(0, 1);
  const after = snapshotWarMatch({ war, phase: "running", settings: DEFAULT_ONLINE_WAR_SETTINGS });

  assert.deepEqual(
    after.colonies[0].ants.map(ant => ant.id),
    before.colonies[0].ants.slice(1).map(ant => ant.id),
  );
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
