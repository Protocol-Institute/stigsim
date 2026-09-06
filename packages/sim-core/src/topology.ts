export type ReadMode = "private" | "shared" | "separable";

/**
 * How colonies' layers are read and written across colony lines. Nothing in
 * the doctrine depends on this; the origin and target axes are simply inert
 * under the options that do not use them.
 */
export interface Topology {
  read: ReadMode;
  /** May spoilers' mimic deposits reach the other colony's chemical? */
  mimicEnemy: boolean;
  /** Which channels cross colony lines at all. An invisible channel is private under every read mode. */
  visible: { home: boolean; food: boolean };
  /** Match rule, [0, 1]; the engine clamps mimic deposits to min(doctrine.mimicRate, this). */
  maxMimicRate: number;
  /** Keep a spoiler-colony -> target sublayer for spectators and metrics. Ants never read it. */
  provenance: boolean;
}

export const READ_MODES: readonly ReadMode[] = ["private", "shared", "separable"];

function frozen(t: Topology): Topology {
  Object.freeze(t.visible);
  return Object.freeze(t);
}

/** Option 1: colonies interact only through food and walls. What the Infinite server keeps. */
export const TOPOLOGY_PRIVATE: Topology = frozen({
  read: "private", mimicEnemy: false, visible: { home: false, food: false }, maxMimicRate: 1, provenance: false,
});
/** Option 2: read-only sensing of the opponent's trails. */
export const TOPOLOGY_SENSING: Topology = frozen({
  read: "separable", mimicEnemy: false, visible: { home: true, food: true }, maxMimicRate: 1, provenance: false,
});
/** Option 3: separable with mimicry. The spec's recommendation. */
export const TOPOLOGY_MIMICRY: Topology = frozen({
  read: "separable", mimicEnemy: true, visible: { home: true, food: true }, maxMimicRate: 0.5, provenance: true,
});
/** Option 4: one summed food field, home private. */
export const TOPOLOGY_OPEN: Topology = frozen({
  read: "shared", mimicEnemy: true, visible: { home: false, food: true }, maxMimicRate: 0.5, provenance: false,
});

export const DEFAULT_TOPOLOGY: Topology = TOPOLOGY_PRIVATE;

/**
 * What the engine implements today. A trace must never be able to claim a
 * read mode the engine does not run, so the validator is widened in the same
 * change that lands the cross-colony read.
 */
const IMPLEMENTED: { reads: readonly ReadMode[]; mimic: readonly boolean[] } = {
  reads: ["private"],
  mimic: [false],
};

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isBool = (v: unknown): v is boolean => typeof v === "boolean";
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

function hasExactKeys(v: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(v);
  return own.length === keys.length && keys.every(k => Object.hasOwn(v, k));
}

export function isTopology(v: unknown): v is Topology {
  if (!isObj(v) || !hasExactKeys(v, ["read", "mimicEnemy", "visible", "maxMimicRate", "provenance"])) return false;
  if (!IMPLEMENTED.reads.includes(v.read as ReadMode)) return false;
  if (!isBool(v.mimicEnemy) || !IMPLEMENTED.mimic.includes(v.mimicEnemy)) return false;
  const vis = v.visible;
  if (!isObj(vis) || !hasExactKeys(vis, ["home", "food"]) || !isBool(vis.home) || !isBool(vis.food)) return false;
  if (!isNum(v.maxMimicRate) || v.maxMimicRate < 0 || v.maxMimicRate > 1) return false;
  return isBool(v.provenance);
}

export function cloneTopology(t: Topology): Topology {
  return { ...t, visible: { ...t.visible } };
}
