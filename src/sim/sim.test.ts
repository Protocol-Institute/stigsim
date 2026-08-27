import assert from "node:assert/strict";
import test from "node:test";
import { Simulation, DEFAULT_PARAMS, COLS, ROWS } from "./index";

function build() {
  return new Simulation(20, DEFAULT_PARAMS, 0.1, 1, 1, 500);
}

test("a fresh simulation has a maze, one colony, and one food source", () => {
  const sim = build();
  assert.equal(sim.grid.length, ROWS);
  assert.equal(sim.grid[0].length, COLS);
  assert.equal(sim.colonies.length, 1);
  assert.equal(sim.foodSources.length, 1);
  assert.equal(sim.allAnts.length, 20);
  assert.equal(sim.totalFoodCollected, 0);
});

test("the nest cell and every food source sit on open ground", () => {
  const sim = build();
  const nest = sim.colonies[0];
  assert.equal(sim.grid[nest.nestY][nest.nestX], 1);
  for (const src of sim.foodSources) {
    assert.equal(sim.grid[src.y][src.x], 1);
  }
});

test("ants collect food within 4000 steps", () => {
  const sim = build();
  for (let i = 0; i < 4000; i++) sim.step();
  assert.ok(
    sim.totalFoodCollected > 0,
    `expected some food collected, got ${sim.totalFoodCollected}`,
  );
});

test("setAntCount grows and shrinks every colony", () => {
  const sim = new Simulation(10, DEFAULT_PARAMS, 0.1, 2, 2, 500);
  assert.equal(sim.allAnts.length, 20);
  sim.setAntCount(30);
  assert.equal(sim.allAnts.length, 60);
  sim.setAntCount(5);
  assert.equal(sim.allAnts.length, 10);
});
