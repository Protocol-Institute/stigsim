import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_DOCTRINE,
  DenseGrid,
  ModeRegistry,
  TOPOLOGY_MIMICRY,
  cloneDoctrine,
  fingerprint,
  type Ant,
  type Doctrine,
  type Rng,
} from "@stigsim/sim-core";
import {
  DEFAULT_WAR_SETTINGS,
  WAR_RULES,
  WarSimulation,
  type WarMatchSettings,
  type WarRules,
} from "./war-simulation";
import {
  WAR_MODE_ID,
  WAR_MODE_VERSION,
  parseWarModeConfig,
  warMode,
  warModeConfig,
  type WarModeConfig,
} from "./war-mode";

const SETTINGS: WarMatchSettings = {
  ...DEFAULT_WAR_SETTINGS,
  masterSeed: "war-mode-sdk",
  startingAnts: 6,
  foodSources: 3,
  foodPerSource: 800,
  tankMax: 8_000,
  topology: TOPOLOGY_MIMICRY,
  layout: "mirrored",
  adoption: "nest",
};

function testDoctrines(): [Doctrine, Doctrine] {
  const first = cloneDoctrine(DEFAULT_DOCTRINE);
  first.evapRate = 0.008;
  first.forager.follow.searching.food.own = 6;
  const second = cloneDoctrine(DEFAULT_DOCTRINE);
  second.spoilerFraction = 0.2;
  second.mimicRate = 0.5;
  return [first, second];
}

function config(
  settings: WarMatchSettings = SETTINGS,
  doctrines: [Doctrine, Doctrine] = testDoctrines(),
  rules: WarRules = { ...WAR_RULES },
): WarModeConfig {
  return {
    settings: { ...settings, topology: { ...settings.topology, visible: { ...settings.topology.visible } } },
    doctrines: [cloneDoctrine(doctrines[0]), cloneDoctrine(doctrines[1])],
    rules: { ...rules },
  };
}

test("war mode has a stable identity and canonical production recipe", () => {
  assert.equal(warMode.id, WAR_MODE_ID);
  assert.equal(warMode.version, WAR_MODE_VERSION);

  const supplied = testDoctrines();
  const suppliedSettings: WarMatchSettings = {
    ...SETTINGS,
    topology: {
      ...SETTINGS.topology,
      visible: { ...SETTINGS.topology.visible },
    },
  };
  const recipe = warModeConfig(suppliedSettings, supplied);
  const defaultRecipe = warModeConfig(SETTINGS);
  supplied[0].forager.follow.searching.food.own = 1;
  suppliedSettings.topology.visible.food = false;

  assert.deepEqual(recipe.settings, SETTINGS);
  assert.equal(recipe.doctrines[0].forager.follow.searching.food.own, 6);
  assert.deepEqual(defaultRecipe.doctrines, [DEFAULT_DOCTRINE, DEFAULT_DOCTRINE]);
  assert.deepEqual(recipe.rules, WAR_RULES);
  assert.notEqual(recipe.settings, SETTINGS);
  assert.notEqual(recipe.settings.topology, SETTINGS.topology);
  assert.notEqual(recipe.doctrines[0], supplied[0]);
  assert.notEqual(recipe.rules, WAR_RULES);
});

test("war config parsing validates and clones the complete PR 20 recipe", () => {
  const raw = {
    ...config(),
    ignored: true,
    settings: { ...SETTINGS, topology: TOPOLOGY_MIMICRY, ignored: true },
    rules: { ...WAR_RULES, ignored: true },
  };
  const parsed = parseWarModeConfig(raw);
  assert.ok(parsed.ok);

  assert.deepEqual(parsed.value, config());
  assert.notEqual(parsed.value.settings, raw.settings);
  assert.notEqual(parsed.value.settings.topology, raw.settings.topology);
  assert.notEqual(parsed.value.doctrines, raw.doctrines);
  assert.notEqual(parsed.value.doctrines[0], raw.doctrines[0]);
  assert.notEqual(parsed.value.rules, raw.rules);
});

test("war config parsing rejects malformed settings, doctrines, and rules", () => {
  assert.deepEqual(parseWarModeConfig(null), {
    ok: false,
    error: "War mode config must be an object.",
  });

  const invalidSettings: Array<[keyof WarMatchSettings, unknown]> = [
    ["masterSeed", ""],
    ["masterSeed", "x".repeat(201)],
    ["startingAnts", -1],
    ["loopRate", 2],
    ["foodSources", 65],
    ["foodPerSource", 0],
    ["tankMax", 0],
    ["topology", { ...TOPOLOGY_MIMICRY, read: "sideways" }],
    ["layout", "asymmetric"],
    ["adoption", "delayed"],
  ];
  for (const [key, value] of invalidSettings) {
    const candidate = config();
    (candidate.settings as unknown as Record<string, unknown>)[key] = value;
    assert.equal(parseWarModeConfig(candidate).ok, false, `accepted invalid ${key}`);
  }
  assert.equal(parseWarModeConfig({ ...config(), settings: [] }).ok, false);

  const invalidDoctrine = cloneDoctrine(DEFAULT_DOCTRINE);
  invalidDoctrine.evapRate = 2;
  for (const doctrines of [null, [DEFAULT_DOCTRINE], [invalidDoctrine, DEFAULT_DOCTRINE], [DEFAULT_DOCTRINE, {}]]) {
    assert.equal(parseWarModeConfig({ ...config(), doctrines }).ok, false);
  }

  const invalidRules: Array<[keyof WarRules, unknown]> = [
    ["maxEnergy", 0],
    ["retreatEnergy", WAR_RULES.maxEnergy + 1],
    ["minDepartEnergy", WAR_RULES.maxEnergy + 1],
    ["moveEnergyCost", -1],
    ["waitEnergyCost", -1],
    ["energyPerFood", -1],
    ["foodDeliveryValue", -1],
    ["startingReservePerAnt", -1],
    ["reproductionCost", 0],
    ["reproductionCheckSteps", 0],
    ["hatchSteps", -1],
    ["safetyReservePerAnt", -1],
    ["emergencyPopulationLimit", 10_001],
  ];
  for (const [key, value] of invalidRules) {
    const candidate = config();
    (candidate.rules as unknown as Record<string, unknown>)[key] = value;
    assert.equal(parseWarModeConfig(candidate).ok, false, `accepted invalid ${key}`);
  }
  assert.equal(parseWarModeConfig({ ...config(), rules: [] }).ok, false);
});

test("a registry reconstructs war@1 from canonical JSON", () => {
  const result = new ModeRegistry().register(warMode).create({
    id: WAR_MODE_ID,
    version: WAR_MODE_VERSION,
    config: config(),
  });
  assert.ok(result.ok);
  assert.ok(result.instance.runtime instanceof WarSimulation);
  assert.equal(result.instance.runtime.tick, 0);
  result.instance.runtime.step();
  assert.equal(result.instance.runtime.tick, 1);
});

interface PrivateWarState {
  antRuntime: Map<Ant, {
    id: number;
    phase: string;
    energy: number;
    departure: [number, number] | null;
  }>;
  colonyRuntime: unknown[];
  economyRng: Rng;
  nextAntId: number;
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
    fingerprint: fingerprint(simulation),
    core: {
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
      fingerprints: simulation.fingerprints,
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
      antRuntime: simulation.colonies.map(colony => colony.ants.map(ant => privateWar.antRuntime.get(ant))),
      metrics: simulation.colonies.map(colony => war.getMetrics(colony.id)),
      doctrines: simulation.colonies.map(colony => war.getDoctrine(colony.id)),
    },
  };
}

test("war@1 preserves every PR 20 state transition tick by tick", () => {
  const doctrines = testDoctrines();
  const ruleOverrides = { reproductionCost: 300, emergencyPopulationLimit: 100 };
  const completeRules = { ...WAR_RULES, ...ruleOverrides };
  const legacy = new WarSimulation(SETTINGS, doctrines, ruleOverrides);
  const sdk = warMode.create(config(SETTINGS, doctrines, completeRules));
  const firstChange = cloneDoctrine(DEFAULT_DOCTRINE);
  firstChange.evapRate = 0.012;
  firstChange.forager.follow.searching.food.own = 7;
  const secondChange = cloneDoctrine(DEFAULT_DOCTRINE);
  secondChange.spoilerFraction = 0.3;
  secondChange.mimicRate = 0.5;
  const thirdChange = cloneDoctrine(DEFAULT_DOCTRINE);
  thirdChange.evapRate = 0.003;
  const changes = new Map<number, readonly [number, Doctrine]>([
    [300, [0, firstChange]],
    [900, [1, secondChange]],
    [1_600, [0, thirdChange]],
  ]);

  assert.deepEqual(completeState(sdk), completeState(legacy));
  for (let tick = 0; tick < 2_400; tick++) {
    const change = changes.get(tick);
    if (change) {
      legacy.setDoctrine(change[0], change[1]);
      sdk.setDoctrine(change[0], change[1]);
    }
    legacy.step();
    sdk.step();
    assert.deepEqual(completeState(sdk), completeState(legacy), `state diverged at tick ${tick + 1}`);
  }
});
