import {
  MAX_TICKS,
  ModeRegistry,
  fingerprint,
  isCommand,
  isJsonValue,
  isModeId,
  isModeVersion,
  mazeMode,
  type Command,
  type ModeConfigResult,
  type ModeDefinition,
  type ModeReference,
  type ModeRuntime,
  type RunConfig,
  type Simulation,
} from "@stigsim/sim-core";
import {
  SIM_VERSION,
  parseTrace,
  traceToRunConfig,
  type Trace,
} from "./trace";

export const MODE_TRACE_FORMAT = "stigsim-mode-trace";
export const MODE_TRACE_VERSION = 1;

export interface TimedModeCommand<Command = unknown> {
  t: number;
  cmd: Command;
}

/** Mode-aware v1 envelope. Legacy Maze traces are upgraded to this in memory. */
export interface ModeTrace<Config = unknown, Command = unknown> {
  format: typeof MODE_TRACE_FORMAT;
  version: number;
  simVersion: number;
  createdAt: string;
  mode: ModeReference<Config>;
  commands: TimedModeCommand<Command>[];
  fingerprints: { t: number; h: string }[];
  endTick: number;
}

export interface TraceModeDefinition<Config, Runtime extends ModeRuntime, Command> {
  mode: ModeDefinition<Config, Runtime>;
  parseCommand(value: unknown): ModeConfigResult<Command>;
  applyCommand(runtime: Runtime, command: Command): void;
  fingerprint(runtime: Runtime): string;
}

interface RegisteredTraceMode {
  readonly id: string;
  readonly version: number;
  parseConfig(value: unknown): ModeConfigResult<unknown>;
  create(config: unknown): ModeRuntime;
  parseCommand(value: unknown): ModeConfigResult<unknown>;
  applyCommand(runtime: ModeRuntime, command: unknown): void;
  fingerprint(runtime: ModeRuntime): string;
}

function keyOf(id: string, version: number): string {
  return `${id}@${version}`;
}

/** Preserve inferred mode, runtime, and command types for trace adapters. */
export function defineTraceMode<Config, Runtime extends ModeRuntime, Command>(
  definition: TraceModeDefinition<Config, Runtime, Command>,
): TraceModeDefinition<Config, Runtime, Command> {
  new ModeRegistry().register(definition.mode);
  return definition;
}

/** Exact-version lookup for the mode-owned parts of parsing and replay. */
export class ModeTraceRegistry {
  private readonly modes = new Map<string, RegisteredTraceMode>();

  register<Config, Runtime extends ModeRuntime, Command>(
    definition: TraceModeDefinition<Config, Runtime, Command>,
  ): this {
    const id = definition.mode.id;
    const version = definition.mode.version;
    new ModeRegistry().register(definition.mode);
    const key = keyOf(id, version);
    if (this.modes.has(key)) throw new Error(`Trace mode ${key} is already registered.`);
    this.modes.set(key, {
      id,
      version,
      parseConfig: definition.mode.parseConfig,
      create: config => definition.mode.create(config as Config),
      parseCommand: definition.parseCommand,
      applyCommand: (runtime, command) => definition.applyCommand(runtime as Runtime, command as Command),
      fingerprint: runtime => definition.fingerprint(runtime as Runtime),
    });
    return this;
  }

  resolve(id: string, version: number): RegisteredTraceMode | undefined {
    return this.modes.get(keyOf(id, version));
  }
}

function cloneJson<Value>(value: Value): Value {
  return JSON.parse(JSON.stringify(value)) as Value;
}

function canonicalConfig(mode: RegisteredTraceMode, value: unknown): ModeConfigResult<unknown> {
  const parsed = mode.parseConfig(value);
  if (!parsed.ok) return parsed;
  if (!isJsonValue(parsed.value)) {
    return { ok: false, error: `Mode ${keyOf(mode.id, mode.version)} produced a non-JSON config.` };
  }
  return { ok: true, value: cloneJson(parsed.value) };
}

function canonicalCommand(mode: RegisteredTraceMode, value: unknown): ModeConfigResult<unknown> {
  const parsed = mode.parseCommand(value);
  if (!parsed.ok) return parsed;
  if (!isJsonValue(parsed.value)) {
    return { ok: false, error: `Mode ${keyOf(mode.id, mode.version)} produced a non-JSON command.` };
  }
  return { ok: true, value: cloneJson(parsed.value) };
}

function legacyToModeTrace(trace: Trace): ModeTrace<RunConfig, Command> {
  return {
    format: MODE_TRACE_FORMAT,
    version: MODE_TRACE_VERSION,
    simVersion: trace.simVersion,
    createdAt: trace.createdAt,
    mode: { id: mazeMode.id, version: mazeMode.version, config: traceToRunConfig(trace) },
    commands: trace.commands.map(({ t, cmd }) => ({ t, cmd: { ...cmd } })),
    fingerprints: trace.fingerprints.map(checkpoint => ({ ...checkpoint })),
    endTick: trace.endTick,
  };
}

export type ModeTraceParseResult =
  | { ok: true; trace: ModeTrace; warning?: string; upgradedLegacy?: true }
  | { ok: false; error: string };

const isInt = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value);

function validateModeTrace(raw: unknown, registry: ModeTraceRegistry): ModeTraceParseResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, error: "That file is not a Stigsim mode trace." };
  }
  const candidate = raw as Record<string, unknown>;
  if (candidate.format !== MODE_TRACE_FORMAT) {
    return { ok: false, error: "That file is not a Stigsim mode trace." };
  }
  if (!isInt(candidate.version)) return { ok: false, error: "That trace has no readable format version." };
  if (candidate.version > MODE_TRACE_VERSION) {
    return {
      ok: false,
      error: `That trace uses a newer version of the mode trace format (${candidate.version}) than this build understands (${MODE_TRACE_VERSION}).`,
    };
  }
  if (candidate.version < MODE_TRACE_VERSION) {
    return {
      ok: false,
      error: `That trace uses an older version of the mode trace format (${candidate.version}) than this build reads (${MODE_TRACE_VERSION}).`,
    };
  }
  if (!isInt(candidate.simVersion)) return { ok: false, error: "That trace has no readable simulation version." };
  if (typeof candidate.createdAt !== "string") {
    return { ok: false, error: "That trace has no readable creation timestamp." };
  }
  if (typeof candidate.mode !== "object" || candidate.mode === null || Array.isArray(candidate.mode)) {
    return { ok: false, error: "That trace is missing its mode reference." };
  }
  const reference = candidate.mode as Record<string, unknown>;
  if (!isModeId(reference.id) || !isModeVersion(reference.version)) {
    return { ok: false, error: "That trace has an invalid mode identity." };
  }
  const mode = registry.resolve(reference.id, reference.version);
  if (!mode) {
    return { ok: false, error: `Mode ${keyOf(reference.id, reference.version)} is not registered.` };
  }
  if (!isJsonValue(reference.config)) {
    return { ok: false, error: "That trace's mode config is not lossless JSON data." };
  }
  const config = canonicalConfig(mode, reference.config);
  if (!config.ok) return { ok: false, error: config.error };

  if (!isInt(candidate.endTick) || candidate.endTick < 0) {
    return { ok: false, error: "That trace has no readable end tick." };
  }
  if (candidate.endTick > MAX_TICKS) {
    return {
      ok: false,
      error: `That trace claims to run for ${candidate.endTick} ticks, more than this build will replay (${MAX_TICKS}).`,
    };
  }
  if (!Array.isArray(candidate.commands)) {
    return { ok: false, error: "That trace has a malformed command list." };
  }
  const commands: TimedModeCommand[] = [];
  for (let index = 0; index < candidate.commands.length; index++) {
    const rawCommand = candidate.commands[index];
    if (typeof rawCommand !== "object" || rawCommand === null || Array.isArray(rawCommand)) {
      return { ok: false, error: `That trace's command ${index + 1} is malformed.` };
    }
    const timed = rawCommand as Record<string, unknown>;
    if (!isInt(timed.t) || timed.t < 1 || timed.t > candidate.endTick + 1) {
      return { ok: false, error: `That trace's command ${index + 1} has an invalid tick.` };
    }
    if (!isJsonValue(timed.cmd)) {
      return { ok: false, error: `That trace's command ${index + 1} is not lossless JSON data.` };
    }
    const command = canonicalCommand(mode, timed.cmd);
    if (!command.ok) return { ok: false, error: `That trace's command ${index + 1}: ${command.error}` };
    commands.push({ t: timed.t, cmd: command.value });
  }

  if (!Array.isArray(candidate.fingerprints)) {
    return { ok: false, error: "That trace has malformed fingerprints." };
  }
  const fingerprints: { t: number; h: string }[] = [];
  for (const checkpoint of candidate.fingerprints) {
    if (typeof checkpoint !== "object" || checkpoint === null || Array.isArray(checkpoint)) {
      return { ok: false, error: "That trace has malformed fingerprints." };
    }
    const value = checkpoint as Record<string, unknown>;
    if (!isInt(value.t) || value.t < 0 || value.t > candidate.endTick || typeof value.h !== "string") {
      return { ok: false, error: "That trace has malformed fingerprints." };
    }
    fingerprints.push({ t: value.t, h: value.h });
  }

  const trace: ModeTrace = {
    format: MODE_TRACE_FORMAT,
    version: candidate.version,
    simVersion: candidate.simVersion,
    createdAt: candidate.createdAt,
    mode: { id: reference.id, version: reference.version, config: config.value },
    commands,
    fingerprints,
    endTick: candidate.endTick,
  };
  return candidate.simVersion === SIM_VERSION
    ? { ok: true, trace }
    : {
        ok: true,
        trace,
        warning: `This trace was recorded under a different simulation version (${candidate.simVersion}, this build is ${SIM_VERSION}). Exact replay is not expected.`,
      };
}

/** Parse a mode trace, or upgrade an existing v1 Maze trace in memory. */
export function parseModeTrace(text: string, registry: ModeTraceRegistry): ModeTraceParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "That file could not be read as JSON." };
  }
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw) &&
      (raw as Record<string, unknown>).format === MODE_TRACE_FORMAT) {
    return validateModeTrace(raw, registry);
  }
  const legacy = parseTrace(text);
  if (!legacy.ok) return legacy;
  const upgraded = validateModeTrace(legacyToModeTrace(legacy.trace), registry);
  return upgraded.ok
    ? { ...upgraded, warning: legacy.warning ?? upgraded.warning, upgradedLegacy: true }
    : upgraded;
}

/** Maze's existing command bus exposed through the generic mode trace hooks. */
export const mazeTraceMode = defineTraceMode({
  mode: mazeMode,
  parseCommand: (value: unknown): ModeConfigResult<Command> => isCommand(value)
    ? { ok: true, value: { ...value } }
    : { ok: false, error: "Maze command is malformed or outside the supported range." },
  applyCommand: (runtime: Simulation, command: Command) => runtime.apply(command),
  fingerprint: (runtime: Simulation) => fingerprint(runtime),
});

export class ModeTraceRecorder<Config, Runtime extends ModeRuntime, Command> {
  readonly runtime: Runtime;
  readonly reference: ModeReference<Config>;
  private readonly commands: TimedModeCommand<Command>[] = [];
  private readonly fingerprints: { t: number; h: string }[] = [];
  private readonly createdAt: string;

  constructor(
    private readonly definition: TraceModeDefinition<Config, Runtime, Command>,
    config: unknown,
    createdAt: string = new Date().toISOString(),
    private readonly fingerprintInterval = 500,
  ) {
    if (!isInt(fingerprintInterval) || fingerprintInterval < 1) {
      throw new RangeError("Fingerprint interval must be a positive integer.");
    }
    const parsed = definition.mode.parseConfig(config);
    if (!parsed.ok) throw new RangeError(parsed.error);
    if (!isJsonValue(parsed.value)) throw new TypeError("Mode config must be lossless JSON data.");
    const canonical = cloneJson(parsed.value);
    this.reference = {
      id: definition.mode.id,
      version: definition.mode.version,
      config: canonical,
    };
    this.runtime = definition.mode.create(cloneJson(canonical));
    this.createdAt = createdAt;
  }

  command(value: unknown): void {
    const parsed = this.definition.parseCommand(value);
    if (!parsed.ok) throw new RangeError(parsed.error);
    if (!isJsonValue(parsed.value)) throw new TypeError("Mode command must be lossless JSON data.");
    const command = cloneJson(parsed.value);
    this.definition.applyCommand(this.runtime, cloneJson(command));
    this.commands.push({ t: this.runtime.tick + 1, cmd: command });
  }

  step(): boolean {
    const before = this.runtime.tick;
    this.runtime.step();
    if (this.runtime.tick === before) return false;
    if (this.runtime.tick !== before + 1) {
      throw new Error("Traceable mode runtimes must advance exactly one tick per step.");
    }
    if (this.runtime.tick % this.fingerprintInterval === 0) {
      this.fingerprints.push({ t: this.runtime.tick, h: this.definition.fingerprint(this.runtime) });
    }
    return true;
  }

  build(): ModeTrace<Config, Command> {
    const checkpoints = this.fingerprints.map(checkpoint => ({ ...checkpoint }));
    const last = checkpoints[checkpoints.length - 1];
    const lastCommand = this.commands[this.commands.length - 1];
    const pausedCommand = lastCommand !== undefined && lastCommand.t > this.runtime.tick;
    if (this.runtime.tick > 0 && last?.t !== this.runtime.tick && !pausedCommand) {
      checkpoints.push({ t: this.runtime.tick, h: this.definition.fingerprint(this.runtime) });
    }
    return {
      format: MODE_TRACE_FORMAT,
      version: MODE_TRACE_VERSION,
      simVersion: SIM_VERSION,
      createdAt: this.createdAt,
      mode: { ...this.reference, config: cloneJson(this.reference.config) },
      commands: this.commands.map(({ t, cmd }) => ({ t, cmd: cloneJson(cmd) })),
      fingerprints: checkpoints,
      endTick: this.runtime.tick,
    };
  }
}

export class ModeTraceReplayer<Runtime extends ModeRuntime = ModeRuntime> {
  readonly trace: ModeTrace;
  runtime: Runtime;
  divergedAt: number | null = null;
  private readonly mode: RegisteredTraceMode;
  private readonly expected: Map<number, string>;
  private checking = true;
  private schedule = new Map<number, unknown[]>();

  constructor(trace: ModeTrace, registry: ModeTraceRegistry) {
    const validated = validateModeTrace(trace, registry);
    if (!validated.ok) throw new RangeError(validated.error);
    this.trace = validated.trace;
    this.mode = registry.resolve(this.trace.mode.id, this.trace.mode.version)!;
    this.expected = new Map(this.trace.fingerprints.map(checkpoint => [checkpoint.t, checkpoint.h]));
    this.runtime = this.build();
  }

  private build(): Runtime {
    const parsed = canonicalConfig(this.mode, this.trace.mode.config);
    if (!parsed.ok) throw new RangeError(parsed.error);
    this.schedule = new Map();
    for (const { t, cmd } of this.trace.commands) {
      const at = this.schedule.get(t);
      if (at) at.push(cmd);
      else this.schedule.set(t, [cmd]);
    }
    return this.mode.create(parsed.value) as Runtime;
  }

  get tick(): number { return this.runtime.tick; }
  get endTick(): number { return this.trace.endTick; }
  get atEnd(): boolean { return this.tick >= this.endTick; }

  reset(): void {
    this.runtime = this.build();
    this.divergedAt = null;
    this.checking = true;
  }

  step(): boolean {
    if (this.divergedAt !== null || this.atEnd) return false;
    const nextTick = this.tick + 1;
    for (const command of this.schedule.get(nextTick) ?? []) {
      this.mode.applyCommand(this.runtime, cloneJson(command));
    }
    const before = this.tick;
    this.runtime.step();
    if (this.tick !== before + 1) return false;
    if (this.checking) {
      const wanted = this.expected.get(this.tick);
      if (wanted !== undefined && this.mode.fingerprint(this.runtime) !== wanted) {
        this.divergedAt = this.tick;
        return false;
      }
    }
    return true;
  }

  seek(target: number): void {
    const tick = Math.max(0, Math.min(target, this.endTick));
    if (tick < this.tick || this.divergedAt !== null) this.reset();
    while (this.tick < tick && this.step());
  }

  continueAfterDivergence(): void {
    this.divergedAt = null;
    this.checking = false;
  }
}

export function serializeModeTrace(trace: ModeTrace): string {
  return JSON.stringify(trace);
}
