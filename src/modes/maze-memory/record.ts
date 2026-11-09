import type {
  Strategy,
  Limits,
  Manifest,
  Prepared,
  Observation,
  CodeUsage,
  Move,
} from "./contract";
import type { Trial } from "./engine";
export interface ModelAnswer {
  move: Move;
  model: string;
  servedModel: string | null;
  confidence: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
}
export interface Attempt {
  maze: number;
  step: number;
  observation: Observation;
  prepared: Prepared;
  answer: ModelAnswer | null;
  applied: boolean;
  error: string | null;
  errorKind: string | null;
  elapsedMs: number;
  usage: {
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
  };
}
export type OutcomeStatus =
  | "solved"
  | "move-limit"
  | "invalid-response"
  | "code-error";
export interface Outcome {
  maze: number;
  seed: string;
  status: OutcomeStatus;
  moves: number;
  shortest: number;
  illegalMoves: number;
  codeUsage: CodeUsage;
  error?: string;
}
export interface RunRecord {
  format: "stigsim-maze-memory-run@1";
  createdAt: string;
  strategy: Strategy;
  strategyId: string;
  model: string;
  limits: Limits;
  manifest: Manifest;
  mode: "practice" | "evaluation";
  attempts: Attempt[];
  outcomes: Outcome[];
  status:
    | "running"
    | "complete"
    | "cancelled"
    | "provider-unavailable"
    | "request-budget"
    | "log-budget";
  currentMaze: number;
}
export interface Snapshot {
  runId: string;
  revision: number;
  record: Omit<RunRecord, "attempts">;
  recentAttempts: Attempt[];
  view: ReturnType<Trial["view"]>;
  busy: boolean;
  metrics: ReturnType<typeof metrics>;
}
export function metrics(record: RunRecord) {
  const solved = record.outcomes.filter((o) => o.status === "solved").length,
    known = record.attempts.every(
      (a) => a.usage.inputTokens !== null && a.usage.outputTokens !== null,
    ),
    input = record.attempts.reduce((s, a) => s + (a.usage.inputTokens ?? 0), 0),
    output = record.attempts.reduce(
      (s, a) => s + (a.usage.outputTokens ?? 0),
      0,
    );
  return {
    solved,
    finished: record.outcomes.length,
    mazes: record.manifest.seeds.length,
    complete: record.status === "complete",
    requests: record.attempts.length,
    inputTokens: input,
    outputTokens: output,
    unknownUsage: record.attempts.filter(
      (a) => a.usage.inputTokens === null || a.usage.outputTokens === null,
    ).length,
    tokensPerSolution:
      record.status === "complete" && solved && known
        ? (input + output) / solved
        : null,
  };
}
