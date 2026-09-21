import assert from "node:assert/strict";
import test from "node:test";
import {
  Simulation, DEFAULT_PARAMS, makeSeeds, isCommand, validParams, MAX_ANTS_PER_COLONY, DEFAULT_DOCTRINE, DEFAULT_TOPOLOGY,
  isPheromoneAmount, fingerprint, MAX_COLONIES, MAX_PHEROMONE,
} from "./index";
import type { RunConfig, Command, TimedCommand } from "./index";

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
      if (!sim.occupancy.isOpen(x, y)) continue;
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
  assert.equal(sim.occupancy.isOpen(x, y), true, "not applied before the step");

  sim.step();
  assert.equal(sim.occupancy.isOpen(x, y), false, "applied during the step");
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

test("flushPending applies immediately but records one tick ahead", () => {
  const sim = new Simulation(config());
  const [x, y] = editableCell(sim);
  sim.enqueue({ kind: "setWall", x, y, open: false });
  sim.flushPending();
  assert.equal(sim.tick, 0, "does not advance time");
  assert.equal(sim.occupancy.isOpen(x, y), false, "applied immediately");
  // Stamped t: 1, not t: 0: replay applies a t: 1 command at the top of tick
  // 1, before tick 1's physics runs, which is where a pre-start edit belongs.
  assert.deepEqual(sim.commandLog, [{ t: 1, cmd: { kind: "setWall", x, y, open: false } }]);
});

test("walls refuse to close over a nest or a food source", () => {
  const sim = new Simulation(config());
  const nest = sim.colonies[0];
  const food = sim.foodSources[0];

  sim.enqueue({ kind: "setWall", x: nest.nestX, y: nest.nestY, open: false });
  sim.enqueue({ kind: "setWall", x: food.x, y: food.y, open: false });
  sim.step();

  assert.equal(sim.occupancy.isOpen(nest.nestX, nest.nestY), true);
  assert.equal(sim.occupancy.isOpen(food.x, food.y), true);
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

/** What a colony believes it has found, as coordinates rather than indices. */
function discoveredCoords(sim: Simulation, colonyIdx: number): string[] {
  const colony = sim.colonies[colonyIdx];
  return [...colony.discoveredSources]
    .map(i => {
      const src = sim.foodSources[i];
      assert.ok(src, `discovered index ${i} is out of bounds`);
      return `${src.x},${src.y}`;
    })
    .sort();
}

test("removing a food source remaps the discovered indices that outlive it", () => {
  const sim = new Simulation(config({ numColonies: 2, numFoodSources: 4 }));
  assert.equal(sim.foodSources.length, 4);

  // Discovery is normally recorded when an ant reaches a source, which takes
  // longer than a test wants to run. Seed it directly: colony 0 has found
  // every source, colony 1 only the two that sit either side of the one about
  // to be removed.
  sim.colonies[0].discoveredSources = new Set([0, 1, 2, 3]);
  sim.colonies[1].discoveredSources = new Set([0, 2]);

  const removed = sim.foodSources[1];
  const removedKey = `${removed.x},${removed.y}`;
  const before = [discoveredCoords(sim, 0), discoveredCoords(sim, 1)];

  sim.enqueue({ kind: "setFood", x: removed.x, y: removed.y, amount: 0 });
  sim.step();

  assert.equal(sim.foodSources.length, 3);
  assert.ok(!sim.foodSources.some(s => s.x === removed.x && s.y === removed.y));

  // Each colony still points at exactly the sources it knew, minus the removed
  // one. An off-by-one in the remap silently reattributes a colony's knowledge
  // to the wrong source, so compare coordinates rather than indices.
  assert.deepEqual(discoveredCoords(sim, 0), before[0].filter(k => k !== removedKey));
  assert.deepEqual(discoveredCoords(sim, 1), before[1].filter(k => k !== removedKey));

  // Colony 0 had discovered the removed source; colony 1 had not.
  assert.equal(sim.colonies[0].discoveredSources.size, 3);
  assert.equal(sim.colonies[1].discoveredSources.size, 2);
});

test("setFood on an existing source replaces its amount rather than adding one", () => {
  const sim = new Simulation(config());
  const target = sim.foodSources[0];
  const { x, y } = target;
  assert.notEqual(target.remaining, 42);

  sim.enqueue({ kind: "setFood", x, y, amount: 42 });
  sim.step();

  assert.equal(sim.foodSources.length, 1);
  const after = sim.foodSources[0];
  assert.equal(after.x, x);
  assert.equal(after.y, y);
  assert.equal(after.remaining, 42);
  assert.equal(after.total, 42);
});

test("setFood refuses walls and nests", () => {
  const sim = new Simulation(config());
  const nest = sim.colonies[0];
  let wall: [number, number] | null = null;
  for (let y = 1; y < 30 && !wall; y++)
    for (let x = 1; x < 30 && !wall; x++)
      if (!sim.occupancy.isOpen(x, y)) wall = [x, y];
  assert.ok(wall);

  const before = sim.foodSources.length;
  sim.enqueue({ kind: "setFood", x: wall[0], y: wall[1], amount: 100 });
  sim.enqueue({ kind: "setFood", x: nest.nestX, y: nest.nestY, amount: 100 });
  sim.step();
  assert.equal(sim.foodSources.length, before);
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
    const open = sim.occupancy.isOpen(nx, ny);
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
  live.enqueue({ kind: "setDoctrine", colony: 0, doctrine: DEFAULT_DOCTRINE });
  for (let i = 0; i < 20; i++) live.step();

  const replay = new Simulation(c);
  replay.loadSchedule([...live.commandLog]);
  for (let i = 0; i < 60; i++) replay.step();

  assert.deepEqual(replay.commandLog, live.commandLog);
  assert.equal(replay.occupancy.isOpen(x, y), false);
  assert.equal(replay.totalFoodCollected, live.totalFoodCollected);
  assert.equal(replay.colonies[0].doctrineVersion, 1);
});

test("a schedule entry at tick 0 applies when the schedule loads", () => {
  const c = config();
  const sim = new Simulation(c);
  const [x, y] = editableCell(sim);
  sim.loadSchedule([{ t: 0, cmd: { kind: "setWall", x, y, open: false } }]);
  assert.equal(sim.tick, 0);
  assert.equal(sim.occupancy.isOpen(x, y), false);
});

test("isCommand accepts valid commands and rejects malformed input", () => {
  const good: Command[] = [
    { kind: "setWall", x: 1, y: 2, open: true },
    { kind: "setFood", x: 1, y: 2, amount: 0 },
    { kind: "setAdoption", mode: "nest" },
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
    { kind: "setParam", key: "trailPower", value: 8 },
    { kind: "setCautionary", value: true },
    { kind: "setManualAnt", index: "3" },
  ];
  for (const cmd of bad) assert.ok(!isCommand(cmd), `accepted ${JSON.stringify(cmd)}`);
});

// ─── Range guards ────────────────────────────────────────────────────────────
//
// A trace is an ordinary file. These bounds are what stops a corrupt or
// hand-written one from allocating unbounded memory, stalling a tick, or
// driving the pheromone field to infinity when it is replayed.

test("setAntCount rejects counts that would exhaust memory", () => {
  assert.equal(isCommand({ kind: "setAntCount", n: 50 }), true);
  assert.equal(isCommand({ kind: "setAntCount", n: MAX_ANTS_PER_COLONY }), true);
  assert.equal(isCommand({ kind: "setAntCount", n: MAX_ANTS_PER_COLONY + 1 }), false);
  assert.equal(isCommand({ kind: "setAntCount", n: 1e9 }), false);
  assert.equal(isCommand({ kind: "setAntCount", n: -1 }), false);
});

test("validParams accepts a tank in range and rejects anything else", () => {
  assert.equal(validParams({ tankMax: 6400 }), true);
  assert.equal(validParams({ tankMax: 0 }), false);
  assert.equal(validParams({ tankMax: 1e12 }), false);
  assert.equal(validParams({ tankMax: "6400" }), false);
  assert.equal(validParams(null), false);
});

test("the retired parameter commands are unknown kinds", () => {
  assert.equal(isCommand({ kind: "setParam", key: "evapRate", value: 0.005 }), false);
  assert.equal(isCommand({ kind: "setCautionary", value: true }), false);
});

test("setFood rejects an amount beyond the supported range", () => {
  assert.equal(isCommand({ kind: "setFood", x: 3, y: 3, amount: 500 }), true);
  assert.equal(isCommand({ kind: "setFood", x: 3, y: 3, amount: 1e12 }), false);
});

test("isCommand accepts the doctrine, adoption, and topology commands", () => {
  assert.equal(isCommand({ kind: "setDoctrine", colony: 0, doctrine: DEFAULT_DOCTRINE }), true);
  assert.equal(isCommand({ kind: "setDoctrine", colony: 3, doctrine: DEFAULT_DOCTRINE }), true);
  assert.equal(isCommand({ kind: "setDoctrine", colony: 4, doctrine: DEFAULT_DOCTRINE }), false);
  assert.equal(isCommand({ kind: "setDoctrine", colony: -1, doctrine: DEFAULT_DOCTRINE }), false);
  assert.equal(isCommand({ kind: "setDoctrine", colony: 0.5, doctrine: DEFAULT_DOCTRINE }), false);
  assert.equal(isCommand({ kind: "setDoctrine", colony: 0, doctrine: { ...DEFAULT_DOCTRINE, evapRate: 9 } }), false);
  assert.equal(isCommand({ kind: "setAdoption", mode: "instant" }), true);
  assert.equal(isCommand({ kind: "setAdoption", mode: "nest" }), true);
  assert.equal(isCommand({ kind: "setAdoption", mode: "later" }), false);
  assert.equal(isCommand({ kind: "setTopology", topology: DEFAULT_TOPOLOGY }), true);
  assert.equal(isCommand({ kind: "setTopology", topology: { ...DEFAULT_TOPOLOGY, read: "shared" } }), true);
  assert.equal(isCommand({ kind: "setTopology", topology: { ...DEFAULT_TOPOLOGY, read: "sideways" } }), false);
});

test("enqueue refuses a command that fails validation and records nothing", () => {
  const sim = new Simulation(config());
  const bad = { ...DEFAULT_DOCTRINE, evapRate: 9 };
  assert.equal(sim.enqueue({ kind: "setDoctrine", colony: 0, doctrine: bad }), false);
  assert.equal(sim.enqueue({ kind: "setAntCount", n: MAX_ANTS_PER_COLONY + 1 }), false);
  assert.equal(sim.enqueue({ kind: "setDoctrine", colony: 0, doctrine: DEFAULT_DOCTRINE }), true);
  sim.step();
  assert.deepEqual(sim.commandLog.map(c => c.cmd.kind), ["setDoctrine"]);
  assert.equal(sim.colonies[0].doctrineVersion, 1);
});

// ─── layPheromone ────────────────────────────────────────────────────────────
//
// An authoring primitive: it writes a starting condition into a colony's
// field without going through the laying path. These cover the validator
// boundary and the three cells the applier refuses.

/** A closed cell, for the rejection test. */
function closedCell(sim: Simulation): [number, number] {
  for (let y = 1; y < 30; y++) {
    for (let x = 1; x < 30; x++) if (!sim.occupancy.isOpen(x, y)) return [x, y];
  }
  throw new Error("no closed cell found");
}

test("isCommand accepts layPheromone on the layable channels and rejects the rest", () => {
  assert.equal(isCommand({ kind: "layPheromone", colony: 0, channel: "home", x: 3, y: 4, amount: 100 }), true);
  assert.equal(isCommand({ kind: "layPheromone", colony: 3, channel: "food", x: 3, y: 4, amount: 0 }), true);
  assert.equal(isCommand({ kind: "layPheromone", colony: 0, channel: "food", x: 3, y: 4, amount: MAX_PHEROMONE }), true);

  // `caut` is storage-only wherever a doctrine runs, so it is not layable.
  assert.equal(isCommand({ kind: "layPheromone", colony: 0, channel: "caut", x: 3, y: 4, amount: 100 }), false);
  assert.equal(isCommand({ kind: "layPheromone", colony: 0, channel: "nope", x: 3, y: 4, amount: 100 }), false);
  assert.equal(isCommand({ kind: "layPheromone", colony: 0, x: 3, y: 4, amount: 100 }), false);

  assert.equal(isCommand({ kind: "layPheromone", colony: MAX_COLONIES, channel: "home", x: 3, y: 4, amount: 1 }), false);
  assert.equal(isCommand({ kind: "layPheromone", colony: -1, channel: "home", x: 3, y: 4, amount: 1 }), false);
  assert.equal(isCommand({ kind: "layPheromone", colony: 0.5, channel: "home", x: 3, y: 4, amount: 1 }), false);
  assert.equal(isCommand({ kind: "layPheromone", colony: 0, channel: "home", x: 3.5, y: 4, amount: 1 }), false);
  assert.equal(isCommand({ kind: "layPheromone", colony: 0, channel: "home", x: 3, y: "4", amount: 1 }), false);
});

test("layPheromone rejects an amplitude outside the supported range", () => {
  assert.equal(isPheromoneAmount(0), true);
  assert.equal(isPheromoneAmount(MAX_PHEROMONE), true);
  assert.equal(isPheromoneAmount(MAX_PHEROMONE + 1), false);
  assert.equal(isPheromoneAmount(-1), false, "this raises a cell, it never scrubs one");
  assert.equal(isPheromoneAmount(Number.POSITIVE_INFINITY), false);
  assert.equal(isPheromoneAmount(Number.NaN), false);
  assert.equal(isPheromoneAmount("100"), false);
});

test("layPheromone raises the named cell of the named colony and channel only", () => {
  const sim = new Simulation(config({ numColonies: 2 }));
  const [x, y] = editableCell(sim);

  sim.enqueue({ kind: "layPheromone", colony: 1, channel: "food", x, y, amount: 250 });
  assert.equal(sim.colonies[1].field.get("food", x, y), 0, "not applied before the step");

  sim.step();
  // One decay pass runs between the command and this read.
  assert.ok(sim.colonies[1].field.get("food", x, y) > 0, "applied during the step");
  assert.equal(sim.colonies[1].field.get("home", x, y), 0, "the other channel is untouched");
  assert.equal(sim.colonies[0].field.get("food", x, y), 0, "the other colony is untouched");
  assert.deepEqual(sim.commandLog.map(c => c.cmd.kind), ["layPheromone"]);
});

test("layPheromone takes the maximum, so a repeated write cannot compound", () => {
  const sim = new Simulation(config());
  const [x, y] = editableCell(sim);

  sim.apply({ kind: "layPheromone", colony: 0, channel: "home", x, y, amount: 400 });
  const once = sim.colonies[0].field.get("home", x, y);
  assert.equal(once, 400);

  sim.apply({ kind: "layPheromone", colony: 0, channel: "home", x, y, amount: 400 });
  assert.equal(sim.colonies[0].field.get("home", x, y), once, "re-applying does not add");

  sim.apply({ kind: "layPheromone", colony: 0, channel: "home", x, y, amount: 100 });
  assert.equal(sim.colonies[0].field.get("home", x, y), once, "a weaker write does not lower the cell");

  sim.apply({ kind: "layPheromone", colony: 0, channel: "home", x, y, amount: 900 });
  assert.equal(sim.colonies[0].field.get("home", x, y), 900, "a stronger write raises it");
});

test("layPheromone ignores an unknown colony, an out-of-bounds cell, and a closed cell", () => {
  const sim = new Simulation(config());
  const [cx, cy] = closedCell(sim);

  // Each of these must be a no-op rather than a throw: a trace is an ordinary
  // file and may name a cell or colony this run does not have.
  sim.apply({ kind: "layPheromone", colony: 3, channel: "home", x: 5, y: 5, amount: 500 });
  assert.equal(sim.colonies.length, 1);

  sim.apply({ kind: "layPheromone", colony: 0, channel: "home", x: 999, y: 999, amount: 500 });
  assert.equal(sim.colonies[0].field.get("home", 999, 999), 0);

  sim.apply({ kind: "layPheromone", colony: 0, channel: "home", x: cx, y: cy, amount: 500 });
  assert.equal(sim.colonies[0].field.get("home", cx, cy), 0, "a closed cell holds nothing");
});

test("a preload laid before the first step is on the field when the ants first read it", () => {
  const sim = new Simulation(config());
  const [x, y] = editableCell(sim);

  // Tick 0, nothing has moved: this is the preload case.
  assert.equal(sim.tick, 0);
  sim.enqueue({ kind: "layPheromone", colony: 0, channel: "food", x, y, amount: 800 });
  sim.flushPending();

  assert.equal(sim.colonies[0].field.get("food", x, y), 800);
  assert.deepEqual(sim.commandLog, [
    { t: 1, cmd: { kind: "layPheromone", colony: 0, channel: "food", x, y, amount: 800 } },
  ], "a paused edit is recorded at the top of the next tick, where replay applies it");
});

test("a run preloaded with pheromone replays identically from its command log", () => {
  const [x, y] = editableCell(new Simulation(config()));
  const preload: TimedCommand[] = [
    { t: 0, cmd: { kind: "layPheromone", colony: 0, channel: "food", x, y, amount: 900 } },
    { t: 0, cmd: { kind: "layPheromone", colony: 0, channel: "home", x: x + 1, y, amount: 300 } },
  ];

  const run = (cmds: TimedCommand[]) => {
    const sim = new Simulation(config());
    sim.loadSchedule(cmds);
    for (let i = 0; i < 200; i++) sim.step();
    return fingerprint(sim);
  };

  assert.equal(run(preload), run(preload), "same preload, same run");
  assert.notEqual(run(preload), run([]), "the preload actually changed the run");
});
