import assert from "node:assert/strict";
import test from "node:test";
import { Simulation } from "./sim";
import { generateMaze } from "./maze";
import { makeRng, makeSeeds } from "./rng";
import { DenseField } from "./field";
import { ChunkedField } from "./chunked-field";
import { DenseGrid, WallSet } from "./world";
import { COLS, ROWS, COLONY_NESTS } from "./constants";
import { DEFAULT_PARAMS } from "./types";
import type { Channel, RunConfig, WorldSpec } from "./types";

const CHANNELS: Channel[] = ["home", "food", "caut"];

function runConfig(): RunConfig {
  return {
    seeds: makeSeeds("equivalence"),
    numAnts: 10,
    params: DEFAULT_PARAMS,
    loopRate: 0.12,
    numColonies: 2,
    numFoodSources: 2,
    foodPerSource: 400,
  };
}

/**
 * One maze expressed twice: as open cells in a dense grid, and as the walls
 * that are its complement in a sparse set. Every reachable cell is identical,
 * so the two worlds differ only in how they are stored.
 */
function worlds(evictBelow: number) {
  const cells = generateMaze(0.12, makeRng("equivalence-maze"));

  // DenseGrid keeps the caller's array and writes through it, so the wall set
  // is built from a copy taken before any simulation can mutate one.
  const walls = new WallSet({ cols: COLS, rows: ROWS });
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) walls.setOpen(x, y, cells[y][x] === 1);
  }

  const dense: WorldSpec = {
    occupancy: new DenseGrid(cells),
    nests: COLONY_NESTS,
    createField: () => new DenseField(COLS, ROWS),
  };
  const chunked: WorldSpec = {
    occupancy: walls,
    nests: COLONY_NESTS,
    createField: () => new ChunkedField({ chunkSize: 8, evictBelow }),
  };
  return { dense, chunked };
}

/** Everything about the ants that the next tick depends on. */
function trajectory(sim: Simulation): number[] {
  const out: number[] = [];
  for (const colony of sim.colonies) {
    out.push(colony.id, colony.foodCollected);
    for (const ant of colony.ants) {
      out.push(
        ant.x, ant.y, ant.cx, ant.cy, ant.tx, ant.ty, ant.prevCx, ant.prevCy,
        ant.state === "returning" ? 1 : 0, ant.hasFood ? 1 : 0, ant.tank,
      );
    }
  }
  return out;
}

test("dense and chunked backings run identically from one seed", () => {
  // Eviction is off deliberately. Dropping a chunk is lossy — a cell sitting
  // at 0.049 reads as 0.049 from a dense field and as 0 from a chunked one
  // once its chunk goes — so an evicting backing cannot agree with a dense one
  // cell for cell. The test below pins that difference as real behaviour.
  const { dense, chunked } = worlds(0);
  const config = runConfig();

  const a = new Simulation(config, { world: dense });
  const b = new Simulation(config, { world: chunked });

  assert.deepEqual(
    b.foodSources, a.foodSources,
    "food placement walks the world, so it must agree before any stepping",
  );
  assert.deepEqual(trajectory(b), trajectory(a), "ants must spawn identically");

  for (let t = 1; t <= 1000; t++) {
    a.step();
    b.step();
    // Compared every tick rather than at the end: a single-tick divergence
    // report is worth far more than "differed somewhere in a thousand ticks".
    assert.deepEqual(trajectory(b), trajectory(a), `trajectories diverged at tick ${t}`);
    // Two runs can agree on every ant and still stand at different points in
    // the random stream, then part company later.
    assert.equal(b.antsDraws, a.antsDraws, `rng position diverged at tick ${t}`);
  }

  assert.ok(a.totalFoodCollected > 0, "the run has to actually forage to prove anything");

  for (let i = 0; i < a.colonies.length; i++) {
    for (const ch of CHANNELS) {
      for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
          assert.equal(
            b.colonies[i].field.get(ch, x, y),
            a.colonies[i].field.get(ch, x, y),
            `colony ${i} channel ${ch} differs at (${x}, ${y})`,
          );
        }
      }
    }
  }
});

test("eviction loses a value a dense field keeps", () => {
  // The reason the comparison above disables eviction, demonstrated directly
  // rather than through a run. Dropping a chunk discards whatever was left in
  // it, so an evicting backing cannot agree with a dense one cell for cell —
  // and a difference this small is exactly what powerChoice amplifies, since
  // it scores (value + 1) ^ trailPower.
  //
  // Measured separately: eviction did not actually perturb a 1000-tick,
  // 31x31 run, so the effect is subtle in practice. It is still wrong in
  // principle, and "subtle" is not a property to build an equivalence proof on.
  const dense = new DenseField(8, 8);
  const keeping = new ChunkedField({ chunkSize: 8, evictBelow: 0 });
  const evicting = new ChunkedField({ chunkSize: 8, evictBelow: 0.05 });

  for (const field of [dense, keeping, evicting]) field.set("home", 1, 1, 0.09);
  // One halving leaves 0.045, under the threshold but comfortably non-zero.
  for (const field of [dense, keeping, evicting]) field.decay(0.5);

  assert.ok(dense.get("home", 1, 1) > 0);
  assert.equal(
    keeping.get("home", 1, 1), dense.get("home", 1, 1),
    "with eviction off the two backings hold the same number",
  );
  assert.equal(evicting.get("home", 1, 1), 0, "the evicting backing dropped the chunk");
  assert.deepEqual(evicting.drainEvicted(), ["0,0"]);
});
