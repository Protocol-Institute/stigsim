import { FOOD_BOUNDARY_SCALE, FOOD_MIN_SEPARATION } from "./constants";
import type { Rng } from "./rng";

/**
 * Food placement for the mirrored layout.
 *
 * Sources are placed in 180-degree rotated pairs so both colonies see the
 * same map. Within that rule:
 *
 * - an odd count puts one source on the centre cell, which is its own image;
 * - a count above two spends its first pair on a "safe" pair, one source
 *   near each nest, weighted toward the shortest path distance from the
 *   nearer nest;
 * - every other pair is "contested", weighted toward cells about as far by
 *   path from one nest as from the other, which in a maze means the
 *   crossings between the two halves;
 * - no two sources sit within FOOD_MIN_SEPARATION of each other.
 *
 * Distances are path distances through the maze, not straight-line, since a
 * cell near the geometric centre can be a long walk from one nest. With
 * fewer than two distance fields (a one-colony run) every weight is 1.
 */
export interface MirroredFoodInput {
  cols: number;
  rows: number;
  /** Cells food may occupy, in a fixed order. Assumed closed under rotation. */
  eligible: readonly (readonly [number, number])[];
  /** Path distance from nest 0 and from nest 1, indexed y * cols + x, -1 if unreachable. */
  distances: readonly Int32Array[];
  count: number;
  rng: Rng;
}

/**
 * A Gaussian falloff in units of FOOD_BOUNDARY_SCALE. The tail matters: with
 * a heavier tail the many cells that are moderately far outvote the few that
 * are close, and the pick drifts away from where it was meant to land.
 */
function falloff(offset: number): number {
  const off = offset / FOOD_BOUNDARY_SCALE;
  return Math.exp(-off * off);
}

/** Weight of a cell for a contested source: 1 on the equidistant set, falling off with |d0 - d1|. */
export function contestedWeight(d0: number, d1: number): number {
  return falloff(Math.abs(d0 - d1));
}

/** Weight of a cell for a safe source: 1 at the shortest available distance from its own nest, falling off beyond it. */
export function safeWeight(nearest: number, shortest: number): number {
  return falloff(nearest - shortest);
}

/** One draw, one index: roulette over the weights. */
function weightedIndex(weights: number[], rng: Rng): number {
  let total = 0;
  for (const w of weights) total += w;
  let u = rng() * total;
  for (let i = 0; i < weights.length; i++) {
    u -= weights[i];
    if (u <= 0) return i;
  }
  return weights.length - 1;
}

export function pickMirroredFood({ cols, rows, eligible, distances, count, rng }: MirroredFoodInput): [number, number][] {
  const key = (x: number, y: number) => y * cols + x;
  const image = (x: number, y: number): [number, number] => [cols - 1 - x, rows - 1 - y];
  const eligibleKeys = new Set(eligible.map(([x, y]) => key(x, y)));
  const twoNests = distances.length >= 2;
  const dist = (i: number, x: number, y: number) => distances[i][key(x, y)];

  // One representative per rotated pair: the member with the smaller key,
  // kept only when both members are eligible and reachable from both nests.
  let pairs: [number, number][] = eligible
    .filter(([x, y]) => {
      const [mx, my] = image(x, y);
      if (key(x, y) >= key(mx, my) || !eligibleKeys.has(key(mx, my))) return false;
      return !twoNests || (dist(0, x, y) >= 0 && dist(1, x, y) >= 0);
    })
    .map(([x, y]) => [x, y]);

  const picked: [number, number][] = [];
  const near = (a: readonly [number, number], b: readonly [number, number]) =>
    Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) < FOOD_MIN_SEPARATION;
  // The picked set is closed under rotation, so a representative that is far
  // from every picked cell has an image that is too.
  const prune = () => { pairs = pairs.filter(p => !picked.some(q => near(p, q))); };
  const takePair = (p: [number, number]) => {
    picked.push(p, image(p[0], p[1]));
    prune();
  };

  let remaining = count;
  if (remaining % 2 === 1) {
    const cx = (cols - 1) / 2, cy = (rows - 1) / 2;
    if (Number.isInteger(cx) && Number.isInteger(cy) && eligibleKeys.has(key(cx, cy))) {
      picked.push([cx, cy]);
      prune();
    }
    // An odd source with no centre to sit on has no image, so it is dropped
    // rather than placed asymmetrically.
    remaining -= 1;
  }

  if (count > 2 && remaining >= 2 && pairs.length) {
    // Each pair's "nearest" is the distance from whichever nest is closer to
    // the representative, which by symmetry is the other member's distance
    // from the other nest.
    const nearest = pairs.map(([x, y]) => twoNests ? Math.min(dist(0, x, y), dist(1, x, y)) : 0);
    const shortest = Math.min(...nearest);
    const weights = nearest.map(n => safeWeight(n, shortest));
    takePair(pairs[weightedIndex(weights, rng)]);
    remaining -= 2;
  }

  while (remaining >= 2 && pairs.length) {
    const weights = pairs.map(([x, y]) => twoNests ? contestedWeight(dist(0, x, y), dist(1, x, y)) : 1);
    takePair(pairs[weightedIndex(weights, rng)]);
    remaining -= 2;
  }

  return picked;
}
