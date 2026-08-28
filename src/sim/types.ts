export interface SimParams {
  evapRate: number;
  trailPower: number;
  tankMax: number;
  cautionary: boolean;
}

export const DEFAULT_PARAMS: SimParams = {
  evapRate: 0.005,
  trailPower: 5,
  tankMax: 6400,
  cautionary: false,
};

export type CellType = 0 | 1;
export type AntState = "searching" | "returning";

export interface FoodSource {
  x: number;
  y: number;
  remaining: number;
  total: number;
}

export interface Colony {
  id: number;
  nestX: number;
  nestY: number;
  homePhero: Float32Array;
  foodPhero: Float32Array;
  cautPhero: Float32Array;
  ants: Ant[];
  foodCollected: number;
  discoveredSources: Set<number>;
}

export interface Ant {
  x: number; y: number;
  cx: number; cy: number;
  tx: number; ty: number;
  prevCx: number; prevCy: number;
  state: AntState;
  hasFood: boolean;
  tank: number;
  colonyId: number;
  manual?: boolean;
}

export interface RunSeeds {
  /** Null when the three streams were seeded independently. */
  master: string | null;
  maze: string;
  food: string;
  ants: string;
}

export interface RunConfig {
  seeds: RunSeeds;
  numAnts: number;
  params: SimParams;
  loopRate: number;
  numColonies: number;
  numFoodSources: number;
  foodPerSource: number;
}
