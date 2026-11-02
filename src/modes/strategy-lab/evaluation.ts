import { CHALLENGE, type Round } from './contract';
import type { Trial } from './engine';

/** Keep the same set across edits so local leaderboard entries are comparable. */
export function evaluationRound(setSeed: string): Round {
  if (!setSeed.trim() || setSeed.length > 100) throw new Error('Test-set seed must be 1–100 characters.');
  return { format: 'stigsim-strategy-round@1', name: '100-maze local evaluation', replicates: 1,
    seeds: Array.from({ length: 100 }, (_, i) => `${setSeed}:maze:${i + 1}`) };
}
export function summarizeTrials(trials: Trial[]) {
  const n = trials.length;
  if (!n) return { n: 0, mean: null, standardError: null, min: null, max: null, failures: 0 };
  // Never silently drop failed trials from an apparent score.
  const failures = trials.filter(t => t.error || t.endTick !== CHALLENGE.ticks).length;
  const values = trials.map(t => t.food);
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = n > 1 ? values.reduce((sum, x) => sum + (x - mean) ** 2, 0) / (n - 1) : 0;
  return { n, mean: failures ? null : mean, standardError: failures || n < 2 ? null : Math.sqrt(variance / n),
    min: Math.min(...values), max: Math.max(...values), failures };
}
