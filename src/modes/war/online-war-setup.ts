import { generateMasterSeed } from "@stigsim/sim-core";
import type { OnlineWarSettings } from "../../../shared/war-contract";

export function settingsForOnlineWarSetup(
  mode: "human" | "random" | "agent",
  settings: OnlineWarSettings,
  generateSeed: () => string = generateMasterSeed,
): OnlineWarSettings {
  return mode !== "human"
    ? { ...settings, masterSeed: generateSeed() }
    : settings;
}
