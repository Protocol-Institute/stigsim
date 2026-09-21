/**
 * Every way the user can mutate a running simulation. Commands are plain
 * serializable data applied at a tick boundary, so a recorded run and a live
 * run follow the same code path.
 */
import { MAX_ANTS_PER_COLONY, MAX_COLONIES, MAX_FOOD_AMOUNT, MAX_PHEROMONE, MAX_TANK } from "./constants";
import { DOCTRINE_CHANNELS, isDoctrine, type Doctrine, type AdoptionMode, type DoctrineChannel } from "./doctrine";
import { isTopology, type Topology } from "./topology";
import type { SimParams } from "./types";

export type Command =
  | { kind: "setWall"; x: number; y: number; open: boolean }
  | { kind: "setFood"; x: number; y: number; amount: number }
  | { kind: "setAntCount"; n: number }
  | { kind: "setManualAnt"; index: number | null }
  | { kind: "moveManualAnt"; dx: number; dy: number }
  | { kind: "setDoctrine"; colony: number; doctrine: Doctrine }
  | { kind: "setAdoption"; mode: AdoptionMode }
  | { kind: "setTopology"; topology: Topology }
  /**
   * Write pheromone into one colony's field directly.
   *
   * An authoring primitive, not a colony action: it does not go through the
   * laying path, so mimic-rate clamping and provenance bookkeeping do not
   * apply to it. That is deliberate — it describes a starting condition, not
   * something an ant did — and it is why the command is kept to local modes.
   *
   * The channel is a DoctrineChannel rather than a Channel because `caut` is
   * inert everywhere a doctrine runs: only Infinite reads it, so laying it
   * here would be recorded and fingerprinted while changing nothing. Reusing
   * the doctrine's channel set means both widen together if `caut` ever
   * becomes data.
   */
  | { kind: "layPheromone"; colony: number; channel: DoctrineChannel; x: number; y: number; amount: number };

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

export const isTankMax = (v: unknown): v is number =>
  isNum(v) && v > 0 && v <= MAX_TANK;

/** Amplitude for one pheromone write. Negative is rejected: this raises a cell, it never scrubs one. */
export const isPheromoneAmount = (v: unknown): v is number =>
  isNum(v) && v >= 0 && v <= MAX_PHEROMONE;

export const isLayableChannel = (v: unknown): v is DoctrineChannel =>
  DOCTRINE_CHANNELS.includes(v as DoctrineChannel);

export function validParams(v: unknown): v is SimParams {
  if (typeof v !== "object" || v === null) return false;
  return isTankMax((v as Record<string, unknown>).tankMax);
}

export function isCommand(value: unknown): value is Command {
  if (typeof value !== "object" || value === null) return false;
  const c = value as Record<string, unknown>;
  switch (c.kind) {
    case "setWall":
      return isInt(c.x) && isInt(c.y) && isBool(c.open);
    case "setFood":
      return isInt(c.x) && isInt(c.y) && isFoodAmount(c.amount);
    case "setAntCount":
      return isAntCount(c.n);
    case "setManualAnt":
      return c.index === null || isInt(c.index);
    case "moveManualAnt":
      return isInt(c.dx) && isInt(c.dy);
    case "setDoctrine":
      return isInt(c.colony) && c.colony >= 0 && c.colony < MAX_COLONIES && isDoctrine(c.doctrine);
    case "setAdoption":
      return c.mode === "instant" || c.mode === "nest";
    case "setTopology":
      return isTopology(c.topology);
    case "layPheromone":
      return isInt(c.colony) && c.colony >= 0 && c.colony < MAX_COLONIES
        && isLayableChannel(c.channel)
        && isInt(c.x) && isInt(c.y) && isPheromoneAmount(c.amount);
    default:
      return false;
  }
}

export function isTimedCommand(value: unknown): value is TimedCommand {
  if (typeof value !== "object" || value === null) return false;
  const t = value as Record<string, unknown>;
  return isInt(t.t) && t.t >= 0 && isCommand(t.cmd);
}
