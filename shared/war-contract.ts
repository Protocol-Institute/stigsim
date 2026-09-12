import { DEFAULT_PARAMS, DEFAULT_TOPOLOGY, cloneTopology } from "@stigsim/sim-core";
import type { AdoptionMode, Doctrine, MazeLayout, Role, Topology } from "@stigsim/sim-core";

export const WAR_RECONNECTED_ELSEWHERE_CODE = 4001;
export const WAR_MATCH_REMOVED_CODE = 4002;

export type WarMatchPhase = "waiting" | "running" | "finished";

export interface OnlineWarSettings {
  masterSeed: string;
  stepsPerSecond: number;
  startingAnts: number;
  foodSources: number;
  foodPerSource: number;
  loopRate: number;
  tankMax: number;
  topology: Topology;
  /** Absent on records written before layouts existed; readers treat that as random. */
  layout: MazeLayout;
  /** Absent on records written before this setting existed; readers treat that as on-return. */
  adoption: AdoptionMode;
}

export const DEFAULT_ONLINE_WAR_SETTINGS: OnlineWarSettings = {
  masterSeed: "",
  stepsPerSecond: 15,
  startingAnts: 20,
  foodSources: 1,
  foodPerSource: 500,
  loopRate: 0.1,
  tankMax: DEFAULT_PARAMS.tankMax,
  topology: cloneTopology(DEFAULT_TOPOLOGY),
  layout: "mirrored",
  adoption: "nest",
};

export interface WarMatchSummary {
  id: string;
  phase: WarMatchPhase;
  playerNames: Array<string | null>;
  connected: boolean[];
  winner: number | "draw" | null;
  createdAt: number;
  settings: OnlineWarSettings;
}

export interface WarMatchRecord {
  recordId: string;
  matchId: string;
  completedAt: string;
  playerNames: Array<string | null>;
  winner: number | "draw";
  settings: OnlineWarSettings;
  finalTick: number;
  finalMetrics: WarMetricsWire[];
  finalDoctrines: Doctrine[];
}

export interface WarMetricsWire {
  population: number;
  foodCollected: number;
  reserve: number;
  hatching: number;
  searching: number;
  carrying: number;
  retreating: number;
  waiting: number;
  lowEnergy: number;
  births: number;
  deaths: number;
  doctrineChanged: boolean;
  doctrineAdopted: number;
}

export interface WarAntWire {
  id: number;
  x: number;
  y: number;
  tx: number;
  ty: number;
  hasFood: boolean;
  phase: "searching" | "returning" | "retreating" | "waiting";
  energy: number;
  role: Role;
  doctrineVersion: number;
}

export interface WarColonyWire {
  id: number;
  nestX: number;
  nestY: number;
  homePhero: number[];
  foodPhero: number[];
  receivedPhero: Array<{ from: number; home: number[]; food: number[] }>;
  ants: WarAntWire[];
  metrics: WarMetricsWire;
  doctrine: Doctrine;
}

export interface WarSnapshot {
  tick: number;
  phase: WarMatchPhase;
  winner: number | "draw" | null;
  settings: OnlineWarSettings;
  grid: number[][];
  foodSources: Array<{ x: number; y: number; remaining: number; total: number }>;
  colonies: WarColonyWire[];
}

export type WarClientMessage =
  | { type: "create-room"; playerName: string; settings: OnlineWarSettings; randomOpponent?: boolean }
  | { type: "join-room"; matchId: string; playerName: string; reconnectToken?: string }
  | { type: "claim-seat"; colonyId: number }
  | { type: "stand-up" }
  | { type: "ready" }
  | { type: "set-doctrine"; doctrine: Doctrine }
  | { type: "reset" };

export type WarServerMessage =
  | { type: "room-created"; matchId: string; reconnectToken: string }
  | { type: "joined"; matchId: string; colonyId: number | null; reconnectToken?: string; phase: WarMatchPhase }
  | { type: "player-state"; connected: boolean[]; ready: boolean[]; names: Array<string | null>; spectators: string[] }
  | { type: "lobby-state"; matches: WarMatchSummary[]; history: WarMatchRecord[] }
  | { type: "snapshot"; snapshot: WarSnapshot }
  | { type: "error"; message: string };
