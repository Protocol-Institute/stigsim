import { DEFAULT_PARAMS, type SimParams } from "@stigsim/sim-core";

/**
 * The deliberately small first version of War doctrine. The versioned shape
 * leaves room for the richer role/state/channel tables explored in PR #13
 * without making that whole experimental vocabulary a prerequisite.
 */
export interface WarDoctrine extends SimParams {
  v: 1;
  spoilerFraction: number;
  mimicRate: number;
}

export const DEFAULT_WAR_DOCTRINE: WarDoctrine = {
  ...DEFAULT_PARAMS,
  v: 1,
  spoilerFraction: 0,
  mimicRate: 0.5,
};

export function copyWarDoctrine(params: SimParams | WarDoctrine): WarDoctrine {
  return {
    ...DEFAULT_WAR_DOCTRINE,
    ...params,
    v: 1,
  };
}
