import type { SimParams } from "@stigsim/sim-core";

export function sameWarDoctrine(first: SimParams, second: SimParams): boolean {
  return first.evapRate === second.evapRate
    && first.trailPower === second.trailPower
    && first.tankMax === second.tankMax
    && first.cautionary === second.cautionary;
}
