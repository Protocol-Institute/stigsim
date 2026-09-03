import assert from "node:assert/strict";
import test from "node:test";
import { ChunkedField } from "./chunked-field";

test("reads empty space as zero without allocating a chunk", () => {
  const field = new ChunkedField();

  assert.equal(field.get("home", 5, 5), 0);
  assert.equal(field.get("home", -900, 4000), 0);
  assert.equal(field.size, 0, "reading must not grow the map");

  field.add("home", 5, 5, 1);
  assert.equal(field.size, 1);
});

test("round-trips values across chunk boundaries and into negative space", () => {
  const field = new ChunkedField({ chunkSize: 8 });

  // One cell in each of four chunks, including negative coordinates, where a
  // naive modulo would fold -1 onto index 0 of the wrong chunk.
  const cells: [number, number][] = [[0, 0], [7, 7], [8, 8], [-1, -1]];
  cells.forEach(([x, y], i) => field.set("food", x, y, (i + 1) * 10));

  cells.forEach(([x, y], i) => assert.equal(field.get("food", x, y), (i + 1) * 10));
  assert.equal(field.size, 3, "(0,0) and (7,7) share a chunk; (8,8) and (-1,-1) do not");
});

test("channels within a cell are independent", () => {
  const field = new ChunkedField();

  field.set("home", 2, 3, 1);
  field.set("food", 2, 3, 2);
  field.set("caut", 2, 3, 3);

  assert.equal(field.get("home", 2, 3), 1);
  assert.equal(field.get("food", 2, 3), 2);
  assert.equal(field.get("caut", 2, 3), 3);
});

test("add accumulates and max raises but never lowers", () => {
  const field = new ChunkedField();

  field.add("food", 1, 1, 5);
  field.add("food", 1, 1, 5);
  assert.equal(field.get("food", 1, 1), 10);

  field.max("food", 1, 1, 4);
  assert.equal(field.get("food", 1, 1), 10);

  field.max("food", 1, 1, 25);
  assert.equal(field.get("food", 1, 1), 25);
});

test("decay drops a spent chunk and reports its key once", () => {
  const field = new ChunkedField({ chunkSize: 8 });
  field.set("home", 100, 100, 10);
  assert.equal(field.size, 1);

  field.decay(0);

  assert.equal(field.size, 0, "the chunk is gone before anyone can read it");
  assert.equal(field.get("home", 100, 100), 0);

  // chunkCoord(100) is 12 at a chunk size of 8.
  assert.deepEqual(field.drainEvicted(), ["12,12"]);
  assert.deepEqual(field.drainEvicted(), [], "a drain empties the list");
});

test("a chunk survives while home or food stays above the threshold", () => {
  const field = new ChunkedField({ evictBelow: 0.05 });
  field.set("home", 1, 1, 1);

  field.decay(0.1); // 1 -> 0.1, still above 0.05
  assert.equal(field.size, 1);
  assert.deepEqual(field.drainEvicted(), []);

  field.decay(0.1); // 0.1 -> 0.01, below
  assert.equal(field.size, 0);
  assert.equal(field.drainEvicted().length, 1);
});

test("a chunk holding only caution pheromone is dropped", () => {
  // Deliberate, and inherited from the Infinite Mode server: caution never
  // keeps a chunk resident. It is a local deterrent that ants regenerate from
  // traffic, so paying to keep empty-but-cautious space alive is not worth it.
  const field = new ChunkedField();
  field.set("caut", 4, 4, 1000);

  field.decay(1); // no decay at all — the value is still 1000

  assert.equal(field.size, 0);
  assert.equal(field.drainEvicted().length, 1);
});

test("eviction can be switched off entirely", () => {
  const field = new ChunkedField({ evictBelow: 0 });
  field.set("home", 1, 1, 1);

  field.decay(0);

  assert.equal(field.size, 1, "nothing is dropped when the threshold is zero");
  assert.deepEqual(field.drainEvicted(), []);
  assert.equal(field.get("home", 1, 1), 0);
});

test("evictChannels decides what keeps a chunk alive", () => {
  const field = new ChunkedField({ evictChannels: ["caut"] });
  field.set("caut", 4, 4, 1000);
  field.set("home", 60, 60, 1000);

  field.decay(1);

  assert.equal(field.size, 1, "the caution chunk lives, the home chunk does not");
  assert.equal(field.get("caut", 4, 4), 1000);
  assert.equal(field.get("home", 60, 60), 0);
});

test("layers walk every live chunk in sorted key order", () => {
  const field = new ChunkedField({ chunkSize: 8 });
  field.set("home", 80, 0, 1); // chunk 10,0
  field.set("home", 0, 0, 2);  // chunk 0,0

  const layers = field.layers();
  assert.equal(layers.length, 6, "three channels per live chunk");

  // "0,0" sorts before "10,0", so its home layer comes first.
  assert.equal(layers[0][0], 2);
  assert.equal(layers[3][0], 1);
});
