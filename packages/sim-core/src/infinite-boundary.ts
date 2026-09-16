import {
  DEFAULT_INFINITE_COLONY_PARAMS,
  type InfiniteColonyInfo,
  type InfiniteColonyParams,
  type InfiniteFoodSource,
  type InfinitePersistedWorld,
  type InfiniteSimulation,
} from "./infinite-mode";
import type { ModeConfigResult } from "./types";

export interface InfiniteInitMessage {
  type: "init";
  walls: string[];
  colonies: InfiniteColonyInfo[];
  foodSources: InfiniteFoodSource[];
}

export interface InfiniteTickMessage {
  type: "tick";
  ants: Array<{ cid: number; wx: number; wy: number; f: number }>;
  foodSources: Array<{ x: number; y: number; r: number; t: number }>;
  fc: Array<{ id: number; n: number; ageTicks: number }>;
}

export interface InfinitePheroMessage {
  type: "phero";
  colonies: Array<{
    id: number;
    chunks: Array<{ key: string; home: number[]; food: number[] }>;
    cleared: string[];
  }>;
}

/**
 * Infinite's mode-owned wire boundary.
 *
 * The encoders deliberately remain separate from War's dense-field codec:
 * Infinite emits byte-scaled sparse chunks while War emits rounded dense
 * layers. A host owns JSON framing; the mode owns the message shape.
 */
export const infiniteWireCodec = {
  init(simulation: InfiniteSimulation): InfiniteInitMessage {
    return { type: "init", ...simulation.serializeInit() };
  },

  tick(simulation: InfiniteSimulation): InfiniteTickMessage {
    return { type: "tick", ...simulation.serializeTick() };
  },

  phero(simulation: InfiniteSimulation): InfinitePheroMessage {
    return { type: "phero", colonies: simulation.serializePhero() };
  },
};

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function parseWalls(value: unknown): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some(wall => typeof wall !== "string")) return null;
  return [...value];
}

function parseParams(value: unknown): Partial<InfiniteColonyParams> | null {
  const params = record(value);
  if (!params) return null;
  const result: Partial<InfiniteColonyParams> = {};
  const numbers = ["numAnts", "evapRate", "trailPower", "tankMax", "colorIdx"] as const;
  for (const key of numbers) {
    if (params[key] !== undefined) {
      if (!finiteNumber(params[key])) return null;
      result[key] = params[key];
    }
  }
  if (params.cautionary !== undefined) {
    if (typeof params.cautionary !== "boolean") return null;
    result.cautionary = params.cautionary;
  }
  if (params.name !== undefined) {
    if (typeof params.name !== "string") return null;
    result.name = params.name;
  }
  return result;
}

interface ParsedColony {
  id?: number;
  nestX: number;
  nestY: number;
  params: Partial<InfiniteColonyParams>;
  foodCollected: number;
  ageTicks: number;
}

function parseColonies(value: unknown): ParsedColony[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const colonies: ParsedColony[] = [];
  for (const item of value) {
    const colony = record(item);
    if (!colony || !finiteNumber(colony.nestX) || !finiteNumber(colony.nestY)) return null;
    const params = parseParams(colony.params);
    if (!params || (colony.id !== undefined && !nonNegativeInteger(colony.id)) ||
        (colony.foodCollected !== undefined && !finiteNumber(colony.foodCollected)) ||
        (colony.ageTicks !== undefined && !finiteNumber(colony.ageTicks))) {
      return null;
    }
    colonies.push({
      ...(colony.id !== undefined ? { id: colony.id as number } : {}),
      nestX: colony.nestX,
      nestY: colony.nestY,
      params,
      foodCollected: colony.foodCollected as number | undefined ?? 0,
      ageTicks: colony.ageTicks as number | undefined ?? 0,
    });
  }
  return colonies;
}

function parseFoodSources(value: unknown): InfiniteFoodSource[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const sources: InfiniteFoodSource[] = [];
  for (const item of value) {
    const source = record(item);
    if (!source || !finiteNumber(source.x) || !finiteNumber(source.y) ||
        !finiteNumber(source.remaining) || !finiteNumber(source.total)) return null;
    sources.push({
      x: source.x,
      y: source.y,
      remaining: source.remaining,
      total: source.total,
    });
  }
  return sources;
}

function invalidPersistence(error: string): ModeConfigResult<void> {
  return { ok: false, error };
}

function hasRestorableColonyIds(
  simulation: InfiniteSimulation,
  colonies: readonly ParsedColony[],
): boolean {
  const ids = new Set(simulation.colonies.map(colony => colony.id));
  let nextId = simulation.serializePersistence().nextColonyId;
  for (const colony of colonies) {
    const id = colony.id ?? nextId++;
    if (ids.has(id)) return false;
    ids.add(id);
    nextId = Math.max(nextId, id + 1);
  }
  return true;
}

/** Versioned durable-state boundary, including the deployed pre-v1 seed shape. */
export const infinitePersistenceCodec = {
  version: 1 as const,

  encode(simulation: InfiniteSimulation): InfinitePersistedWorld {
    return simulation.serializePersistence();
  },

  restore(simulation: InfiniteSimulation, value: unknown): ModeConfigResult<void> {
    const world = record(value);
    if (!world) return invalidPersistence("Infinite persistence must be an object.");
    if (world.version !== undefined && world.version !== 1) {
      return invalidPersistence("Unsupported Infinite persistence version.");
    }
    const walls = parseWalls(world.walls);
    const colonies = parseColonies(world.colonies);
    const foodSources = parseFoodSources(world.foodSources);
    if (!walls || !colonies || !foodSources) {
      return invalidPersistence("Infinite persistence contains invalid world data.");
    }
    if (!hasRestorableColonyIds(simulation, colonies)) {
      return invalidPersistence("Infinite persistence contains duplicate colony ids.");
    }

    if (world.version === 1) {
      if (!nonNegativeInteger(world.nextColonyId) || colonies.some(colony => colony.id === undefined)) {
        return invalidPersistence("Infinite persistence v1 has invalid colony ids.");
      }
      simulation.restorePersistence({
        version: 1,
        nextColonyId: world.nextColonyId,
        walls,
        colonies: colonies.map(colony => ({
          id: colony.id!,
          nestX: colony.nestX,
          nestY: colony.nestY,
          params: { ...DEFAULT_INFINITE_COLONY_PARAMS, ...colony.params },
          foodCollected: colony.foodCollected,
          ageTicks: colony.ageTicks,
        })),
        foodSources,
      });
      return { ok: true, value: undefined };
    }

    // Pre-v1 seeds and snapshots omitted the version and sometimes colony ids.
    if (world.nextColonyId !== undefined && !nonNegativeInteger(world.nextColonyId)) {
      return invalidPersistence("Infinite persistence has an invalid next colony id.");
    }
    for (const wall of walls) simulation.walls.add(wall);
    for (const colony of colonies) {
      if (colony.id !== undefined) {
        simulation.restoreColony({
          id: colony.id,
          nestX: colony.nestX,
          nestY: colony.nestY,
          params: { ...DEFAULT_INFINITE_COLONY_PARAMS, ...colony.params },
          foodCollected: Math.max(0, colony.foodCollected),
          ageTicks: Math.max(0, colony.ageTicks),
        });
      } else {
        simulation.addColony(colony.nestX, colony.nestY, colony.params);
      }
    }
    if (world.nextColonyId !== undefined) {
      simulation.restoreNextColonyId(world.nextColonyId);
    }
    for (const food of foodSources) {
      if (food.remaining <= 0) continue;
      const source = simulation.addFood(food.x, food.y, food.remaining);
      source.total = Math.max(source.remaining, food.total);
    }
    return { ok: true, value: undefined };
  },
};
