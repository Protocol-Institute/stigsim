export const RULES = { id: 'local-maze-agent@1', cols: 31, rows: 31, loopRate: 0.1,
  stepLimit: 4000, practiceMazes: 20, evaluationMazes: 100, sensorRadius: 1 } as const;
export const BUDGET = { sourceBytes: 32000, stateBytes: 128000, observationBytes: 2000000,
  memoryBytes: 16 * 1024 * 1024, stackBytes: 256 * 1024, fuelPerCall: 64, fuelPerMaze: 32000 } as const;
export const DIRECTIONS = ['N', 'E', 'S', 'W'] as const;
export type Move = typeof DIRECTIONS[number];
export const DELTAS: Record<Move, [number, number]> = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };
export interface Entry { format: 'stigsim-maze-agent@1'; name: string; description: string; parent: string | null; source: string }
export function parseEntry(value: unknown): Entry {
  const e = value as Entry;
  if (!e || e.format !== 'stigsim-maze-agent@1' || typeof e.name !== 'string' || !e.name.trim() || e.name.length > 80 ||
      typeof e.description !== 'string' || e.description.length > 2000 ||
      (e.parent !== null && (typeof e.parent !== 'string' || !/^[a-f0-9]{64}$/.test(e.parent))) ||
      typeof e.source !== 'string' || !e.source.trim() || new TextEncoder().encode(e.source).length > BUDGET.sourceBytes) {
    throw new Error('Expected stigsim-maze-agent@1 with name, description, parent hash or null, and at most 32 KB of JavaScript.');
  }
  return { format: e.format, name: e.name, description: e.description, parent: e.parent, source: e.source };
}
export async function entryId(entry: Entry) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(parseEntry(entry))));
  return Array.from(new Uint8Array(digest), x => x.toString(16).padStart(2, '0')).join('');
}
export interface LocalObservation {
  position: { x: number; y: number }; exits: Record<Move, boolean>; step: number;
  stepLimit: number; atGoal: boolean; lastMove: { direction: Move; moved: boolean } | null;
}
export interface Decision { move: Move; state: unknown }
export function parseDecision(value: unknown): Decision {
  const d = value as Decision;
  if (!d || !DIRECTIONS.includes(d.move)) throw new Error('step must return { move: "N" | "E" | "S" | "W", state }.');
  const encoded = JSON.stringify(d.state ?? null);
  if (new TextEncoder().encode(encoded).length > BUDGET.stateBytes) throw new Error('Memory exceeds 128 KB of JSON state.');
  return { move: d.move, state: JSON.parse(encoded) };
}
export const PRACTICE_SEEDS = Array.from({ length: RULES.practiceMazes }, (_, i) => `maze-agent-practice-v1:${i + 1}`);
export interface Manifest { format: 'stigsim-maze-agent-round@1'; name: string; seeds: string[] }
export function parseManifest(value: unknown): Manifest {
  const m = value as Manifest;
  if (!m || m.format !== 'stigsim-maze-agent-round@1' || typeof m.name !== 'string' || !m.name.trim() || m.name.length > 100 ||
      !Array.isArray(m.seeds) || m.seeds.length !== RULES.evaluationMazes || new Set(m.seeds).size !== m.seeds.length ||
      m.seeds.some(s => typeof s !== 'string' || !s.trim() || s.length > 200 || PRACTICE_SEEDS.includes(s))) {
    throw new Error('Evaluation needs a name and exactly 100 unique non-practice seeds (1–200 characters each).');
  }
  return { format: m.format, name: m.name, seeds: [...m.seeds] };
}
