/**
 * Every way the user can mutate a running simulation. Commands are plain
 * serializable data applied at a tick boundary, so a recorded run and a live
 * run follow the same code path.
 */
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

const NUMERIC_PARAM_KEYS: NumericParamKey[] = ["evapRate", "trailPower", "tankMax"];

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isBool = (v: unknown): v is boolean => typeof v === "boolean";

export function isCommand(value: unknown): value is Command {
  if (typeof value !== "object" || value === null) return false;
  const c = value as Record<string, unknown>;
  switch (c.kind) {
    case "setWall":
      return isInt(c.x) && isInt(c.y) && isBool(c.open);
    case "setFood":
      return isInt(c.x) && isInt(c.y) && isNum(c.amount) && c.amount >= 0;
    case "setParam":
      return NUMERIC_PARAM_KEYS.includes(c.key as NumericParamKey) && isNum(c.value);
    case "setCautionary":
      return isBool(c.value);
    case "setAntCount":
      return isInt(c.n) && c.n >= 0;
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
