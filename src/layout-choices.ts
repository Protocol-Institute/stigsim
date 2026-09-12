import type { MazeLayout } from "@stigsim/sim-core";

/**
 * The map layouts a War match can be created with, in display order, with
 * the words the setup screen and lobby use for them.
 */
export interface LayoutChoice {
  name: MazeLayout;
  label: string;
  description: string;
}

export const LAYOUT_CHOICES: readonly LayoutChoice[] = [
  {
    name: "mirrored",
    label: "Mirrored",
    description: "The maze is identical from either nest, and food comes in matched pairs: one near each nest when there are more than two sources, the rest where the two halves meet. A single source sits at the exact centre.",
  },
  {
    name: "random",
    label: "Random",
    description: "One random maze and random food placement. Neither colony is guaranteed a fair start.",
  },
];

/** The choice for a layout, treating a missing value (a match recorded before layouts existed) as random. */
export function layoutChoice(layout: MazeLayout | undefined): LayoutChoice {
  return LAYOUT_CHOICES.find(choice => choice.name === (layout ?? "random")) ?? LAYOUT_CHOICES[LAYOUT_CHOICES.length - 1];
}
