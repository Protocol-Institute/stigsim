import { DEFAULT_DOCTRINE, cloneDoctrine, isHalfStep } from '@stigsim/sim-core';

export const CHALLENGE = { id: 'food-collection@1', ticks: 3000, ants: 20,
  loopRate: 0.1, foodSources: 3, foodPerSource: 200, tankMax: 6400 } as const;
export const LIMITS = { sourceBytes: 32_000, stateBytes: 64_000, observationBytes: 16_000_000,
  vmMemoryBytes: 16 * 1024 * 1024, vmStackBytes: 256 * 1024,
  interruptsPerCall: 128, interruptsPerTrial: 8192, actionsPerTrial: 128 } as const;
export interface Settings { evaporation: number; trailBias: number; foodDeposition: number }
export const BASELINE: Settings = { evaporation: 0.002, trailBias: 7, foodDeposition: 2 };
export interface Strategy {
  format: 'stigsim-strategy@1'; name: string; description: string;
  parent: string | null; initial: Settings; source: string;
}
export function parseSettings(value: unknown): Settings {
  const s = value as Settings;
  if (!s || typeof s !== 'object' ||
      !Number.isFinite(s.evaporation) || s.evaporation < 0 || s.evaporation > 1 ||
      !Number.isFinite(s.trailBias) || !isHalfStep(s.trailBias) || s.trailBias < 0 || s.trailBias > 32 ||
      !Number.isInteger(s.foodDeposition) || s.foodDeposition < 0 || s.foodDeposition > 3) {
    throw new Error('Settings need evaporation 0–1, trail bias 0–32 in half steps, and integer food deposition 0–3.');
  }
  return { evaporation: s.evaporation, trailBias: s.trailBias, foodDeposition: s.foodDeposition };
}
export function parseStrategy(value: unknown): Strategy {
  const s = value as Strategy;
  if (!s || s.format !== 'stigsim-strategy@1' ||
      typeof s.name !== 'string' || !s.name.trim() || s.name.length > 80 ||
      typeof s.description !== 'string' || s.description.length > 2000 ||
      (s.parent !== null && (typeof s.parent !== 'string' || !/^[a-f0-9]{64}$/.test(s.parent))) ||
      typeof s.source !== 'string' || !s.source.trim() || new TextEncoder().encode(s.source).length > LIMITS.sourceBytes) {
    throw new Error('Invalid strategy file. Expected stigsim-strategy@1 with name, description, parent hash or null, initial settings and at most 32 KB of source.');
  }
  return { format: s.format, name: s.name, description: s.description, parent: s.parent,
    initial: parseSettings(s.initial), source: s.source };
}
export async function strategyId(strategy: Strategy): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(parseStrategy(strategy))));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}
export function doctrine(settings: Settings) {
  const d = cloneDoctrine(DEFAULT_DOCTRINE);
  d.evapRate = settings.evaporation;
  d.forager.follow.searching.food.own = settings.trailBias;
  d.forager.follow.returning.home.own = settings.trailBias;
  d.forager.lay.returning.food.own = settings.foodDeposition;
  return d;
}
export interface Decision { nextTick: number; state: unknown; settings?: Settings }
export function parseDecision(value: unknown, tick: number): Decision {
  const d = value as Decision;
  if (!d || typeof d !== 'object' || !Number.isInteger(d.nextTick) || d.nextTick <= tick || d.nextTick > CHALLENGE.ticks + 1) {
    throw new Error('step must return nextTick between the current tick + 1 and 3001.');
  }
  const serialized = JSON.stringify(d.state ?? null);
  if (new TextEncoder().encode(serialized).length > LIMITS.stateBytes) throw new Error('Persistent state exceeds 64 KB.');
  return { nextTick: d.nextTick, state: JSON.parse(serialized),
    ...(d.settings === undefined ? {} : { settings: parseSettings(d.settings) }) };
}
export interface Round { format: 'stigsim-strategy-round@1'; name: string; seeds: string[]; replicates: number }
export function parseRound(value: unknown): Round {
  const r = value as Round;
  if (!r || r.format !== 'stigsim-strategy-round@1' || typeof r.name !== 'string' || !r.name.trim() || r.name.length > 100 ||
      !Array.isArray(r.seeds) || r.seeds.length < 2 || r.seeds.length > 200 ||
      r.seeds.some(s => typeof s !== 'string' || !s || s.length > 200) || new Set(r.seeds).size !== r.seeds.length ||
      !Number.isInteger(r.replicates) || r.replicates < 1 || r.replicates > 3) {
    throw new Error('Round needs a name, 2–200 unique seeds, and 1–3 ant-seed replicates.');
  }
  return { format: r.format, name: r.name, seeds: [...r.seeds], replicates: r.replicates };
}
export const PRACTICE_ROUND: Round = { format: 'stigsim-strategy-round@1', name: 'Public practice',
  seeds: ['strategy-practice-1', 'strategy-practice-2', 'strategy-practice-3'], replicates: 1 };
