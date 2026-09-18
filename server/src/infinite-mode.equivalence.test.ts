import assert from "node:assert/strict";
import test from "node:test";
import {
  InfiniteSimulation as CoreInfiniteSimulation,
  makeRng,
  type InfiniteColony as CoreInfiniteColony,
} from "@stigsim/sim-core";
import { InfiniteSimulation as LegacyInfiniteSimulation } from "./legacy-infinite-sim";

interface LegacyChunk {
  home: Float32Array;
  food: Float32Array;
  caut: Float32Array;
}

interface LegacyColonyShape {
  pheroChunks: Map<string, LegacyChunk>;
}

function colonyState(colony: {
  id: number;
  nestX: number;
  nestY: number;
  params: object;
  foodCollected: number;
  bornAtTick: number;
  discoveredSources: Set<string>;
  recentlyClearedChunks: Set<string>;
  ants: unknown[];
}, chunks: Array<{ key: string; home: Float32Array; food: Float32Array; caut: Float32Array }>) {
  return {
    id: colony.id,
    nestX: colony.nestX,
    nestY: colony.nestY,
    params: colony.params,
    foodCollected: colony.foodCollected,
    bornAtTick: colony.bornAtTick,
    discoveredSources: [...colony.discoveredSources],
    recentlyClearedChunks: [...colony.recentlyClearedChunks],
    ants: colony.ants,
    chunks,
  };
}

function legacyState(sim: LegacyInfiniteSimulation) {
  return {
    tick: sim.tick,
    nextColonyId: (sim as unknown as { nextColonyId: number }).nextColonyId,
    walls: [...sim.walls],
    foodSources: sim.foodSources,
    colonies: sim.colonies.map(colony => colonyState(
      colony,
      [...(colony as unknown as LegacyColonyShape).pheroChunks].map(([key, chunk]) => ({ key, ...chunk })),
    )),
    init: sim.serializeInit(),
    persistence: sim.serializePersistence(),
    tickWire: sim.serializeTick(),
  };
}

function coreState(sim: CoreInfiniteSimulation) {
  return {
    tick: sim.tick,
    nextColonyId: (sim as unknown as { nextColonyId: number }).nextColonyId,
    walls: [...sim.walls],
    foodSources: sim.foodSources,
    colonies: sim.colonies.map(colony => colonyState(
      colony,
      (colony as CoreInfiniteColony).chunks().map(chunk => ({ ...chunk })),
    )),
    init: sim.serializeInit(),
    persistence: sim.serializePersistence(),
    tickWire: sim.serializeTick(),
  };
}

test("infinite@1 preserves every legacy server transition tick by tick", () => {
  const legacyRng = makeRng("infinite-mode-full-equivalence");
  const coreRng = makeRng("infinite-mode-full-equivalence");
  const legacy = new LegacyInfiniteSimulation();
  const core = new CoreInfiniteSimulation(coreRng, 8);
  const originalRandom = Math.random;
  Math.random = legacyRng;

  try {
    for (let coordinate = -8; coordinate <= 8; coordinate++) {
      legacy.setWall(coordinate, -8, true);
      legacy.setWall(coordinate, 8, true);
      legacy.setWall(-8, coordinate, true);
      legacy.setWall(8, coordinate, true);
      core.setWall(coordinate, -8, true);
      core.setWall(coordinate, 8, true);
      core.setWall(-8, coordinate, true);
      core.setWall(8, coordinate, true);
    }
    const colonyParams = {
      numAnts: 5,
      evapRate: 0.008,
      trailPower: 5,
      tankMax: 4_800,
      cautionary: true,
      name: "Differential",
    };
    legacy.addColony(-4, 0, colonyParams);
    core.addColony(-4, 0, colonyParams);
    legacy.addColony(4, 0, { ...colonyParams, name: "Second", cautionary: false });
    core.addColony(4, 0, { ...colonyParams, name: "Second", cautionary: false });
    legacy.addFood(0, 0, 200);
    core.addFood(0, 0, 200);
    legacy.addFood(-2, 3, 80);
    core.addFood(-2, 3, 80);

    assert.deepEqual(coreState(core), legacyState(legacy));
    for (let tick = 0; tick < 1_200; tick++) {
      if (tick === 200) {
        legacy.toggleWall(0, 1);
        core.toggleWall(0, 1);
      }
      if (tick === 400) {
        legacy.addFood(0, 0, 25);
        core.addFood(0, 0, 25);
      }
      if (tick === 600) {
        assert.equal(core.removeFood(-2, 3), legacy.removeFood(-2, 3));
      }
      if (tick === 800) {
        const legacyAdded = legacy.addColony(0, 5, { ...colonyParams, numAnts: 2, name: "Temporary" });
        const coreAdded = core.addColony(0, 5, { ...colonyParams, numAnts: 2, name: "Temporary" });
        assert.equal(coreAdded.id, legacyAdded.id);
      }
      if (tick === 900) {
        legacy.removeColony(2);
        core.removeColony(2);
      }

      assert.deepEqual(core.step(), legacy.step(), `death events differ at tick ${tick + 1}`);
      assert.equal(coreRng.draws, legacyRng.draws, `RNG position differs at tick ${tick + 1}`);
      assert.deepEqual(coreState(core), legacyState(legacy), `state differs at tick ${tick + 1}`);

      if ((tick + 1) % 100 === 0) {
        assert.deepEqual(core.serializePhero(), legacy.serializePhero());
      }
    }
  } finally {
    Math.random = originalRandom;
  }
});
