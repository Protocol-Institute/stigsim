import {
  ADOPTION_MODES,
  DEFAULT_DOCTRINE,
  MAZE_LAYOUTS,
  MAX_ANTS_PER_COLONY,
  MAX_FOOD_PER_SOURCE,
  MAX_FOOD_SOURCES,
  MAX_TICKS,
  cloneDoctrine,
  cloneTopology,
  defineMode,
  isAntCount,
  isDoctrine,
  isTankMax,
  isTopology,
  type Doctrine,
  type MazeLayout,
  type ModeConfigResult,
} from "@stigsim/sim-core";
import {
  WAR_RULES,
  WarSimulation,
  type WarMatchSettings,
  type WarRules,
} from "./war-simulation";

export const WAR_MODE_ID = "war";
export const WAR_MODE_VERSION = 1;

export interface WarModeConfig {
  settings: WarMatchSettings;
  doctrines: [Doctrine, Doctrine];
  rules: WarRules;
}

const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const isInt = (value: unknown): value is number =>
  isNumber(value) && Number.isInteger(value);
const inRange = (value: unknown, min: number, max: number): value is number =>
  isNumber(value) && value >= min && value <= max;
const intInRange = (value: unknown, min: number, max: number): value is number =>
  isInt(value) && value >= min && value <= max;

function parseSettings(value: unknown): WarMatchSettings | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const settings = value as Record<string, unknown>;
  if (typeof settings.masterSeed !== "string" || settings.masterSeed.length < 1 ||
      settings.masterSeed.length > 200 || !isAntCount(settings.startingAnts) ||
      !inRange(settings.loopRate, 0, 1) ||
      !intInRange(settings.foodSources, 0, MAX_FOOD_SOURCES) ||
      !inRange(settings.foodPerSource, Number.MIN_VALUE, MAX_FOOD_PER_SOURCE) ||
      !isTankMax(settings.tankMax) || !isTopology(settings.topology) ||
      !(MAZE_LAYOUTS as readonly unknown[]).includes(settings.layout) ||
      !(ADOPTION_MODES as readonly unknown[]).includes(settings.adoption)) {
    return null;
  }
  return {
    masterSeed: settings.masterSeed,
    startingAnts: settings.startingAnts,
    loopRate: settings.loopRate,
    foodSources: settings.foodSources,
    foodPerSource: settings.foodPerSource,
    tankMax: settings.tankMax,
    topology: cloneTopology(settings.topology),
    layout: settings.layout as MazeLayout,
    adoption: settings.adoption as WarMatchSettings["adoption"],
  };
}

function parseDoctrines(value: unknown): [Doctrine, Doctrine] | null {
  if (!Array.isArray(value) || value.length !== 2 ||
      !isDoctrine(value[0]) || !isDoctrine(value[1])) {
    return null;
  }
  return [cloneDoctrine(value[0]), cloneDoctrine(value[1])];
}

function parseRules(value: unknown): WarRules | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const rules = value as Record<string, unknown>;
  if (!inRange(rules.maxEnergy, Number.MIN_VALUE, MAX_FOOD_PER_SOURCE) ||
      !inRange(rules.retreatEnergy, 0, rules.maxEnergy) ||
      !inRange(rules.minDepartEnergy, 0, rules.maxEnergy) ||
      !inRange(rules.moveEnergyCost, 0, MAX_FOOD_PER_SOURCE) ||
      !inRange(rules.waitEnergyCost, 0, MAX_FOOD_PER_SOURCE) ||
      !inRange(rules.energyPerFood, 0, MAX_FOOD_PER_SOURCE) ||
      !inRange(rules.foodDeliveryValue, 0, MAX_FOOD_PER_SOURCE) ||
      !inRange(rules.startingReservePerAnt, 0, MAX_FOOD_PER_SOURCE) ||
      !inRange(rules.reproductionCost, Number.MIN_VALUE, MAX_FOOD_PER_SOURCE) ||
      !intInRange(rules.reproductionCheckSteps, 1, MAX_TICKS) ||
      !intInRange(rules.hatchSteps, 0, MAX_TICKS) ||
      !inRange(rules.safetyReservePerAnt, 0, MAX_FOOD_PER_SOURCE) ||
      !intInRange(rules.emergencyPopulationLimit, 0, MAX_ANTS_PER_COLONY * 10)) {
    return null;
  }
  return {
    maxEnergy: rules.maxEnergy,
    retreatEnergy: rules.retreatEnergy,
    minDepartEnergy: rules.minDepartEnergy,
    moveEnergyCost: rules.moveEnergyCost,
    waitEnergyCost: rules.waitEnergyCost,
    energyPerFood: rules.energyPerFood,
    foodDeliveryValue: rules.foodDeliveryValue,
    startingReservePerAnt: rules.startingReservePerAnt,
    reproductionCost: rules.reproductionCost,
    reproductionCheckSteps: rules.reproductionCheckSteps,
    hatchSteps: rules.hatchSteps,
    safetyReservePerAnt: rules.safetyReservePerAnt,
    emergencyPopulationLimit: rules.emergencyPopulationLimit,
  };
}

/** Parse the complete, serializable recipe needed to reconstruct a War match. */
export function parseWarModeConfig(value: unknown): ModeConfigResult<WarModeConfig> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, error: "War mode config must be an object." };
  }
  const config = value as Record<string, unknown>;
  const settings = parseSettings(config.settings);
  if (!settings) return { ok: false, error: "War mode config has invalid settings." };
  const doctrines = parseDoctrines(config.doctrines);
  if (!doctrines) return { ok: false, error: "War mode config has invalid doctrines." };
  const rules = parseRules(config.rules);
  if (!rules) return { ok: false, error: "War mode config has invalid rules." };
  return { ok: true, value: { settings, doctrines, rules } };
}

/** The existing War engine and policy behind a reconstructible SDK identity. */
export const warMode = defineMode({
  id: WAR_MODE_ID,
  version: WAR_MODE_VERSION,
  parseConfig: parseWarModeConfig,
  create: (config: WarModeConfig) =>
    new WarSimulation(config.settings, config.doctrines, config.rules),
});

/** Canonical production recipe; callers may replace doctrines but not omit behavior rules. */
export function warModeConfig(
  settings: WarMatchSettings,
  doctrines: readonly Doctrine[] = [],
): WarModeConfig {
  return {
    settings: {
      ...settings,
      topology: cloneTopology(settings.topology),
    },
    doctrines: [
      cloneDoctrine(doctrines[0] ?? DEFAULT_DOCTRINE),
      cloneDoctrine(doctrines[1] ?? DEFAULT_DOCTRINE),
    ],
    rules: { ...WAR_RULES },
  };
}
