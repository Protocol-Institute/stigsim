import { defineMode, generateMaze, makeRng } from "@stigsim/sim-core";
import {
  DELTAS,
  DIRECTIONS,
  RULES,
  type Move,
  type Observation,
} from "./contract";
import { EnvironmentMemory, type MarkWrite } from "./environment";
export class Trial {
  readonly grid: number[][];
  readonly goal: { x: number; y: number };
  readonly shortest: number;
  readonly environment = new EnvironmentMemory();
  position = { x: 1, y: 1 };
  tick = 0;
  moves: { move: Move; moved: boolean; x: number; y: number }[] = [];
  visited = new Set(["1,1"]);
  constructor(
    readonly seed: string,
    readonly stepLimit: number,
  ) {
    this.grid = generateMaze(RULES.loopRate, makeRng(`${seed}:terrain`));
    const distances = new Map([["1,1", 0]]),
      queue = [[1, 1]];
    for (let i = 0; i < queue.length; i++) {
      const [x, y] = queue[i];
      for (const [dx, dy] of Object.values(DELTAS)) {
        const nx = x + dx,
          ny = y + dy,
          key = `${nx},${ny}`;
        if (this.grid[ny]?.[nx] !== 1 || distances.has(key)) continue;
        distances.set(key, distances.get(`${x},${y}`)! + 1);
        queue.push([nx, ny]);
      }
    }
    const candidates = queue.filter(
      ([x, y]) => distances.get(`${x},${y}`)! >= 12,
    );
    const [x, y] =
      candidates[Math.floor(makeRng(`${seed}:exit`)() * candidates.length)];
    this.goal = { x, y };
    this.shortest = distances.get(`${x},${y}`)!;
  }
  get solved() {
    return this.position.x === this.goal.x && this.position.y === this.goal.y;
  }
  get done() {
    return this.solved || this.tick >= this.stepLimit;
  }
  observation(): Observation {
    const { x, y } = this.position,
      last = this.moves.at(-1);
    const observation = {
      position: { x, y },
      exits: Object.fromEntries(
        DIRECTIONS.map((d) => {
          const [dx, dy] = DELTAS[d];
          return [d, this.grid[y + dy]?.[x + dx] === 1];
        }),
      ) as Record<Move, boolean>,
      step: this.tick,
      stepLimit: this.stepLimit,
      atGoal: this.solved,
      lastMove: last ? { direction: last.move, moved: last.moved } : null,
    };
    return {
      ...observation,
      environment: this.environment.local(observation as Observation),
    };
  }
  /** Only successful model responses enter this path. Replay uses it too. */
  apply(move: Move, writes: MarkWrite[]) {
    if (!DIRECTIONS.includes(move) || this.done)
      throw Error("Invalid movement or maze already finished.");
    const o = this.observation();
    this.environment.commit(o, writes, move);
    const moved = o.exits[move],
      [dx, dy] = DELTAS[move];
    if (moved)
      this.position = { x: this.position.x + dx, y: this.position.y + dy };
    this.moves.push({ move, moved, ...this.position });
    this.tick++;
    this.visited.add(`${this.position.x},${this.position.y}`);
  }
  step() {
    throw Error("A model decision is required.");
  }
  view() {
    const cells: { x: number; y: number; open: boolean }[] = [];
    for (let y = 0; y < RULES.rows; y++)
      for (let x = 0; x < RULES.cols; x++) {
        if (
          this.visited.has(`${x},${y}`) ||
          DIRECTIONS.some((d) =>
            this.visited.has(`${x + DELTAS[d][0]},${y + DELTAS[d][1]}`),
          )
        )
          cells.push({ x, y, open: this.grid[y][x] === 1 });
      }
    return {
      observation: this.observation(),
      cells,
      path: [{ x: 1, y: 1 }, ...this.moves.map(({ x, y }) => ({ x, y }))],
      solved: this.solved,
    };
  }
}
export const mazeMemoryMode = defineMode({
  id: "maze-memory",
  version: 1,
  parseConfig(value: unknown) {
    const c = value as { seed: string; stepLimit: number };
    return c &&
      typeof c.seed === "string" &&
      c.seed.length > 0 &&
      c.seed.length <= 200 &&
      Number.isInteger(c.stepLimit) &&
      c.stepLimit > 0 &&
      c.stepLimit <= 4000
      ? { ok: true as const, value: { seed: c.seed, stepLimit: c.stepLimit } }
      : { ok: false as const, error: "Invalid maze seed or movement limit." };
  },
  create: (c) => new Trial(c.seed, c.stepLimit),
});
