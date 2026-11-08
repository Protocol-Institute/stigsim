import type { LocalMarks, MarkWrite } from "./environment";
export const DIRECTIONS = ["N", "E", "S", "W"] as const;
export type Move = (typeof DIRECTIONS)[number];
export const DELTAS: Record<Move, [number, number]> = {
  N: [0, -1],
  E: [1, 0],
  S: [0, 1],
  W: [-1, 0],
};
export const RULES = {
  id: "maze-memory@1",
  cols: 31,
  rows: 31,
  loopRate: 0.1,
  stepLimit: 4000,
  practiceMazes: 20,
} as const;
export const BUDGET = {
  sourceBytes: 32000,
  contextBytes: 24000,
  instructionChars: 8000,
  observationBytes: 2000000,
  memoryBytes: 16 * 1024 * 1024,
  stackBytes: 256 * 1024,
  fuelPerCall: 64,
  fuelPerMaze: 32000,
} as const;
export const PRACTICE_SEEDS = Array.from(
  { length: 20 },
  (_, i) => `maze-memory-practice-v1:${i + 1}`,
);
export interface Observation {
  position: { x: number; y: number };
  exits: Record<Move, boolean>;
  step: number;
  stepLimit: number;
  atGoal: boolean;
  lastMove: { direction: Move; moved: boolean } | null;
  environment: LocalMarks;
}
export type LocalObservation = Observation;
export interface Strategy {
  format: "stigsim-maze-memory-strategy@1";
  name: string;
  description: string;
  parent: string | null;
  source: string;
}
export function parseStrategy(value: unknown): Strategy {
  const s = value as Strategy;
  if (
    !s ||
    s.format !== "stigsim-maze-memory-strategy@1" ||
    typeof s.name !== "string" ||
    !s.name.trim() ||
    s.name.length > 80 ||
    typeof s.description !== "string" ||
    s.description.length > 2000 ||
    (s.parent !== null &&
      (typeof s.parent !== "string" || !/^[a-f0-9]{64}$/.test(s.parent))) ||
    typeof s.source !== "string" ||
    !s.source.trim() ||
    new TextEncoder().encode(s.source).length > BUDGET.sourceBytes
  )
    throw Error(
      "Expected a maze-memory strategy with name, description, parent hash or null, and up to 32 KB JavaScript.",
    );
  return {
    format: s.format,
    name: s.name,
    description: s.description,
    parent: s.parent,
    source: s.source,
  };
}
export interface Prepared {
  instructions: string;
  context: unknown;
  writes: MarkWrite[];
}
export interface CodeUsage {
  calls: number;
  fuel: number;
  observationBytes: number;
}
export interface Limits {
  movesPerMaze: number;
  requests: number;
}
export function parseLimits(value: unknown): Limits {
  const l = value as Limits;
  if (
    !l ||
    !Number.isInteger(l.movesPerMaze) ||
    l.movesPerMaze < 1 ||
    l.movesPerMaze > 4000 ||
    !Number.isInteger(l.requests) ||
    l.requests < 1 ||
    l.requests > 100000
  )
    throw Error(
      "Choose 1–4,000 moves per maze and 1–100,000 total model requests.",
    );
  return { movesPerMaze: l.movesPerMaze, requests: l.requests };
}
export interface Manifest {
  name: string;
  seeds: string[];
}
export function parseManifest(value: unknown): Manifest {
  const m = value as Manifest;
  if (
    !m ||
    typeof m.name !== "string" ||
    !m.name.trim() ||
    m.name.length > 100 ||
    !Array.isArray(m.seeds) ||
    m.seeds.length < 1 ||
    m.seeds.length > 100 ||
    new Set(m.seeds).size !== m.seeds.length ||
    m.seeds.some(
      (s) =>
        typeof s !== "string" ||
        !s ||
        s.length > 200 ||
        PRACTICE_SEEDS.includes(s),
    )
  )
    throw Error(
      "Evaluation requires 1–100 unique non-practice maze seeds and a round name.",
    );
  return { name: m.name, seeds: [...m.seeds] };
}
