import assert from "node:assert/strict";
import test from "node:test";
import { Simulation, DEFAULT_PARAMS, makeSeeds, isCommand } from "./index";
import type { RunConfig, Command } from "./index";

function config(overrides: Partial<RunConfig> = {}): RunConfig {
  return {
    seeds: makeSeeds("command-test"),
    numAnts: 10,
    params: DEFAULT_PARAMS,
    loopRate: 0.1,
    numColonies: 1,
    numFoodSources: 1,
    foodPerSource: 500,
    ...overrides,
  };
}

/** An open, non-nest, non-food cell for edit tests. */
function editableCell(sim: Simulation): [number, number] {
  for (let y = 2; y < 28; y++) {
    for (let x = 2; x < 28; x++) {
      if (sim.grid[y][x] !== 1) continue;
      if (sim.colonies.some(c => c.nestX === x && c.nestY === y)) continue;
      if (sim.foodSources.some(s => s.x === x && s.y === y)) continue;
      return [x, y];
    }
  }
  throw new Error("no editable cell found");
}

test("the tick counter starts at zero and advances once per step", () => {
  const sim = new Simulation(config());
  assert.equal(sim.tick, 0);
  sim.step();
  assert.equal(sim.tick, 1);
  for (let i = 0; i < 99; i++) sim.step();
  assert.equal(sim.tick, 100);
});

test("an enqueued command applies on the next step and is recorded at that tick", () => {
  const sim = new Simulation(config());
  const [x, y] = editableCell(sim);

  sim.enqueue({ kind: "setWall", x, y, open: false });
  assert.equal(sim.grid[y][x], 1, "not applied before the step");

  sim.step();
  assert.equal(sim.grid[y][x], 0, "applied during the step");
  assert.deepEqual(sim.commandLog, [{ t: 1, cmd: { kind: "setWall", x, y, open: false } }]);
});

test("commands enqueued in one tick apply in order", () => {
  const sim = new Simulation(config());
  sim.enqueue({ kind: "setAntCount", n: 5 });
  sim.enqueue({ kind: "setAntCount", n: 7 });
  sim.step();
  assert.equal(sim.allAnts.length, 7);
  assert.deepEqual(sim.commandLog.map(c => c.t), [1, 1]);
});

test("flushPending applies at the current tick without advancing", () => {
  const sim = new Simulation(config());
  const [x, y] = editableCell(sim);
  sim.enqueue({ kind: "setWall", x, y, open: false });
  sim.flushPending();
  assert.equal(sim.tick, 0);
  assert.equal(sim.grid[y][x], 0);
  assert.deepEqual(sim.commandLog, [{ t: 0, cmd: { kind: "setWall", x, y, open: false } }]);
});

test("walls refuse to close over a nest or a food source", () => {
  const sim = new Simulation(config());
  const nest = sim.colonies[0];
  const food = sim.foodSources[0];

  sim.enqueue({ kind: "setWall", x: nest.nestX, y: nest.nestY, open: false });
  sim.enqueue({ kind: "setWall", x: food.x, y: food.y, open: false });
  sim.step();

  assert.equal(sim.grid[nest.nestY][nest.nestX], 1);
  assert.equal(sim.grid[food.y][food.x], 1);
});

test("closing a wall clears any ant targeting that cell", () => {
  const sim = new Simulation(config());
  for (let i = 0; i < 50; i++) sim.step();
  const ant = sim.allAnts[0];
  const [tx, ty] = [ant.tx, ant.ty];
  if (sim.colonies.some(c => c.nestX === tx && c.nestY === ty)) return;
  if (sim.foodSources.some(s => s.x === tx && s.y === ty)) return;

  sim.enqueue({ kind: "setWall", x: tx, y: ty, open: false });
  sim.step();

  for (const a of sim.allAnts) {
    assert.ok(!(a.tx === tx && a.ty === ty), "an ant still targets the closed cell");
  }
});

test("setFood adds and removes sources and keeps discovered indices consistent", () => {
  const sim = new Simulation(config());
  const [x, y] = editableCell(sim);

  sim.enqueue({ kind: "setFood", x, y, amount: 300 });
  sim.step();
  assert.equal(sim.foodSources.length, 2);
  const added = sim.foodSources.find(s => s.x === x && s.y === y);
  assert.ok(added);
  assert.equal(added.remaining, 300);
  assert.equal(added.total, 300);

  sim.enqueue({ kind: "setFood", x, y, amount: 0 });
  sim.step();
  assert.equal(sim.foodSources.length, 1);
});

test("setFood refuses walls and nests", () => {
  const sim = new Simulation(config());
  const nest = sim.colonies[0];
  let wall: [number, number] | null = null;
  for (let y = 1; y < 30 && !wall; y++)
    for (let x = 1; x < 30 && !wall; x++)
      if (sim.grid[y][x] === 0) wall = [x, y];
  assert.ok(wall);

  const before = sim.foodSources.length;
  sim.enqueue({ kind: "setFood", x: wall[0], y: wall[1], amount: 100 });
  sim.enqueue({ kind: "setFood", x: nest.nestX, y: nest.nestY, amount: 100 });
  sim.step();
  assert.equal(sim.foodSources.length, before);
});

test("setParam and setCautionary reach the running simulation", () => {
  const sim = new Simulation(config());
  sim.enqueue({ kind: "setParam", key: "trailPower", value: 8 });
  sim.enqueue({ kind: "setCautionary", value: true });
  sim.step();
  assert.equal(sim.params.trailPower, 8);
  assert.equal(sim.params.cautionary, true);
});

test("setManualAnt marks exactly one ant and null clears it", () => {
  const sim = new Simulation(config());
  sim.enqueue({ kind: "setManualAnt", index: 3 });
  sim.step();
  assert.equal(sim.manualAntIndex, 3);
  assert.equal(sim.allAnts.filter(a => a.manual).length, 1);
  assert.equal(sim.allAnts[3].manual, true);

  sim.enqueue({ kind: "setManualAnt", index: null });
  sim.step();
  assert.equal(sim.manualAntIndex, null);
  assert.equal(sim.allAnts.filter(a => a.manual).length, 0);
});

test("moveManualAnt retargets the controlled ant and refuses walls", () => {
  const sim = new Simulation(config());
  sim.enqueue({ kind: "setManualAnt", index: 0 });
  sim.step();
  const ant = sim.allAnts[0];

  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as [number, number][]) {
    const nx = ant.cx + dx, ny = ant.cy + dy;
    const open = nx >= 0 && nx < 31 && ny >= 0 && ny < 31 && sim.grid[ny][nx] === 1;
    const before: [number, number] = [ant.tx, ant.ty];
    sim.enqueue({ kind: "moveManualAnt", dx, dy });
    sim.flushPending();
    if (open) assert.deepEqual([ant.tx, ant.ty], [nx, ny]);
    else assert.deepEqual([ant.tx, ant.ty], before);
  }
});

test("a loaded schedule replays commands at the recorded ticks", () => {
  const c = config();
  const live = new Simulation(c);
  const [x, y] = editableCell(live);

  for (let i = 0; i < 20; i++) live.step();
  live.enqueue({ kind: "setWall", x, y, open: false });
  for (let i = 0; i < 20; i++) live.step();
  live.enqueue({ kind: "setParam", key: "evapRate", value: 0.01 });
  for (let i = 0; i < 20; i++) live.step();

  const replay = new Simulation(c);
  replay.loadSchedule([...live.commandLog]);
  for (let i = 0; i < 60; i++) replay.step();

  assert.deepEqual(replay.commandLog, live.commandLog);
  assert.equal(replay.grid[y][x], 0);
  assert.equal(replay.params.evapRate, 0.01);
  assert.equal(replay.totalFoodCollected, live.totalFoodCollected);
});

test("a schedule entry at tick 0 applies when the schedule loads", () => {
  const c = config();
  const sim = new Simulation(c);
  const [x, y] = editableCell(sim);
  sim.loadSchedule([{ t: 0, cmd: { kind: "setWall", x, y, open: false } }]);
  assert.equal(sim.tick, 0);
  assert.equal(sim.grid[y][x], 0);
});

test("isCommand accepts valid commands and rejects malformed input", () => {
  const good: Command[] = [
    { kind: "setWall", x: 1, y: 2, open: true },
    { kind: "setFood", x: 1, y: 2, amount: 0 },
    { kind: "setParam", key: "tankMax", value: 3200 },
    { kind: "setCautionary", value: false },
    { kind: "setAntCount", n: 12 },
    { kind: "setManualAnt", index: null },
    { kind: "moveManualAnt", dx: 0, dy: -1 },
  ];
  for (const cmd of good) assert.ok(isCommand(cmd), `rejected ${JSON.stringify(cmd)}`);

  const bad: unknown[] = [
    null, undefined, 42, "setWall", {},
    { kind: "nope" },
    { kind: "setWall", x: 1, y: 2 },
    { kind: "setWall", x: "1", y: 2, open: true },
    { kind: "setParam", key: "cautionary", value: true },
    { kind: "setParam", key: "trailPower", value: "8" },
    { kind: "setManualAnt", index: "3" },
  ];
  for (const cmd of bad) assert.ok(!isCommand(cmd), `accepted ${JSON.stringify(cmd)}`);
});
