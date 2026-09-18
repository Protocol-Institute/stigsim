import {
  COLS,
  MAX_ANTS_PER_COLONY,
  MAX_FOOD_PER_SOURCE,
  MAX_FOOD_SOURCES,
  ROWS,
  ROLES,
  DenseField,
  type ModeConfigResult,
  type Role,
} from "@stigsim/sim-core";
import {
  defineRecordingMode,
  defineResearchChannel,
} from "@stigsim/sim-trace";
import type {
  WarAntPhase,
  WarColonyMetrics,
  WarResult,
  WarSimulation,
} from "./war-simulation";
import { warTraceMode } from "./war-trace";

export interface WarMetricsObservation {
  result: WarResult;
  foodRemaining: number[];
  colonies: WarColonyMetrics[];
}

export interface WarAgentObservation {
  colonies: Array<{
    id: number;
    ants: Array<{
      id: number;
      x: number;
      y: number;
      cx: number;
      cy: number;
      tx: number;
      ty: number;
      hasFood: boolean;
      phase: WarAntPhase;
      energy: number;
      role: Role;
      doctrineVersion: number;
    }>;
  }>;
}

export interface WarFieldObservation {
  colonies: Array<{
    id: number;
    home: number[];
    food: number[];
    caut: number[];
    received: Array<{
      from: number;
      home: number[];
      food: number[];
      caut: number[];
    }>;
  }>;
}

export interface WarResearchOutcome {
  winner: Exclude<WarResult, null>;
  tick: number;
  colonies: WarColonyMetrics[];
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function nonNegative(value: unknown): value is number {
  return finite(value) && value >= 0;
}

function natural(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

const METRIC_NUMBER_KEYS: ReadonlyArray<keyof WarColonyMetrics> = [
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

function parseMetrics(value: unknown): WarColonyMetrics | null {
  const candidate = record(value);
  if (!candidate || METRIC_NUMBER_KEYS.some(key => !nonNegative(candidate[key])) ||
      typeof candidate.doctrineChanged !== "boolean") return null;
  return {
    population: candidate.population as number,
    foodCollected: candidate.foodCollected as number,
    reserve: candidate.reserve as number,
    hatching: candidate.hatching as number,
    searching: candidate.searching as number,
    carrying: candidate.carrying as number,
    retreating: candidate.retreating as number,
    waiting: candidate.waiting as number,
    lowEnergy: candidate.lowEnergy as number,
    births: candidate.births as number,
    deaths: candidate.deaths as number,
    doctrineChanged: candidate.doctrineChanged,
    doctrineAdopted: candidate.doctrineAdopted as number,
  };
}

function parseMetricsList(value: unknown): WarColonyMetrics[] | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const parsed = value.map(parseMetrics);
  return parsed.some(metric => metric === null) ? null : parsed as WarColonyMetrics[];
}

function validResult(value: unknown): value is WarResult {
  return value === null || value === 0 || value === 1 || value === "draw";
}

export function parseWarMetricsObservation(value: unknown): ModeConfigResult<WarMetricsObservation> {
  const candidate = record(value);
  const colonies = parseMetricsList(candidate?.colonies);
  if (!candidate || !validResult(candidate.result) || !colonies ||
      !Array.isArray(candidate.foodRemaining) || candidate.foodRemaining.length > MAX_FOOD_SOURCES ||
      candidate.foodRemaining.some(amount => !nonNegative(amount) || amount > MAX_FOOD_PER_SOURCE)) {
    return { ok: false, error: "War metrics observation is malformed or outside the supported range." };
  }
  return {
    ok: true,
    value: {
      result: candidate.result,
      foodRemaining: [...candidate.foodRemaining] as number[],
      colonies,
    },
  };
}

function captureMetrics(runtime: WarSimulation): WarMetricsObservation {
  return {
    result: runtime.result,
    foodRemaining: runtime.simulation.foodSources.map(source => source.remaining),
    colonies: runtime.simulation.colonies.map(colony => runtime.getMetrics(colony.id)),
  };
}

const WAR_PHASES: readonly WarAntPhase[] = ["searching", "returning", "retreating", "waiting"];

export function parseWarAgentObservation(value: unknown): ModeConfigResult<WarAgentObservation> {
  const candidate = record(value);
  if (!candidate || !Array.isArray(candidate.colonies) || candidate.colonies.length !== 2) {
    return { ok: false, error: "War agent observation is malformed." };
  }
  const colonies: WarAgentObservation["colonies"] = [];
  for (const rawColony of candidate.colonies) {
    const colony = record(rawColony);
    if (!colony || (colony.id !== 0 && colony.id !== 1) || !Array.isArray(colony.ants) ||
        colony.ants.length > MAX_ANTS_PER_COLONY * 10) {
      return { ok: false, error: "War agent observation has an invalid colony." };
    }
    const ants: WarAgentObservation["colonies"][number]["ants"] = [];
    for (const rawAnt of colony.ants) {
      const ant = record(rawAnt);
      if (!ant || !natural(ant.id) || !finite(ant.x) || !finite(ant.y) ||
          !natural(ant.cx) || ant.cx >= COLS || !natural(ant.cy) || ant.cy >= ROWS ||
          !natural(ant.tx) || ant.tx >= COLS || !natural(ant.ty) || ant.ty >= ROWS ||
          typeof ant.hasFood !== "boolean" ||
          !(WAR_PHASES as readonly unknown[]).includes(ant.phase) || !nonNegative(ant.energy) ||
          !(ROLES as readonly unknown[]).includes(ant.role) || !natural(ant.doctrineVersion)) {
        return { ok: false, error: "War agent observation has an invalid ant." };
      }
      ants.push({
        id: ant.id,
        x: ant.x,
        y: ant.y,
        cx: ant.cx,
        cy: ant.cy,
        tx: ant.tx,
        ty: ant.ty,
        hasFood: ant.hasFood,
        phase: ant.phase as WarAntPhase,
        energy: ant.energy,
        role: ant.role as Role,
        doctrineVersion: ant.doctrineVersion,
      });
    }
    colonies.push({ id: colony.id, ants });
  }
  return { ok: true, value: { colonies } };
}

function captureAgents(runtime: WarSimulation): WarAgentObservation {
  return {
    colonies: runtime.simulation.colonies.map(colony => ({
      id: colony.id,
      ants: colony.ants.map(ant => {
        const state = runtime.getAntSnapshot(ant);
        if (!state) throw new Error("War ant is missing its mode-owned research state.");
        return {
          id: state.id,
          x: ant.x,
          y: ant.y,
          cx: ant.cx,
          cy: ant.cy,
          tx: ant.tx,
          ty: ant.ty,
          hasFood: ant.hasFood,
          phase: state.phase,
          energy: state.energy,
          role: state.role,
          doctrineVersion: state.doctrineVersion,
        };
      }),
    })),
  };
}

const FIELD_LENGTH = COLS * ROWS;

function parseLayer(value: unknown): number[] | null {
  return Array.isArray(value) && value.length === FIELD_LENGTH && value.every(nonNegative)
    ? [...value] as number[]
    : null;
}

export function parseWarFieldObservation(value: unknown): ModeConfigResult<WarFieldObservation> {
  const candidate = record(value);
  if (!candidate || !Array.isArray(candidate.colonies) || candidate.colonies.length !== 2) {
    return { ok: false, error: "War field observation is malformed." };
  }
  const colonies: WarFieldObservation["colonies"] = [];
  for (const rawColony of candidate.colonies) {
    const colony = record(rawColony);
    const home = parseLayer(colony?.home);
    const food = parseLayer(colony?.food);
    const caut = parseLayer(colony?.caut);
    if (!colony || (colony.id !== 0 && colony.id !== 1) || !home || !food || !caut ||
        !Array.isArray(colony.received) || colony.received.length > 1) {
      return { ok: false, error: "War field observation has an invalid colony." };
    }
    const received: WarFieldObservation["colonies"][number]["received"] = [];
    for (const rawReceived of colony.received) {
      const source = record(rawReceived);
      const sourceHome = parseLayer(source?.home);
      const sourceFood = parseLayer(source?.food);
      const sourceCaut = parseLayer(source?.caut);
      if (!source || (source.from !== 0 && source.from !== 1) ||
          !sourceHome || !sourceFood || !sourceCaut) {
        return { ok: false, error: "War field observation has invalid provenance layers." };
      }
      received.push({ from: source.from, home: sourceHome, food: sourceFood, caut: sourceCaut });
    }
    colonies.push({ id: colony.id, home, food, caut, received });
  }
  return { ok: true, value: { colonies } };
}

function fieldLayers(field: DenseField): Pick<WarFieldObservation["colonies"][number], "home" | "food" | "caut"> {
  return {
    home: Array.from(field.layer("home")),
    food: Array.from(field.layer("food")),
    caut: Array.from(field.layer("caut")),
  };
}

function captureFields(runtime: WarSimulation): WarFieldObservation {
  return {
    colonies: runtime.simulation.colonies.map(colony => {
      if (!(colony.field instanceof DenseField)) throw new Error("War research recording requires dense fields.");
      return {
        id: colony.id,
        ...fieldLayers(colony.field),
        received: [...colony.received].map(([from, field]) => {
          if (!(field instanceof DenseField)) throw new Error("War research recording requires dense provenance fields.");
          return { from, ...fieldLayers(field) };
        }),
      };
    }),
  };
}

export function parseWarResearchOutcome(value: unknown): ModeConfigResult<WarResearchOutcome> {
  const candidate = record(value);
  const colonies = parseMetricsList(candidate?.colonies);
  if (!candidate || !validResult(candidate.winner) || candidate.winner === null ||
      !natural(candidate.tick) || !colonies) {
    return { ok: false, error: "War research outcome is malformed." };
  }
  return { ok: true, value: { winner: candidate.winner, tick: candidate.tick, colonies } };
}

/** War's stable research views; replay still belongs to warTraceMode. */
export const warRecordingMode = defineRecordingMode({
  trace: warTraceMode,
  channels: {
    metrics: defineResearchChannel({
      version: 1,
      defaultInterval: 10,
      defaultCapacity: 20_000,
      capture: captureMetrics,
      parse: parseWarMetricsObservation,
    }),
    agents: defineResearchChannel({
      version: 1,
      defaultInterval: 25,
      defaultCapacity: 8_000,
      capture: captureAgents,
      parse: parseWarAgentObservation,
    }),
    fields: defineResearchChannel({
      version: 1,
      defaultInterval: 100,
      defaultCapacity: 2_000,
      capture: captureFields,
      parse: parseWarFieldObservation,
    }),
  },
  outcome: {
    version: 1,
    capture: (runtime: WarSimulation): WarResearchOutcome | undefined => runtime.result === null
      ? undefined
      : {
          winner: runtime.result,
          tick: runtime.tick,
          colonies: runtime.simulation.colonies.map(colony => runtime.getMetrics(colony.id)),
        },
    parse: parseWarResearchOutcome,
  },
});
