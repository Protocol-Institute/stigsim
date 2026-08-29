import assert from "node:assert/strict";
import test from "node:test";
import { Terrain, TerrainLayer, TERRAIN, TERRAIN_BRUSHES } from "./terrain";
import { DEFAULT_PARAMS, Simulation } from "./simulation";
import { COLS, ROWS } from "./constants";

test("an unpainted layer is plain everywhere and reports itself empty", () => {
  const layer = new TerrainLayer(8, 8);

  assert.equal(layer.isEmpty, true);
  assert.equal(layer.at(0, 0), Terrain.Plain);
  assert.equal(layer.at(7, 7), Terrain.Plain);
  assert.equal(layer.props(3, 3).speed, 1, "plain ground changes nothing");
  assert.equal(layer.props(3, 3).evap, 1);
  assert.equal(layer.props(3, 3).adhesion, 1);
});

test("cells outside the layer read as plain rather than throwing", () => {
  const layer = new TerrainLayer(4, 4);

  assert.equal(layer.at(-1, 0), Terrain.Plain);
  assert.equal(layer.at(0, -1), Terrain.Plain);
  assert.equal(layer.at(4, 0), Terrain.Plain);
  assert.equal(layer.at(0, 4), Terrain.Plain);
  layer.set(99, 99, Terrain.Mire);
  assert.equal(layer.isEmpty, true, "an out-of-bounds paint is dropped");
});

test("painting and clearing round-trip", () => {
  const layer = new TerrainLayer(8, 8);

  layer.set(2, 3, Terrain.Mire);
  assert.equal(layer.at(2, 3), Terrain.Mire);
  assert.equal(layer.isEmpty, false);
  assert.equal(layer.props(2, 3).name, "Mire");

  layer.clear();
  assert.equal(layer.at(2, 3), Terrain.Plain);
  assert.equal(layer.isEmpty, true);
});

test("every brush has properties and a distinct fill", () => {
  const fills = new Set<string>();
  for (const brush of TERRAIN_BRUSHES) {
    const props = TERRAIN[brush];
    assert.ok(props, `${brush} has properties`);
    assert.ok(props.speed > 0, `${props.name} is crossable`);
    assert.ok(props.evap > 0, `${props.name} has a decay rate`);
    assert.ok(props.adhesion >= 0 && props.adhesion <= 1, `${props.name} adhesion in range`);
    assert.ok(props.blurb.length > 0, `${props.name} explains itself`);
    fills.add(props.fill);
  }
  assert.equal(fills.size, TERRAIN_BRUSHES.length, "each surface looks different");
});

test("exactly one surface is fertile, and it is loam", () => {
  const fertile = TERRAIN_BRUSHES.filter(t => TERRAIN[t].fertile);
  assert.deepEqual(fertile, [Terrain.Loam]);
});

function plainSim(seed = "terrain"): Simulation {
  return new Simulation(10, { ...DEFAULT_PARAMS }, 0.1, 1, 1, 500, seed);
}

/** Total pheromone across a colony's home field. */
function homeTotal(sim: Simulation): number {
  return sim.colonies[0].homePhero.reduce((a, b) => a + b, 0);
}

test("a world with no terrain painted behaves exactly as before", () => {
  const bare = plainSim("identical");
  const painted = plainSim("identical");
  painted.paintTerrain(0, 0, Terrain.Plain); // a no-op paint

  for (let i = 0; i < 300; i++) { bare.step(); painted.step(); }

  assert.equal(painted.terrain.isEmpty, true, "painting plain leaves it empty");
  assert.equal(homeTotal(painted), homeTotal(bare), "and the run is identical");
});

test("hardpan holds pheromone longer than sand", () => {
  const build = (surface: Terrain) => {
    const sim = plainSim("decay");
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) sim.paintTerrain(x, y, surface);
    }
    return sim;
  };

  const hardpan = build(Terrain.Hardpan);
  const sand = build(Terrain.Sand);
  for (let i = 0; i < 400; i++) { hardpan.step(); sand.step(); }

  assert.ok(
    homeTotal(hardpan) > homeTotal(sand),
    `hardpan ${homeTotal(hardpan).toFixed(0)} should exceed sand ${homeTotal(sand).toFixed(0)}`,
  );
});

test("mire refuses to hold a trail", () => {
  const sim = plainSim("mire");
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) sim.paintTerrain(x, y, Terrain.Mire);
  }
  for (let i = 0; i < 400; i++) sim.step();

  const plain = plainSim("mire");
  for (let i = 0; i < 400; i++) plain.step();

  assert.ok(
    homeTotal(sim) < homeTotal(plain) * 0.1,
    `mire held ${homeTotal(sim).toFixed(1)} against plain ${homeTotal(plain).toFixed(1)}`,
  );
});

test("painting terrain invalidates the decay cache", () => {
  const sim = plainSim("cache");
  for (let i = 0; i < 50; i++) sim.step();
  const before = sim.terrainVersion;

  sim.paintTerrain(5, 5, Terrain.Sand);
  assert.equal(sim.terrainVersion, before + 1);

  sim.paintTerrain(5, 5, Terrain.Sand);
  assert.equal(sim.terrainVersion, before + 1, "repainting the same surface is a no-op");
});

test("food grows only on loam once any has been painted", () => {
  const sim = new Simulation(
    10, { ...DEFAULT_PARAMS, replenish: true }, 0.1, 1, 1, 500, "loam",
  );
  assert.equal(sim.hasLoam, false);

  // Paint a small loam patch on open floor.
  const patch: [number, number][] = [];
  for (let y = 1; y < ROWS - 1 && patch.length < 6; y++) {
    for (let x = 1; x < COLS - 1 && patch.length < 6; x++) {
      if (sim.isOpen(x, y)) patch.push([x, y]);
    }
  }
  for (const [x, y] of patch) sim.paintTerrain(x, y, Terrain.Loam);
  assert.equal(sim.hasLoam, true);

  // Drain the larder so growth has headroom, then run.
  for (const source of sim.foodSources) source.remaining = 0;
  for (let i = 0; i < 2000; i++) sim.step();

  const grown = sim.foodSources.filter(s => s.remaining > 0);
  assert.ok(grown.length > 0, "expected food to grow");
  for (const source of grown) {
    assert.equal(
      sim.terrain.at(source.x, source.y), Terrain.Loam,
      `food grew at ${source.x},${source.y} which is not loam`,
    );
  }
});

test("the layer covers the maze", () => {
  const sim = plainSim();
  assert.equal(sim.terrain.cols, COLS);
  assert.equal(sim.terrain.rows, ROWS);
});
