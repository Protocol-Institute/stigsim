import {
  parseStrategy,
  parseLimits,
  parseManifest,
  PRACTICE_SEEDS,
  DIRECTIONS,
  BUDGET,
  type Observation,
} from "./contract";
import { parseWrites, type JsonMark } from "./environment";
import { mazeMemoryMode } from "./engine";
import type { RunRecord, Attempt } from "./record";
const stable = (v: unknown): string =>
  JSON.stringify(v, (_, x) =>
    x && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(
          Object.keys(x)
            .sort()
            .map((k) => [k, x[k]]),
        )
      : x,
  );
const finiteCount = (v: unknown) =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= 1e9;
export function validateRecord(value: unknown): RunRecord {
  const r = value as RunRecord;
  if (
    !r ||
    r.format !== "stigsim-maze-memory-run@1" ||
    !Array.isArray(r.attempts) ||
    r.attempts.length > 100000 ||
    !Array.isArray(r.outcomes) ||
    r.outcomes.length > 100 ||
    typeof r.model !== "string" ||
    r.model.length > 200 ||
    !["practice", "evaluation"].includes(r.mode) ||
    ![
      "running",
      "complete",
      "cancelled",
      "provider-unavailable",
      "request-budget",
      "log-budget",
    ].includes(r.status)
  )
    throw Error("Invalid maze-memory recording.");
  if (typeof r.manifest?.name !== "string" || r.manifest.name.length > 100)
    throw Error("Invalid round name.");
  parseStrategy(r.strategy);
  parseLimits(r.limits);
  if (r.mode === "evaluation") parseManifest(r.manifest);
  else if (
    r.manifest?.seeds?.length !== 1 ||
    !PRACTICE_SEEDS.includes(r.manifest.seeds[0])
  )
    throw Error("Invalid practice manifest.");
  if (
    !Number.isInteger(r.currentMaze) ||
    r.currentMaze < 0 ||
    r.currentMaze >= r.manifest.seeds.length ||
    r.attempts.length > r.limits.requests ||
    r.outcomes.length > r.manifest.seeds.length
  )
    throw Error("Invalid recording bounds.");
  const trials = r.manifest.seeds.map((seed) =>
    mazeMemoryMode.create({ seed, stepLimit: r.limits.movesPerMaze }),
  );
  let previousMaze = 0;
  const terminal = new Set<number>();
  for (const a of r.attempts) {
    if (
      !Number.isInteger(a.maze) ||
      a.maze < previousMaze ||
      a.maze > r.currentMaze ||
      !trials[a.maze] ||
      terminal.has(a.maze) ||
      typeof a.applied !== "boolean"
    )
      throw Error("Invalid attempt sequence.");
    previousMaze = a.maze;
    const t = trials[a.maze];
    if (a.step !== t.tick || stable(a.observation) !== stable(t.observation()))
      throw Error("Recording observation diverges from maze and memory.");
    if (
      typeof a.prepared?.instructions !== "string" ||
      Object.keys(a.prepared).some(
        (k) => !["instructions", "context", "writes"].includes(k),
      ) ||
      a.prepared.instructions.length > BUDGET.instructionChars ||
      new TextEncoder().encode(JSON.stringify(a.prepared.context ?? null))
        .length > BUDGET.contextBytes
    )
      throw Error("Invalid recorded preparation.");
    const writes = parseWrites(a.prepared.writes);
    t.environment.validate(t.observation(), writes);
    if (
      !a.usage ||
      [a.usage.inputTokens, a.usage.outputTokens, a.usage.totalTokens].some(
        (n) => n !== null && !finiteCount(n),
      )
    )
      throw Error("Invalid recorded usage.");
    if (
      (a.answer && !DIRECTIONS.includes(a.answer.move)) ||
      (a.applied && !a.answer)
    )
      throw Error("Invalid recorded move.");
    if (a.applied) t.apply(a.answer!.move, writes);
    else terminal.add(a.maze);
  }
  const outcomeMazes = new Set<number>();
  for (const o of r.outcomes) {
    const t = trials[o.maze];
    if (
      !t ||
      outcomeMazes.has(o.maze) ||
      o.seed !== r.manifest.seeds[o.maze] ||
      o.moves !== t.tick ||
      o.shortest !== t.shortest ||
      o.illegalMoves !== t.moves.filter((m) => !m.moved).length ||
      !["solved", "move-limit", "invalid-response", "code-error"].includes(
        o.status,
      ) ||
      (o.status === "solved" && !t.solved) ||
      (o.status !== "solved" && t.solved) ||
      (o.status === "move-limit" && !t.done)
    )
      throw Error("Recorded outcome diverges.");
    outcomeMazes.add(o.maze);
  }
  if (r.status === "complete" && r.outcomes.length !== r.manifest.seeds.length)
    throw Error("Incomplete evaluation cannot claim completion.");
  return structuredClone(r);
}
export interface Change {
  target: string;
  before: JsonMark;
  after: JsonMark;
}
function committedChanges(o: Observation, a: Attempt): Change[] {
  if (!a.applied) return [];
  const notes = structuredClone(o.environment),
    changes: Change[] = [];
  for (const w of a.prepared.writes) {
    if (
      (w.target === "chosenPassage" && !o.exits[a.answer!.move]) ||
      (w.when === "chosen" &&
        (!o.exits[a.answer!.move] || w.target !== a.answer!.move))
    )
      continue;
    const target = w.target === "chosenPassage" ? a.answer!.move : w.target;
    const before =
      target === "cell" ? notes.cell : (notes.passages[target] ?? null);
    changes.push({
      target,
      before: structuredClone(before),
      after: structuredClone(w.value),
    });
    if (target === "cell") notes.cell = w.value;
    else notes.passages[target] = w.value;
  }
  return changes;
}
/** Incremental playback keeps forward animation linear; backward seeks reconstruct locally. */
export class ReplayCursor {
  private trial: ReturnType<typeof mazeMemoryMode.create>;
  private tick = 0;
  private changes: Change[] = [];
  private readonly attempts: Attempt[];
  private readonly moves: Attempt[];
  constructor(
    private readonly record: RunRecord,
    private readonly maze: number,
  ) {
    this.trial = this.fresh();
    this.attempts = record.attempts.filter((a) => a.maze === maze);
    this.moves = this.attempts.filter((a) => a.applied);
  }
  private fresh() {
    if (!this.record.manifest.seeds[this.maze])
      throw Error("Invalid replay maze.");
    return mazeMemoryMode.create({
      seed: this.record.manifest.seeds[this.maze],
      stepLimit: this.record.limits.movesPerMaze,
    });
  }
  at(tick: number) {
    if (!Number.isInteger(tick) || tick < 0 || tick > this.moves.length)
      throw Error("Invalid replay position.");
    if (tick < this.tick) {
      this.trial = this.fresh();
      this.tick = 0;
      this.changes = [];
    }
    while (this.tick < tick) {
      const a = this.moves[this.tick];
      this.changes = committedChanges(this.trial.observation(), a);
      this.trial.apply(a.answer!.move, a.prepared.writes);
      this.tick++;
    }
    return {
      view: this.trial.view(),
      changes: this.tick ? this.changes : [],
      next: this.attempts.find((a) => a.step === tick),
      max: this.moves.length,
    };
  }
}
export function replayFrame(record: RunRecord, maze: number, tick: number) {
  return new ReplayCursor(record, maze).at(tick);
}
