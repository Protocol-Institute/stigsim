import type { ColonyMetrics, SimParams } from "./AntSim";

export type MatchPhase = "waiting" | "running" | "finished";

export interface MatchSettings {
  stepsPerSecond: number;
  startingAnts: number;
  foodSources: number;
  foodPerSource: number;
  loopRate: number;
}

export interface MatchSummary {
  id: string;
  phase: MatchPhase;
  playerNames: Array<string | null>;
  connected: boolean[];
  winner: number | "draw" | null;
  createdAt: number;
  endedAt: number | null;
  settings: MatchSettings;
}

export interface AntSnapshot {
  id: number;
  colonyId: number;
  x: number;
  y: number;
  tx: number;
  ty: number;
  state: "searching" | "returning" | "retreating" | "waiting";
  hasFood: boolean;
  energy: number;
}

export interface ColonySnapshot {
  id: number;
  nestX: number;
  nestY: number;
  homePhero: number[];
  foodPhero: number[];
  cautPhero: number[];
  ants: AntSnapshot[];
  metrics: ColonyMetrics;
  doctrine: SimParams;
  doctrineVersion: number;
}

export interface MatchSnapshot {
  tick: number;
  phase: MatchPhase;
  winner: number | "draw" | null;
  settings: MatchSettings;
  grid: number[][];
  foodSources: Array<{ x: number; y: number; remaining: number; total: number }>;
  colonies: ColonySnapshot[];
}

export interface MatchEvent {
  tick: number;
  at: number;
  type: "match-started" | "doctrine-changed" | "ants-born" | "ants-died" | "match-ended";
  colonyId?: number;
  count?: number;
  doctrine?: SimParams;
  winner?: number | "draw";
}

export interface MatchHistoryRecord {
  summary: MatchSummary;
  events: MatchEvent[];
  checkpoints: MatchSnapshot[];
}

export type ClientMessage =
  | { type: "create-room"; playerName: string; settings: MatchSettings }
  | { type: "create-random-room"; playerName: string; settings: MatchSettings }
  | { type: "join-room"; matchId: string; playerName: string; reconnectToken?: string }
  | { type: "get-history"; matchId: string; createdAt: number }
  | { type: "claim-seat"; colonyId: number }
  | { type: "ready" }
  | { type: "set-doctrine"; doctrine: SimParams }
  | { type: "reset" };

export type ServerMessage =
  | { type: "room-created"; matchId: string; reconnectToken: string }
  | { type: "joined"; matchId: string; colonyId: number | null; reconnectToken: string; phase: MatchPhase }
  | { type: "player-state"; connected: boolean[]; ready: boolean[]; names: Array<string | null> }
  | { type: "lobby-state"; active: MatchSummary[]; history: MatchSummary[] }
  | { type: "history-record"; record: MatchHistoryRecord }
  | { type: "snapshot"; snapshot: MatchSnapshot }
  | { type: "error"; message: string };

