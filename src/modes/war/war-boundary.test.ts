import assert from "node:assert/strict";
import test from "node:test";
import {
  COLS,
  ROWS,
  DEFAULT_DOCTRINE,
  TOPOLOGY_MIMICRY,
  TOPOLOGY_PRIVATE,
  DenseField,
  cloneDoctrine,
} from "@stigsim/sim-core";
import {
  DEFAULT_ONLINE_WAR_SETTINGS,
  type WarMatchRecord,
} from "../../../shared/war-contract";
import { parseWarMatchRecord, warWireCodec } from "./war-boundary";
import { WarSimulation } from "./war-simulation";

test("War wire snapshots preserve the deployed PR 20 message shape", () => {
  const war = new WarSimulation({
    masterSeed: "snapshot-test",
    startingAnts: 2,
    foodSources: 1,
    foodPerSource: 100,
    loopRate: 0.05,
  });
  war.step();
  const snapshot = warWireCodec.snapshot({
    war,
    phase: "running",
    settings: DEFAULT_ONLINE_WAR_SETTINGS,
  });

  assert.equal(snapshot.tick, 1);
  assert.equal(snapshot.phase, "running");
  assert.equal(snapshot.colonies.length, 2);
  assert.equal(snapshot.grid.length > 0, true);
  assert.equal(snapshot.colonies[0].homePhero.length, snapshot.grid.length * snapshot.grid[0].length);
  assert.equal(snapshot.colonies[0].ants.length, 2);
  assert.equal(snapshot.colonies[0].ants[0].role, "forager");
  assert.equal(snapshot.colonies[0].ants[0].doctrineVersion, 0);
});

test("War snapshots retain the match gland, topology, layout, and adoption settings", () => {
  const settings = {
    ...DEFAULT_ONLINE_WAR_SETTINGS,
    tankMax: 8_000,
    topology: TOPOLOGY_MIMICRY,
    layout: "random" as const,
    adoption: "instant" as const,
  };
  const war = new WarSimulation(settings);
  const snapshot = warWireCodec.snapshot({ war, phase: "running", settings });

  assert.equal(war.simulation.params.tankMax, 8_000);
  assert.deepEqual(war.simulation.topology, TOPOLOGY_MIMICRY);
  assert.equal(snapshot.settings.tankMax, 8_000);
  assert.deepEqual(snapshot.settings.topology, TOPOLOGY_MIMICRY);
  assert.equal(snapshot.settings.layout, "random");
  assert.equal(snapshot.settings.adoption, "instant");
  assert.notEqual(snapshot.settings.topology, settings.topology);
});

test("War wire snapshots round pheromones without changing simulation precision", () => {
  const war = new WarSimulation({ masterSeed: "snapshot-rounding-test", startingAnts: 1 });
  const field = war.simulation.colonies[0].field;
  assert.ok(field instanceof DenseField);
  const home = field.layer("home");
  home[0] = 1 / 3;
  const authoritativeValue = home[0];

  const snapshot = warWireCodec.snapshot({
    war,
    phase: "running",
    settings: DEFAULT_ONLINE_WAR_SETTINGS,
  });

  assert.equal(snapshot.colonies[0].homePhero[0], 0.333);
  assert.equal(home[0], authoritativeValue);
  assert.notEqual(authoritativeValue, snapshot.colonies[0].homePhero[0]);
  assert.equal(JSON.stringify(snapshot).includes("0.3333333432674408"), false);
});

test("War wire snapshots expose false-trail provenance without a cautionary channel", () => {
  const war = new WarSimulation({
    masterSeed: "snapshot-provenance",
    startingAnts: 1,
    topology: TOPOLOGY_MIMICRY,
  });
  const received = new DenseField(COLS, ROWS);
  received.set("food", 2, 3, 12.3456);
  war.simulation.colonies[0].received.set(1, received);

  const snapshot = warWireCodec.snapshot({
    war,
    phase: "running",
    settings: { ...DEFAULT_ONLINE_WAR_SETTINGS, topology: TOPOLOGY_MIMICRY },
  });
  assert.deepEqual(snapshot.colonies[0].receivedPhero, [{
    from: 1,
    home: Array(COLS * ROWS).fill(0),
    food: Array.from({ length: COLS * ROWS }, (_, index) => index === 3 * COLS + 2 ? 12.346 : 0),
  }]);
  assert.equal("cautPhero" in snapshot.colonies[0], false);
});

test("War wire ant ids remain stable when an earlier ant leaves the array", () => {
  const war = new WarSimulation({ masterSeed: "stable-ant-id-test", startingAnts: 3 });
  const source = { war, phase: "running" as const, settings: DEFAULT_ONLINE_WAR_SETTINGS };
  const before = warWireCodec.snapshot(source);
  war.simulation.colonies[0].ants.splice(0, 1);
  const after = warWireCodec.snapshot(source);

  assert.deepEqual(
    after.colonies[0].ants.map(ant => ant.id),
    before.colonies[0].ants.slice(1).map(ant => ant.id),
  );
});

function recordFixture(): WarMatchRecord {
  const war = new WarSimulation({ masterSeed: "record-codec", startingAnts: 1 });
  return {
    recordId: "record-1",
    matchId: "ABCDE",
    completedAt: "2026-09-16T12:00:00.000Z",
    playerNames: ["Alpha", null],
    winner: "draw",
    settings: { ...DEFAULT_ONLINE_WAR_SETTINGS, masterSeed: "record-codec" },
    finalTick: 12,
    finalMetrics: war.simulation.colonies.map(colony => war.getMetrics(colony.id)),
    finalDoctrines: war.simulation.colonies.map(colony => war.getDoctrine(colony.id)),
    replayAvailable: true,
  };
}

test("War history records are deeply cloned at the persistence boundary", () => {
  const input = recordFixture();
  const parsed = parseWarMatchRecord(input);
  assert.deepEqual(parsed, input);
  assert.ok(parsed);
  assert.notEqual(parsed, input);
  assert.notEqual(parsed.settings, input.settings);
  assert.notEqual(parsed.settings.topology, input.settings.topology);
  assert.notEqual(parsed.finalMetrics, input.finalMetrics);
  assert.notEqual(parsed.finalDoctrines, input.finalDoctrines);
  assert.notEqual(parsed.finalDoctrines[0], input.finalDoctrines[0]);
});

test("War history migrates records written before PR 20 settings existed", () => {
  const current = recordFixture();
  const legacySettings = {
    masterSeed: "legacy-seed",
    stepsPerSecond: 15,
    startingAnts: 20,
    foodSources: 1,
    foodPerSource: 500,
    loopRate: 0.1,
  };
  const parsed = parseWarMatchRecord({ ...current, settings: legacySettings });
  assert.ok(parsed);
  assert.equal(parsed.settings.tankMax, DEFAULT_ONLINE_WAR_SETTINGS.tankMax);
  assert.deepEqual(parsed.settings.topology, TOPOLOGY_PRIVATE);
  assert.equal(parsed.settings.layout, "random");
  assert.equal(parsed.settings.adoption, "nest");

  const modern = parseWarMatchRecord({
    ...current,
    settings: { ...DEFAULT_ONLINE_WAR_SETTINGS, layout: "mirrored", adoption: "instant" },
  });
  assert.ok(modern);
  assert.equal(modern.settings.layout, "mirrored");
  assert.equal(modern.settings.adoption, "instant");
});

test("War history treats records written before research playback as unavailable", () => {
  const { replayAvailable: _omitted, ...legacy } = recordFixture();
  assert.equal(parseWarMatchRecord(legacy)?.replayAvailable, false);
});

test("War history rejects malformed persisted records", () => {
  const valid = recordFixture();
  const invalidDoctrine = cloneDoctrine(DEFAULT_DOCTRINE);
  invalidDoctrine.evapRate = 2;
  const invalid: unknown[] = [
    null,
    { ...valid, recordId: 4 },
    { ...valid, matchId: null },
    { ...valid, completedAt: 3 },
    { ...valid, playerNames: ["only one"] },
    { ...valid, playerNames: ["Alpha", 3] },
    { ...valid, winner: 3 },
    { ...valid, finalTick: -1 },
    { ...valid, settings: { ...valid.settings, loopRate: Number.NaN } },
    { ...valid, finalMetrics: [{ ...valid.finalMetrics[0], population: "many" }] },
    { ...valid, finalMetrics: [{ ...valid.finalMetrics[0], doctrineChanged: 1 }] },
    { ...valid, finalDoctrines: [invalidDoctrine, valid.finalDoctrines[1]] },
  ];
  for (const value of invalid) assert.equal(parseWarMatchRecord(value), null);
});
