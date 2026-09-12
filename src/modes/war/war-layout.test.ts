import assert from "node:assert/strict";
import test from "node:test";
import { COLS, ROWS } from "@stigsim/sim-core";
import { DEFAULT_WAR_SETTINGS, WarSimulation } from "./war-simulation";
import { LAYOUT_CHOICES, layoutChoice } from "../../layout-choices";

test("a War match is mirrored by default and passes the layout to the simulation", () => {
  assert.equal(DEFAULT_WAR_SETTINGS.layout, "mirrored");
  const war = new WarSimulation({ masterSeed: "layout-default", startingAnts: 2, foodSources: 3 });
  const sim = war.simulation;
  assert.equal(sim.layout, "mirrored");
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      assert.equal(sim.occupancy.isOpen(x, y), sim.occupancy.isOpen(COLS - 1 - x, ROWS - 1 - y), `cell ${x},${y}`);
    }
  }
  assert.equal(sim.foodSources.length, 3);
  for (const src of sim.foodSources) {
    assert.ok(sim.foodSources.some(s => s.x === COLS - 1 - src.x && s.y === ROWS - 1 - src.y), `${src.x},${src.y} has no image`);
  }
});

test("a War match can still be created on the random layout", () => {
  const war = new WarSimulation({ masterSeed: "layout-random", startingAnts: 2, layout: "random" });
  assert.equal(war.simulation.layout, "random");
});

test("layout choices name both layouts and treat a missing layout as random", () => {
  assert.deepEqual(LAYOUT_CHOICES.map(choice => choice.name), ["mirrored", "random"]);
  assert.equal(layoutChoice("mirrored").label, "Mirrored");
  assert.equal(layoutChoice(undefined).name, "random");
});
