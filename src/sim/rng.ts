import type { RunSeeds } from "./types";

export type Rng = () => number;

/** Small Fast Counter, 32-bit. Shifts, xor, and wrapping addition only. */
export function sfc32(a: number, b: number, c: number, d: number): Rng {
  return function next(): number {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
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

/**
 * Exponentiation without Math.pow, whose precision the ECMAScript
 * specification leaves implementation-defined. Multiplication and square root
 * are both exactly specified by IEEE-754, and the trail-bias slider steps in
 * halves, so every exponent it can produce is reachable this way.
 */
export function deterministicPow(base: number, power: number): number {
  const whole = Math.floor(power);
  let r = 1;
  for (let i = 0; i < whole; i++) r *= base;
  return power === whole ? r : r * Math.sqrt(base);
}
