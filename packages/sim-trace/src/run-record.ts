import {
  MAX_TICKS,
  isJsonValue,
  isModeId,
  isModeVersion,
  type ModeConfigResult,
  type ModeReference,
  type ModeRuntime,
} from "@stigsim/sim-core";
import {
  MODE_TRACE_FORMAT,
  MODE_TRACE_VERSION,
  ModeTraceRecorder,
  ModeTraceRegistry,
  parseModeTrace,
  type ModeTrace,
  type TraceModeDefinition,
} from "./mode-trace";

export const MODE_RUN_RECORD_FORMAT = "stigsim-run-record";
export const MODE_RUN_RECORD_VERSION = 1;

export const MAX_RECORD_PARTICIPANTS = 1_024;
export const MAX_RECORD_COMMANDS = 1_000_000;
export const MAX_RESEARCH_CHANNELS = 64;
export const MAX_RESEARCH_SAMPLES = 1_000_000;

const MAX_RECORD_ID_LENGTH = 100;
const MAX_RECORD_LABEL_LENGTH = 200;

export type ParticipantKind = "player" | "bot" | "system";

/** Recording-local identity. Do not put account ids, tokens, or network identifiers here. */
export interface RunParticipant {
  id: string;
  kind: ParticipantKind;
  label?: string;
  slot?: string;
}

export type CommandSource =
  | { kind: "participant"; participantId: string }
  | { kind: "system"; systemId: string };

export interface RecordedModeCommand<Command = unknown> {
  t: number;
  /** Zero-based order among commands applied at the same tick. */
  sequence: number;
  source: CommandSource;
  cmd: Command;
}

export interface ResearchSample<Sample = unknown> {
  t: number;
  data: Sample;
}

export interface ResearchChannelRecord<Sample = unknown> {
  version: number;
  interval: number;
  capacity: number;
  truncated: boolean;
  samples: ResearchSample<Sample>[];
}

export interface RecordedOutcome<Outcome = unknown> {
  version: number;
  data: Outcome;
}

/**
 * A replayable trace plus explicitly versioned, mode-owned research data.
 * Research observations are deliberately separate from restorable engine state.
 */
export interface ModeRunRecord<Config = unknown, Command = unknown> {
  format: typeof MODE_RUN_RECORD_FORMAT;
  version: number;
  simVersion: number;
  createdAt: string;
  mode: ModeReference<Config>;
  participants: RunParticipant[];
  commands: RecordedModeCommand<Command>[];
  fingerprints: { t: number; h: string }[];
  channels: Record<string, ResearchChannelRecord>;
  outcome?: RecordedOutcome;
  endTick: number;
}

export interface ResearchChannelDefinition<Runtime extends ModeRuntime, Sample> {
  version: number;
  defaultInterval: number;
  defaultCapacity: number;
  capture(runtime: Runtime): Sample;
  parse(value: unknown): ModeConfigResult<Sample>;
}

export interface ResearchOutcomeDefinition<Runtime extends ModeRuntime, Outcome> {
  version: number;
  capture(runtime: Runtime): Outcome | undefined;
  parse(value: unknown): ModeConfigResult<Outcome>;
}

type AnyChannel<Runtime extends ModeRuntime> = ResearchChannelDefinition<Runtime, unknown>;
type ChannelMap<Runtime extends ModeRuntime> = Record<string, AnyChannel<Runtime>>;

export interface RecordingModeDefinition<
  Config,
  Runtime extends ModeRuntime,
  Command,
  Channels extends ChannelMap<Runtime> = ChannelMap<Runtime>,
  Outcome = unknown,
> {
  trace: TraceModeDefinition<Config, Runtime, Command>;
  channels: Channels;
  outcome?: ResearchOutcomeDefinition<Runtime, Outcome>;
}

function positiveBoundedInteger(value: unknown, maximum: number): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 1 && (value as number) <= maximum;
}

/** Preserve a channel's inferred sample type while checking its public schema metadata. */
export function defineResearchChannel<Runtime extends ModeRuntime, Sample>(
  definition: ResearchChannelDefinition<Runtime, Sample>,
): ResearchChannelDefinition<Runtime, Sample> {
  if (!isModeVersion(definition.version)) throw new TypeError("Research channel version must be a positive integer.");
  if (!positiveBoundedInteger(definition.defaultInterval, MAX_TICKS)) {
    throw new RangeError("Research channel interval is outside the supported range.");
  }
  if (!positiveBoundedInteger(definition.defaultCapacity, MAX_RESEARCH_SAMPLES)) {
    throw new RangeError("Research channel capacity is outside the supported range.");
  }
  return definition;
}

/** Preserve inferred mode and channel types while validating the recording contract. */
export function defineRecordingMode<
  Config,
  Runtime extends ModeRuntime,
  Command,
  Channels extends ChannelMap<Runtime>,
  Outcome,
>(definition: RecordingModeDefinition<Config, Runtime, Command, Channels, Outcome>):
    RecordingModeDefinition<Config, Runtime, Command, Channels, Outcome> {
  const names = Object.keys(definition.channels);
  if (names.length > MAX_RESEARCH_CHANNELS) throw new RangeError("Recording mode defines too many research channels.");
  for (const name of names) {
    if (!isModeId(name)) throw new TypeError(`Invalid research channel id: ${name}`);
    defineResearchChannel(definition.channels[name]);
  }
  if (definition.outcome && !isModeVersion(definition.outcome.version)) {
    throw new TypeError("Research outcome version must be a positive integer.");
  }
  return definition;
}

type ErasedRecordingMode = RecordingModeDefinition<
  unknown,
  ModeRuntime,
  unknown,
  ChannelMap<ModeRuntime>,
  unknown
>;

function modeKey(id: string, version: number): string {
  return `${id}@${version}`;
}

/** Exact-version registry for parsing mode-owned research channels and outcomes. */
export class ModeRecordingRegistry {
  private readonly modes = new Map<string, ErasedRecordingMode>();

  register<
    Config,
    Runtime extends ModeRuntime,
    Command,
    Channels extends ChannelMap<Runtime>,
    Outcome,
  >(definition: RecordingModeDefinition<Config, Runtime, Command, Channels, Outcome>): this {
    defineRecordingMode(definition);
    const key = modeKey(definition.trace.mode.id, definition.trace.mode.version);
    if (this.modes.has(key)) throw new Error(`Recording mode ${key} is already registered.`);
    this.modes.set(key, definition as unknown as ErasedRecordingMode);
    return this;
  }

  resolve(id: string, version: number): ErasedRecordingMode | undefined {
    return this.modes.get(modeKey(id, version));
  }
}

function cloneJson<Value>(value: Value): Value {
  return JSON.parse(JSON.stringify(value)) as Value;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function validRecordId(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= MAX_RECORD_ID_LENGTH &&
    /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value);
}

function optionalLabel(value: unknown): value is string | undefined {
  return value === undefined || (typeof value === "string" && value.length <= MAX_RECORD_LABEL_LENGTH);
}

function parseParticipants(value: unknown): ModeConfigResult<RunParticipant[]> {
  if (!Array.isArray(value) || value.length > MAX_RECORD_PARTICIPANTS) {
    return { ok: false, error: "That run record has a malformed participant list." };
  }
  const participants: RunParticipant[] = [];
  const ids = new Set<string>();
  for (const item of value) {
    const participant = record(item);
    if (!participant || !validRecordId(participant.id) || ids.has(participant.id) ||
        !["player", "bot", "system"].includes(participant.kind as string) ||
        !optionalLabel(participant.label) || !optionalLabel(participant.slot)) {
      return { ok: false, error: "That run record has a malformed or duplicate participant." };
    }
    ids.add(participant.id);
    participants.push({
      id: participant.id,
      kind: participant.kind as ParticipantKind,
      ...(participant.label === undefined ? {} : { label: participant.label }),
      ...(participant.slot === undefined ? {} : { slot: participant.slot }),
    });
  }
  return { ok: true, value: participants };
}

function parseSource(value: unknown, participantIds: ReadonlySet<string>): ModeConfigResult<CommandSource> {
  const source = record(value);
  if (source?.kind === "participant" && validRecordId(source.participantId) &&
      participantIds.has(source.participantId)) {
    return { ok: true, value: { kind: "participant", participantId: source.participantId } };
  }
  if (source?.kind === "system" && validRecordId(source.systemId)) {
    return { ok: true, value: { kind: "system", systemId: source.systemId } };
  }
  return { ok: false, error: "That run record has a command with an invalid source." };
}

function canonicalCaptured<Value>(
  value: unknown,
  parser: (input: unknown) => ModeConfigResult<Value>,
  description: string,
): Value {
  const parsed = parser(value);
  if (!parsed.ok) throw new RangeError(`${description}: ${parsed.error}`);
  if (!isJsonValue(parsed.value)) throw new TypeError(`${description} must be lossless JSON data.`);
  return cloneJson(parsed.value);
}

export interface ChannelSampling {
  interval?: number;
  capacity?: number;
}

export interface ModeRunRecorderOptions<ChannelName extends string = string> {
  createdAt?: string;
  fingerprintInterval?: number;
  participants?: RunParticipant[];
  channels?: Partial<Record<ChannelName, false | ChannelSampling>>;
}

interface ActiveChannel {
  definition: AnyChannel<ModeRuntime>;
  interval: number;
  capacity: number;
  truncated: boolean;
  samples: ResearchSample[];
}

/** One mutation gateway for replay commands, player provenance, and sampled research data. */
export class ModeRunRecorder<
  Config,
  Runtime extends ModeRuntime,
  Command,
  Channels extends ChannelMap<Runtime>,
  Outcome = unknown,
> {
  private readonly traceRecorder: ModeTraceRecorder<Config, Runtime, Command>;
  private readonly participants: RunParticipant[];
  private readonly participantIds: Set<string>;
  private readonly commandSources: Array<{ t: number; sequence: number; source: CommandSource }> = [];
  private readonly activeChannels = new Map<string, ActiveChannel>();

  constructor(
    private readonly definition: RecordingModeDefinition<Config, Runtime, Command, Channels, Outcome>,
    config: unknown,
    options: ModeRunRecorderOptions<keyof Channels & string> = {},
  ) {
    defineRecordingMode(definition);
    const parsedParticipants = parseParticipants(options.participants ?? []);
    if (!parsedParticipants.ok) throw new RangeError(parsedParticipants.error);
    this.participants = parsedParticipants.value;
    this.participantIds = new Set(this.participants.map(participant => participant.id));
    this.traceRecorder = new ModeTraceRecorder(
      definition.trace,
      config,
      options.createdAt,
      options.fingerprintInterval,
    );

    for (const name of Object.keys(options.channels ?? {})) {
      if (!(name in definition.channels)) throw new RangeError(`Recording mode has no ${name} research channel.`);
    }

    for (const [name, channel] of Object.entries(definition.channels)) {
      const selected = options.channels?.[name as keyof Channels & string];
      if (selected === false) continue;
      const interval = selected?.interval ?? channel.defaultInterval;
      const capacity = selected?.capacity ?? channel.defaultCapacity;
      if (!positiveBoundedInteger(interval, MAX_TICKS)) {
        throw new RangeError(`Research channel ${name} interval is outside the supported range.`);
      }
      if (!positiveBoundedInteger(capacity, MAX_RESEARCH_SAMPLES)) {
        throw new RangeError(`Research channel ${name} capacity is outside the supported range.`);
      }
      this.activeChannels.set(name, {
        definition: channel as unknown as AnyChannel<ModeRuntime>,
        interval,
        capacity,
        truncated: false,
        samples: [],
      });
    }
  }

  get runtime(): Runtime {
    return this.traceRecorder.runtime;
  }

  command(sourceValue: CommandSource, value: unknown): void {
    const source = parseSource(sourceValue, this.participantIds);
    if (!source.ok) throw new RangeError(source.error);
    const t = this.runtime.tick + 1;
    const previous = this.commandSources[this.commandSources.length - 1];
    const sequence = previous?.t === t ? previous.sequence + 1 : 0;
    this.traceRecorder.command(value);
    this.commandSources.push({ t, sequence, source: source.value });
  }

  step(): boolean {
    if (!this.traceRecorder.step()) return false;
    for (const [name, channel] of this.activeChannels) {
      if (this.runtime.tick % channel.interval === 0) this.capture(name, channel);
    }
    return true;
  }

  private capture(name: string, channel: ActiveChannel): void {
    const data = canonicalCaptured(
      channel.definition.capture(this.runtime),
      channel.definition.parse,
      `Research channel ${name} sample`,
    );
    channel.samples.push({ t: this.runtime.tick, data });
    if (channel.samples.length > channel.capacity) {
      channel.samples.shift();
      channel.truncated = true;
    }
  }

  build(): ModeRunRecord<Config, Command> {
    for (const [name, channel] of this.activeChannels) {
      const last = channel.samples[channel.samples.length - 1];
      if (last?.t !== this.runtime.tick) this.capture(name, channel);
    }
    const trace = this.traceRecorder.build();
    if (trace.commands.length !== this.commandSources.length) {
      throw new Error("Trace commands and command provenance are out of sync.");
    }
    const channels: Record<string, ResearchChannelRecord> = {};
    for (const [name, channel] of this.activeChannels) {
      channels[name] = {
        version: channel.definition.version,
        interval: channel.interval,
        capacity: channel.capacity,
        truncated: channel.truncated,
        samples: channel.samples.map(sample => ({ t: sample.t, data: cloneJson(sample.data) })),
      };
    }
    const capturedOutcome = this.definition.outcome?.capture(this.runtime);
    const outcome = capturedOutcome === undefined || !this.definition.outcome
      ? undefined
      : {
          version: this.definition.outcome.version,
          data: canonicalCaptured(
            capturedOutcome,
            this.definition.outcome.parse,
            "Research outcome",
          ),
        };
    return {
      format: MODE_RUN_RECORD_FORMAT,
      version: MODE_RUN_RECORD_VERSION,
      simVersion: trace.simVersion,
      createdAt: trace.createdAt,
      mode: { ...trace.mode, config: cloneJson(trace.mode.config) },
      participants: this.participants.map(participant => ({ ...participant })),
      commands: trace.commands.map(({ t, cmd }, index) => ({
        t,
        sequence: this.commandSources[index].sequence,
        source: { ...this.commandSources[index].source },
        cmd: cloneJson(cmd),
      })),
      fingerprints: trace.fingerprints.map(checkpoint => ({ ...checkpoint })),
      channels,
      ...(outcome === undefined ? {} : { outcome }),
      endTick: trace.endTick,
    };
  }
}

export type ModeRunRecordParseResult =
  | { ok: true; record: ModeRunRecord; warning?: string }
  | { ok: false; error: string };

function validateChannels(
  value: unknown,
  definition: ErasedRecordingMode,
  endTick: number,
): ModeConfigResult<Record<string, ResearchChannelRecord>> {
  const rawChannels = record(value);
  if (!rawChannels || Object.keys(rawChannels).length > MAX_RESEARCH_CHANNELS) {
    return { ok: false, error: "That run record has malformed research channels." };
  }
  const channels: Record<string, ResearchChannelRecord> = {};
  for (const [name, rawValue] of Object.entries(rawChannels)) {
    const channelDefinition = definition.channels[name];
    const rawChannel = record(rawValue);
    if (!channelDefinition || !rawChannel || rawChannel.version !== channelDefinition.version ||
        !positiveBoundedInteger(rawChannel.interval, MAX_TICKS) ||
        !positiveBoundedInteger(rawChannel.capacity, MAX_RESEARCH_SAMPLES) ||
        typeof rawChannel.truncated !== "boolean" || !Array.isArray(rawChannel.samples) ||
        rawChannel.samples.length > rawChannel.capacity) {
      return { ok: false, error: `That run record has a malformed or unsupported ${name} channel.` };
    }
    const samples: ResearchSample[] = [];
    let previousTick = -1;
    for (const rawSample of rawChannel.samples) {
      const sample = record(rawSample);
      if (!sample || !Number.isSafeInteger(sample.t) || (sample.t as number) < 0 ||
          (sample.t as number) > endTick || (sample.t as number) <= previousTick) {
        return { ok: false, error: `That run record has malformed ${name} samples.` };
      }
      const parsed = channelDefinition.parse(sample.data);
      if (!parsed.ok || !isJsonValue(parsed.value)) {
        return { ok: false, error: `That run record has an invalid ${name} sample.` };
      }
      previousTick = sample.t as number;
      samples.push({ t: previousTick, data: cloneJson(parsed.value) });
    }
    channels[name] = {
      version: channelDefinition.version,
      interval: rawChannel.interval as number,
      capacity: rawChannel.capacity as number,
      truncated: rawChannel.truncated,
      samples,
    };
  }
  return { ok: true, value: channels };
}

/** Parse an untrusted research record through the exact mode and channel versions that created it. */
export function parseModeRunRecord(text: string, registry: ModeRecordingRegistry): ModeRunRecordParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "That file could not be read as JSON." };
  }
  const candidate = record(raw);
  if (!candidate || candidate.format !== MODE_RUN_RECORD_FORMAT) {
    return { ok: false, error: "That file is not a Stigsim run record." };
  }
  if (candidate.version !== MODE_RUN_RECORD_VERSION) {
    return { ok: false, error: "That run record uses an unsupported format version." };
  }
  const reference = record(candidate.mode);
  if (!reference || !isModeId(reference.id) || !isModeVersion(reference.version)) {
    return { ok: false, error: "That run record has an invalid mode identity." };
  }
  const definition = registry.resolve(reference.id, reference.version);
  if (!definition) {
    return { ok: false, error: `Recording mode ${modeKey(reference.id, reference.version)} is not registered.` };
  }
  if (!Array.isArray(candidate.commands) || candidate.commands.length > MAX_RECORD_COMMANDS) {
    return { ok: false, error: "That run record has a malformed or oversized command list." };
  }
  const rawCommands = candidate.commands.map(item => record(item));
  if (rawCommands.some(command => command === null)) {
    return { ok: false, error: "That run record has a malformed command list." };
  }

  const traceRegistry = new ModeTraceRegistry().register(definition.trace);
  const traceResult = parseModeTrace(JSON.stringify({
    format: MODE_TRACE_FORMAT,
    version: MODE_TRACE_VERSION,
    simVersion: candidate.simVersion,
    createdAt: candidate.createdAt,
    mode: candidate.mode,
    commands: rawCommands.map(command => ({ t: command!.t, cmd: command!.cmd })),
    fingerprints: candidate.fingerprints,
    endTick: candidate.endTick,
  }), traceRegistry);
  if (!traceResult.ok) return traceResult;

  const participants = parseParticipants(candidate.participants);
  if (!participants.ok) return participants;
  const participantIds = new Set(participants.value.map(participant => participant.id));
  const commands: RecordedModeCommand[] = [];
  let previousTick = -1;
  let expectedSequence = 0;
  for (let index = 0; index < rawCommands.length; index++) {
    const rawCommand = rawCommands[index]!;
    const command = traceResult.trace.commands[index];
    const source = parseSource(rawCommand.source, participantIds);
    if (!source.ok) return source;
    if (!Number.isSafeInteger(rawCommand.sequence) || (rawCommand.sequence as number) < 0 ||
        command.t < previousTick) {
      return { ok: false, error: "That run record has commands in a non-canonical order." };
    }
    expectedSequence = command.t === previousTick ? expectedSequence + 1 : 0;
    if (rawCommand.sequence !== expectedSequence) {
      return { ok: false, error: "That run record has a non-canonical command sequence." };
    }
    previousTick = command.t;
    commands.push({
      t: command.t,
      sequence: expectedSequence,
      source: source.value,
      cmd: cloneJson(command.cmd),
    });
  }

  const channels = validateChannels(candidate.channels, definition, traceResult.trace.endTick);
  if (!channels.ok) return channels;
  let outcome: RecordedOutcome | undefined;
  if (candidate.outcome !== undefined) {
    const rawOutcome = record(candidate.outcome);
    if (!definition.outcome || !rawOutcome || rawOutcome.version !== definition.outcome.version) {
      return { ok: false, error: "That run record has a malformed or unsupported outcome." };
    }
    const parsed = definition.outcome.parse(rawOutcome.data);
    if (!parsed.ok || !isJsonValue(parsed.value)) {
      return { ok: false, error: "That run record has an invalid outcome." };
    }
    outcome = { version: definition.outcome.version, data: cloneJson(parsed.value) };
  }

  return {
    ok: true,
    record: {
      format: MODE_RUN_RECORD_FORMAT,
      version: MODE_RUN_RECORD_VERSION,
      simVersion: traceResult.trace.simVersion,
      createdAt: traceResult.trace.createdAt,
      mode: cloneJson(traceResult.trace.mode),
      participants: participants.value,
      commands,
      fingerprints: traceResult.trace.fingerprints.map(checkpoint => ({ ...checkpoint })),
      channels: channels.value,
      ...(outcome === undefined ? {} : { outcome }),
      endTick: traceResult.trace.endTick,
    },
    ...(traceResult.warning === undefined ? {} : { warning: traceResult.warning }),
  };
}

/** Drop research-only fields and recover the deterministic replay primitive. */
export function modeRunRecordToTrace(recording: ModeRunRecord): ModeTrace {
  return {
    format: MODE_TRACE_FORMAT,
    version: MODE_TRACE_VERSION,
    simVersion: recording.simVersion,
    createdAt: recording.createdAt,
    mode: cloneJson(recording.mode),
    commands: recording.commands.map(command => ({ t: command.t, cmd: cloneJson(command.cmd) })),
    fingerprints: recording.fingerprints.map(checkpoint => ({ ...checkpoint })),
    endTick: recording.endTick,
  };
}

export function serializeModeRunRecord(recording: ModeRunRecord): string {
  return JSON.stringify(recording);
}

/** Stream-friendly command export for Python, R, DuckDB, Polars, and similar tools. */
export function modeRunCommandsToNdjson(recording: ModeRunRecord): string {
  return recording.commands.map(command => JSON.stringify(command)).join("\n");
}

/** Stream-friendly export of one mode-owned research channel. */
export function modeRunChannelToNdjson(recording: ModeRunRecord, channel: string): string {
  const selected = recording.channels[channel];
  if (!selected) throw new RangeError(`Run record has no ${channel} channel.`);
  return selected.samples.map(sample => JSON.stringify(sample)).join("\n");
}
