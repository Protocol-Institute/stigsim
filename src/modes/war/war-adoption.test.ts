import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_DOCTRINE, cloneDoctrine } from "@stigsim/sim-core";
import { DEFAULT_WAR_SETTINGS, WarSimulation } from "./war-simulation";
import { ADOPTION_CHOICES, adoptionChoice } from "../../adoption-choices";

test("a War match adopts on return to the nest by default", () => {
  assert.equal(DEFAULT_WAR_SETTINGS.adoption, "nest");
  const war = new WarSimulation({ masterSeed: "adoption-default", startingAnts: 3 });
  assert.equal(war.simulation.adoption, "nest");
});

test("under instant adoption every ant switches doctrine at once, wherever it is", () => {
  const war = new WarSimulation({ masterSeed: "adoption-instant", startingAnts: 4, adoption: "instant" });
  for (let i = 0; i < 30; i++) war.step();
  const colony = war.simulation.colonies[0];
  assert.ok(colony.ants.some(ant => ant.cx !== colony.nestX || ant.cy !== colony.nestY), "no ant left the nest");

  const changed = cloneDoctrine(DEFAULT_DOCTRINE);
  changed.forager.follow.searching.food.own = 8;
  war.setDoctrine(0, changed);

  for (const ant of colony.ants) {
    assert.equal(war.simulation.doctrineFor(ant, colony).forager.follow.searching.food.own, 8);
    assert.equal(ant.doctrineVersion, 1);
  }
  assert.equal(war.getMetrics(0).doctrineAdopted, colony.ants.length);
  // The other colony is untouched.
  for (const ant of war.simulation.colonies[1].ants) assert.equal(ant.doctrineVersion, 0);
});

test("under on-return adoption an ant out in the maze keeps the old doctrine", () => {
  const war = new WarSimulation({ masterSeed: "adoption-nest", startingAnts: 4, adoption: "nest" });
  for (let i = 0; i < 30; i++) war.step();
  const colony = war.simulation.colonies[0];
  const away = colony.ants.filter(ant => ant.cx !== colony.nestX || ant.cy !== colony.nestY);
  assert.ok(away.length > 0, "no ant left the nest");

  const changed = cloneDoctrine(DEFAULT_DOCTRINE);
  changed.forager.follow.searching.food.own = 8;
  war.setDoctrine(0, changed);

  for (const ant of away) assert.equal(ant.doctrineVersion, 0);
  assert.ok(war.getMetrics(0).doctrineAdopted < colony.ants.length);
});

test("adoption choices name both modes and treat a missing mode as on-return", () => {
  assert.deepEqual(ADOPTION_CHOICES.map(choice => choice.name), ["nest", "instant"]);
  assert.equal(adoptionChoice("instant").label, "Instant");
  assert.equal(adoptionChoice(undefined).name, "nest");
  for (const choice of ADOPTION_CHOICES) assert.ok(choice.note.length > 0);
});
