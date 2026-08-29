/**
 * Every way the user can mutate a running simulation. Commands are plain
 * serializable data applied at a tick boundary, so a recorded run and a live
 * run follow the same code path.
 */
import {
  MAX_ANTS_PER_COLONY, MAX_EVAP_RATE, MAX_FOOD_AMOUNT, MAX_TANK, MAX_TRAIL_POWER,
} from "./constants";
import { isHalfStep } from "./rng";
import type { SimParams } from "./types";

export type NumericParamKey = "evapRate" | "trailPower" | "tankMax";

export type Command =
  | { kind: "setWall"; x: number; y: number; open: boolean }
  | { kind: "setFood"; x: number; y: number; amount: number }
  | { kind: "setParam"; key: NumericParamKey; value: number }
  | { kind: "setCautionary"; value: boolean }
  | { kind: "setAntCount"; n: number }
  | { kind: "setManualAnt"; index: number | null }
  | { kind: "moveManualAnt"; dx: number; dy: number };

export interface TimedCommand {
  t: number;
  cmd: Command;
}

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isBool = (v: unknown): v is boolean => typeof v === "boolean";

/**
 * Range guards for every number the outside world can hand the simulation.
 * A trace is an ordinary file, so this is the boundary that keeps a corrupt or
 * hand-written one from exhausting the heap, stalling a tick, or driving the
 * pheromone field to infinity. The same guards serve the command bus and the
 * trace loader, so the two cannot drift apart.
 */
export const isAntCount = (v: unknown): v is number =>
  isInt(v) && v >= 0 && v <= MAX_ANTS_PER_COLONY;

export const isFoodAmount = (v: unknown): v is number =>
  isNum(v) && v >= 0 && v <= MAX_FOOD_AMOUNT;

/** Outside [0, 1] the decay factor `1 - evapRate` amplifies or inverts. */
export const isEvapRate = (v: unknown): v is number =>
  isNum(v) && v >= 0 && v <= MAX_EVAP_RATE;

/** Must sit in deterministicPow's domain as well as its safe range. */
export const isTrailPower = (v: unknown): v is number =>
  isNum(v) && v >= 0 && v <= MAX_TRAIL_POWER && isHalfStep(v);

export const isTankMax = (v: unknown): v is number =>
  isNum(v) && v > 0 && v <= MAX_TANK;

const PARAM_GUARDS: Record<NumericParamKey, (v: unknown) => v is number> = {
  evapRate: isEvapRate,
  trailPower: isTrailPower,
  tankMax: isTankMax,
};

const isParamKey = (v: unknown): v is NumericParamKey =>
  typeof v === "string" && Object.hasOwn(PARAM_GUARDS, v);

export function validParams(v: unknown): v is SimParams {
  if (typeof v !== "object" || v === null) return false;
  const p = v as Record<string, unknown>;
  return isEvapRate(p.evapRate) && isTrailPower(p.trailPower) &&
    isTankMax(p.tankMax) && isBool(p.cautionary);
}

export function isCommand(value: unknown): value is Command {
  if (typeof value !== "object" || value === null) return false;
  const c = value as Record<string, unknown>;
  switch (c.kind) {
    case "setWall":
      return isInt(c.x) && isInt(c.y) && isBool(c.open);
    case "setFood":
      return isInt(c.x) && isInt(c.y) && isFoodAmount(c.amount);
    case "setParam":
      return isParamKey(c.key) && PARAM_GUARDS[c.key](c.value);
    case "setCautionary":
      return isBool(c.value);
    case "setAntCount":
      return isAntCount(c.n);
    case "setManualAnt":
      return c.index === null || isInt(c.index);
    case "moveManualAnt":
      return isInt(c.dx) && isInt(c.dy);
    default:
      return false;
  }
}

export function isTimedCommand(value: unknown): value is TimedCommand {
  if (typeof value !== "object" || value === null) return false;
  const t = value as Record<string, unknown>;
  return isInt(t.t) && t.t >= 0 && isCommand(t.cmd);
}
