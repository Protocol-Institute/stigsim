export const WAR_AGENT_PROTOCOL = "stigsim-war-agent" as const;
export const WAR_AGENT_PROTOCOL_VERSION = 1 as const;

export type WarAgentPresetName = "Default" | "Highway" | "Scout" | "Volatile" | "Saboteur" | "Poacher";
export type WarAgentSituation = "exploring" | "exploiting" | "stale-highway" | "possible-mill" | "under-pressure" | "interference-opportunity";

export interface WarAgentEvidence {
  signal: string;
  value: number | string;
  description: string;
  severity: "info" | "warning" | "critical";
}

export interface WarAgentCandidate {
  preset: WarAgentPresetName;
  score: number;
  reasons: string[];
}

/** A bounded, display-safe OODA trace. It is evidence and conclusions, not hidden model reasoning. */
export interface WarAgentDecision {
  protocol: typeof WAR_AGENT_PROTOCOL;
  version: typeof WAR_AGENT_PROTOCOL_VERSION;
  id: string;
  tick: number;
  colonyId: number;
  observe: WarAgentEvidence[];
  orient: {
    situation: WarAgentSituation;
    summary: string;
  };
  decide: {
    candidates: WarAgentCandidate[];
    selected: WarAgentPresetName;
    confidence: number;
  };
  act: {
    previousPreset: WarAgentPresetName;
    nextPreset: WarAgentPresetName;
    changed: boolean;
    reviewAtTick: number;
  };
  expected: string;
}

export interface WarAgentState {
  protocol: typeof WAR_AGENT_PROTOCOL;
  version: typeof WAR_AGENT_PROTOCOL_VERSION;
  agentId: "deterministic-ooda-v1";
  colonyId: number;
  currentSituation: WarAgentSituation;
  currentPreset: WarAgentPresetName;
  nextReviewTick: number;
  decisions: WarAgentDecision[];
}

export type WarOpponentType = "human" | "random" | "agent";
