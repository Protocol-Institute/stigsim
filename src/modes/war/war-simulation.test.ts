import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  CELL, DEFAULT_DOCTRINE, TOPOLOGY_MIMICRY,
  cloneDoctrine, fingerprint, type Ant, type Colony,
} from "@stigsim/sim-core";
import { WarSimulation } from "./war-simulation";

function forceAtNest(ant: Ant, colony: Colony) {
  ant.cx = colony.nestX;
  ant.cy = colony.nestY;
  ant.tx = colony.nestX;
  ant.ty = colony.nestY;
  ant.x = colony.nestX * CELL + CELL / 2;
  ant.y = colony.nestY * CELL + CELL / 2;
  ant.state = "returning";
}

function antDoctrine(war: WarSimulation, ant: Ant) {
  return war.simulation.doctrineFor(ant, war.simulation.colonies[ant.colonyId]);
}

test("a War match starts with its selected topology and full per-colony doctrines", () => {
  const saboteur = cloneDoctrine(DEFAULT_DOCTRINE);
  saboteur.spoilerFraction = 0.25;
  saboteur.mimicRate = 0.5;
  const war = new WarSimulation(
    { masterSeed: "full-doctrine", startingAnts: 8, topology: TOPOLOGY_MIMICRY },
    [saboteur, DEFAULT_DOCTRINE],
  );

  assert.deepEqual(war.simulation.topology, TOPOLOGY_MIMICRY);
  assert.equal(war.getFullDoctrine(0).spoilerFraction, 0.25);
  assert.equal(war.simulation.colonies[0].ants.filter(ant => ant.role === "spoiler").length, 2);
  assert.ok(war.simulation.colonies[1].ants.every(ant => ant.role === "forager"));
});

test("gland size is fixed once per match and shared by both colonies", () => {
  const war = new WarSimulation({ masterSeed: "shared-gland", startingAnts: 2, tankMax: 8_000 });
  assert.equal(war.simulation.params.tankMax, 8_000);
  assert.ok(war.simulation.colonies.every(colony => colony.ants.every(ant => ant.tank === 8_000)));
});

test("doctrine changes wait until an ant returns to its nest", () => {
  const war = new WarSimulation(
    { masterSeed: "doctrine-test", startingAnts: 1 },
    [DEFAULT_DOCTRINE, DEFAULT_DOCTRINE],
    { maxEnergy: 3, retreatEnergy: 2, minDepartEnergy: 2 },
  );
  const colony = war.simulation.colonies[0];
  const ant = colony.ants[0];
  const changed = cloneDoctrine(DEFAULT_DOCTRINE);
  changed.forager.follow.searching.food.own = 8;

  war.setDoctrine(0, changed);
  assert.equal(war.getMetrics(0).doctrineChanged, true);
  assert.equal(antDoctrine(war, ant).forager.follow.searching.food.own, DEFAULT_DOCTRINE.forager.follow.searching.food.own);
  war.step();
  war.step();
  assert.equal(war.getAntSnapshot(ant)?.phase, "retreating");
  assert.equal(antDoctrine(war, ant).forager.follow.searching.food.own, DEFAULT_DOCTRINE.forager.follow.searching.food.own);

  forceAtNest(ant, colony);
  war.step();
  assert.equal(antDoctrine(war, ant).forager.follow.searching.food.own, 8);
  assert.equal(war.getAntSnapshot(ant)?.doctrineVersion, 1);
  assert.equal(war.getMetrics(0).doctrineAdopted, 1);
  assert.equal(war.getMetrics(0).doctrineChanged, false);
});

test("metrics account for every living ant and current doctrine adoption", () => {
  const war = new WarSimulation({ masterSeed: "metrics-test", startingAnts: 3 });
  const initial = war.getMetrics(0);

  assert.deepEqual(initial, {
    population: 3,
    foodCollected: 0,
    reserve: 18,
    hatching: 0,
    searching: 3,
    carrying: 0,
    retreating: 0,
    waiting: 0,
    lowEnergy: 0,
    births: 0,
    deaths: 0,
    doctrineChanged: false,
    doctrineAdopted: 3,
  });

  const changedDoctrine = cloneDoctrine(DEFAULT_DOCTRINE);
  changedDoctrine.forager.follow.searching.food.own = 7;
  war.setDoctrine(0, changedDoctrine);
  const changed = war.getMetrics(0);
  assert.equal(changed.doctrineChanged, true);
  assert.equal(changed.doctrineAdopted, 0);
  assert.equal(changed.searching + changed.carrying + changed.retreating + changed.waiting, changed.population);
});

test("movement consumes energy and low-energy ants retreat", () => {
  const war = new WarSimulation(
    { masterSeed: "energy-test", startingAnts: 1 },
    undefined,
    { maxEnergy: 3, retreatEnergy: 2, minDepartEnergy: 2 },
  );
  const ant = war.simulation.colonies[0].ants[0];
  war.step();
  assert.equal(war.getAntSnapshot(ant)?.energy, 3);
  war.step();
  assert.equal(war.getAntSnapshot(ant)?.energy, 2);
  // Retreat begins on the step that reaches the threshold, an intentional
  // improvement over the prototype's one-step delay.
  assert.equal(war.getAntSnapshot(ant)?.phase, "retreating");
  assert.equal(ant.hasFood, false);
});

test("an ant refuels from its colony reserve at the nest", () => {
  const war = new WarSimulation(
    { masterSeed: "refuel-test", startingAnts: 1 },
    undefined,
    {
      maxEnergy: 3,
      retreatEnergy: 2,
      minDepartEnergy: 2,
      startingReservePerAnt: 1,
      energyPerFood: 10,
    },
  );
  const colony = war.simulation.colonies[0];
  const ant = colony.ants[0];
  war.step();
  war.step();
  forceAtNest(ant, colony);
  war.step();

  assert.equal(war.getAntSnapshot(ant)?.energy, 3);
  assert.equal(war.getAntSnapshot(ant)?.phase, "searching");
  assert.equal(war.getMetrics(0).reserve, 0.9);
});

test("an under-fueled ant waits at the nest and keeps consuming energy", () => {
  // Pinned to the random layout this test was written against. Under the
  // mirrored maze for this seed the ant flips to retreating mid-corridor, and
  // the one-cell no-backtrack rule sends it forward to the next junction
  // rather than home, so it never reaches the nest within the budget below.
  // That is a retreat-path behaviour, not the waiting rule under test here.
  const war = new WarSimulation(
    { masterSeed: "waiting-test", startingAnts: 1, layout: "random" },
    undefined,
    {
      maxEnergy: 1000,
      retreatEnergy: 990,
      minDepartEnergy: 1000,
      startingReservePerAnt: 0,
      reproductionCheckSteps: 10_000,
    },
  );
  for (let i = 0; i < 100 && war.getMetrics(0).waiting === 0; i++) war.step();
  assert.equal(war.getMetrics(0).waiting, 1);
  const ant = war.simulation.colonies[0].ants[0];
  const before = war.getAntSnapshot(ant)!.energy;
  war.step();
  assert.equal(war.getAntSnapshot(ant)!.energy, before - 0.25);
});

test("a waiting ant refuels before departing on the following step", () => {
  const war = new WarSimulation(
    { masterSeed: "waiting-departure-test", startingAnts: 2 },
    undefined,
    {
      maxEnergy: 1000,
      retreatEnergy: 990,
      minDepartEnergy: 1000,
      startingReservePerAnt: 0,
      reproductionCheckSteps: 10_000,
    },
  );
  const colony = war.simulation.colonies[0];
  for (let i = 0; i < 1000 && war.getMetrics(0).waiting === 0; i++) war.step();
  const waitingAnt = colony.ants.find(ant => war.getAntSnapshot(ant)?.phase === "waiting");
  assert.ok(waitingAnt);

  const deliveringAnt = colony.ants.find(ant => ant !== waitingAnt);
  assert.ok(deliveringAnt);
  forceAtNest(deliveringAnt, colony);
  deliveringAnt.hasFood = true;
  war.step();

  const nestPosition = [waitingAnt.x, waitingAnt.y];
  war.step();
  assert.equal(war.getAntSnapshot(waitingAnt)?.phase, "searching");
  assert.deepEqual([waitingAnt.x, waitingAnt.y], nestPosition);

  const energyBeforeDeparture = war.getAntSnapshot(waitingAnt)!.energy;
  war.step();
  assert.notDeepEqual([waitingAnt.x, waitingAnt.y], nestPosition);
  assert.equal(war.getAntSnapshot(waitingAnt)!.energy, energyBeforeDeparture - 1);
});

test("refueling never drives a colony reserve below zero", () => {
  const war = new WarSimulation({ masterSeed: "neg-36", startingAnts: 3 });
  for (let step = 0; step < 2000 && war.result === null; step++) {
    war.step();
    assert.ok(war.getMetrics(0).reserve >= 0, `colony 0 reserve was negative at step ${step + 1}`);
    assert.ok(war.getMetrics(1).reserve >= 0, `colony 1 reserve was negative at step ${step + 1}`);
  }
});

test("food deliveries add to the colony reserve", () => {
  const war = new WarSimulation(
    { masterSeed: "delivery-test", startingAnts: 20 },
    undefined,
    {
      maxEnergy: 100_000,
      retreatEnergy: 1,
      minDepartEnergy: 2,
      startingReservePerAnt: 0,
      energyPerFood: Number.POSITIVE_INFINITY,
      reproductionCost: 1_000_000,
    },
  );
  for (let i = 0; i < 4000 && war.getMetrics(0).foodCollected === 0; i++) war.step();
  const metrics = war.getMetrics(0);
  assert.ok(metrics.foodCollected > 0);
  assert.equal(metrics.reserve, metrics.foodCollected * 20);
});

test("surplus reserve develops and hatches new ants deterministically", () => {
  const options = {
    maxEnergy: 100,
    retreatEnergy: 10,
    minDepartEnergy: 20,
    startingReservePerAnt: 10,
    reproductionCost: 1,
    reproductionCheckSteps: 1,
    hatchSteps: 2,
    safetyReservePerAnt: 0,
    emergencyPopulationLimit: 2,
  };
  const first = new WarSimulation({ masterSeed: "brood-test", startingAnts: 1 }, undefined, options);
  const second = new WarSimulation({ masterSeed: "brood-test", startingAnts: 1 }, undefined, options);

  for (let i = 0; i < 5; i++) {
    first.step();
    second.step();
    assert.deepEqual(first.getMetrics(0), second.getMetrics(0));
  }
  assert.equal(first.getMetrics(0).population, 2);
  assert.equal(first.getMetrics(0).births, 1);
});

test("the reproduction clock keeps advancing while a colony has no live ants", () => {
  const war = new WarSimulation({ masterSeed: "empty-colony-clock", startingAnts: 1 });
  const colony = war.simulation.colonies[0];
  colony.ants.length = 0;

  const runtime = war as unknown as {
    colonyRuntime: Array<{ reproductionClock: number }>;
  };
  const before = runtime.colonyRuntime[0].reproductionClock;

  war.step();

  assert.equal(runtime.colonyRuntime[0].reproductionClock, before + 1);
});

test("an empty colony uses its pending doctrine for pheromone evaporation", () => {
  const war = new WarSimulation({ masterSeed: "empty-evaporation", startingAnts: 1 });
  const colony = war.simulation.colonies[0];
  colony.ants.length = 0;
  const changed = cloneDoctrine(DEFAULT_DOCTRINE);
  changed.evapRate = 0.02;
  war.setDoctrine(0, changed);

  const cell = [0, 0] as const;
  colony.field.set("home", cell[0], cell[1], 100);
  war.step();

  assert.ok(Math.abs(colony.field.get("home", cell[0], cell[1]) - 98) < 0.001);
});

test("colony-level evaporation changes immediately while ants keep old per-ant behavior", () => {
  const war = new WarSimulation({ masterSeed: "split-adoption", startingAnts: 1 });
  const colony = war.simulation.colonies[0];
  const ant = colony.ants[0];
  const changed = cloneDoctrine(DEFAULT_DOCTRINE);
  changed.evapRate = 0.02;
  changed.forager.follow.searching.food.own = 8;
  colony.field.set("home", 0, 0, 100);

  war.setDoctrine(0, changed);
  war.step();

  assert.ok(Math.abs(colony.field.get("home", 0, 0) - 98) < 0.001);
  assert.equal(ant.doctrineVersion, 0);
  assert.equal(antDoctrine(war, ant).forager.follow.searching.food.own, DEFAULT_DOCTRINE.forager.follow.searching.food.own);
});

test("War behavior remains pinned through doctrine, birth, and death transitions", () => {
  const firstDoctrine = cloneDoctrine(DEFAULT_DOCTRINE);
  firstDoctrine.evapRate = 0.012;
  firstDoctrine.forager.follow.searching.food.own = 7;
  const secondDoctrine = cloneDoctrine(DEFAULT_DOCTRINE);
  secondDoctrine.spoilerFraction = 0.2;
  secondDoctrine.mimicRate = 0.5;
  const thirdDoctrine = cloneDoctrine(DEFAULT_DOCTRINE);
  thirdDoctrine.evapRate = 0.003;

  const war = new WarSimulation(
    {
      masterSeed: "war-characterization",
      startingAnts: 6,
      foodSources: 3,
      foodPerSource: 800,
      topology: TOPOLOGY_MIMICRY,
      layout: "mirrored",
      adoption: "nest",
    },
    undefined,
    { reproductionCost: 300, emergencyPopulationLimit: 100 },
  );
  const changes = new Map<number, readonly [number, typeof firstDoctrine]>([
    [300, [0, firstDoctrine]],
    [900, [1, secondDoctrine]],
    [1_600, [0, thirdDoctrine]],
  ]);
  const wanted = new Set([400, 1_200, 2_400]);
  const checkpoints: unknown[] = [];

  for (let tick = 0; tick < 2_400; tick++) {
    const change = changes.get(tick);
    if (change) war.setDoctrine(change[0], change[1]);
    war.step();
    if (!wanted.has(tick + 1)) continue;

    checkpoints.push({
      tick: war.simulation.tick,
      result: war.result,
      fingerprint: fingerprint(war.simulation),
      antsDraws: war.simulation.antsDraws,
      foodRemaining: war.simulation.foodSources.map(source => source.remaining),
      metrics: [war.getMetrics(0), war.getMetrics(1)],
      // The core fingerprint does not know about War's per-ant runtime. Hash
      // the complete public snapshots so a lifecycle refactor cannot preserve
      // positions while silently changing energy, phase, identity, or doctrine.
      runtimeHashes: war.simulation.colonies.map(colony =>
        createHash("sha256")
          .update(JSON.stringify(colony.ants.map(ant => war.getAntSnapshot(ant))))
          .digest("hex")
          .slice(0, 16)
      ),
    });
  }

  assert.deepEqual(checkpoints, [
    {
      tick: 400,
      result: null,
      fingerprint: "47381ba3",
      antsDraws: 1_155,
      foodRemaining: [799, 784, 790],
      metrics: [
        {
          population: 6, foodCollected: 11, reserve: 243.2799999999999, hatching: 0,
          searching: 1, carrying: 5, retreating: 0, waiting: 0, lowEnergy: 0,
          births: 0, deaths: 0, doctrineChanged: true, doctrineAdopted: 1,
        },
        {
          population: 6, foodCollected: 7, reserve: 167.71999999999997, hatching: 0,
          searching: 2, carrying: 4, retreating: 0, waiting: 0, lowEnergy: 0,
          births: 0, deaths: 0, doctrineChanged: false, doctrineAdopted: 6,
        },
      ],
      runtimeHashes: ["c6ce74f00ab2fc56", "11caef43476ca8ac"],
    },
    {
      tick: 1_200,
      result: null,
      fingerprint: "a2812f2b",
      antsDraws: 3_614,
      foodRemaining: [798, 745, 758],
      metrics: [
        {
          population: 8, foodCollected: 50, reserve: 83.50000000000009, hatching: 1,
          searching: 3, carrying: 5, retreating: 0, waiting: 0, lowEnergy: 0,
          births: 2, deaths: 0, doctrineChanged: false, doctrineAdopted: 8,
        },
        {
          population: 7, foodCollected: 39, reserve: 172.56000000000003, hatching: 1,
          searching: 2, carrying: 5, retreating: 0, waiting: 0, lowEnergy: 0,
          births: 1, deaths: 0, doctrineChanged: true, doctrineAdopted: 6,
        },
      ],
      runtimeHashes: ["1a3490fb26facaa9", "3414d7decfe90d8e"],
    },
    {
      tick: 2_400,
      result: null,
      fingerprint: "1f3c5e14",
      antsDraws: 8_847,
      foodRemaining: [798, 657, 687],
      metrics: [
        {
          population: 12, foodCollected: 137, reserve: 234.7600000000005, hatching: 2,
          searching: 6, carrying: 6, retreating: 0, waiting: 0, lowEnergy: 0,
          births: 6, deaths: 0, doctrineChanged: false, doctrineAdopted: 12,
        },
        {
          population: 10, foodCollected: 107, reserve: 263.2000000000003, hatching: 1,
          searching: 3, carrying: 7, retreating: 0, waiting: 0, lowEnergy: 0,
          births: 5, deaths: 1, doctrineChanged: false, doctrineAdopted: 10,
        },
      ],
      runtimeHashes: ["e58d180f6be0ff0c", "697b99c787147f0c"],
    },
  ]);
});

test("same-seed War Mode remains deterministic through doctrine changes", () => {
  const settings = {
    masterSeed: "long-war-equivalence",
    startingAnts: 8,
    foodSources: 4,
    foodPerSource: 2_000,
  };
  const first = new WarSimulation(settings);
  const second = new WarSimulation(settings);
  const firstChange = cloneDoctrine(DEFAULT_DOCTRINE);
  firstChange.evapRate = 0.012;
  firstChange.forager.follow.searching.food.own = 7;
  const secondChange = cloneDoctrine(DEFAULT_DOCTRINE);
  secondChange.spoilerFraction = 0.2;
  secondChange.mimicRate = 0.5;
  const thirdChange = cloneDoctrine(DEFAULT_DOCTRINE);
  thirdChange.evapRate = 0.003;
  const changes = new Map<number, readonly [number, typeof firstChange]>([
    [400, [0, firstChange]],
    [1_200, [1, secondChange]],
    [2_100, [0, thirdChange]],
  ]);

  for (let tick = 0; tick < 3_000; tick++) {
    const change = changes.get(tick);
    if (change) {
      first.setDoctrine(change[0], change[1]);
      second.setDoctrine(change[0], change[1]);
    }
    first.step();
    second.step();

    if ((tick + 1) % 100 === 0) {
      assert.equal(fingerprint(first.simulation), fingerprint(second.simulation));
      assert.deepEqual(first.getMetrics(0), second.getMetrics(0));
      assert.deepEqual(first.getMetrics(1), second.getMetrics(1));
      for (const colonyId of [0, 1]) {
        assert.deepEqual(
          first.simulation.colonies[colonyId].ants.map(ant => first.getAntSnapshot(ant)),
          second.simulation.colonies[colonyId].ants.map(ant => second.getAntSnapshot(ant)),
        );
      }
    }
  }
  assert.equal(first.result, second.result);
});

test("colony 0 can win and a decided match no longer advances", () => {
  const war = new WarSimulation({ masterSeed: "colony-zero-wins", startingAnts: 1 });
  war.simulation.colonies[1].ants.length = 0;

  war.step();
  assert.equal(war.result, 0);
  const decidedAt = war.simulation.tick;

  war.step();
  assert.equal(war.simulation.tick, decidedAt);
  assert.equal(war.result, 0);
});

test("ant death ends a match when neither colony survives", () => {
  const war = new WarSimulation(
    { masterSeed: "extinction-test", startingAnts: 1 },
    undefined,
    {
      maxEnergy: 1,
      retreatEnergy: 0,
      minDepartEnergy: 1,
      startingReservePerAnt: 0,
      reproductionCheckSteps: 100,
    },
  );
  war.step();
  war.step();
  assert.equal(war.getMetrics(0).deaths, 1);
  assert.equal(war.getMetrics(1).deaths, 1);
  assert.equal(war.result, "draw");
});
