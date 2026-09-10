import { generateMasterSeed } from "@stigsim/sim-core";
import type { OnlineWarSettings } from "../../../shared/war-contract";

export function settingsForOnlineWarSetup(
  mode: "human" | "random",
  settings: OnlineWarSettings,
  generateSeed: () => string = generateMasterSeed,
): OnlineWarSettings {
  return mode === "random"
    ? { ...settings, masterSeed: generateSeed() }
    : settings;
}
