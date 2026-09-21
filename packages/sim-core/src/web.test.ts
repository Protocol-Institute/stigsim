import assert from "node:assert/strict";
import test from "node:test";
import { buildWeb, orbWeaver, pseudoAngle, orderAround, alongPerimeter } from "./web";
import type { Point } from "./web";
import { makeRng } from "./rng";
import { COLONY_NESTS, COLS, ROWS } from "./constants";

const nestAnchors = (): Point[] =>
  COLONY_NESTS.map(([x, y]) => ({ x: x / (COLS - 1), y: y / (ROWS - 1) }));

test("pseudoAngle increases with the true angle without using any", () => {
  // Points walked anticlockwise from due east. Only the order matters, so the
  // test is that the sequence is monotonic, not what the values are.
  const ring: [number, number][] = [
    [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1],
  ];
  const values = ring.map(([dx, dy]) => pseudoAngle(dx, dy));
  for (let i = 1; i < values.length; i++) {
    assert.ok(values[i] > values[i - 1], `not monotonic at ${i}: ${values[i - 1]} then ${values[i]}`);
  }
  assert.equal(pseudoAngle(0, 0), 0, "a zero vector has no angle to report");
});

test("orderAround puts anchors in cyclic order so the frame is a simple polygon", () => {
  const centre = { x: 0.5, y: 0.5 };
  const corners: Point[] = [
    { x: 0, y: 0 }, { x: 1, y: 1 }, { x: 1, y: 0 }, { x: 0, y: 1 },
  ];
  const ordered = orderAround(corners, centre);
  assert.equal(ordered.length, 4);

  // Consecutive corners of a unit square are one side apart; opposite corners
  // are a diagonal apart. A correct cyclic order never puts a diagonal pair
  // next to each other.
  for (let i = 0; i < 4; i++) {
    const a = ordered[i];
    const b = ordered[(i + 1) % 4];
    const d = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
    assert.equal(d, 1, `${JSON.stringify(a)} and ${JSON.stringify(b)} are not adjacent corners`);
  }
});

test("alongPerimeter walks the frame by arc length and wraps", () => {
  const square: Point[] = [
    { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 },
  ];
  assert.deepEqual(alongPerimeter(square, 0), { x: 0, y: 0 });
  assert.deepEqual(alongPerimeter(square, 0.25), { x: 1, y: 0 });
  assert.deepEqual(alongPerimeter(square, 0.5), { x: 1, y: 1 });
  // t wraps, so a radius index past the end continues round rather than
  // clamping every later radius onto the same corner.
  assert.deepEqual(alongPerimeter(square, 1.25), alongPerimeter(square, 0.25));

  const degenerate: Point[] = [{ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }];
  assert.deepEqual(alongPerimeter(degenerate, 0.4), { x: 0.5, y: 0.5 });
});

test("the orb-weaver needs at least three anchors", () => {
  assert.throws(
    () => buildWeb(makeRng("orb"), [{ x: 0, y: 0 }, { x: 1, y: 1 }]),
    RangeError,
  );
});

test("the first strand is the bridge, the only one not already on the web", () => {
  const plan = buildWeb(makeRng("orb"), nestAnchors());
  assert.equal(plan.strands[0].kind, "bridge");
  assert.equal(plan.strands[0].from, plan.anchors[0]);
  assert.equal(plan.strands[0].to, plan.anchors[1]);
  // The drop hangs off the bridge and its landing point is the hub.
  assert.equal(plan.strands[1].span, "sag");
  assert.deepEqual(plan.strands[1].to, plan.hub);
});

test("the orb-weaver leaves its radii dry and its capture spiral sticky", () => {
  const plan = buildWeb(makeRng("orb"), nestAnchors(), { radii: 8, turns: 3 });
  const radii = plan.strands.filter(s => s.kind === "radius");
  const capture = plan.strands.filter(s => s.kind === "capture");

  assert.equal(radii.length, 8);
  assert.ok(capture.length > 0);
  assert.ok(radii.every(s => !s.sticky), "a radius came out sticky");
  assert.ok(capture.every(s => s.sticky), "a capture strand came out dry");
  // Stickiness is a strand property, so nothing else should be asserting it.
  assert.ok(plan.strands.filter(s => s.kind === "frame").every(s => !s.sticky));
});

test("loopRate decides how much scaffolding survives", () => {
  const none = buildWeb(makeRng("orb"), nestAnchors(), { radii: 8, turns: 4, loopRate: 0 });
  const all = buildWeb(makeRng("orb"), nestAnchors(), { radii: 8, turns: 4, loopRate: 1 });

  const aux = (p: typeof none) => p.strands.filter(s => s.kind === "auxiliary").length;
  assert.equal(aux(none), 0, "a finished web keeps no scaffolding");
  assert.ok(aux(all) > 0, "a fully scaffolded web kept none either");
  assert.ok(all.strands.length > none.strands.length);
});

test("options are clamped rather than trusted", () => {
  const plan = buildWeb(makeRng("orb"), nestAnchors(), { radii: 1, turns: 0, loopRate: 5 });
  assert.ok(plan.strands.filter(s => s.kind === "radius").length >= 3);
  assert.ok(plan.strands.some(s => s.kind === "capture"));
});

test("construction steps are numbered in order", () => {
  const plan = buildWeb(makeRng("orb"), nestAnchors(), { radii: 6, turns: 2 });
  plan.strands.forEach((s, i) => assert.equal(s.step, i, `strand ${i} is stamped ${s.step}`));
});

test("the same seed builds the same web", () => {
  const options = { radii: 7, turns: 3, loopRate: 0.5 };
  const a = buildWeb(makeRng("orb"), nestAnchors(), options);
  const b = buildWeb(makeRng("orb"), nestAnchors(), options);
  const c = buildWeb(makeRng("silk"), nestAnchors(), options);

  assert.deepEqual(a, b, "same seed, different web");
  assert.notDeepEqual(a, c, "different seeds produced the same web");
});

test("a strategy is data, so buildWeb will run someone else's", () => {
  const flat = buildWeb(makeRng("orb"), nestAnchors(), {}, (_rng, anchors) => ({
    anchors, hub: anchors[0],
    strands: [{
      kind: "bridge", from: anchors[0], to: anchors[1],
      span: "taut", sticky: true, step: 0,
    }],
  }));
  assert.equal(flat.strands.length, 1);
  assert.equal(flat.strands[0].sticky, true, "a sticky bridge is a legal web");
  assert.equal(orbWeaver(makeRng("orb"), nestAnchors()).strands.length > 1, true);
});
