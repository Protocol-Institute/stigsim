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

/**
 * Both layouts are generated from the match seed; the difference is whether
 * the result is the same from either nest. The internal name of the second
 * stays `random` because it is what traces and match records carry.
 */
export const LAYOUT_CHOICES: readonly LayoutChoice[] = [
  {
    name: "mirrored",
    label: "Mirrored",
    description: "A seed-generated maze that is identical from either nest, with food in matched pairs: one near each nest when there are more than two sources, the rest where the two halves meet. A single source sits at the exact centre.",
  },
  {
    name: "random",
    label: "Asymmetric",
    description: "A seed-generated maze with no symmetry and food placed anywhere. Neither colony is guaranteed a fair start.",
  },
];

/** The choice for a layout, treating a missing value (a match recorded before layouts existed) as asymmetric. */
export function layoutChoice(layout: MazeLayout | undefined): LayoutChoice {
  return LAYOUT_CHOICES.find(choice => choice.name === (layout ?? "random")) ?? LAYOUT_CHOICES[LAYOUT_CHOICES.length - 1];
}
