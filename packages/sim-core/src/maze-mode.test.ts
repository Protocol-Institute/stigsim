import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_DOCTRINE,
  DEFAULT_PARAMS,
  MAZE_MODE_ID,
  MAZE_MODE_VERSION,
  MAX_ANTS_PER_COLONY,
  MAX_COLONIES,
  MAX_FOOD_PER_SOURCE,
  MAX_FOOD_SOURCES,
  MAX_TANK,
  Simulation,
  cloneDoctrine,
  fingerprint,
  makeSeeds,
  mazeMode,
  parseMazeModeConfig,
  type MazeLayout,
  type RunConfig,
} from "./index";

function config(layout: MazeLayout = "random"): RunConfig {
  return {
    seeds: makeSeeds("maze-mode"),
    numAnts: 8,
    params: { ...DEFAULT_PARAMS },
    loopRate: 0.1,
    numColonies: 2,
    numFoodSources: 2,
    foodPerSource: 500,
    layout,
  };
}

test("maze@1 exposes the existing Simulation through the mode factory", () => {
  assert.equal(mazeMode.id, MAZE_MODE_ID);
  assert.equal(mazeMode.version, MAZE_MODE_VERSION);

  for (const layout of ["random", "mirrored"] as const) {
    const recipe = config(layout);
    const direct = new Simulation(recipe);
    const throughMode = mazeMode.create(recipe);
    const doctrine = cloneDoctrine(DEFAULT_DOCTRINE);
    doctrine.evapRate = 0.012;

    for (let tick = 1; tick <= 500; tick++) {
      if (tick === 200) {
        direct.enqueue({ kind: "setDoctrine", colony: 0, doctrine });
        throughMode.enqueue({ kind: "setDoctrine", colony: 0, doctrine });
      }
      direct.step();
      throughMode.step();
      assert.equal(
        fingerprint(throughMode),
        fingerprint(direct),
        `${layout} layout diverged at tick ${tick}`,
      );
    }
  }
});

test("parseMazeModeConfig canonicalizes and detaches current configs", () => {
  const input = {
    ...config("mirrored"),
    params: { ...DEFAULT_PARAMS, ignoredParameter: true },
    ignored: true,
  };
  const parsed = parseMazeModeConfig(input);
  assert.ok(parsed.ok);
  assert.deepEqual(parsed.value, config("mirrored"));
  assert.notEqual(parsed.value.seeds, input.seeds);
  assert.notEqual(parsed.value.params, input.params);
  assert.equal("ignored" in parsed.value, false);
  assert.equal("ignoredParameter" in parsed.value.params, false);
});

test("parseMazeModeConfig upgrades a pre-layout recipe to random", () => {
  const { layout: _layout, ...legacy } = config();
  const parsed = parseMazeModeConfig(legacy);
  assert.ok(parsed.ok);
  assert.deepEqual(parsed.value, config("random"));
});

test("parseMazeModeConfig rejects malformed, unbounded, and experimental recipes", () => {
  const valid = config();
  const invalid: unknown[] = [
    null,
    [],
    { ...valid, seeds: null },
    { ...valid, seeds: { ...valid.seeds, master: 1 } },
    { ...valid, seeds: { ...valid.seeds, maze: null } },
    { ...valid, numAnts: MAX_ANTS_PER_COLONY + 1 },
    { ...valid, params: { tankMax: MAX_TANK + 1 } },
    { ...valid, loopRate: -0.1 },
    { ...valid, loopRate: Number.NaN },
    { ...valid, numColonies: 0 },
    { ...valid, numColonies: MAX_COLONIES + 1 },
    { ...valid, numFoodSources: -1 },
    { ...valid, numFoodSources: MAX_FOOD_SOURCES + 1 },
    { ...valid, foodPerSource: 0 },
    { ...valid, foodPerSource: MAX_FOOD_PER_SOURCE + 1 },
    { ...valid, layout: "asymmetric" },
    { ...valid, fieldMode: "vector" },
    { ...valid, vectorSubstrate: { basis: "random", dims: 6 } },
  ];

  for (const candidate of invalid) {
    assert.equal(parseMazeModeConfig(candidate).ok, false, `accepted ${JSON.stringify(candidate)}`);
  }
});
