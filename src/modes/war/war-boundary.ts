import {
  ADOPTION_MODES,
  MAZE_LAYOUTS,
  DenseField,
  DenseGrid,
  cloneDoctrine,
  cloneTopology,
  isDoctrine,
  isTopology,
  type Doctrine,
} from "@stigsim/sim-core";
import {
  DEFAULT_ONLINE_WAR_SETTINGS,
  type OnlineWarSettings,
  type WarMatchPhase,
  type WarMatchRecord,
  type WarMetricsWire,
  type WarSnapshot,
} from "../../../shared/war-contract";
import type { WarSimulation } from "./war-simulation";

export interface WarSnapshotSource {
  war: WarSimulation;
  phase: WarMatchPhase;
  settings: OnlineWarSettings;
}

function pheromoneWireValues(layer: Float32Array): number[] {
  return Array.from(layer, value => Math.round(value * 1_000) / 1_000);
}

/**
 * War's mode-owned wire boundary. Its rounded dense layers intentionally do
 * not share Infinite's byte-scaled sparse-chunk codec.
 */
export const warWireCodec = {
  snapshot(match: WarSnapshotSource): WarSnapshot {
    const simulation = match.war.simulation;
    const grid = simulation.occupancy;
    if (!(grid instanceof DenseGrid)) throw new Error("Online War requires a bounded dense maze");
    return {
      tick: simulation.tick,
      phase: match.phase,
      winner: match.war.result,
      settings: {
        ...match.settings,
        topology: cloneTopology(match.settings.topology),
      },
      grid: grid.cells.map(row => [...row]),
      foodSources: simulation.foodSources.map(source => ({ ...source })),
      colonies: simulation.colonies.map(colony => {
        if (!(colony.field instanceof DenseField)) throw new Error("Online War requires dense pheromone fields");
        return {
          id: colony.id,
          nestX: colony.nestX,
          nestY: colony.nestY,
          homePhero: pheromoneWireValues(colony.field.layer("home")),
          foodPhero: pheromoneWireValues(colony.field.layer("food")),
          receivedPhero: [...colony.received].map(([from, field]) => {
            if (!(field instanceof DenseField)) throw new Error("Online War requires dense provenance fields");
            return {
              from,
              home: pheromoneWireValues(field.layer("home")),
              food: pheromoneWireValues(field.layer("food")),
            };
          }),
          ants: colony.ants.map(ant => {
            const runtime = match.war.getAntSnapshot(ant);
            if (!runtime) throw new Error("War ant is missing runtime state");
            return {
              id: runtime.id,
              x: ant.x,
              y: ant.y,
              tx: ant.tx,
              ty: ant.ty,
              hasFood: ant.hasFood,
              phase: runtime.phase,
              energy: runtime.energy,
              role: runtime.role,
              doctrineVersion: runtime.doctrineVersion,
            };
          }),
          metrics: match.war.getMetrics(colony.id),
          doctrine: match.war.getDoctrine(colony.id),
        };
      }),
    };
  },
};

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parseSettings(value: unknown): OnlineWarSettings | null {
  const settings = record(value);
  if (!settings || typeof settings.masterSeed !== "string" ||
      !finite(settings.stepsPerSecond) || !finite(settings.startingAnts) ||
      !finite(settings.foodSources) || !finite(settings.foodPerSource) ||
      !finite(settings.loopRate)) return null;
  return {
    masterSeed: settings.masterSeed,
    stepsPerSecond: settings.stepsPerSecond,
    startingAnts: settings.startingAnts,
    foodSources: settings.foodSources,
    foodPerSource: settings.foodPerSource,
    loopRate: settings.loopRate,
    tankMax: finite(settings.tankMax)
      ? settings.tankMax
      : DEFAULT_ONLINE_WAR_SETTINGS.tankMax,
    topology: isTopology(settings.topology)
      ? cloneTopology(settings.topology)
      : cloneTopology(DEFAULT_ONLINE_WAR_SETTINGS.topology),
    // Records written before these fields existed were played on the only
    // layout and adoption mode available then, not on today's defaults.
    layout: (MAZE_LAYOUTS as readonly unknown[]).includes(settings.layout)
      ? settings.layout as OnlineWarSettings["layout"]
      : "random",
    adoption: (ADOPTION_MODES as readonly unknown[]).includes(settings.adoption)
      ? settings.adoption as OnlineWarSettings["adoption"]
      : "nest",
  };
}

const METRIC_NUMBERS: ReadonlyArray<keyof WarMetricsWire> = [
  "population",
  "foodCollected",
  "reserve",
  "hatching",
  "searching",
  "carrying",
  "retreating",
  "waiting",
  "lowEnergy",
  "births",
  "deaths",
  "doctrineAdopted",
];

function parseMetrics(value: unknown): WarMetricsWire[] | null {
  if (!Array.isArray(value)) return null;
  const metrics: WarMetricsWire[] = [];
  for (const item of value) {
    const metric = record(item);
    if (!metric || METRIC_NUMBERS.some(key => !finite(metric[key])) ||
        typeof metric.doctrineChanged !== "boolean") return null;
    metrics.push({
      population: metric.population as number,
      foodCollected: metric.foodCollected as number,
      reserve: metric.reserve as number,
      hatching: metric.hatching as number,
      searching: metric.searching as number,
      carrying: metric.carrying as number,
      retreating: metric.retreating as number,
      waiting: metric.waiting as number,
      lowEnergy: metric.lowEnergy as number,
      births: metric.births as number,
      deaths: metric.deaths as number,
      doctrineChanged: metric.doctrineChanged,
      doctrineAdopted: metric.doctrineAdopted as number,
    });
  }
  return metrics;
}

function parseDoctrines(value: unknown): Doctrine[] | null {
  if (!Array.isArray(value) || value.some(doctrine => !isDoctrine(doctrine))) return null;
  return value.map(doctrine => cloneDoctrine(doctrine));
}

/** Parse and migrate one persisted completed-match record before it reaches the lobby. */
export function parseWarMatchRecord(value: unknown): WarMatchRecord | null {
  const candidate = record(value);
  if (!candidate || typeof candidate.recordId !== "string" ||
      typeof candidate.matchId !== "string" || typeof candidate.completedAt !== "string" ||
      !Array.isArray(candidate.playerNames) || candidate.playerNames.length !== 2 ||
      candidate.playerNames.some(name => name !== null && typeof name !== "string") ||
      (candidate.winner !== 0 && candidate.winner !== 1 && candidate.winner !== "draw") ||
      !Number.isSafeInteger(candidate.finalTick) || (candidate.finalTick as number) < 0) return null;
  const settings = parseSettings(candidate.settings);
  const finalMetrics = parseMetrics(candidate.finalMetrics);
  const finalDoctrines = parseDoctrines(candidate.finalDoctrines);
  if (!settings || !finalMetrics || !finalDoctrines) return null;
  return {
    recordId: candidate.recordId,
    matchId: candidate.matchId,
    completedAt: candidate.completedAt,
    playerNames: [...candidate.playerNames] as Array<string | null>,
    winner: candidate.winner,
    settings,
    finalTick: candidate.finalTick as number,
    finalMetrics,
    finalDoctrines,
  };
}
