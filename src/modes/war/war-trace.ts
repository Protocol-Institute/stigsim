import {
  cloneDoctrine,
  isDoctrine,
  type Doctrine,
  type ModeConfigResult,
} from "@stigsim/sim-core";
import { defineTraceMode } from "@stigsim/sim-trace";
import { warMode } from "./war-mode";

export interface WarModeCommand {
  kind: "set-doctrine";
  colonyId: number;
  doctrine: Doctrine;
}

export function parseWarModeCommand(value: unknown): ModeConfigResult<WarModeCommand> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, error: "War command must be an object." };
  }
  const command = value as Record<string, unknown>;
  if (command.kind !== "set-doctrine" ||
      (command.colonyId !== 0 && command.colonyId !== 1) ||
      !isDoctrine(command.doctrine)) {
    return { ok: false, error: "War doctrine command is malformed or outside the supported range." };
  }
  return {
    ok: true,
    value: {
      kind: "set-doctrine",
      colonyId: command.colonyId,
      doctrine: cloneDoctrine(command.doctrine),
    },
  };
}

export const warTraceMode = defineTraceMode({
  mode: warMode,
  parseCommand: parseWarModeCommand,
  applyCommand: (runtime, command) => runtime.setDoctrine(command.colonyId, command.doctrine),
  fingerprint: runtime => runtime.fingerprint(),
});
