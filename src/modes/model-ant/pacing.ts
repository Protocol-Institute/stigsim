import type { AgentUsage } from '../../../shared/model-ant';
export const PACING = { tokensPerMinute: 160000, cooldownMs: 60000, maxConsecutiveRateLimits: 3 } as const;
interface Sample { at: number; tokens: number }
// Timing estimates are only for pacing; they never enter reported usage or cost.
export class RunPacing {
  private samples: Sample[] = [];
  private lastTokens = 1000;
  private growth = 0;
  private nextAt = 0;
  private rateLimits = 0;
  private started = false;
  constructor(private clock: () => number = Date.now) {}
  resumeExistingRun() {
    if (!this.started) { this.started = true; this.nextAt = this.clock() + PACING.cooldownMs; }
  }
  succeeded(usage?: AgentUsage) {
    this.started = true; this.rateLimits = 0;
    const tokens = usage?.totalTokens;
    if (typeof tokens === 'number' && Number.isFinite(tokens) && tokens >= 0) {
      this.growth = Math.max(0, tokens - this.lastTokens);
      this.lastTokens = Math.max(1, tokens);
    }
    const estimate = this.estimatedNextTokens();
    this.samples.push({ at: this.clock(), tokens: typeof tokens === 'number' && tokens >= 0 ? tokens : estimate });
    this.nextAt = this.clock() + Math.max(500, Math.ceil(estimate / PACING.tokensPerMinute * 60000));
  }
  rateLimited() {
    this.started = true; this.rateLimits++;
    this.nextAt = this.clock() + PACING.cooldownMs;
    return this.rateLimits >= PACING.maxConsecutiveRateLimits;
  }
  get consecutiveRateLimits() { return this.rateLimits; }
  estimatedNextTokens() { return Math.min(PACING.tokensPerMinute, Math.ceil((this.lastTokens + this.growth) * 1.1)); }
  delayMs() {
    const now = this.clock();
    this.samples = this.samples.filter(sample => now - sample.at < 60000);
    let total = this.samples.reduce((sum, sample) => sum + sample.tokens, 0);
    let availableAt = now;
    for (const sample of this.samples) {
      if (total + this.estimatedNextTokens() <= PACING.tokensPerMinute) break;
      total -= sample.tokens; availableAt = sample.at + 60000;
    }
    return Math.max(0, this.nextAt - now, availableAt - now);
  }
}
const runs = new Map<string, RunPacing>();
export function getRunPacing(runId: string): RunPacing {
  let pacing = runs.get(runId);
  if (!pacing) {
    if (runs.size >= 16) runs.delete(runs.keys().next().value!);
    pacing = new RunPacing(); runs.set(runId, pacing);
  }
  return pacing;
}
export function clearRunPacing(runId: string) { runs.delete(runId); }
