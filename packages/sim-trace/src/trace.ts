import type { RunConfig, RunSeeds, SimParams } from "@stigsim/sim-core";
import type { TimedCommand } from "@stigsim/sim-core";
import { isTimedCommand, isAntCount, validParams } from "@stigsim/sim-core";
import { MAX_COLONIES, MAX_FOOD_PER_SOURCE, MAX_FOOD_SOURCES, MAX_TICKS } from "@stigsim/sim-core";
import type { MetricsSample, MetricsRecorder } from "./metrics";
import type { Simulation } from "@stigsim/sim-core";
import { fingerprint } from "@stigsim/sim-core";

export const TRACE_FORMAT = "stigsim-trace";
/** The file format. Bump when the shape of a trace changes. */
export const TRACE_VERSION = 1;
/** Simulation behaviour. Bump whenever a change alters how the model runs. */
export const SIM_VERSION = 2;

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
  const fingerprints = sim.fingerprints.map(f => ({ ...f }));
  // Checkpoints only land every FINGERPRINT_INTERVAL ticks, which leaves the
  // tail of every run — and the entirety of any run shorter than the
  // interval — with nothing for a replay to verify against. Add one at the
  // tick the trace was actually saved at, unless a checkpoint already lands
  // there.
  //
  // Except when a paused edit is outstanding: flushPending() applies the
  // edit to `sim` right away (so the paused canvas updates) but records the
  // command at `tick + 1`, since that's where replay will actually drain it
  // — at the top of the next tick, before that tick's physics runs. If we
  // saved a tail fingerprint here, it would hash `sim`'s already-edited
  // state under the *current* tick, while a replay stopped at that same
  // tick (endTick) hasn't drained the `tick + 1` command yet and is still
  // pre-edit. The two would disagree and a faithful recording would be
  // reported as diverged. `recorded` is monotonically non-decreasing in
  // `t`, so checking only its last entry is enough to detect this.
  const lastCommand = sim.commandLog[sim.commandLog.length - 1];
  const pausedEditOutstanding = lastCommand !== undefined && lastCommand.t > sim.tick;
  const last = fingerprints[fingerprints.length - 1];
  if (sim.tick > 0 && last?.t !== sim.tick && !pausedEditOutstanding) {
    fingerprints.push({ t: sim.tick, h: fingerprint(sim) });
  }
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
    fingerprints,
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

function validColonySample(v: unknown): boolean {
  if (typeof v !== "object" || v === null) return false;
  const c = v as Record<string, unknown>;
  return (
    isNum(c.food) && isNum(c.ratePerKTick) && isNum(c.highwayScore) &&
    typeof c.pheroMass === "object" && c.pheroMass !== null &&
    typeof c.pheroEntropy === "object" && c.pheroEntropy !== null &&
    (c.meanTripRatio === null || isNum(c.meanTripRatio))
  );
}

function validMetricsSample(v: unknown): v is MetricsSample {
  if (typeof v !== "object" || v === null) return false;
  const s = v as Record<string, unknown>;
  return (
    isInt(s.t) && s.t >= 0 &&
    Array.isArray(s.colonies) && s.colonies.every(validColonySample) &&
    Array.isArray(s.foodRemaining) && s.foodRemaining.every(isNum)
  );
}

/**
 * Kept as named checks rather than one conjunction so a rejected trace can say
 * which field was wrong. Someone who is handed a trace that will not load has
 * no other way to work out why.
 */
const CONFIG_CHECKS: [string, (c: Record<string, unknown>) => boolean][] = [
  ["ant count", c => isAntCount(c.numAnts)],
  ["parameter block", c => validParams(c.params)],
  ["loop rate", c => isNum(c.loopRate) && c.loopRate >= 0 && c.loopRate <= 1],
  ["colony count", c => isInt(c.numColonies) && c.numColonies >= 1 && c.numColonies <= MAX_COLONIES],
  ["food source count", c => isInt(c.numFoodSources) && c.numFoodSources >= 0 && c.numFoodSources <= MAX_FOOD_SOURCES],
  ["food-per-source amount", c => isNum(c.foodPerSource) && c.foodPerSource > 0 && c.foodPerSource <= MAX_FOOD_PER_SOURCE],
];

function configError(v: unknown): string | null {
  if (typeof v !== "object" || v === null) {
    return "That trace has a missing or malformed run config.";
  }
  const c = v as Record<string, unknown>;
  for (const [field, ok] of CONFIG_CHECKS) {
    if (!ok(c)) {
      return `That trace has an unusable ${field}: missing, malformed, or outside the range this build allows.`;
    }
  }
  return null;
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
  if (!isStr(t.createdAt)) {
    return { ok: false, error: "That trace has no readable creation timestamp." };
  }

  const run = t.run as Record<string, unknown> | undefined;
  if (typeof run !== "object" || run === null) {
    return { ok: false, error: "That trace is missing its run description." };
  }
  if (!validSeeds(run.seeds)) {
    return { ok: false, error: "That trace has missing or malformed run seeds." };
  }
  const badConfig = configError(run.config);
  if (badConfig !== null) {
    return { ok: false, error: badConfig };
  }

  if (!Array.isArray(t.commands)) {
    return { ok: false, error: "That trace has a malformed command list." };
  }
  const badCommand = t.commands.findIndex(c => !isTimedCommand(c));
  if (badCommand >= 0) {
    const kind = (t.commands[badCommand] as { cmd?: { kind?: unknown } } | null)?.cmd?.kind;
    return {
      ok: false,
      error: isStr(kind)
        ? `That trace's command ${badCommand + 1} (${kind}) is malformed or outside the range this build allows.`
        : `That trace's command ${badCommand + 1} is not one this build recognises.`,
    };
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
      !isInt(metrics.interval) || metrics.interval <= 0 ||
      typeof metrics.truncated !== "boolean" ||
      !Array.isArray(metrics.samples)) {
    return { ok: false, error: "That trace has a malformed metrics block." };
  }
  if (!metrics.samples.every(validMetricsSample)) {
    return { ok: false, error: "That trace has a malformed metrics sample." };
  }
  const endTick = t.endTick;
  if (!isInt(endTick) || endTick < 0) {
    return { ok: false, error: "That trace has no readable end tick." };
  }
  if (endTick > MAX_TICKS) {
    return {
      ok: false,
      error: `That trace claims to run for ${endTick} ticks, more than this build will replay (${MAX_TICKS}).`,
    };
  }

  // A trace whose checkpoints or commands sit past its end tick is
  // self-contradictory, and the surplus would never be replayed. One tick of
  // slack is legitimate: flushPending stamps a paused edit at tick + 1, so a
  // trace saved while an edit is outstanding carries its last command there.
  const lateFingerprint = (t.fingerprints as { t: number }[]).find(f => f.t > endTick);
  if (lateFingerprint !== undefined) {
    return {
      ok: false,
      error: `That trace has a checkpoint at tick ${lateFingerprint.t}, after its end tick of ${endTick}.`,
    };
  }
  const lateCommand = (t.commands as TimedCommand[]).find(c => c.t > endTick + 1);
  if (lateCommand !== undefined) {
    return {
      ok: false,
      error: `That trace has a command at tick ${lateCommand.t}, after its end tick of ${endTick}.`,
    };
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
