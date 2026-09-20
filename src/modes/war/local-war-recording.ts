import type { Doctrine } from "@stigsim/sim-core";
import {
  ModeRunRecorder,
  type CommandSource,
  type RunParticipant,
} from "@stigsim/sim-trace";
import { warModeConfig } from "./war-mode";
import { warRecordingMode } from "./war-recording";
import type { WarMatchSettings } from "./war-simulation";
import {
  createWarReplay,
  parseWarRunRecord,
  warRunRecordFilename,
  type WarRunRecord,
} from "./war-run-record";

export const LOCAL_WAR_PARTICIPANTS: RunParticipant[] = [
  { id: "local-colony-0", kind: "player", slot: "colony-0" },
  { id: "local-colony-1", kind: "player", slot: "colony-1" },
];

export type LocalWarRecord = WarRunRecord;

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
export const parseLocalWarRecord = parseWarRunRecord;

export const createLocalWarReplay = createWarReplay;

export const localWarRecordFilename = warRunRecordFilename;
