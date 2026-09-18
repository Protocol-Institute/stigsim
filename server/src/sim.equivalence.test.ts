import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { makeRng, makeSeeds, type Channel } from "@stigsim/sim-core";
import { InfiniteSimulation } from "./sim";

const SIZE = 9;
const NEST = [4, 4] as const;
const FOOD = [6, 4] as const;
const CHANNELS: Channel[] = ["home", "food", "caut"];

function putBoundary(sim: InfiniteSimulation): void {
  for (let i = 0; i < SIZE; i++) {
    sim.setWall(i, 0, true);
    sim.setWall(i, SIZE - 1, true);
    sim.setWall(0, i, true);
    sim.setWall(SIZE - 1, i, true);
  }
}

function stateHash(sim: InfiniteSimulation): string {
  const state = {
    foodSources: sim.foodSources,
    colonies: sim.colonies.map(colony => ({
      foodCollected: colony.foodCollected,
      discoveredSources: [...colony.discoveredSources].sort(),
      ants: colony.ants.map(ant => ({
        wx: ant.wx,
        wy: ant.wy,
        cx: ant.cx,
        cy: ant.cy,
        tx: ant.tx,
        ty: ant.ty,
        prevCx: ant.prevCx,
        prevCy: ant.prevCy,
        state: ant.state,
        hasFood: ant.hasFood,
        tank: ant.tank,
        colonyId: ant.colonyId,
        energy: ant.energy,
      })),
      fields: CHANNELS.map(channel => {
        const values: number[] = [];
        for (let y = 0; y < SIZE; y++) {
          for (let x = 0; x < SIZE; x++) values.push(colony.getAt(channel, x, y));
        }
        return values;
      }),
    })),
  };
  return createHash("sha256").update(JSON.stringify(state)).digest("hex").slice(0, 16);
}

test("Infinite behavior remains pinned through discovery and delivery", () => {
  const sim = new InfiniteSimulation();
  putBoundary(sim);
  const colony = sim.addColony(NEST[0], NEST[1], {
    numAnts: 3,
    name: "Characterization",
  });
  sim.addFood(FOOD[0], FOOD[1], 10_000);

  const random = makeRng(makeSeeds("infinite-core-equivalence").ants);
  const originalRandom = Math.random;
  const checkpoints: unknown[] = [];
  Math.random = random;
  try {
    for (let tick = 1; tick <= 1_000; tick++) {
      sim.step();
      if (tick === 250 || tick === 500 || tick === 1_000) {
        checkpoints.push({
          tick: sim.tick,
          randomDraws: random.draws,
          population: colony.ants.length,
          foodCollected: colony.foodCollected,
          foodRemaining: sim.foodSources.map(source => source.remaining),
          stateHash: stateHash(sim),
        });
      }
    }
  } finally {
    Math.random = originalRandom;
  }

  assert.deepEqual(checkpoints, [
    {
      tick: 250,
      randomDraws: 131,
      population: 3,
      foodCollected: 28,
      foodRemaining: [9_970],
      stateHash: "0403b73426281157",
    },
    {
      tick: 500,
      randomDraws: 224,
      population: 3,
      foodCollected: 75,
      foodRemaining: [9_924],
      stateHash: "71fe29015d86f437",
    },
    {
      tick: 1_000,
      randomDraws: 413,
      population: 3,
      foodCollected: 168,
      foodRemaining: [9_831],
      stateHash: "8c593e112121f70d",
    },
  ]);
  assert.ok(colony.foodCollected > 0, "the run must complete a trip to exercise food handling");
});
