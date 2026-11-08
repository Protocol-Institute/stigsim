import { defineMode, generateMaze, makeRng, type ModeConfigResult } from '@stigsim/sim-core';
import { BUDGET, DELTAS, DIRECTIONS, RULES, entryId, parseEntry, parseManifest, type Entry, type LocalObservation, type Manifest, type Move } from './contract';
import { choose, type Usage } from './policy';
export interface World { grid: number[][]; goal: { x: number; y: number }; shortest: number }
export function makeWorld(seed: string): World {
  const grid = generateMaze(RULES.loopRate, makeRng(`${seed}:terrain`));
  const distances = new Map<string, number>([['1,1', 0]]), queue = [[1, 1]];
  for (let i = 0; i < queue.length; i++) {
    const [x, y] = queue[i], distance = distances.get(`${x},${y}`)!;
    for (const [dx, dy] of Object.values(DELTAS)) {
      const nx = x + dx, ny = y + dy, key = `${nx},${ny}`;
      if (grid[ny]?.[nx] !== 1 || distances.has(key)) continue;
      distances.set(key, distance + 1); queue.push([nx, ny]);
    }
  }
  const candidates = queue.filter(([x, y]) => distances.get(`${x},${y}`)! >= 12);
  const [x, y] = candidates[Math.floor(makeRng(`${seed}:exit`)() * candidates.length)];
  return { grid, goal: { x, y }, shortest: distances.get(`${x},${y}`)! };
}
export interface MoveRecord { move: Move; moved: boolean; x: number; y: number }
export interface Outcome {
  solved: boolean; steps: number; illegalMoves: number; shortest: number; efficiency: number;
  usage: Usage; error?: string; moves: MoveRecord[];
}
export class MazeTrial {
  readonly world: World;
  readonly entry: Entry;
  position = { x: 1, y: 1 };
  tick = 0;
  state: unknown = null;
  error: string | undefined;
  moves: MoveRecord[] = [];
  visited = new Set(['1,1']);
  readonly usage: Usage = { calls: 0, fuel: 0, observationBytes: 0, peakStateBytes: 0 };
  constructor(entry: Entry, seed: string) { this.entry = parseEntry(entry); this.world = makeWorld(seed); }
  get solved() { return this.position.x === this.world.goal.x && this.position.y === this.world.goal.y; }
  get done() { return this.solved || this.error !== undefined || this.tick >= RULES.stepLimit; }
  observation(): LocalObservation {
    const { x, y } = this.position, last = this.moves[this.moves.length - 1];
    return { position: { x, y }, exits: Object.fromEntries(DIRECTIONS.map(d => {
      const [dx, dy] = DELTAS[d]; return [d, this.world.grid[y + dy]?.[x + dx] === 1];
    })) as Record<Move, boolean>, step: this.tick, stepLimit: RULES.stepLimit, atGoal: this.solved,
    lastMove: last ? { direction: last.move, moved: last.moved } : null };
  }
  /** Sole movement mutation path; replay uses this same command application. */
  apply(move: Move) {
    if (!DIRECTIONS.includes(move)) throw new Error('Invalid movement command.');
    if (this.done) return;
    const moved = this.observation().exits[move];
    const [dx, dy] = DELTAS[move];
    if (moved) this.position = { x: this.position.x + dx, y: this.position.y + dy };
    this.moves.push({ move, moved, ...this.position }); this.tick++;
    this.visited.add(`${this.position.x},${this.position.y}`);
  }
  async step() {
    if (this.done) return;
    try { const d = await choose(this.entry.source, this.observation(), this.state, this.usage); this.state = d.state; this.apply(d.move); }
    catch (e) { this.error = e instanceof Error ? e.message : 'Agent failed.'; }
  }
  async advance(count: number) {
    if (!Number.isInteger(count) || count < 1 || count > 1000) throw new Error('Advance by 1–1000 decisions.');
    for (let i = 0; i < count && !this.done; i++) await this.step();
  }
  view(reveal = false) {
    const cells: { x: number; y: number; open: boolean }[] = [];
    for (let y = 0; y < RULES.rows; y++) for (let x = 0; x < RULES.cols; x++) {
      if (reveal || this.visited.has(`${x},${y}`) || DIRECTIONS.some(d => this.visited.has(`${x + DELTAS[d][0]},${y + DELTAS[d][1]}`)))
        cells.push({ x, y, open: this.world.grid[y][x] === 1 });
    }
    return { observation: this.observation(), cells, goal: reveal || this.solved ? this.world.goal : null,
      path: [{ x: 1, y: 1 }, ...this.moves.map(m => ({ x: m.x, y: m.y }))], done: this.done, error: this.error,
      usage: { ...this.usage }, state: this.state };
  }
  outcome(): Outcome {
    return { solved: this.solved, steps: this.tick, illegalMoves: this.moves.filter(m => !m.moved).length,
      shortest: this.world.shortest, efficiency: this.solved ? this.world.shortest / this.tick : 0,
      usage: { ...this.usage }, ...(this.error !== undefined ? { error: this.error } : {}), moves: [...this.moves] };
  }
}
interface Config { entry: Entry; seed: string }
function parseConfig(value: unknown): ModeConfigResult<Config> {
  try {
    const c = value as Config;
    if (!c || typeof c.seed !== 'string' || !c.seed.trim() || c.seed.length > 200) throw new Error('Seed must be 1–200 characters.');
    return { ok: true, value: { entry: parseEntry(c.entry), seed: c.seed } };
  } catch (e) { return { ok: false, error: String(e) }; }
}
export const mazeAgentMode = defineMode({ id: 'maze-agent', version: 1, parseConfig,
  create: (c: Config) => new MazeTrial(c.entry, c.seed) });
export interface Report {
  format: 'stigsim-maze-agent-results@1'; rules: typeof RULES; budget: typeof BUDGET;
  engine: 'quickjs-emscripten-core@0.32.0/release-sync'; manifest: Manifest;
  entries: { id: string; entry: Entry; outcomes: Outcome[] }[];
}
export async function evaluate(entries: Entry[], manifest: Manifest, onTrial?: (entry: number, outcome: Outcome, completed: number) => void): Promise<Report> {
  const round = parseManifest(manifest);
  if (!entries.length || entries.length > 20) throw new Error('Evaluate 1–20 entries.');
  const canonical = entries.map(parseEntry);
  const frozen = await Promise.all(canonical.map(async entry => ({ id: await entryId(entry), entry, outcomes: [] as Outcome[] })));
  if (new Set(frozen.map(e => e.id)).size !== frozen.length) throw new Error('Duplicate entries.');
  let completed = 0;
  for (const seed of round.seeds) for (let i = 0; i < frozen.length; i++) {
    const trial = mazeAgentMode.create({ entry: frozen[i].entry, seed });
    while (!trial.done) await trial.advance(1000);
    const outcome = trial.outcome(); frozen[i].outcomes.push(outcome); onTrial?.(i, outcome, ++completed);
  }
  return { format: 'stigsim-maze-agent-results@1', rules: RULES, budget: BUDGET,
    engine: 'quickjs-emscripten-core@0.32.0/release-sync', manifest: round, entries: frozen };
}
export function summarize(outcomes: Outcome[]) {
  const n = outcomes.length, solved = outcomes.filter(o => o.solved), values = outcomes.map(o => o.efficiency);
  const mean = n ? values.reduce((s, x) => s + x, 0) / n : 0;
  const variance = n > 1 ? values.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1) : 0;
  return { count: n, solved: solved.length, completion: n ? solved.length / n : 0,
    score: mean * 100, standardError: n > 1 ? Math.sqrt(variance / n) * 100 : null,
    meanSteps: solved.length ? solved.reduce((s, o) => s + o.steps, 0) / solved.length : null,
    illegalMoves: outcomes.reduce((s, o) => s + o.illegalMoves, 0), errors: outcomes.filter(o => o.error).length,
    fuel: outcomes.reduce((s, o) => s + o.usage.fuel, 0) };
}
/** Reconstruct outcomes from logged actions without evaluating entrant source. */
export function replay(entry: Entry, seed: string, outcome: Outcome) {
  const trial = mazeAgentMode.create({ entry, seed });
  if (!Array.isArray(outcome.moves) || outcome.moves.length > RULES.stepLimit) throw new Error('Invalid replay length.');
  for (const record of outcome.moves) {
    if (!DIRECTIONS.includes(record.move) || trial.done) throw new Error('Invalid replay action.');
    trial.apply(record.move);
    const actual = trial.moves[trial.moves.length - 1];
    if (actual.move !== record.move || actual.moved !== record.moved || actual.x !== record.x || actual.y !== record.y) throw new Error('Replay diverged.');
  }
  if (trial.tick !== outcome.steps || trial.solved !== outcome.solved || trial.world.shortest !== outcome.shortest || trial.outcome().efficiency !== outcome.efficiency || trial.outcome().illegalMoves !== outcome.illegalMoves)
    throw new Error('Replay outcome does not match actions.');
  return trial;
}
