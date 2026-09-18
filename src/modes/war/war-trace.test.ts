import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_DOCTRINE,
  DenseGrid,
  TOPOLOGY_MIMICRY,
  cloneDoctrine,
  fingerprint,
  type Ant,
  type Doctrine,
  type Rng,
} from "@stigsim/sim-core";
import {
  ModeTraceRecorder,
  ModeTraceRegistry,
  ModeTraceReplayer,
  MODE_TRACE_VERSION,
  parseModeTrace,
  serializeModeTrace,
} from "@stigsim/sim-trace";
import { warModeConfig } from "./war-mode";
import {
  DEFAULT_WAR_SETTINGS,
  WarSimulation,
  type WarMatchSettings,
} from "./war-simulation";
import { parseWarModeCommand, warTraceMode } from "./war-trace";

interface PrivateWarState {
  antRuntime: Map<Ant, {
    id: number;
    phase: string;
    energy: number;
    departure: [number, number] | null;
  }>;
  colonyRuntime: Array<{
    foodReserve: number;
    developingAnts: number[];
    reproductionClock: number;
    births: number;
    deaths: number;
    doctrineChanged: boolean;
  }>;
  economyRng: Rng;
  nextAntId: number;
}

const SETTINGS: WarMatchSettings = {
  ...DEFAULT_WAR_SETTINGS,
  masterSeed: "war-trace-round-trip",
  startingAnts: 6,
  loopRate: 0.1,
  foodSources: 3,
  foodPerSource: 800,
  tankMax: 8_000,
  topology: TOPOLOGY_MIMICRY,
  layout: "mirrored",
  adoption: "nest",
};

function changedDoctrine(change: (doctrine: Doctrine) => void): Doctrine {
  const doctrine = cloneDoctrine(DEFAULT_DOCTRINE);
  change(doctrine);
  return doctrine;
}

function completeState(war: WarSimulation) {
  const simulation = war.simulation;
  const privateWar = war as unknown as PrivateWarState;
  assert.ok(simulation.occupancy instanceof DenseGrid);
  return {
    tick: war.tick,
    result: war.result,
    settings: war.settings,
    rules: war.rules,
    fingerprint: war.fingerprint(),
    core: {
      fingerprint: fingerprint(simulation),
      fingerprints: simulation.fingerprints,
      config: simulation.config,
      numAnts: simulation.numAnts,
      numColonies: simulation.numColonies,
      numFoodSources: simulation.numFoodSources,
      foodPerSource: simulation.foodPerSource,
      params: simulation.params,
      loopRate: simulation.loopRate,
      layout: simulation.layout,
      adoption: simulation.adoption,
      topology: simulation.topology,
      bounds: simulation.bounds,
      grid: simulation.occupancy.cells,
      gridVersion: simulation.gridVersion,
      manualAntIndex: simulation.manualAntIndex,
      foodSources: simulation.foodSources,
      antsDraws: simulation.antsDraws,
      commandLog: simulation.commandLog,
      colonies: simulation.colonies.map(colony => ({
        id: colony.id,
        nestX: colony.nestX,
        nestY: colony.nestY,
        ants: colony.ants,
        foodCollected: colony.foodCollected,
        discoveredSources: [...colony.discoveredSources],
        recentTrips: colony.recentTrips,
        doctrine: colony.doctrine,
        doctrineVersion: colony.doctrineVersion,
        doctrines: [...colony.doctrines],
        doctrineRefs: [...colony.doctrineRefs],
        fields: colony.field.layers(),
        received: [...colony.received].map(([from, fields]) => [from, fields.layers()]),
      })),
    },
    war: {
      nextAntId: privateWar.nextAntId,
      economyDraws: privateWar.economyRng.draws,
      colonyRuntime: privateWar.colonyRuntime,
      antRuntime: simulation.colonies.map(colony =>
        colony.ants.map(ant => privateWar.antRuntime.get(ant))
      ),
      metrics: simulation.colonies.map(colony => war.getMetrics(colony.id)),
      doctrines: simulation.colonies.map(colony => war.getDoctrine(colony.id)),
    },
  };
}

test("War doctrine commands validate, detach, and canonicalize their payload", () => {
  const doctrine = changedDoctrine(value => {
    value.evapRate = 0.008;
    value.spoilerFraction = 0.2;
    value.spoiler.follow.searching.home.enemy = 4;
  });
  const parsed = parseWarModeCommand({
    kind: "set-doctrine",
    colonyId: 1,
    doctrine,
    ignored: true,
  });
  assert.ok(parsed.ok);
  doctrine.spoiler.follow.searching.home.enemy = 1;
  assert.equal(parsed.value.doctrine.spoiler.follow.searching.home.enemy, 4);
  assert.notEqual(parsed.value.doctrine, doctrine);

  const extraDoctrine = { ...DEFAULT_DOCTRINE, ignored: true };
  const invalidDoctrine = cloneDoctrine(DEFAULT_DOCTRINE);
  invalidDoctrine.evapRate = 2;
  for (const value of [
    null,
    [],
    { kind: "other", colonyId: 0, doctrine: DEFAULT_DOCTRINE },
    { kind: "set-doctrine", colonyId: 2, doctrine: DEFAULT_DOCTRINE },
    { kind: "set-doctrine", colonyId: 0, doctrine: extraDoctrine },
    { kind: "set-doctrine", colonyId: 0, doctrine: invalidDoctrine },
  ]) {
    assert.equal(parseWarModeCommand(value).ok, false);
  }
});

test("a PR 20 War trace round-trips complete state through JSON and replay", () => {
  const firstDoctrine = changedDoctrine(doctrine => {
    doctrine.evapRate = 0.008;
    doctrine.forager.follow.searching.food.own = 6;
  });
  const secondDoctrine = changedDoctrine(doctrine => {
    doctrine.spoilerFraction = 0.2;
    doctrine.mimicRate = 0.5;
  });
  const config = warModeConfig(SETTINGS, [firstDoctrine, secondDoctrine]);
  config.rules.reproductionCost = 300;
  config.rules.emergencyPopulationLimit = 100;
  const recorder = new ModeTraceRecorder(
    warTraceMode,
    config,
    "2026-09-16T12:00:00.000Z",
    100,
  );
  const changes = new Map<number, Doctrine>([
    [300, changedDoctrine(doctrine => {
      doctrine.evapRate = 0.012;
      doctrine.forager.follow.searching.food.own = 7;
    })],
    [700, changedDoctrine(doctrine => {
      doctrine.spoilerFraction = 0.3;
      doctrine.mimicRate = 0.5;
    })],
    [1_000, changedDoctrine(doctrine => { doctrine.evapRate = 0.003; })],
  ]);

  for (let tick = 0; tick < 1_200; tick++) {
    const doctrine = changes.get(tick);
    if (doctrine) recorder.command({
      kind: "set-doctrine",
      colonyId: tick === 700 ? 1 : 0,
      doctrine,
    });
    assert.equal(recorder.step(), true);
  }

  const trace = recorder.build();
  assert.equal(trace.version, MODE_TRACE_VERSION);
  assert.equal(trace.mode.id, "war");
  assert.deepEqual(trace.commands.map(command => command.t), [301, 701, 1_001]);

  const modes = new ModeTraceRegistry().register(warTraceMode);
  const parsed = parseModeTrace(serializeModeTrace(trace), modes);
  assert.ok(parsed.ok);
  const replay = new ModeTraceReplayer<WarSimulation>(parsed.trace, modes);
  while (replay.step());

  assert.equal(replay.divergedAt, null);
  assert.equal(replay.tick, trace.endTick);
  assert.deepEqual(completeState(replay.runtime), completeState(recorder.runtime));
});

test("War fingerprints cover continuation-relevant state owned outside the core", () => {
  const war = new WarSimulation({ ...SETTINGS, masterSeed: "war-trace-owned-state" });
  const privateWar = war as unknown as PrivateWarState;
  const coreBefore = fingerprint(war.simulation);
  const warBefore = war.fingerprint();

  privateWar.colonyRuntime[0].foodReserve += 1;

  assert.equal(fingerprint(war.simulation), coreBefore);
  assert.notEqual(war.fingerprint(), warBefore);
});
