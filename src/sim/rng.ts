// ─────────────────────────────────────────────────────────────────────────────
// Deterministic pseudo-random number generation for the simulator.
//
// Every stochastic decision in the model — maze carving, food placement, and
// each ant's choice of where to step next — draws from one seeded stream. Two
// runs with the same seed and the same parameters are identical, which is what
// makes a parameter change legible: any difference between two runs is then the
// parameter, not the dice.
//
// View-level randomness (which ant the camera follows, for instance) must NOT
// draw from this stream. Consuming a value for a presentation decision would
// shift every subsequent model draw, so the choice of camera target would
// silently alter the simulation it is observing.
// ─────────────────────────────────────────────────────────────────────────────

/** Mix a seed string into a 32-bit integer using FNV-1a. */
export function hashSeed(seed: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * A small, fast, well-distributed generator (mulberry32). Chosen over an
 * LCG because low-order bits matter here: `chance()` and `pick()` are called
 * several times per ant per step, and an LCG's weak low bits show up as
 * visible directional bias in the trails.
 */
export class Rng {
  private state: number;

  constructor(seed: number | string) {
    this.state = (typeof seed === "string" ? hashSeed(seed) : seed >>> 0) || 1;
  }

  /** Uniform in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform integer in [0, maxExclusive). Returns 0 for an empty range. */
  int(maxExclusive: number): number {
    return maxExclusive <= 0 ? 0 : Math.floor(this.next() * maxExclusive);
  }

  /** Uniform in [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** True with probability `p`. */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /** A uniformly chosen element. Callers must not pass an empty array. */
  pick<T>(items: readonly T[]): T {
    return items[this.int(items.length)];
  }

  /** Unbiased in-place Fisher-Yates shuffle. Returns the same array. */
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
  }
}

/**
 * A short, typable seed for a fresh run.
 *
 * This is the one place `Math.random` is correct: choosing which deterministic
 * stream to enter is not itself part of the model.
 */
export function randomSeed(): string {
  return Math.random().toString(36).slice(2, 8);
}
