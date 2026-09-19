import {
  ModeRecordingRegistry,
  ModeTraceRegistry,
  ModeTraceReplayer,
  modeRunRecordToTrace,
  parseModeRunRecord,
  parseModeRunRecordValue,
  type ModeRunRecord,
  type ModeRunRecordParseResult,
} from "@stigsim/sim-trace";
import type { WarModeConfig } from "./war-mode";
import { warRecordingMode } from "./war-recording";
import type { WarSimulation } from "./war-simulation";
import { warTraceMode, type WarModeCommand } from "./war-trace";

export type WarRunRecord = ModeRunRecord<WarModeConfig, WarModeCommand>;

function recordingRegistry(): ModeRecordingRegistry {
  return new ModeRecordingRegistry().register(warRecordingMode);
}

/** Parse an untrusted War run record through the exact recording-mode version it names. */
export function parseWarRunRecord(text: string): ModeRunRecordParseResult & { record?: WarRunRecord } {
  const parsed = parseModeRunRecord(text, recordingRegistry());
  return parsed.ok
    ? { ...parsed, record: parsed.record as WarRunRecord }
    : parsed;
}

/** Validate a decoded War record without serializing the persistence envelope again. */
export function parseWarRunRecordValue(value: unknown): ModeRunRecordParseResult & { record?: WarRunRecord } {
  const parsed = parseModeRunRecordValue(value, recordingRegistry());
  return parsed.ok
    ? { ...parsed, record: parsed.record as WarRunRecord }
    : parsed;
}

export function createWarReplay(record: WarRunRecord): ModeTraceReplayer<WarSimulation> {
  return new ModeTraceReplayer<WarSimulation>(
    modeRunRecordToTrace(record),
    new ModeTraceRegistry().register(warTraceMode),
  );
}

export function warRunRecordFilename(record: WarRunRecord): string {
  const seed = record.mode.config.settings.masterSeed
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "custom";
  return `stigsim-war-${seed}-${record.endTick}.run.json`;
}
