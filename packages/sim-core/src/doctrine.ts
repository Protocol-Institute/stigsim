import { MAX_EVAP_RATE, MAX_TRAIL_POWER } from "./constants";
import { isHalfStep } from "./rng";
import type { AntState } from "./types";

export type Role = "forager" | "spoiler";
export type DoctrineChannel = "home" | "food";
export type Origin = "own" | "enemy";
export type AdoptionMode = "instant" | "nest";

export const ADOPTION_MODES: readonly AdoptionMode[] = ["instant", "nest"];
export const ROLES: readonly Role[] = ["forager", "spoiler"];
export const STATES: readonly AntState[] = ["searching", "returning"];
export const DOCTRINE_CHANNELS: readonly DoctrineChannel[] = ["home", "food"];
export const ORIGINS: readonly Origin[] = ["own", "enemy"];

/** Largest own-target lay gain. Multiplies DEPOSIT_RATE. */
export const MAX_LAY_GAIN = 3;

export interface LayEntry {
  /** Integer 0..MAX_LAY_GAIN, multiplying DEPOSIT_RATE. */
  own: number;
  /** 0 or 1: lay mimicRate * DEPOSIT_RATE of the opponent's chemical. Always 0 on the forager table. */
  mimic: number;
}

export interface RoleTable {
  /** Signed half-step exponent per (state, channel, origin). 0 means ignore. */
  follow: Record<AntState, Record<DoctrineChannel, Record<Origin, number>>>;
  lay: Record<AntState, Record<DoctrineChannel, LayEntry>>;
}

export interface Doctrine {
  /** Descriptor kind. A second kind can be added later without a trace format change. */
  v: 1;
  forager: RoleTable;
  spoiler: RoleTable;
  /** Fraction of the colony's ants roled as spoilers, [0, 1]. Colony-level. */
  spoilerFraction: number;
  /** Scale on mimic deposits, [0, 1]. Colony-level. */
  mimicRate: number;
  /** Decay applied to this colony's layer each tick, [0, MAX_EVAP_RATE]. Colony-level. */
  evapRate: number;
}

type FollowSpec = Partial<Record<AntState, Partial<Record<DoctrineChannel, Partial<Record<Origin, number>>>>>>;
type LaySpec = Partial<Record<AntState, Partial<Record<DoctrineChannel, Partial<LayEntry>>>>>;

/** A full role table from a sparse description; everything unspecified is zero. */
export function makeRoleTable(spec: { follow?: FollowSpec; lay?: LaySpec } = {}): RoleTable {
  const follow = {} as RoleTable["follow"];
  const lay = {} as RoleTable["lay"];
  for (const s of STATES) {
    follow[s] = {} as Record<DoctrineChannel, Record<Origin, number>>;
    lay[s] = {} as Record<DoctrineChannel, LayEntry>;
    for (const c of DOCTRINE_CHANNELS) {
      follow[s][c] = {
        own: spec.follow?.[s]?.[c]?.own ?? 0,
        enemy: spec.follow?.[s]?.[c]?.enemy ?? 0,
      };
      lay[s][c] = {
        own: spec.lay?.[s]?.[c]?.own ?? 0,
        mimic: spec.lay?.[s]?.[c]?.mimic ?? 0,
      };
    }
  }
  return { follow, lay };
}

function deepFreeze<T>(v: T): T {
  if (typeof v === "object" && v !== null) {
    for (const k of Object.keys(v)) deepFreeze((v as Record<string, unknown>)[k]);
    Object.freeze(v);
  }
  return v;
}

/**
 * Today's model as a point in the doctrine space: four nonzero atoms. The
 * spoiler table is only consulted once spoilerFraction is raised; its default
 * is an explorer that drifts toward the opponent and lays false food trail.
 */
export const DEFAULT_DOCTRINE: Doctrine = deepFreeze({
  v: 1,
  forager: makeRoleTable({
    follow: { searching: { food: { own: 5 } }, returning: { home: { own: 5 } } },
    lay: { searching: { home: { own: 1 } }, returning: { food: { own: 1 } } },
  }),
  spoiler: makeRoleTable({
    follow: { searching: { food: { own: 1 }, home: { enemy: 2 } }, returning: { home: { own: 5 } } },
    lay: { searching: { food: { mimic: 1 } }, returning: { food: { own: 1 } } },
  }),
  spoilerFraction: 0,
  mimicRate: 0,
  evapRate: 0.005,
});

/** A mutable deep copy. Doctrines hold only finite numbers, so JSON is exact. */
export function cloneDoctrine(d: Doctrine): Doctrine {
  return JSON.parse(JSON.stringify(d)) as Doctrine;
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

function hasExactKeys(v: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(v);
  return own.length === keys.length && keys.every(k => Object.hasOwn(v, k));
}

const isFollowWeight = (v: unknown): v is number =>
  isNum(v) && isHalfStep(v) && Math.abs(v) <= MAX_TRAIL_POWER;
const isLayGain = (v: unknown): v is number =>
  isNum(v) && Number.isInteger(v) && v >= 0 && v <= MAX_LAY_GAIN;
const isFlag = (v: unknown): v is number => v === 0 || v === 1;

function isRoleTable(v: unknown, mimicAllowed: boolean): v is RoleTable {
  if (!isObj(v) || !hasExactKeys(v, ["follow", "lay"])) return false;
  const { follow, lay } = v;
  if (!isObj(follow) || !hasExactKeys(follow, STATES)) return false;
  if (!isObj(lay) || !hasExactKeys(lay, STATES)) return false;
  for (const s of STATES) {
    const fRow = follow[s], lRow = lay[s];
    if (!isObj(fRow) || !hasExactKeys(fRow, DOCTRINE_CHANNELS)) return false;
    if (!isObj(lRow) || !hasExactKeys(lRow, DOCTRINE_CHANNELS)) return false;
    let rowSum = 0;
    for (const c of DOCTRINE_CHANNELS) {
      const w = fRow[c], l = lRow[c];
      if (!isObj(w) || !hasExactKeys(w, ORIGINS)) return false;
      if (!isObj(l) || !hasExactKeys(l, ["own", "mimic"])) return false;
      if (!isFollowWeight(w.own) || !isFollowWeight(w.enemy)) return false;
      rowSum += Math.abs(w.own) + Math.abs(w.enemy);
      if (!isLayGain(l.own) || !isFlag(l.mimic)) return false;
      if (!mimicAllowed && l.mimic !== 0) return false;
    }
    // The single exponent was bounded so 5000^32 stays finite; the product of
    // four factors is bounded the same way when the row's |w| sum is.
    if (rowSum > MAX_TRAIL_POWER) return false;
  }
  return true;
}

/**
 * The one predicate the command bus and the trace loader share, so the two
 * cannot drift. Exact key sets: a doctrine with an unknown field is rejected
 * rather than silently carried.
 */
export function isDoctrine(v: unknown): v is Doctrine {
  if (!isObj(v)) return false;
  if (!hasExactKeys(v, ["v", "forager", "spoiler", "spoilerFraction", "mimicRate", "evapRate"])) return false;
  return v.v === 1 &&
    isRoleTable(v.forager, false) &&
    isRoleTable(v.spoiler, true) &&
    isNum(v.spoilerFraction) && v.spoilerFraction >= 0 && v.spoilerFraction <= 1 &&
    isNum(v.mimicRate) && v.mimicRate >= 0 && v.mimicRate <= 1 &&
    isNum(v.evapRate) && v.evapRate >= 0 && v.evapRate <= MAX_EVAP_RATE;
}

/**
 * Every number in a doctrine, in one fixed order: follow entries by role,
 * state, channel, origin; then lay entries by role, state, channel as
 * (own, mimic); then the three scalars. The fingerprint hashes this.
 */
export function doctrineNumbers(d: Doctrine): number[] {
  const out: number[] = [];
  for (const r of ROLES) for (const s of STATES) for (const c of DOCTRINE_CHANNELS) for (const o of ORIGINS) {
    out.push(d[r].follow[s][c][o]);
  }
  for (const r of ROLES) for (const s of STATES) for (const c of DOCTRINE_CHANNELS) {
    out.push(d[r].lay[s][c].own, d[r].lay[s][c].mimic);
  }
  out.push(d.spoilerFraction, d.mimicRate, d.evapRate);
  return out;
}
