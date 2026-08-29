import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_FOOD_SPAWN,
  isSpawnTick,
  planFoodSpawn,
  SiteMemory,
  type FoodSpawnConfig,
  type SpawnWorld,
} from "../../shared/food-spawn";

const CONFIG: FoodSpawnConfig = {
  ...DEFAULT_FOOD_SPAWN,
  capacityUnits: 1_000,
  maxSourcesPerAttempt: 1,
  minUnits: 100,
  maxUnits: 100,
  clusterChance: 0,
  placementAttempts: 8,
};

/** A generator returning a fixed cycle, so placement choices are predictable. */
function cycle(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}

function world(overrides: Partial<SpawnWorld> = {}): SpawnWorld {
  return {
    standingUnits: 0,
    region: { minX: 0, minY: 0, maxX: 9, maxY: 9 },
    memory: [],
    canPlaceAt: () => true,
    ...overrides,
  };
}

test("spawn attempts happen on the configured interval only", () => {
  const config = { ...CONFIG, intervalTicks: 100 };

  assert.equal(isSpawnTick(0, config), false, "tick zero is not a spawn");
  assert.equal(isSpawnTick(99, config), false);
  assert.equal(isSpawnTick(100, config), true);
  assert.equal(isSpawnTick(250, config), false);
  assert.equal(isSpawnTick(300, config), true);
  assert.equal(isSpawnTick(100, { ...config, intervalTicks: 0 }), false, "disabled");
});

test("nothing spawns once the world is at carrying capacity", () => {
  const atCapacity = planFoodSpawn(world({ standingUnits: 1_000 }), CONFIG, cycle([0.5]));
  assert.deepEqual(atCapacity, []);

  const nearlyFull = planFoodSpawn(world({ standingUnits: 950 }), CONFIG, cycle([0.5]));
  assert.deepEqual(nearlyFull, [], "headroom below one minimum source spawns nothing");

  const roomForOne = planFoodSpawn(world({ standingUnits: 880 }), CONFIG, cycle([0.5]));
  assert.equal(roomForOne.length, 1);
});

test("a planned batch never exceeds remaining headroom", () => {
  const config = { ...CONFIG, maxSourcesPerAttempt: 5, minUnits: 100, maxUnits: 300 };
  const random = cycle([0.9, 0.4, 0.1, 0.7, 0.25, 0.6, 0.33, 0.8]);

  const planned = planFoodSpawn(world({ standingUnits: 600 }), config, random);
  const total = planned.reduce((sum, source) => sum + source.units, 0);

  assert.ok(planned.length > 0, "expected some food");
  assert.ok(total <= 400, `planned ${total} units into 400 of headroom`);
});

test("sources land inside the region and never on the same cell twice", () => {
  const config = { ...CONFIG, maxSourcesPerAttempt: 6, minUnits: 10, maxUnits: 10 };
  const region = { minX: -5, minY: -5, maxX: 5, maxY: 5 };
  // The first draw sets the batch size, so it has to be high to get a batch.
  const random = cycle([0.95, 0.15, 0.3, 0.45, 0.62, 0.77, 0.91, 0.2, 0.55, 0.83]);

  const planned = planFoodSpawn(world({ region }), config, random);
  const seen = new Set<string>();

  assert.ok(planned.length > 1, "expected a multi-source batch");
  for (const source of planned) {
    assert.ok(source.x >= region.minX && source.x <= region.maxX, `x ${source.x} in region`);
    assert.ok(source.y >= region.minY && source.y <= region.maxY, `y ${source.y} in region`);
    const key = `${source.x},${source.y}`;
    assert.ok(!seen.has(key), `duplicate placement at ${key}`);
    seen.add(key);
  }
});

test("cells the world refuses are never planned on", () => {
  // Only the single cell 3,3 is placeable.
  const planned = planFoodSpawn(
    world({ canPlaceAt: (x, y) => x === 3 && y === 3 }),
    { ...CONFIG, placementAttempts: 200 },
    cycle([0.31, 0.33, 0.37, 0.3, 0.35]),
  );

  for (const source of planned) {
    assert.deepEqual({ x: source.x, y: source.y }, { x: 3, y: 3 });
  }
});

test("an unplaceable world yields no food rather than looping", () => {
  const planned = planFoodSpawn(world({ canPlaceAt: () => false }), CONFIG, cycle([0.5]));
  assert.deepEqual(planned, []);
});

test("clustering places food near remembered sites, uniform spawning does not", () => {
  const region = { minX: -50, minY: -50, maxX: 50, maxY: 50 };
  const memory = [{ x: 40, y: -40 }];
  const config = { ...CONFIG, clusterChance: 1, clusterRadius: 4, maxSourcesPerAttempt: 1 };

  // Draw sequence: cluster roll, anchor pick, then x and y offsets.
  const clustered = planFoodSpawn(
    world({ region, memory }),
    config,
    cycle([0.0, 0.0, 0.5, 0.5]),
  );

  assert.equal(clustered.length, 1);
  assert.ok(
    Math.abs(clustered[0].x - 40) <= 4 && Math.abs(clustered[0].y + 40) <= 4,
    `clustered source ${clustered[0].x},${clustered[0].y} should sit within 4 of the anchor`,
  );

  // With clustering off the same world spawns from the region at large, not
  // beside the remembered site.
  const uniform = planFoodSpawn(
    world({ region, memory }),
    { ...config, clusterChance: 0 },
    cycle([0.5, 0.5, 0.5]),
  );
  assert.equal(uniform.length, 1);
  assert.ok(
    Math.abs(uniform[0].x - 40) > 4 || Math.abs(uniform[0].y + 40) > 4,
    "uniform spawning should not be pinned to the remembered site",
  );
});

test("clustered spawning still refuses sites outside the region", () => {
  const region = { minX: 0, minY: 0, maxX: 4, maxY: 4 };
  // Anchor sits at the region's corner, so most offsets fall outside it.
  const planned = planFoodSpawn(
    world({ region, memory: [{ x: 0, y: 0 }] }),
    { ...CONFIG, clusterChance: 1, clusterRadius: 10, placementAttempts: 60 },
    cycle([0.0, 0.0, 0.55, 0.55, 0.48, 0.52]),
  );

  for (const source of planned) {
    assert.ok(source.x >= 0 && source.x <= 4, `x ${source.x} clamped to region`);
    assert.ok(source.y >= 0 && source.y <= 4, `y ${source.y} clamped to region`);
  }
});

test("site memory keeps the newest entries and refreshes repeats", () => {
  const memory = new SiteMemory(3);
  memory.remember(1, 1);
  memory.remember(2, 2);
  memory.remember(3, 3);
  memory.remember(4, 4);

  assert.deepEqual(memory.entries, [{ x: 2, y: 2 }, { x: 3, y: 3 }, { x: 4, y: 4 }], "oldest evicted");

  memory.remember(2, 2);
  assert.deepEqual(
    memory.entries,
    [{ x: 3, y: 3 }, { x: 4, y: 4 }, { x: 2, y: 2 }],
    "re-remembering moves a site to newest without duplicating it",
  );
});
