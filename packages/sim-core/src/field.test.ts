import assert from "node:assert/strict";
import test from "node:test";
import { DenseField } from "./field";
import type { Channel } from "./types";

const CHANNELS: Channel[] = ["home", "food", "caut"];

test("round-trips a value on every channel independently", () => {
  const field = new DenseField(8, 6);

  field.set("home", 3, 2, 10);
  field.set("food", 3, 2, 20);
  field.set("caut", 3, 2, 30);

  assert.equal(field.get("home", 3, 2), 10);
  assert.equal(field.get("food", 3, 2), 20);
  assert.equal(field.get("caut", 3, 2), 30);
  assert.equal(field.get("home", 2, 3), 0);
});

test("add accumulates and max raises but never lowers", () => {
  const field = new DenseField(8, 6);

  field.add("food", 1, 1, 5);
  field.add("food", 1, 1, 5);
  assert.equal(field.get("food", 1, 1), 10);

  field.max("food", 1, 1, 4);
  assert.equal(field.get("food", 1, 1), 10);

  field.max("food", 1, 1, 25);
  assert.equal(field.get("food", 1, 1), 25);
});

test("reads outside the grid are zero rather than a neighbouring cell", () => {
  const field = new DenseField(31, 31);

  // Without a bounds test, y * cols + x folds a negative x into the previous
  // row: (-1, 5) would be index 154, a real cell four rows up.
  field.set("home", 30, 4, 99);
  assert.equal(field.get("home", -1, 5), 0);

  assert.equal(field.get("home", 31, 0), 0);
  assert.equal(field.get("home", 0, -1), 0);
  assert.equal(field.get("home", 0, 31), 0);
});

test("writes outside the grid are dropped", () => {
  const field = new DenseField(31, 31);
  field.set("home", 30, 4, 99);

  field.add("home", -1, 5, 1000);
  field.set("home", 31, 5, 1000);
  field.max("home", 5, -1, 1000);

  // The cell a folded index would have hit is untouched.
  assert.equal(field.get("home", 30, 4), 99);
  for (const layer of field.layers()) {
    assert.equal(layer.reduce((a, b) => a + b, 0), layer === field.layer("home") ? 99 : 0);
  }
});

test("decay multiplies every channel", () => {
  const field = new DenseField(4, 4);
  for (const ch of CHANNELS) field.set(ch, 2, 2, 100);

  field.decay(0.5);

  for (const ch of CHANNELS) assert.equal(field.get(ch, 2, 2), 50);
});

test("a dense field never evicts", () => {
  const field = new DenseField(4, 4);
  assert.deepEqual(field.drainEvicted(), []);

  field.set("home", 1, 1, 100);
  field.decay(0);
  assert.deepEqual(field.drainEvicted(), []);
});

test("layers are the live arrays, in home food caut order", () => {
  const field = new DenseField(4, 4);
  const layers = field.layers();

  assert.equal(layers.length, 3);
  assert.equal(layers[0], field.layer("home"));
  assert.equal(layers[1], field.layer("food"));
  assert.equal(layers[2], field.layer("caut"));

  // Live, not copies: the fingerprint hashes these directly.
  field.set("food", 1, 1, 7);
  assert.equal(layers[1][1 * 4 + 1], 7);
});

test("stays word-for-word identical to raw Float32Arrays", () => {
  // The standing guard on the fingerprint. It reinterprets each layer as
  // Uint32Array and hashes every word, so any drift between the accessors and
  // plain indexed arithmetic would silently move every recorded hash.
  const cols = 31, rows = 31;
  const field = new DenseField(cols, rows);
  const raw: Record<Channel, Float32Array> = {
    home: new Float32Array(cols * rows),
    food: new Float32Array(cols * rows),
    caut: new Float32Array(cols * rows),
  };

  let seed = 12345;
  const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;

  for (let step = 0; step < 4000; step++) {
    const ch = CHANNELS[Math.floor(next() * 3)];
    const x = Math.floor(next() * cols);
    const y = Math.floor(next() * rows);
    const value = next() * 1000;
    const i = y * cols + x;

    switch (Math.floor(next() * 4)) {
      case 0:
        field.add(ch, x, y, value);
        raw[ch][i] += value;
        break;
      case 1:
        field.set(ch, x, y, value);
        raw[ch][i] = value;
        break;
      case 2:
        field.max(ch, x, y, value);
        if (value > raw[ch][i]) raw[ch][i] = value;
        break;
      default:
        field.decay(0.995);
        for (const c of CHANNELS) {
          for (let k = 0; k < raw[c].length; k++) raw[c][k] *= 0.995;
        }
    }
  }

  const words = (a: Float32Array) => [...new Uint32Array(a.buffer, a.byteOffset, a.length)];
  const layers = field.layers();
  assert.deepEqual(words(layers[0]), words(raw.home));
  assert.deepEqual(words(layers[1]), words(raw.food));
  assert.deepEqual(words(layers[2]), words(raw.caut));
});
