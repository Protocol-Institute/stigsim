import type { AgentUsage } from '../../../shared/model-ant';
import pricing from './model-pricing.json';
export interface UsageRecord { model?: string; usage?: AgentUsage }
export interface ModelRate { input: number; output: number }
export interface UsageSummary {
  requests: number;
  knownTokens: number;
  tokensComplete: boolean;
  estimatedCostUsd: number;
  costComplete: boolean;
  uncountedTokenRecords: number;
  unpricedRecords: number;
}
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
export function summarizeUsage(records: UsageRecord[], rates: Record<string, ModelRate> = pricing.rates): UsageSummary {
  const summary: UsageSummary = { requests: 0, knownTokens: 0, tokensComplete: true, estimatedCostUsd: 0,
    costComplete: true, uncountedTokenRecords: 0, unpricedRecords: 0 };
  for (const { model, usage } of records) {
    if (count(usage?.requests)) summary.requests += usage.requests;
    if (count(usage?.totalTokens)) summary.knownTokens += usage.totalTokens;
    else if (count(usage?.inputTokens) && count(usage?.outputTokens)) summary.knownTokens += usage.inputTokens + usage.outputTokens;
    else { summary.tokensComplete = false; summary.uncountedTokenRecords++; }
    const rate = model ? rates[model] : undefined;
    if (rate && Number.isFinite(rate.input) && rate.input >= 0 && Number.isFinite(rate.output) && rate.output >= 0 &&
      count(usage?.inputTokens) && (rate.output === 0 || count(usage?.outputTokens))) {
      summary.estimatedCostUsd += (usage.inputTokens * rate.input + (usage.outputTokens ?? 0) * rate.output) / pricing.perTokens;
    } else { summary.costComplete = false; summary.unpricedRecords++; }
  }
  return summary;
}
export function formatTokenTotal(summary: UsageSummary): string {
  return `${summary.knownTokens.toLocaleString('en-US')}${summary.tokensComplete ? '' : '+'}`;
}
export function formatEstimatedCost(summary: UsageSummary): string {
  if (summary.estimatedCostUsd === 0 && !summary.costComplete) return '—';
  if (summary.estimatedCostUsd > 0 && summary.estimatedCostUsd < 0.0001) return '<$0.0001';
  return `$${summary.estimatedCostUsd.toFixed(summary.estimatedCostUsd < 1 && summary.estimatedCostUsd !== 0 ? 4 : 2)}`;
}
export { pricing };
