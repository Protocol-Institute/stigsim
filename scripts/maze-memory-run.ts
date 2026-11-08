import { createHash, randomUUID } from "node:crypto";
import {
  parseStrategy,
  parseLimits,
  parseManifest,
  PRACTICE_SEEDS,
  type CodeUsage,
} from "../src/modes/maze-memory/contract";
import { mazeMemoryMode } from "../src/modes/maze-memory/engine";
import { prepare } from "../src/modes/maze-memory/prepare";
import {
  metrics,
  type Attempt,
  type RunRecord,
  type Snapshot,
  type OutcomeStatus,
} from "../src/modes/maze-memory/record";
import {
  askModel,
  ProviderError,
  type ProviderConfig,
} from "./maze-memory-provider";
export class MemoryRun {
  readonly id = randomUUID();
  readonly record: RunRecord;
  trial: ReturnType<typeof mazeMemoryMode.create>;
  revision = 0;
  busy = false;
  touched = Date.now();
  active: AbortController | null = null;
  logBytes = 0;
  usage: CodeUsage = { calls: 0, fuel: 0, observationBytes: 0 };
  constructor(
    strategy: unknown,
    limits: unknown,
    manifest: unknown,
    mode: "practice" | "evaluation",
    readonly config: ProviderConfig,
    readonly request: typeof fetch = fetch,
  ) {
    const s = parseStrategy(strategy),
      l = parseLimits(limits),
      m =
        mode === "evaluation"
          ? parseManifest(manifest)
          : (manifest as { name: string; seeds: string[] });
    if (
      (mode !== "practice" && mode !== "evaluation") ||
      (mode === "practice" &&
        (!m || m.seeds.length !== 1 || !PRACTICE_SEEDS.includes(m.seeds[0])))
    )
      throw Error("Invalid practice maze.");
    this.record = {
      format: "stigsim-maze-memory-run@1",
      createdAt: new Date().toISOString(),
      strategy: s,
      strategyId: createHash("sha256").update(JSON.stringify(s)).digest("hex"),
      model: config.model,
      limits: l,
      manifest: { name: m.name, seeds: [...m.seeds] },
      mode,
      attempts: [],
      outcomes: [],
      status: "running",
      currentMaze: 0,
    };
    this.trial = this.makeTrial();
  }
  private makeTrial() {
    return mazeMemoryMode.create({
      seed: this.record.manifest.seeds[this.record.currentMaze],
      stepLimit: this.record.limits.movesPerMaze,
    });
  }
  snapshot(): Snapshot {
    const { attempts, ...record } = this.record;
    return {
      runId: this.id,
      revision: this.revision,
      record,
      recentAttempts: attempts.slice(-10),
      view: this.trial.view(),
      busy: this.busy,
      metrics: metrics(this.record),
    };
  }
  cancel() {
    if (this.record.status === "running") this.record.status = "cancelled";
    this.active?.abort();
  }
  private finish(status: OutcomeStatus, error?: string) {
    const r = this.record;
    this.record.outcomes.push({
      maze: r.currentMaze,
      seed: r.manifest.seeds[r.currentMaze],
      status,
      moves: this.trial.tick,
      shortest: this.trial.shortest,
      illegalMoves: this.trial.moves.filter((m) => !m.moved).length,
      codeUsage: { ...this.usage },
      ...(error ? { error } : {}),
    });
    if (r.outcomes.length === r.manifest.seeds.length) r.status = "complete";
  }
  async step(maze: number, step: number, revision?: number) {
    if (revision !== undefined) {
      if (
        !Number.isSafeInteger(revision) ||
        revision < 0 ||
        revision > this.revision
      )
        throw Error("Invalid step revision.");
      if (revision < this.revision) return this.snapshot();
    }
    await this.advance(maze, step);
    this.revision++;
    return this.snapshot();
  }
  private async advance(maze: number, step: number) {
    this.touched = Date.now();
    if (this.busy) throw Error("A decision is already in progress.");
    const r = this.record;
    if (
      maze < r.currentMaze ||
      (maze === r.currentMaze && step < this.trial.tick)
    )
      return this.snapshot();
    if (maze !== r.currentMaze || step !== this.trial.tick)
      throw Error("Run is out of sync.");
    if (r.status !== "running") return this.snapshot();
    this.busy = true;
    try {
      if (r.outcomes.length > r.currentMaze) {
        r.currentMaze++;
        this.trial = this.makeTrial();
        this.usage = { calls: 0, fuel: 0, observationBytes: 0 };
      }
      if (r.attempts.length >= r.limits.requests) {
        r.status = "request-budget";
        return this.snapshot();
      }
      if (this.logBytes + 100000 > 64 * 1024 * 1024) {
        r.status = "log-budget";
        return this.snapshot();
      }
      const observation = this.trial.observation();
      let p;
      try {
        p = await prepare(r.strategy.source, observation, this.usage);
        this.trial.environment.validate(observation, p.writes);
      } catch (e) {
        this.finish(
          "code-error",
          e instanceof Error
            ? e.message.slice(0, 1000)
            : "Strategy code failed.",
        );
        return this.snapshot();
      }
      const a: Attempt = {
        maze: r.currentMaze,
        step: this.trial.tick,
        observation,
        prepared: p,
        answer: null,
        applied: false,
        error: null,
        errorKind: null,
        elapsedMs: 0,
        usage: { inputTokens: null, outputTokens: null, totalTokens: null },
      };
      const start = Date.now();
      this.active = new AbortController();
      try {
        const answer = await askModel(
          this.config,
          p,
          observation,
          this.active.signal,
          this.request,
        );
        a.answer = answer;
        a.usage = {
          inputTokens: answer.inputTokens,
          outputTokens: answer.outputTokens,
          totalTokens: answer.totalTokens,
        };
        if (r.status === "running") {
          this.trial.apply(answer.move, p.writes);
          a.applied = true;
          if (this.trial.solved) this.finish("solved");
          else if (this.trial.done) this.finish("move-limit");
        }
      } catch (e) {
        a.error = e instanceof Error ? e.message : "Inference failed.";
        a.errorKind = e instanceof ProviderError ? e.kind : "unknown";
        if (e instanceof ProviderError) a.usage = e.usage;
        if (r.status === "running") {
          if (a.errorKind === "invalid-action") this.finish("invalid-response");
          else r.status = "provider-unavailable";
        }
      } finally {
        a.elapsedMs = Date.now() - start;
        r.attempts.push(a);
        this.logBytes += new TextEncoder().encode(JSON.stringify(a)).length;
        this.active = null;
      }
      return this.snapshot();
    } finally {
      this.busy = false;
    }
  }
}
