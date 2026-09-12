import type { AdoptionMode } from "@stigsim/sim-core";

/**
 * When a doctrine change reaches the ants, as a War match setting, with the
 * words the setup screen, lobby, and colony panels use for it.
 */
export interface AdoptionChoice {
  name: AdoptionMode;
  label: string;
  description: string;
  /** Shown under the doctrine panel once a colony has changed its doctrine. */
  note: string;
}

export const ADOPTION_CHOICES: readonly AdoptionChoice[] = [
  {
    name: "nest",
    label: "On return to nest",
    description: "Each ant picks up new follow and lay behavior when it next reaches the nest, so a change spreads through the colony over a round trip. Evaporation, spoiler share, and mimic rate apply on the next tick regardless.",
    note: "Follow and lay behavior updates when each ant returns; colony-level settings apply on the next tick.",
  },
  {
    name: "instant",
    label: "Instant",
    description: "Every ant switches to the new doctrine on the next tick, wherever it is. The colony reacts at once, and a change costs nothing to undo.",
    note: "Every ant switched on the next tick.",
  },
];

/** The choice for a mode, treating a missing value (a match recorded before this setting existed) as on-return. */
export function adoptionChoice(mode: AdoptionMode | undefined): AdoptionChoice {
  return ADOPTION_CHOICES.find(choice => choice.name === (mode ?? "nest")) ?? ADOPTION_CHOICES[0];
}
