import type { Doctrine } from "@stigsim/sim-core";
import {
  ModeRecordingRegistry,
  ModeRunRecorder,
  ModeTraceRegistry,
  ModeTraceReplayer,
  modeRunRecordToTrace,
  parseModeRunRecord,
  type CommandSource,
  type ModeRunRecord,
  type ModeRunRecordParseResult,
  type RunParticipant,
} from "@stigsim/sim-trace";
import { warModeConfig, type WarModeConfig } from "./war-mode";
import { warRecordingMode } from "./war-recording";
import type { WarMatchSettings, WarSimulation } from "./war-simulation";
import { warTraceMode, type WarModeCommand } from "./war-trace";

export const LOCAL_WAR_PARTICIPANTS: RunParticipant[] = [
  { id: "local-colony-0", kind: "player", slot: "colony-0" },
  { id: "local-colony-1", kind: "player", slot: "colony-1" },
];

export type LocalWarRecord = ModeRunRecord<WarModeConfig, WarModeCommand>;

export function localWarPlayerSource(colonyId: number): CommandSource {
  if (colonyId !== 0 && colonyId !== 1) throw new RangeError("Local War has only two player colonies.");
  return { kind: "participant", participantId: LOCAL_WAR_PARTICIPANTS[colonyId].id };
}

/** Create the live local runtime and its research recorder through one factory. */
export function createLocalWarRecorder(settings: WarMatchSettings, doctrines: readonly Doctrine[]) {
  return new ModeRunRecorder(warRecordingMode, warModeConfig(settings, doctrines), {
    participants: LOCAL_WAR_PARTICIPANTS,
  });
}

/** Parse only exact-version War records, then recover their useful static type. */
export function parseLocalWarRecord(text: string): ModeRunRecordParseResult & { record?: LocalWarRecord } {
  const parsed = parseModeRunRecord(
    text,
    new ModeRecordingRegistry().register(warRecordingMode),
  );
  return parsed.ok
    ? { ...parsed, record: parsed.record as LocalWarRecord }
    : parsed;
}

export function createLocalWarReplay(record: LocalWarRecord): ModeTraceReplayer<WarSimulation> {
  return new ModeTraceReplayer<WarSimulation>(
    modeRunRecordToTrace(record),
    new ModeTraceRegistry().register(warTraceMode),
  );
}

export function localWarRecordFilename(record: LocalWarRecord): string {
  const seed = record.mode.config.settings.masterSeed
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "custom";
  return `stigsim-war-${seed}-${record.endTick}.run.json`;
}
