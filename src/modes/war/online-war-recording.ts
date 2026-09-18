import type { Doctrine } from "@stigsim/sim-core";
import {
  ModeRunRecorder,
  type CommandSource,
  type ModeRunRecorderOptions,
  type RunParticipant,
} from "@stigsim/sim-trace";
import type { OnlineWarSettings } from "../../../shared/war-contract";
import { warModeConfig } from "./war-mode";
import { warRecordingMode } from "./war-recording";

/**
 * Server profile: frequent metrics, replay-quality commands/fingerprints, and
 * lower-frequency agent/field observations with hard retention ceilings.
 */
export const ONLINE_WAR_RECORDING_PROFILE = {
  metrics: { interval: 10, capacity: 10_000 },
  agents: { interval: 50, capacity: 2_000 },
  fields: { interval: 250, capacity: 400 },
} as const;

export type OnlineWarRecordingChannels = NonNullable<
  ModeRunRecorderOptions<keyof typeof warRecordingMode.channels & string>["channels"]
>;

export function onlineWarParticipants(secondIsBot = false): RunParticipant[] {
  return [
    { id: "online-colony-0", kind: "player", slot: "colony-0" },
    { id: "online-colony-1", kind: secondIsBot ? "bot" : "player", slot: "colony-1" },
  ];
}

export function onlineWarPlayerSource(colonyId: number): CommandSource {
  if (colonyId !== 0 && colonyId !== 1) throw new RangeError("Online War has only two colonies.");
  return { kind: "participant", participantId: `online-colony-${colonyId}` };
}

/** The authoritative server runtime and its recorder are created together. */
export function createOnlineWarRecorder(
  settings: OnlineWarSettings,
  doctrines: readonly Doctrine[] = [],
  secondIsBot = false,
  channels: OnlineWarRecordingChannels = ONLINE_WAR_RECORDING_PROFILE,
) {
  return new ModeRunRecorder(warRecordingMode, warModeConfig(settings, doctrines), {
    participants: onlineWarParticipants(secondIsBot),
    channels,
  });
}
