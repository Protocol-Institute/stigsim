import {
  DEFAULT_LAYOUT,
  MAZE_LAYOUTS,
  MAX_COLONIES,
  MAX_FOOD_PER_SOURCE,
  MAX_FOOD_SOURCES,
} from "./constants";
import { isAntCount, validParams } from "./commands";
import { defineMode } from "./sdk";
import { Simulation } from "./sim";
import type { MazeLayout, ModeConfigResult, RunConfig, RunSeeds } from "./types";

export const MAZE_MODE_ID = "maze";
export const MAZE_MODE_VERSION = 1;

const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const isInteger = (value: unknown): value is number =>
  isNumber(value) && Number.isInteger(value);

function parseSeeds(value: unknown): RunSeeds | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const seeds = value as Record<string, unknown>;
  if ((seeds.master !== null && typeof seeds.master !== "string") ||
      typeof seeds.maze !== "string" || typeof seeds.food !== "string" ||
      typeof seeds.ants !== "string") {
    return null;
  }
  return {
    master: seeds.master,
    maze: seeds.maze,
    food: seeds.food,
    ants: seeds.ants,
  };
}

/** Validate and canonicalize the complete recipe for the bounded Maze engine. */
export function parseMazeModeConfig(value: unknown): ModeConfigResult<RunConfig> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, error: "Maze mode config must be an object." };
  }
  const config = value as Record<string, unknown>;
  const seeds = parseSeeds(config.seeds);
  if (!seeds) return { ok: false, error: "Maze mode config has invalid seeds." };
  if (!isAntCount(config.numAnts)) {
    return { ok: false, error: "Maze mode config has an invalid ant count." };
  }
  if (!validParams(config.params)) {
    return { ok: false, error: "Maze mode config has invalid parameters." };
  }
  if (!isNumber(config.loopRate) || config.loopRate < 0 || config.loopRate > 1) {
    return { ok: false, error: "Maze mode config has an invalid loop rate." };
  }
  if (!isInteger(config.numColonies) || config.numColonies < 1 ||
      config.numColonies > MAX_COLONIES) {
    return { ok: false, error: "Maze mode config has an invalid colony count." };
  }
  if (!isInteger(config.numFoodSources) || config.numFoodSources < 0 ||
      config.numFoodSources > MAX_FOOD_SOURCES) {
    return { ok: false, error: "Maze mode config has an invalid food source count." };
  }
  if (!isNumber(config.foodPerSource) || config.foodPerSource <= 0 ||
      config.foodPerSource > MAX_FOOD_PER_SOURCE) {
    return { ok: false, error: "Maze mode config has an invalid food amount." };
  }
  const layout = config.layout ?? DEFAULT_LAYOUT;
  if (!(MAZE_LAYOUTS as readonly unknown[]).includes(layout)) {
    return { ok: false, error: "Maze mode config has an invalid layout." };
  }
  // Never silently downgrade recipes from the separate substrate experiment.
  if (config.fieldMode !== undefined || config.vectorSubstrate !== undefined) {
    return { ok: false, error: "Maze mode config uses an unsupported substrate." };
  }

  return {
    ok: true,
    value: {
      seeds,
      numAnts: config.numAnts,
      params: { tankMax: config.params.tankMax },
      loopRate: config.loopRate,
      numColonies: config.numColonies,
      numFoodSources: config.numFoodSources,
      foodPerSource: config.foodPerSource,
      layout: layout as MazeLayout,
    },
  };
}

/** The original bounded Maze simulation under a stable SDK identity. */
export const mazeMode = defineMode({
  id: MAZE_MODE_ID,
  version: MAZE_MODE_VERSION,
  parseConfig: parseMazeModeConfig,
  create: (config: RunConfig) => new Simulation(config),
});
