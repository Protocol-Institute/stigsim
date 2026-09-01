import type { RunSeeds } from "./types";

export type Rng = {
  (): number;
  /**
   * How many values have been drawn. Fingerprints mix this in, so a replay
   * that draws a different number of times is caught at the next checkpoint
   * even when the extra draws have not yet changed anything visible.
   */
  draws: number;
};

/** Small Fast Counter, 32-bit. Shifts, xor, and wrapping addition only. */
export function sfc32(a: number, b: number, c: number, d: number): Rng {
  const next = function (): number {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    next.draws++;
    return (t >>> 0) / 4294967296;
  } as Rng;
  next.draws = 0;
  return next;
}

/** Hashes a string into four 32-bit words suitable for seeding sfc32. */
export function cyrb128(str: string): [number, number, number, number] {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  return [
    (h1 ^ h2 ^ h3 ^ h4) >>> 0,
    (h2 ^ h1) >>> 0,
    (h3 ^ h1) >>> 0,
    (h4 ^ h1) >>> 0,
  ];
}

export function makeRng(seed: string): Rng {
  const [a, b, c, d] = cyrb128(seed);
  const rng = sfc32(a, b, c, d);
  // Discard the first draws so poorly-distributed seeds settle.
  for (let i = 0; i < 12; i++) rng();
  rng.draws = 0;
  return rng;
}

export function deriveStreamSeed(master: string, stream: string): string {
  const [a] = cyrb128(`${master}:${stream}`);
  return a.toString(16).padStart(8, "0");
}

export function makeSeeds(master: string): RunSeeds {
  return {
    master,
    maze: deriveStreamSeed(master, "maze"),
    food: deriveStreamSeed(master, "food"),
    ants: deriveStreamSeed(master, "ants"),
  };
}

const SEED_ADJECTIVES = [
  "quiet", "amber", "hollow", "brisk", "solar", "tidal", "gilded", "narrow",
  "velvet", "cobalt", "rustic", "candid", "lucid", "muted", "stark", "keen",
];

const SEED_NOUNS = [
  "ember", "lattice", "harbor", "cinder", "meadow", "quarry", "bastion", "thicket",
  "current", "vellum", "compass", "beacon", "cistern", "ridge", "furrow", "anvil",
];

/**
 * A short, typeable, shareable seed. Uses Math.random because the value is
 * captured in the trace rather than regenerated from anything.
 */
export function generateMasterSeed(): string {
  const adjective = SEED_ADJECTIVES[Math.floor(Math.random() * SEED_ADJECTIVES.length)];
  const noun = SEED_NOUNS[Math.floor(Math.random() * SEED_NOUNS.length)];
  const number = Math.floor(Math.random() * 9000) + 1000;
  return `${adjective}-${noun}-${number}`;
}

export function shuffleInPlace<T>(arr: T[], rng: Rng): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

/** True for exponents deterministicPow can compute: the multiples of a half. */
export function isHalfStep(v: number): boolean {
  return Number.isFinite(v) && Number.isInteger(v * 2);
}

/**
 * Exponentiation without Math.pow, whose precision the ECMAScript
 * specification leaves implementation-defined. Multiplication, division, and
 * square root are all exactly specified by IEEE-754, so this returns the same
 * bits on every conforming engine.
 *
 * The domain is the multiples of a half, which is what the trail-bias slider
 * produces. Anything else throws rather than returning a plausible-looking
 * wrong answer: there is no engine-safe way to raise a number to 2.3, and a
 * silent approximation would be indistinguishable from a correct run while
 * changing how the ants behave. Callers taking an exponent from outside the
 * program must screen it with isHalfStep first; the trace loader does.
 */
export function deterministicPow(base: number, power: number): number {
  if (!isHalfStep(power)) {
    throw new RangeError(`deterministicPow needs a multiple of 0.5, got ${power}`);
  }
  let n = Math.abs(power);
  const half = !Number.isInteger(n);
  n = Math.floor(n);

  // Exponentiation by squaring. Repeated multiplication would be O(n), which
  // a large exponent from a trace file could turn into an unrecoverable stall.
  let r = 1;
  let b = base;
  while (n > 0) {
    if (n % 2 === 1) r *= b;
    n = Math.floor(n / 2);
    if (n > 0) b *= b;
  }
  if (half) r *= Math.sqrt(base);
  return power < 0 ? 1 / r : r;
}
