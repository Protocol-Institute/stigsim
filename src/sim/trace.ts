import type { RunConfig, RunSeeds, SimParams } from "./types";
import type { TimedCommand } from "./commands";
import { isTimedCommand } from "./commands";
import type { MetricsSample, MetricsRecorder } from "./metrics";
import type { Simulation } from "./sim";

export const TRACE_FORMAT = "stigsim-trace";
/** The file format. Bump when the shape of a trace changes. */
export const TRACE_VERSION = 1;
/** Simulation behaviour. Bump whenever a change alters how the model runs. */
export const SIM_VERSION = 1;

export interface TraceRunConfig {
  numAnts: number;
  params: SimParams;
  loopRate: number;
  numColonies: number;
  numFoodSources: number;
  foodPerSource: number;
}

export interface Trace {
  format: typeof TRACE_FORMAT;
  version: number;
  simVersion: number;
  createdAt: string;
  run: { seeds: RunSeeds; config: TraceRunConfig };
  commands: TimedCommand[];
  fingerprints: { t: number; h: string }[];
  metrics: { interval: number; truncated: boolean; samples: MetricsSample[] };
  endTick: number;
}

export type ParseResult =
  | { ok: true; trace: Trace; warning?: string }
  | { ok: false; error: string };

export function buildTrace(
  sim: Simulation,
  recorder: MetricsRecorder,
  createdAt: string = new Date().toISOString(),
): Trace {
  return {
    format: TRACE_FORMAT,
    version: TRACE_VERSION,
    simVersion: SIM_VERSION,
    createdAt,
    run: {
      seeds: { ...sim.config.seeds },
      config: {
        numAnts: sim.config.numAnts,
        params: { ...sim.config.params },
        loopRate: sim.config.loopRate,
        numColonies: sim.config.numColonies,
        numFoodSources: sim.config.numFoodSources,
        foodPerSource: sim.config.foodPerSource,
      },
    },
    commands: sim.commandLog.map(c => ({ t: c.t, cmd: { ...c.cmd } })),
    fingerprints: sim.fingerprints.map(f => ({ ...f })),
    metrics: {
      interval: recorder.interval,
      truncated: recorder.truncated,
      samples: recorder.samples.slice(),
    },
    endTick: sim.tick,
  };
}

export function serializeTrace(trace: Trace): string {
  return JSON.stringify(trace);
}

export function traceToRunConfig(trace: Trace): RunConfig {
  return { seeds: { ...trace.run.seeds }, ...trace.run.config };
}

export function traceFilename(trace: Trace): string {
  const seed = trace.run.seeds.master ?? "custom";
  return `stigsim-${seed}-${trace.endTick}.trace.json`;
}

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === "string";

function validSeeds(v: unknown): v is RunSeeds {
  if (typeof v !== "object" || v === null) return false;
  const s = v as Record<string, unknown>;
  return (s.master === null || isStr(s.master)) && isStr(s.maze) && isStr(s.food) && isStr(s.ants);
}

function validParams(v: unknown): v is SimParams {
  if (typeof v !== "object" || v === null) return false;
  const p = v as Record<string, unknown>;
  return isNum(p.evapRate) && isNum(p.trailPower) && isNum(p.tankMax) && typeof p.cautionary === "boolean";
}

function validMetricsSample(v: unknown): v is MetricsSample {
  if (typeof v !== "object" || v === null) return false;
  const s = v as Record<string, unknown>;
  return (
    isInt(s.t) && s.t >= 0 &&
    Array.isArray(s.colonies) &&
    Array.isArray(s.foodRemaining) && s.foodRemaining.every(isNum)
  );
}

function validConfig(v: unknown): v is TraceRunConfig {
  if (typeof v !== "object" || v === null) return false;
  const c = v as Record<string, unknown>;
  return (
    isInt(c.numAnts) && c.numAnts >= 0 &&
    validParams(c.params) &&
    isNum(c.loopRate) && c.loopRate >= 0 && c.loopRate <= 1 &&
    isInt(c.numColonies) && c.numColonies >= 1 && c.numColonies <= 4 &&
    isInt(c.numFoodSources) && c.numFoodSources >= 0 &&
    isNum(c.foodPerSource) && c.foodPerSource > 0
  );
}

export function parseTrace(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "That file could not be read as JSON." };
  }

  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, error: "That file is not a Stigsim trace." };
  }
  const t = raw as Record<string, unknown>;

  if (t.format !== TRACE_FORMAT) {
    return { ok: false, error: "That file is not a Stigsim trace." };
  }
  if (!isInt(t.version)) {
    return { ok: false, error: "That trace has no readable format version." };
  }
  if (t.version > TRACE_VERSION) {
    return {
      ok: false,
      error: `That trace uses a newer version of the trace format (${t.version}) than this build understands (${TRACE_VERSION}).`,
    };
  }
  if (!isInt(t.simVersion)) {
    return { ok: false, error: "That trace has no readable simulation version." };
  }

  const run = t.run as Record<string, unknown> | undefined;
  if (typeof run !== "object" || run === null) {
    return { ok: false, error: "That trace is missing its run description." };
  }
  if (!validSeeds(run.seeds)) {
    return { ok: false, error: "That trace has missing or malformed run seeds." };
  }
  if (!validConfig(run.config)) {
    return { ok: false, error: "That trace has a missing or malformed run config." };
  }

  if (!Array.isArray(t.commands) || !t.commands.every(isTimedCommand)) {
    return { ok: false, error: "That trace contains a command this build does not recognise." };
  }
  if (!Array.isArray(t.fingerprints) ||
      !t.fingerprints.every(f =>
        typeof f === "object" && f !== null &&
        isInt((f as Record<string, unknown>).t) &&
        isStr((f as Record<string, unknown>).h))) {
    return { ok: false, error: "That trace has malformed fingerprints." };
  }

  const metrics = t.metrics as Record<string, unknown> | undefined;
  if (typeof metrics !== "object" || metrics === null ||
      !isInt(metrics.interval) || typeof metrics.truncated !== "boolean" ||
      !Array.isArray(metrics.samples)) {
    return { ok: false, error: "That trace has a malformed metrics block." };
  }
  if (!metrics.samples.every(validMetricsSample)) {
    return { ok: false, error: "That trace has a malformed metrics sample." };
  }
  if (!isInt(t.endTick) || t.endTick < 0) {
    return { ok: false, error: "That trace has no readable end tick." };
  }

  const trace = raw as Trace;
  if (trace.simVersion !== SIM_VERSION) {
    return {
      ok: true,
      trace,
      warning: `This trace was recorded under a different simulation version (${trace.simVersion}, this build is ${SIM_VERSION}). Exact replay is not expected.`,
    };
  }
  return { ok: true, trace };
}
