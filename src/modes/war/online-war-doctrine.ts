import type { WarDoctrine } from "../../../shared/war-doctrine";

export function sameWarDoctrine(first: WarDoctrine, second: WarDoctrine): boolean {
  return first.v === second.v
    && first.evapRate === second.evapRate
    && first.trailPower === second.trailPower
    && first.tankMax === second.tankMax
    && first.cautionary === second.cautionary
    && first.spoilerFraction === second.spoilerFraction
    && first.mimicRate === second.mimicRate;
}
