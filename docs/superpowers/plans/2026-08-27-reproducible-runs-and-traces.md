# Reproducible Runs and Downloadable Traces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every Maze Simulator run reproducible from a seed and a recorded list of interventions, and let a user download that run as a single file that replays exactly.

**Architecture:** The simulation moves out of `src/AntSim.tsx` into a React-free `src/sim/` module driven by a seeded PRNG with three independent streams. Every mutation the UI can perform becomes a serializable command applied at a tick boundary, so recording a run is just appending commands as they drain. A periodic hash of simulation state travels with the trace so a replay that fails to reproduce reports itself instead of producing a plausible wrong answer.

**Tech Stack:** TypeScript 5.9, React 19, Vite 7, `node:test` via `tsx` (matching the existing server tests), pnpm workspaces.

## Global Constraints

- Nothing under `src/sim/` may import React or touch the DOM. This is what keeps the deferred headless batch runner a small addition.
- Node.js 22.13 or newer; pnpm 11.16.0.
- `pnpm typecheck` and `pnpm build` must pass before every commit.
- Tests use `node:test` and `node:assert/strict` run through `tsx`, following the existing pattern in `server/src/fixed-step.test.ts`. Do not add vitest, jest, or any other test framework.
- Infinite World (`src/components/InfiniteSim.tsx`, `server/`, `shared/`) must not be modified by any task in this plan.
- The simulation grid is fixed at `COLS = 31`, `ROWS = 31`, `CELL = 16`, `V = 4`.
- Trace constants: `TRACE_FORMAT = "stigsim-trace"`, `TRACE_VERSION = 1`, `SIM_VERSION = 1`.
- Sampling intervals: metrics every 10 ticks, fingerprints every 500 ticks.
- Commit messages use the `type: summary` form already in the repo history.

## Deviation from the spec

The spec's command union types `setParam` as `{ key: keyof SimParams; value: number | boolean }`. That does not typecheck cleanly under `strict`, because `cautionary` is boolean while the other three params are numeric, so `apply` cannot narrow the value type from the key. This plan splits it into `setParam` for the three numeric params and `setCautionary` for the boolean. Behaviour is identical; only the typing changes. Everything else follows the spec as written.

## File Structure

**Created:**

| File | Responsibility |
| --- | --- |
| `src/sim/constants.ts` | Grid geometry and model constants shared by sim, renderer, and UI |
| `src/sim/types.ts` | `CellType`, `AntState`, `Ant`, `Colony`, `FoodSource`, `SimParams`, `RunSeeds`, `RunConfig` |
| `src/sim/rng.ts` | `sfc32`, `cyrb128`, `makeRng`, `shuffleInPlace`, `deterministicPow`, seed derivation and generation |
| `src/sim/maze.ts` | `generateMaze(loopRate, rng)` |
| `src/sim/sim.ts` | `Simulation`: `step()`, `enqueue()`, `apply()`, `loadSchedule()` |
| `src/sim/commands.ts` | `Command` union, `TimedCommand`, `isCommand` validation |
| `src/sim/fingerprint.ts` | `fingerprint(sim)` returning an 8-character hex string |
| `src/sim/metrics.ts` | `MetricsRecorder`, sample types, BFS shortest paths, CSV export |
| `src/sim/trace.ts` | `Trace` type, `serializeTrace`, `parseTrace` |
| `src/sim/replay.ts` | `Replayer`: `step()`, `seek()`, divergence reporting |
| `src/sim/index.ts` | Public surface re-exporting the above |
| `src/render.ts` | Canvas renderer plus `COLONY_COLORS` and `VIEW_HALF` |
| `src/sim/*.test.ts` | Colocated tests, one per module under test |
| `src/sim/fixtures/golden.trace.json` | Committed trace replayed in CI |

**Modified:**

- `src/AntSim.tsx` — loses the simulation and the renderer, keeps UI and wiring
- `package.json` — root `tsx` devDependency, `test:client` script, `test` runs both suites
- `CONTRIBUTING.md` — architecture section and the manual cross-engine check

---

### Task 1: Extract the simulation and renderer out of AntSim.tsx

No behaviour changes. This is deliberately a separate commit so that when something breaks in a later task, it is possible to tell whether the extraction or the new logic caused it. The characterisation test added here is the smoke check.

**Files:**
- Create: `src/sim/constants.ts`, `src/sim/types.ts`, `src/sim/maze.ts`, `src/sim/sim.ts`, `src/sim/index.ts`, `src/render.ts`
- Create: `src/sim/sim.test.ts`
- Modify: `src/AntSim.tsx` (remove lines 1–397 and 399–583, add imports)
- Modify: `package.json`

**Interfaces:**
- Consumes: nothing
- Produces: `Simulation` class with `constructor(numAnts, params, loopRate, numColonies, numFoodSources, foodPerSource)`, `step()`, `setAntCount(n)`, `allAnts`, `totalFoodCollected`, and public fields `grid`, `colonies`, `foodSources`, `params`. Also `generateMaze(loopRate)`, `computeHighwayScore(sim)`, `openNeighbours`, `powerChoice`, `cellCenter`, and the constants `COLS`, `ROWS`, `CELL`, `W`, `H`, `V`, `ARRIVE_THRESH`, `NEST_SEED`, `DEPOSIT_RATE`, `DEFAULT_NUM_ANTS`, `COLONY_NESTS`, `DIRS4`, `DEFAULT_PARAMS`, `DEFAULT_NUM_COLONIES`, `DEFAULT_NUM_FOOD_SOURCES`, `DEFAULT_FOOD_PER_SOURCE`. `render(ctx, sim, viewMode, watchedAntIdx, editMode, hoverCell)` and `COLONY_COLORS` from `src/render.ts`.

- [ ] **Step 1: Add the client test harness**

The root package has no test runner; `tsx` is a dependency of the `server` workspace only. Add it to the root and wire up a client test script.

Run:

```bash
pnpm add -D -w tsx@^4.19.0
```

Then edit `package.json` so the `scripts` block reads exactly:

```json
  "scripts": {
    "dev": "vite --host 0.0.0.0",
    "dev:server": "pnpm --dir server dev",
    "build": "tsc --noEmit && vite build && node scripts/prepare-static-routes.mjs",
    "test": "pnpm typecheck && pnpm test:client && pnpm test:server",
    "test:client": "tsx --test src/sim/*.test.ts",
    "test:persistence": "pnpm --dir server exec tsx --test src/sim.persistence.test.ts",
    "test:server": "pnpm --dir server exec tsx --test src/degraded-status.test.ts src/fixed-step.test.ts src/sim.persistence.test.ts src/sim.starvation.test.ts src/security.test.ts src/transport.test.ts src/ws.integration.test.ts",
    "typecheck": "tsc --noEmit && pnpm --dir server typecheck",
    "preview": "vite preview --host 0.0.0.0"
  },
```

- [ ] **Step 2: Write the failing characterisation test**

This pins current behaviour before anything moves. It cannot assert exact values yet, because the simulation still uses `Math.random()`; it asserts the invariants that must survive the extraction.

Create `src/sim/sim.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { Simulation, DEFAULT_PARAMS, COLS, ROWS } from "./index";

function build() {
  return new Simulation(20, DEFAULT_PARAMS, 0.1, 1, 1, 500);
}

test("a fresh simulation has a maze, one colony, and one food source", () => {
  const sim = build();
  assert.equal(sim.grid.length, ROWS);
  assert.equal(sim.grid[0].length, COLS);
  assert.equal(sim.colonies.length, 1);
  assert.equal(sim.foodSources.length, 1);
  assert.equal(sim.allAnts.length, 20);
  assert.equal(sim.totalFoodCollected, 0);
});

test("the nest cell and every food source sit on open ground", () => {
  const sim = build();
  const nest = sim.colonies[0];
  assert.equal(sim.grid[nest.nestY][nest.nestX], 1);
  for (const src of sim.foodSources) {
    assert.equal(sim.grid[src.y][src.x], 1);
  }
});

test("ants collect food within 4000 steps", () => {
  const sim = build();
  for (let i = 0; i < 4000; i++) sim.step();
  assert.ok(
    sim.totalFoodCollected > 0,
    `expected some food collected, got ${sim.totalFoodCollected}`,
  );
});

test("setAntCount grows and shrinks every colony", () => {
  const sim = new Simulation(10, DEFAULT_PARAMS, 0.1, 2, 2, 500);
  assert.equal(sim.allAnts.length, 20);
  sim.setAntCount(30);
  assert.equal(sim.allAnts.length, 60);
  sim.setAntCount(5);
  assert.equal(sim.allAnts.length, 10);
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm test:client`

Expected: FAIL. The module `src/sim/index` does not exist, so every test errors with `Cannot find module`.

- [ ] **Step 4: Create the constants module**

Create `src/sim/constants.ts`. These are moved verbatim from `src/AntSim.tsx` lines 4–26 and 135.

```ts
// ─── Maze dimensions ───────────────────────────────────────────────────────
export const COLS = 31;
export const ROWS = 31;
export const CELL = 16;
export const W = COLS * CELL;
export const H = ROWS * CELL;

// ─── Movement (fixed) ──────────────────────────────────────────────────────
export const V = 4;
export const ARRIVE_THRESH = V + 1;
export const NEST_SEED = 1000;
export const DEFAULT_NUM_ANTS = 20;
export const DEPOSIT_RATE = 20;

// ─── Colony nest corner positions (up to 4) ──────────────────────────────────
export const COLONY_NESTS: [number, number][] = [
  [1, 1],
  [COLS - 2, ROWS - 2],
  [COLS - 2, 1],
  [1, ROWS - 2],
];

export const DIRS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export const DEFAULT_NUM_COLONIES = 1;
export const DEFAULT_NUM_FOOD_SOURCES = 1;
export const DEFAULT_FOOD_PER_SOURCE = 500;

/** Completed round trips kept per colony for the trip-efficiency metric. */
export const TRIP_WINDOW = 50;
```

- [ ] **Step 5: Create the types module**

Create `src/sim/types.ts`. Moved verbatim from `src/AntSim.tsx` lines 36–48 and 54–88.

```ts
export interface SimParams {
  evapRate: number;
  trailPower: number;
  tankMax: number;
  cautionary: boolean;
}

export const DEFAULT_PARAMS: SimParams = {
  evapRate: 0.005,
  trailPower: 5,
  tankMax: 6400,
  cautionary: false,
};

export type CellType = 0 | 1;
export type AntState = "searching" | "returning";

export interface FoodSource {
  x: number;
  y: number;
  remaining: number;
  total: number;
}

export interface Colony {
  id: number;
  nestX: number;
  nestY: number;
  homePhero: Float32Array;
  foodPhero: Float32Array;
  cautPhero: Float32Array;
  ants: Ant[];
  foodCollected: number;
  discoveredSources: Set<number>;
}

export interface Ant {
  x: number; y: number;
  cx: number; cy: number;
  tx: number; ty: number;
  prevCx: number; prevCy: number;
  state: AntState;
  hasFood: boolean;
  tank: number;
  colonyId: number;
  manual?: boolean;
}
```

- [ ] **Step 6: Create the maze module**

Create `src/sim/maze.ts`. Moved verbatim from `src/AntSim.tsx` lines 90–112. The randomness is left exactly as it is; Task 2 replaces it.

```ts
import { COLS, ROWS, COLONY_NESTS } from "./constants";
import type { CellType } from "./types";

export function generateMaze(loopRate: number = 0.1): CellType[][] {
  const grid: CellType[][] = Array.from({ length: ROWS }, () => Array(COLS).fill(0));
  const visited = Array.from({ length: ROWS }, () => Array(COLS).fill(false));
  function carve(cx: number, cy: number) {
    visited[cy][cx] = true;
    grid[cy][cx] = 1;
    const dirs = [[0, -2], [0, 2], [-2, 0], [2, 0]].sort(() => Math.random() - 0.5);
    for (const [dx, dy] of dirs) {
      const nx = cx + dx, ny = cy + dy;
      if (nx >= 0 && nx < COLS && ny >= 0 && ny < ROWS && !visited[ny][nx]) {
        grid[cy + dy / 2][cx + dx / 2] = 1;
        carve(nx, ny);
      }
    }
  }
  carve(1, 1);
  for (let y = 1; y < ROWS - 1; y++)
    for (let x = 1; x < COLS - 1; x++)
      if (grid[y][x] === 0 && Math.random() < loopRate) grid[y][x] = 1;
  // Ensure all colony nest corners are open
  for (const [nx, ny] of COLONY_NESTS) grid[ny][nx] = 1;
  return grid;
}
```

- [ ] **Step 7: Create the simulation module**

Create `src/sim/sim.ts`. Move `computeHighwayScore`, `openNeighbours`, `powerChoice`, `cellCenter`, and the whole `Simulation` class from `src/AntSim.tsx` lines 114–397 verbatim, adding `export` to each and importing what they need. The file begins:

```ts
import {
  COLS, ROWS, CELL, V, ARRIVE_THRESH, NEST_SEED, DEPOSIT_RATE,
  COLONY_NESTS, DIRS4,
} from "./constants";
import type { Ant, AntState, CellType, Colony, FoodSource, SimParams } from "./types";
import { generateMaze } from "./maze";

export const cellCenter = (gx: number, gy: number) => ({ px: gx * CELL + CELL / 2, py: gy * CELL + CELL / 2 });
```

Then `export function computeHighwayScore`, `export function openNeighbours`, `export function powerChoice`, and `export class Simulation`, each copied without any change to its body. `cellCenter` is declared before `Simulation` because the class uses it.

- [ ] **Step 8: Create the public surface**

Create `src/sim/index.ts`:

```ts
export * from "./constants";
export * from "./types";
export * from "./maze";
export * from "./sim";
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `pnpm test:client`

Expected: PASS, 4 tests. If "ants collect food within 4000 steps" fails intermittently, that is a real signal the extraction changed something; do not raise the step count to make it pass.

- [ ] **Step 10: Create the renderer module**

Create `src/render.ts`. Move `VIEW_HALF` (line 18), `COLONY_COLORS` (lines 29–34), `ViewMode`, `EditMode`, and `render` (lines 399–583) from `src/AntSim.tsx` verbatim. The file begins:

```ts
import { COLS, ROWS, CELL, W, H, NEST_SEED } from "./sim/constants";
import type { Simulation } from "./sim";

// ─── One-ant view: half-size of the source window in pixels ─────────────────
export const VIEW_HALF = CELL * 1;

// ─── Colony visual identity ──────────────────────────────────────────────────
export const COLONY_COLORS = [
  { primary: "#4b9eff", homeRGB: "80,158,255", foodRGB: "80,220,200" },
  { primary: "#ff6b6b", homeRGB: "255,107,107", foodRGB: "255,200,80"  },
  { primary: "#4bde80", homeRGB: "75,222,128",  foodRGB: "200,255,80"  },
  { primary: "#c084fc", homeRGB: "192,132,252", foodRGB: "252,132,200" },
];

export type ViewMode = "all" | "one";
export type EditMode = "none" | "wall" | "food";

export function render(
  ctx: CanvasRenderingContext2D,
  sim: Simulation,
  viewMode: ViewMode = "all",
  watchedAntIdx: number = 0,
  editMode: EditMode = "none",
  hoverCell: { x: number; y: number } | null = null,
) {
  // Body copied unchanged from AntSim.tsx lines 407-583.
}
```

The body is 177 lines of canvas drawing. Move it verbatim; do not retype or
reformat it, and do not change any colour, alpha, or coordinate value. Import
any further constants it references. Let `pnpm typecheck` name them; do not
guess.

- [ ] **Step 11: Strip AntSim.tsx down to the UI**

Delete lines 1–583 of `src/AntSim.tsx` (everything from the React import through the end of `render`) and replace them with:

```tsx
import { useRef, useEffect, useCallback, useState } from "react";
import {
  Simulation, computeHighwayScore, cellCenter,
  COLS, ROWS, CELL, W, H, V, DEPOSIT_RATE, DEFAULT_NUM_ANTS,
  DEFAULT_PARAMS, DEFAULT_NUM_COLONIES, DEFAULT_NUM_FOOD_SOURCES,
  DEFAULT_FOOD_PER_SOURCE,
} from "./sim";
import type { SimParams } from "./sim";
import { render, COLONY_COLORS } from "./render";
import type { ViewMode, EditMode } from "./render";
```

Keep `ParamCard`, `ControlCard`, `DPAD_CHEVRONS`, `DPadButton`, `IconPlay`, `IconPause`, `IconReset`, and the `AntSim` component exactly as they are. Prune any import that `pnpm typecheck` reports as unused.

- [ ] **Step 12: Verify the whole build**

Run: `pnpm typecheck && pnpm build && pnpm test:client`

Expected: all pass.

- [ ] **Step 13: Smoke check in the browser**

There is no automated coverage of the UI, so this extraction needs eyes on it. Run `PORT=3000 BASE_PATH=/ pnpm dev` and open `http://localhost:3000/`. Confirm: the maze renders; play and pause work; ants form a trail and the food counter rises; the reset button generates a new maze; the wall and food edit modes still change the grid; "control one" switches to the zoomed single-ant view and the arrow keys move that ant; changing colony count from 1 to 4 gives four coloured nests.

- [ ] **Step 14: Commit**

```bash
git add package.json pnpm-lock.yaml src/sim src/render.ts src/AntSim.tsx
git commit -m "refactor: extract simulation and renderer out of AntSim.tsx

Moves the Simulation class, maze generation, and the canvas renderer into
src/sim/ and src/render.ts, leaving AntSim.tsx as UI and wiring. No
behaviour change. Adds a client test harness using node:test via tsx,
matching the existing server tests, with characterisation tests that pin
current simulation behaviour.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Seeded randomness

Replaces all four `Math.random()` call sites in the simulation with three independent seeded streams, removes the two cross-engine determinism hazards, and puts a seed field in the UI.

**Files:**
- Create: `src/sim/rng.ts`, `src/sim/rng.test.ts`, `src/sim/maze.test.ts`
- Modify: `src/sim/types.ts`, `src/sim/maze.ts`, `src/sim/sim.ts`, `src/sim/index.ts`, `src/AntSim.tsx`

**Interfaces:**
- Consumes: `Simulation`, `generateMaze`, `powerChoice` from Task 1.
- Produces: `type Rng = () => number`; `sfc32(a,b,c,d): Rng`; `cyrb128(str): [number,number,number,number]`; `makeRng(seed: string): Rng`; `deriveStreamSeed(master: string, stream: string): string`; `makeSeeds(master: string): RunSeeds`; `generateMasterSeed(): string`; `shuffleInPlace<T>(arr: T[], rng: Rng): void`; `deterministicPow(base: number, power: number): number`. `RunSeeds` and `RunConfig` in `types.ts`. `Simulation` constructor changes to `constructor(config: RunConfig)` and gains a readonly `config` field.

- [ ] **Step 1: Write the failing RNG tests**

Create `src/sim/rng.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  makeRng, makeSeeds, deriveStreamSeed, generateMasterSeed,
  shuffleInPlace, deterministicPow,
} from "./rng";

test("the same seed produces the same sequence", () => {
  const a = makeRng("abc123");
  const b = makeRng("abc123");
  for (let i = 0; i < 1000; i++) assert.equal(a(), b());
});

test("different seeds produce different sequences", () => {
  const a = makeRng("abc123");
  const b = makeRng("abc124");
  let same = 0;
  for (let i = 0; i < 1000; i++) if (a() === b()) same++;
  assert.ok(same < 5, `expected near-zero collisions, got ${same}`);
});

test("draws stay in [0, 1)", () => {
  const r = makeRng("range-check");
  for (let i = 0; i < 10000; i++) {
    const v = r();
    assert.ok(v >= 0 && v < 1, `out of range: ${v}`);
  }
});

test("the mean of many draws is near 0.5", () => {
  const r = makeRng("uniformity");
  let sum = 0;
  const n = 200000;
  for (let i = 0; i < n; i++) sum += r();
  assert.ok(Math.abs(sum / n - 0.5) < 0.005, `mean was ${sum / n}`);
});

test("streams derived from one master differ from each other", () => {
  const seeds = makeSeeds("quiet-ember-4417");
  assert.equal(seeds.master, "quiet-ember-4417");
  const distinct = new Set([seeds.maze, seeds.food, seeds.ants]);
  assert.equal(distinct.size, 3);
});

test("stream derivation is stable across calls", () => {
  assert.equal(deriveStreamSeed("m", "ants"), deriveStreamSeed("m", "ants"));
  assert.notEqual(deriveStreamSeed("m", "ants"), deriveStreamSeed("m", "maze"));
});

test("generated master seeds are non-empty and vary", () => {
  const seeds = new Set(Array.from({ length: 50 }, () => generateMasterSeed()));
  assert.ok(seeds.size > 40, `expected varied seeds, got ${seeds.size} distinct`);
  for (const s of seeds) assert.ok(s.length > 0);
});

test("shuffleInPlace is a permutation and is seed-stable", () => {
  const a = [1, 2, 3, 4, 5, 6, 7, 8];
  const b = [1, 2, 3, 4, 5, 6, 7, 8];
  shuffleInPlace(a, makeRng("shuf"));
  shuffleInPlace(b, makeRng("shuf"));
  assert.deepEqual(a, b);
  assert.deepEqual([...a].sort((x, y) => x - y), [1, 2, 3, 4, 5, 6, 7, 8]);
});

test("deterministicPow matches Math.pow across the slider's value set", () => {
  for (let power = 1; power <= 10; power += 0.5) {
    for (const base of [1, 1.5, 2, 7, 21.25, 101, 1001]) {
      const ours = deterministicPow(base, power);
      const theirs = Math.pow(base, power);
      const relative = Math.abs(ours - theirs) / theirs;
      assert.ok(
        relative < 1e-12,
        `power ${power} base ${base}: ${ours} vs ${theirs} (rel ${relative})`,
      );
    }
  }
});

test("deterministicPow is stable across repeated calls", () => {
  const first = deterministicPow(37.125, 7.5);
  for (let i = 0; i < 100; i++) assert.equal(deterministicPow(37.125, 7.5), first);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test:client`

Expected: FAIL with `Cannot find module './rng'`.

- [ ] **Step 3: Write the RNG module**

Create `src/sim/rng.ts`.

`sfc32` uses only shifts, xor, and `| 0` addition, none of which is implementation-defined. `cyrb128` uses `Math.imul`, which the ECMAScript specification defines exactly as the 32-bit integer product, so it is equally safe.

```ts
export type Rng = () => number;

/** Small Fast Counter, 32-bit. Shifts, xor, and wrapping addition only. */
export function sfc32(a: number, b: number, c: number, d: number): Rng {
  return function next(): number {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

/** Hashes a string into four 32-bit words suitable for seeding sfc32. */
export function cyrb128(str: string): [number, number, number, number] {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  return [
    (h1 ^ h2 ^ h3 ^ h4) >>> 0,
    (h2 ^ h1) >>> 0,
    (h3 ^ h1) >>> 0,
    (h4 ^ h1) >>> 0,
  ];
}

export function makeRng(seed: string): Rng {
  const [a, b, c, d] = cyrb128(seed);
  const rng = sfc32(a, b, c, d);
  // Discard the first draws so poorly-distributed seeds settle.
  for (let i = 0; i < 12; i++) rng();
  return rng;
}

export function deriveStreamSeed(master: string, stream: string): string {
  const [a] = cyrb128(`${master}:${stream}`);
  return a.toString(16).padStart(8, "0");
}

const SEED_ADJECTIVES = [
  "quiet", "amber", "hollow", "brisk", "solar", "tidal", "gilded", "narrow",
  "velvet", "cobalt", "rustic", "candid", "lucid", "muted", "stark", "keen",
];

const SEED_NOUNS = [
  "ember", "lattice", "harbor", "cinder", "meadow", "quarry", "bastion", "thicket",
  "current", "vellum", "compass", "beacon", "cistern", "ridge", "furrow", "anvil",
];

/**
 * A short, typeable, shareable seed. Uses Math.random because the value is
 * captured in the trace rather than regenerated from anything.
 */
export function generateMasterSeed(): string {
  const adjective = SEED_ADJECTIVES[Math.floor(Math.random() * SEED_ADJECTIVES.length)];
  const noun = SEED_NOUNS[Math.floor(Math.random() * SEED_NOUNS.length)];
  const number = Math.floor(Math.random() * 9000) + 1000;
  return `${adjective}-${noun}-${number}`;
}

export function shuffleInPlace<T>(arr: T[], rng: Rng): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

/**
 * Exponentiation without Math.pow, whose precision the ECMAScript
 * specification leaves implementation-defined. Multiplication and square root
 * are both exactly specified by IEEE-754, and the trail-bias slider steps in
 * halves, so every exponent it can produce is reachable this way.
 */
export function deterministicPow(base: number, power: number): number {
  const whole = Math.floor(power);
  let r = 1;
  for (let i = 0; i < whole; i++) r *= base;
  return power === whole ? r : r * Math.sqrt(base);
}
```

- [ ] **Step 4: Add the seed types**

Append to `src/sim/types.ts`:

```ts
export interface RunSeeds {
  /** Null when the three streams were seeded independently. */
  master: string | null;
  maze: string;
  food: string;
  ants: string;
}

export interface RunConfig {
  seeds: RunSeeds;
  numAnts: number;
  params: SimParams;
  loopRate: number;
  numColonies: number;
  numFoodSources: number;
  foodPerSource: number;
}
```

Append `makeSeeds` to `src/sim/rng.ts`:

```ts
import type { RunSeeds } from "./types";

export function makeSeeds(master: string): RunSeeds {
  return {
    master,
    maze: deriveStreamSeed(master, "maze"),
    food: deriveStreamSeed(master, "food"),
    ants: deriveStreamSeed(master, "ants"),
  };
}
```

Put the import at the top of the file, not inline.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm test:client`

Expected: the ten `rng.test.ts` tests PASS. The Task 1 tests still pass, because nothing has been rewired yet.

- [ ] **Step 6: Write the failing maze determinism test**

Create `src/sim/maze.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { generateMaze } from "./maze";
import { makeRng } from "./rng";
import { COLS, ROWS, COLONY_NESTS } from "./constants";

test("the same seed produces an identical grid", () => {
  const a = generateMaze(0.1, makeRng("maze-seed-1"));
  const b = generateMaze(0.1, makeRng("maze-seed-1"));
  assert.deepEqual(a, b);
});

test("different seeds produce different grids", () => {
  const a = generateMaze(0.1, makeRng("maze-seed-1"));
  const b = generateMaze(0.1, makeRng("maze-seed-2"));
  assert.notDeepEqual(a, b);
});

test("every nest corner is open regardless of seed", () => {
  const grid = generateMaze(0.1, makeRng("nest-check"));
  for (const [x, y] of COLONY_NESTS) assert.equal(grid[y][x], 1);
});

test("the grid is the declared size and holds only 0 or 1", () => {
  const grid = generateMaze(0.25, makeRng("shape-check"));
  assert.equal(grid.length, ROWS);
  for (const row of grid) {
    assert.equal(row.length, COLS);
    for (const cell of row) assert.ok(cell === 0 || cell === 1);
  }
});

test("a higher loop rate opens at least as many cells", () => {
  const count = (g: number[][]) => g.flat().filter(c => c === 1).length;
  const sparse = count(generateMaze(0.0, makeRng("loops")));
  const dense = count(generateMaze(0.4, makeRng("loops")));
  assert.ok(dense > sparse, `expected ${dense} > ${sparse}`);
});
```

- [ ] **Step 7: Run to verify it fails**

Run: `pnpm test:client`

Expected: FAIL. `generateMaze` takes one argument, so passing an `Rng` is a type error and the seeded tests do not compile.

- [ ] **Step 8: Seed the maze generator**

Rewrite `src/sim/maze.ts`. The direction shuffle changes from `sort(() => Math.random() - 0.5)`, which is not a uniform shuffle and depends on the engine's sort algorithm, to Fisher-Yates over the maze stream.

```ts
import { COLS, ROWS, COLONY_NESTS } from "./constants";
import type { CellType } from "./types";
import { shuffleInPlace, type Rng } from "./rng";

export function generateMaze(loopRate: number, rng: Rng): CellType[][] {
  const grid: CellType[][] = Array.from({ length: ROWS }, () => Array(COLS).fill(0));
  const visited = Array.from({ length: ROWS }, () => Array(COLS).fill(false));

  function carve(cx: number, cy: number) {
    visited[cy][cx] = true;
    grid[cy][cx] = 1;
    const dirs: [number, number][] = [[0, -2], [0, 2], [-2, 0], [2, 0]];
    shuffleInPlace(dirs, rng);
    for (const [dx, dy] of dirs) {
      const nx = cx + dx, ny = cy + dy;
      if (nx >= 0 && nx < COLS && ny >= 0 && ny < ROWS && !visited[ny][nx]) {
        grid[cy + dy / 2][cx + dx / 2] = 1;
        carve(nx, ny);
      }
    }
  }

  carve(1, 1);
  for (let y = 1; y < ROWS - 1; y++)
    for (let x = 1; x < COLS - 1; x++)
      if (grid[y][x] === 0 && rng() < loopRate) grid[y][x] = 1;
  // Ensure all colony nest corners are open
  for (const [nx, ny] of COLONY_NESTS) grid[ny][nx] = 1;
  return grid;
}
```

- [ ] **Step 9: Run to verify it passes**

Run: `pnpm test:client`

Expected: the `maze.test.ts` tests PASS. The Task 1 `sim.test.ts` tests now FAIL to compile, because `Simulation` still calls `generateMaze(loopRate)` with one argument. Step 10 fixes that.

- [ ] **Step 10: Seed the simulation**

Edit `src/sim/sim.ts`.

Add to the imports:

```ts
import { makeRng, deterministicPow, shuffleInPlace, type Rng } from "./rng";
import type { RunConfig } from "./types";
```

Change `powerChoice` to take an `Rng` and to use `deterministicPow`:

```ts
export function powerChoice(
  cells: [number, number][],
  phero: Float32Array,
  power: number,
  rng: Rng,
  cautPhero?: Float32Array,
  cautPower?: number,
): [number, number] {
  const scores = cells.map(([cx, cy]) => {
    const idx = cy * COLS + cx;
    const trail = deterministicPow(phero[idx] + 1, power);
    const caution = (cautPhero && cautPower) ? deterministicPow(cautPhero[idx] + 1, cautPower) : 1;
    return trail / caution;
  });
  const total = scores.reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (let i = 0; i < cells.length; i++) { r -= scores[i]; if (r <= 0) return cells[i]; }
  return cells[cells.length - 1];
}
```

Replace the `Simulation` constructor and its two seeded helpers. The constructor now takes a single `RunConfig`:

```ts
export class Simulation {
  readonly config: RunConfig;
  numAnts: number;
  numColonies: number;
  numFoodSources: number;
  foodPerSource: number;
  params: SimParams;
  loopRate: number;
  grid: CellType[][];
  colonies: Colony[];
  foodSources: FoodSource[];
  private antsRng: Rng;

  constructor(config: RunConfig) {
    this.config = config;
    this.numAnts = config.numAnts;
    this.params = { ...config.params };
    this.loopRate = config.loopRate;
    this.numColonies = config.numColonies;
    this.numFoodSources = config.numFoodSources;
    this.foodPerSource = config.foodPerSource;
    this.antsRng = makeRng(config.seeds.ants);
    this.grid = generateMaze(config.loopRate, makeRng(config.seeds.maze));
    this.colonies = this._initColonies();
    this.foodSources = this._placeFoodSources(makeRng(config.seeds.food));
    for (const colony of this.colonies) this._seedNest(colony);
  }
```

In `_placeFoodSources`, take the stream as a parameter and replace the inline Fisher-Yates:

```ts
  private _placeFoodSources(rng: Rng): FoodSource[] {
    // ... the open-cell collection loop is unchanged ...
    shuffleInPlace(open, rng);
    const count = Math.min(this.numFoodSources, open.length);
    return open.slice(0, count).map(([x, y]) => ({
      x, y,
      remaining: this.foodPerSource,
      total: this.foodPerSource,
    }));
  }
```

In `_moveAnt`, pass the ants stream to `powerChoice`:

```ts
    const next = powerChoice(
      candidates, phero, trailPower, this.antsRng,
      this.params.cautionary ? colony.cautPhero : undefined, trailPower,
    );
```

- [ ] **Step 11: Update the Task 1 tests for the new constructor**

In `src/sim/sim.test.ts`, replace the imports and the `build` helper:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { Simulation, DEFAULT_PARAMS, COLS, ROWS, makeSeeds } from "./index";
import type { RunConfig } from "./index";

function config(overrides: Partial<RunConfig> = {}): RunConfig {
  return {
    seeds: makeSeeds("test-master"),
    numAnts: 20,
    params: DEFAULT_PARAMS,
    loopRate: 0.1,
    numColonies: 1,
    numFoodSources: 1,
    foodPerSource: 500,
    ...overrides,
  };
}

function build() {
  return new Simulation(config());
}
```

In the `setAntCount` test, replace `new Simulation(10, DEFAULT_PARAMS, 0.1, 2, 2, 500)` with `new Simulation(config({ numAnts: 10, numColonies: 2, numFoodSources: 2 }))`.

Add `export * from "./rng";` to `src/sim/index.ts`.

- [ ] **Step 12: Add the stream independence test**

Append to `src/sim/sim.test.ts`:

```ts
test("the same seeds produce an identical run", () => {
  const c = config();
  const a = new Simulation(c);
  const b = new Simulation(c);
  for (let i = 0; i < 500; i++) { a.step(); b.step(); }
  assert.equal(a.totalFoodCollected, b.totalFoodCollected);
  assert.deepEqual(a.grid, b.grid);
  assert.deepEqual(
    a.allAnts.map(x => [x.cx, x.cy]),
    b.allAnts.map(x => [x.cx, x.cy]),
  );
});

test("holding the maze and food seeds fixed while varying ants keeps the map", () => {
  const base = config();
  const varied: RunConfig = {
    ...base,
    seeds: { ...base.seeds, master: null, ants: "deadbeef" },
  };
  const a = new Simulation(base);
  const b = new Simulation(varied);

  assert.deepEqual(a.grid, b.grid);
  assert.deepEqual(
    a.foodSources.map(s => [s.x, s.y]),
    b.foodSources.map(s => [s.x, s.y]),
  );

  for (let i = 0; i < 500; i++) { a.step(); b.step(); }
  assert.notDeepEqual(
    a.allAnts.map(x => [x.cx, x.cy]),
    b.allAnts.map(x => [x.cx, x.cy]),
  );
});
```

- [ ] **Step 13: Run the tests to verify they pass**

Run: `pnpm test:client`

Expected: PASS, all of `rng.test.ts`, `maze.test.ts`, and `sim.test.ts`.

- [ ] **Step 14: Wire the seed into the UI**

In `src/AntSim.tsx`, add to the imports from `./sim`: `makeSeeds`, `generateMasterSeed`, and the type `RunConfig`.

Add state beside the other simulation settings near line 751:

```tsx
  const [seedInput, setSeedInput] = useState(() => generateMasterSeed());
  const [activeSeed, setActiveSeed] = useState(seedInput);
  const seedInputRef = useRef(seedInput);
  seedInputRef.current = seedInput;
```

Replace the body of `initSim` so it builds a `RunConfig` and records which seed the run is actually using:

```tsx
  const initSim = useCallback(() => {
    const master = seedInputRef.current.trim() || generateMasterSeed();
    setActiveSeed(master);
    simRef.current = new Simulation({
      seeds: makeSeeds(master),
      numAnts: numAntsRef.current,
      params: paramsRef.current,
      loopRate: loopRateRef.current,
      numColonies: numColoniesRef.current,
      numFoodSources: numFoodSourcesRef.current,
      foodPerSource: foodPerSourceRef.current,
    });
    setColonyScores(simRef.current.colonies.map(() => 0));
    setFoodRate(0);
    foodTimestampsRef.current = [];
    prevTotalRef.current = 0;
    if (viewModeRef.current === "one") {
      const total = simRef.current.allAnts.length;
      const idx = Math.floor(Math.random() * total);
      setWatchedAntIdx(idx);
      watchedAntIdxRef.current = idx;
    }
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx && simRef.current) render(ctx, simRef.current, viewModeRef.current, watchedAntIdxRef.current, editModeRef.current, hoverCellRef.current);
  }, []);
```

Add a Run panel above the "Ant settings" section at line 1465. Editing the field does not disturb the run in progress; the new seed takes effect on the next reset, matching how the existing maze-shape and colony-count controls behave.

```tsx
      <div style={{ width: "100%", maxWidth: 600 }}>
        <p style={{ margin: "4px 0 8px", fontSize: "0.65rem", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#6b5a3e" }}>
          Run
        </p>
        <div style={{
          background: "#0f0a04", border: "1px solid #3d2e18", borderRadius: 10,
          padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8,
        }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="text"
              value={seedInput}
              onChange={e => setSeedInput(e.target.value)}
              spellCheck={false}
              aria-label="Run seed"
              style={{
                flex: 1, minWidth: 0, background: "#1a1208", color: "#e5d5b5",
                border: "1px solid #3d2e18", borderRadius: 6, padding: "6px 8px",
                fontFamily: "monospace", fontSize: "0.8rem",
              }}
            />
            <button
              type="button"
              onClick={() => setSeedInput(generateMasterSeed())}
              style={{
                background: "#1a1208", color: "#f59e0b", border: "1px solid #3d2e18",
                borderRadius: 6, padding: "6px 10px", cursor: "pointer", fontSize: "0.8rem",
              }}
            >
              New seed
            </button>
          </div>
          <p style={{ margin: 0, fontSize: "0.72rem", color: "#a08060", lineHeight: 1.45 }}>
            {seedInput.trim() === activeSeed
              ? "Runs with this seed reproduce exactly."
              : `Running as "${activeSeed}". Reset to use the new seed.`}
          </p>
        </div>
      </div>
```

- [ ] **Step 15: Verify the build and check reproducibility by hand**

Run: `pnpm typecheck && pnpm build && pnpm test:client`

Then `PORT=3000 BASE_PATH=/ pnpm dev`. Enter a fixed seed, press reset, and confirm the same maze and the same food position appear every time. Press "New seed" and reset to confirm you get a different maze. Confirm the helper line switches to "Reset to use the new seed" when the field is edited and back after a reset.

- [ ] **Step 16: Commit**

```bash
git add src/sim src/AntSim.tsx
git commit -m "feat: seed the simulation from a shareable run seed

Replaces every Math.random call in the simulation with three independent
sfc32 streams for maze, food, and ant behaviour, derived from one master
seed. Holding the maze and food seeds fixed while varying the ant seed
reruns the same map with different behaviour.

Closes two cross-engine determinism hazards: the random-comparator sort
in generateMaze becomes Fisher-Yates, and Math.pow in powerChoice becomes
repeated multiplication with Math.sqrt for half exponents, since the
ECMAScript specification leaves Math.pow precision implementation-defined.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Tick counter and command bus

Every mutation becomes a serializable command applied at a tick boundary. After this task the UI never touches simulation state directly, which is what makes recording a run free.

**Files:**
- Create: `src/sim/commands.ts`, `src/sim/commands.test.ts`
- Modify: `src/sim/sim.ts`, `src/sim/index.ts`, `src/AntSim.tsx`

**Interfaces:**
- Consumes: `Simulation`, `RunConfig` from Task 2.
- Produces: `Command` union, `TimedCommand` (`{ t: number; cmd: Command }`), `isCommand(v: unknown): v is Command`. `Simulation` gains `tick: number`, `manualAntIndex: number | null`, `enqueue(cmd: Command): void`, `apply(cmd: Command): void`, `flushPending(): void`, `loadSchedule(cmds: TimedCommand[]): void`, and `get commandLog(): readonly TimedCommand[]`.

- [ ] **Step 1: Write the failing command bus tests**

Create `src/sim/commands.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { Simulation, DEFAULT_PARAMS, makeSeeds, isCommand } from "./index";
import type { RunConfig, Command } from "./index";

function config(overrides: Partial<RunConfig> = {}): RunConfig {
  return {
    seeds: makeSeeds("command-test"),
    numAnts: 10,
    params: DEFAULT_PARAMS,
    loopRate: 0.1,
    numColonies: 1,
    numFoodSources: 1,
    foodPerSource: 500,
    ...overrides,
  };
}

/** An open, non-nest, non-food cell for edit tests. */
function editableCell(sim: Simulation): [number, number] {
  for (let y = 2; y < 28; y++) {
    for (let x = 2; x < 28; x++) {
      if (sim.grid[y][x] !== 1) continue;
      if (sim.colonies.some(c => c.nestX === x && c.nestY === y)) continue;
      if (sim.foodSources.some(s => s.x === x && s.y === y)) continue;
      return [x, y];
    }
  }
  throw new Error("no editable cell found");
}

test("the tick counter starts at zero and advances once per step", () => {
  const sim = new Simulation(config());
  assert.equal(sim.tick, 0);
  sim.step();
  assert.equal(sim.tick, 1);
  for (let i = 0; i < 99; i++) sim.step();
  assert.equal(sim.tick, 100);
});

test("an enqueued command applies on the next step and is recorded at that tick", () => {
  const sim = new Simulation(config());
  const [x, y] = editableCell(sim);

  sim.enqueue({ kind: "setWall", x, y, open: false });
  assert.equal(sim.grid[y][x], 1, "not applied before the step");

  sim.step();
  assert.equal(sim.grid[y][x], 0, "applied during the step");
  assert.deepEqual(sim.commandLog, [{ t: 1, cmd: { kind: "setWall", x, y, open: false } }]);
});

test("commands enqueued in one tick apply in order", () => {
  const sim = new Simulation(config());
  sim.enqueue({ kind: "setAntCount", n: 5 });
  sim.enqueue({ kind: "setAntCount", n: 7 });
  sim.step();
  assert.equal(sim.allAnts.length, 7);
  assert.deepEqual(sim.commandLog.map(c => c.t), [1, 1]);
});

test("flushPending applies at the current tick without advancing", () => {
  const sim = new Simulation(config());
  const [x, y] = editableCell(sim);
  sim.enqueue({ kind: "setWall", x, y, open: false });
  sim.flushPending();
  assert.equal(sim.tick, 0);
  assert.equal(sim.grid[y][x], 0);
  assert.deepEqual(sim.commandLog, [{ t: 0, cmd: { kind: "setWall", x, y, open: false } }]);
});

test("walls refuse to close over a nest or a food source", () => {
  const sim = new Simulation(config());
  const nest = sim.colonies[0];
  const food = sim.foodSources[0];

  sim.enqueue({ kind: "setWall", x: nest.nestX, y: nest.nestY, open: false });
  sim.enqueue({ kind: "setWall", x: food.x, y: food.y, open: false });
  sim.step();

  assert.equal(sim.grid[nest.nestY][nest.nestX], 1);
  assert.equal(sim.grid[food.y][food.x], 1);
});

test("closing a wall clears any ant targeting that cell", () => {
  const sim = new Simulation(config());
  for (let i = 0; i < 50; i++) sim.step();
  const ant = sim.allAnts[0];
  const [tx, ty] = [ant.tx, ant.ty];
  if (sim.colonies.some(c => c.nestX === tx && c.nestY === ty)) return;
  if (sim.foodSources.some(s => s.x === tx && s.y === ty)) return;

  sim.enqueue({ kind: "setWall", x: tx, y: ty, open: false });
  sim.step();

  for (const a of sim.allAnts) {
    assert.ok(!(a.tx === tx && a.ty === ty), "an ant still targets the closed cell");
  }
});

test("setFood adds and removes sources and keeps discovered indices consistent", () => {
  const sim = new Simulation(config());
  const [x, y] = editableCell(sim);

  sim.enqueue({ kind: "setFood", x, y, amount: 300 });
  sim.step();
  assert.equal(sim.foodSources.length, 2);
  const added = sim.foodSources.find(s => s.x === x && s.y === y);
  assert.ok(added);
  assert.equal(added.remaining, 300);
  assert.equal(added.total, 300);

  sim.enqueue({ kind: "setFood", x, y, amount: 0 });
  sim.step();
  assert.equal(sim.foodSources.length, 1);
});

test("setFood refuses walls and nests", () => {
  const sim = new Simulation(config());
  const nest = sim.colonies[0];
  let wall: [number, number] | null = null;
  for (let y = 1; y < 30 && !wall; y++)
    for (let x = 1; x < 30 && !wall; x++)
      if (sim.grid[y][x] === 0) wall = [x, y];
  assert.ok(wall);

  const before = sim.foodSources.length;
  sim.enqueue({ kind: "setFood", x: wall[0], y: wall[1], amount: 100 });
  sim.enqueue({ kind: "setFood", x: nest.nestX, y: nest.nestY, amount: 100 });
  sim.step();
  assert.equal(sim.foodSources.length, before);
});

test("setParam and setCautionary reach the running simulation", () => {
  const sim = new Simulation(config());
  sim.enqueue({ kind: "setParam", key: "trailPower", value: 8 });
  sim.enqueue({ kind: "setCautionary", value: true });
  sim.step();
  assert.equal(sim.params.trailPower, 8);
  assert.equal(sim.params.cautionary, true);
});

test("setManualAnt marks exactly one ant and null clears it", () => {
  const sim = new Simulation(config());
  sim.enqueue({ kind: "setManualAnt", index: 3 });
  sim.step();
  assert.equal(sim.manualAntIndex, 3);
  assert.equal(sim.allAnts.filter(a => a.manual).length, 1);
  assert.equal(sim.allAnts[3].manual, true);

  sim.enqueue({ kind: "setManualAnt", index: null });
  sim.step();
  assert.equal(sim.manualAntIndex, null);
  assert.equal(sim.allAnts.filter(a => a.manual).length, 0);
});

test("moveManualAnt retargets the controlled ant and refuses walls", () => {
  const sim = new Simulation(config());
  sim.enqueue({ kind: "setManualAnt", index: 0 });
  sim.step();
  const ant = sim.allAnts[0];

  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as [number, number][]) {
    const nx = ant.cx + dx, ny = ant.cy + dy;
    const open = nx >= 0 && nx < 31 && ny >= 0 && ny < 31 && sim.grid[ny][nx] === 1;
    const before: [number, number] = [ant.tx, ant.ty];
    sim.enqueue({ kind: "moveManualAnt", dx, dy });
    sim.flushPending();
    if (open) assert.deepEqual([ant.tx, ant.ty], [nx, ny]);
    else assert.deepEqual([ant.tx, ant.ty], before);
  }
});

test("a loaded schedule replays commands at the recorded ticks", () => {
  const c = config();
  const live = new Simulation(c);
  const [x, y] = editableCell(live);

  for (let i = 0; i < 20; i++) live.step();
  live.enqueue({ kind: "setWall", x, y, open: false });
  for (let i = 0; i < 20; i++) live.step();
  live.enqueue({ kind: "setParam", key: "evapRate", value: 0.01 });
  for (let i = 0; i < 20; i++) live.step();

  const replay = new Simulation(c);
  replay.loadSchedule([...live.commandLog]);
  for (let i = 0; i < 60; i++) replay.step();

  assert.deepEqual(replay.commandLog, live.commandLog);
  assert.equal(replay.grid[y][x], 0);
  assert.equal(replay.params.evapRate, 0.01);
  assert.equal(replay.totalFoodCollected, live.totalFoodCollected);
});

test("a schedule entry at tick 0 applies when the schedule loads", () => {
  const c = config();
  const sim = new Simulation(c);
  const [x, y] = editableCell(sim);
  sim.loadSchedule([{ t: 0, cmd: { kind: "setWall", x, y, open: false } }]);
  assert.equal(sim.tick, 0);
  assert.equal(sim.grid[y][x], 0);
});

test("isCommand accepts valid commands and rejects malformed input", () => {
  const good: Command[] = [
    { kind: "setWall", x: 1, y: 2, open: true },
    { kind: "setFood", x: 1, y: 2, amount: 0 },
    { kind: "setParam", key: "tankMax", value: 3200 },
    { kind: "setCautionary", value: false },
    { kind: "setAntCount", n: 12 },
    { kind: "setManualAnt", index: null },
    { kind: "moveManualAnt", dx: 0, dy: -1 },
  ];
  for (const cmd of good) assert.ok(isCommand(cmd), `rejected ${JSON.stringify(cmd)}`);

  const bad: unknown[] = [
    null, undefined, 42, "setWall", {},
    { kind: "nope" },
    { kind: "setWall", x: 1, y: 2 },
    { kind: "setWall", x: "1", y: 2, open: true },
    { kind: "setParam", key: "cautionary", value: true },
    { kind: "setParam", key: "trailPower", value: "8" },
    { kind: "setManualAnt", index: "3" },
  ];
  for (const cmd of bad) assert.ok(!isCommand(cmd), `accepted ${JSON.stringify(cmd)}`);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test:client`

Expected: FAIL with `Cannot find module './commands'` and missing members on `Simulation`.

- [ ] **Step 3: Write the commands module**

Create `src/sim/commands.ts`:

```ts
/**
 * Every way the user can mutate a running simulation. Commands are plain
 * serializable data applied at a tick boundary, so a recorded run and a live
 * run follow the same code path.
 */
export type NumericParamKey = "evapRate" | "trailPower" | "tankMax";

export type Command =
  | { kind: "setWall"; x: number; y: number; open: boolean }
  | { kind: "setFood"; x: number; y: number; amount: number }
  | { kind: "setParam"; key: NumericParamKey; value: number }
  | { kind: "setCautionary"; value: boolean }
  | { kind: "setAntCount"; n: number }
  | { kind: "setManualAnt"; index: number | null }
  | { kind: "moveManualAnt"; dx: number; dy: number };

export interface TimedCommand {
  t: number;
  cmd: Command;
}

const NUMERIC_PARAM_KEYS: NumericParamKey[] = ["evapRate", "trailPower", "tankMax"];

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isBool = (v: unknown): v is boolean => typeof v === "boolean";

export function isCommand(value: unknown): value is Command {
  if (typeof value !== "object" || value === null) return false;
  const c = value as Record<string, unknown>;
  switch (c.kind) {
    case "setWall":
      return isInt(c.x) && isInt(c.y) && isBool(c.open);
    case "setFood":
      return isInt(c.x) && isInt(c.y) && isNum(c.amount) && c.amount >= 0;
    case "setParam":
      return NUMERIC_PARAM_KEYS.includes(c.key as NumericParamKey) && isNum(c.value);
    case "setCautionary":
      return isBool(c.value);
    case "setAntCount":
      return isInt(c.n) && c.n >= 0;
    case "setManualAnt":
      return c.index === null || isInt(c.index);
    case "moveManualAnt":
      return isInt(c.dx) && isInt(c.dy);
    default:
      return false;
  }
}

export function isTimedCommand(value: unknown): value is TimedCommand {
  if (typeof value !== "object" || value === null) return false;
  const t = value as Record<string, unknown>;
  return isInt(t.t) && t.t >= 0 && isCommand(t.cmd);
}
```

- [ ] **Step 4: Add the command bus to Simulation**

Edit `src/sim/sim.ts`. Add the import:

```ts
import type { Command, TimedCommand } from "./commands";
```

Add fields to the class, beside the existing ones:

```ts
  tick = 0;
  manualAntIndex: number | null = null;
  private pending: Command[] = [];
  private recorded: TimedCommand[] = [];
  private schedule: Map<number, Command[]> | null = null;
```

Add the public methods:

```ts
  get commandLog(): readonly TimedCommand[] {
    return this.recorded;
  }

  enqueue(cmd: Command) {
    this.pending.push(cmd);
  }

  /** Applies queued commands at the current tick without advancing time. */
  flushPending() {
    if (this.schedule) return;
    this._runCommandsFor(this.tick);
  }

  /** Switches the simulation from live input to a recorded command schedule. */
  loadSchedule(cmds: TimedCommand[]) {
    this.schedule = new Map();
    for (const { t, cmd } of cmds) {
      const at = this.schedule.get(t);
      if (at) at.push(cmd);
      else this.schedule.set(t, [cmd]);
    }
    this.pending = [];
    this._runCommandsFor(this.tick);
  }

  private _runCommandsFor(tick: number) {
    const cmds = this.schedule
      ? this.schedule.get(tick) ?? []
      : this.pending.splice(0, this.pending.length);
    for (const cmd of cmds) {
      this.apply(cmd);
      this.recorded.push({ t: tick, cmd });
    }
  }

  apply(cmd: Command) {
    switch (cmd.kind) {
      case "setWall":       this._applySetWall(cmd.x, cmd.y, cmd.open); break;
      case "setFood":       this._applySetFood(cmd.x, cmd.y, cmd.amount); break;
      case "setParam":      this.params = { ...this.params, [cmd.key]: cmd.value }; break;
      case "setCautionary": this.params = { ...this.params, cautionary: cmd.value }; break;
      case "setAntCount":   this.setAntCount(cmd.n); break;
      case "setManualAnt":  this._applySetManualAnt(cmd.index); break;
      case "moveManualAnt": this._applyMoveManualAnt(cmd.dx, cmd.dy); break;
    }
  }

  private _applySetWall(gx: number, gy: number, open: boolean) {
    if (gx < 0 || gx >= COLS || gy < 0 || gy >= ROWS) return;
    if (this.colonies.some(c => c.nestX === gx && c.nestY === gy)) return;
    if (this.foodSources.some(s => s.x === gx && s.y === gy)) return;
    this.grid[gy][gx] = open ? 1 : 0;
    if (!open) {
      for (const colony of this.colonies) {
        for (const ant of colony.ants) {
          if (ant.tx === gx && ant.ty === gy) { ant.tx = ant.cx; ant.ty = ant.cy; }
        }
      }
    }
  }

  private _applySetFood(gx: number, gy: number, amount: number) {
    if (gx < 0 || gx >= COLS || gy < 0 || gy >= ROWS) return;
    if (this.grid[gy][gx] === 0) return;
    if (this.colonies.some(c => c.nestX === gx && c.nestY === gy)) return;

    const srcIdx = this.foodSources.findIndex(s => s.x === gx && s.y === gy);
    if (amount <= 0) {
      if (srcIdx < 0) return;
      this.foodSources.splice(srcIdx, 1);
      for (const colony of this.colonies) {
        const updated = new Set<number>();
        for (const idx of colony.discoveredSources) {
          if (idx === srcIdx) continue;
          updated.add(idx > srcIdx ? idx - 1 : idx);
        }
        colony.discoveredSources = updated;
      }
      return;
    }
    if (srcIdx >= 0) {
      this.foodSources[srcIdx].remaining = amount;
      this.foodSources[srcIdx].total = amount;
      return;
    }
    this.foodSources.push({ x: gx, y: gy, remaining: amount, total: amount });
  }

  private _applySetManualAnt(index: number | null) {
    const all = this.allAnts;
    for (const ant of all) ant.manual = false;
    this.manualAntIndex = null;
    if (index === null) return;
    const ant = all[index];
    if (!ant) return;
    ant.manual = true;
    this.manualAntIndex = index;
  }

  private _applyMoveManualAnt(dx: number, dy: number) {
    if (this.manualAntIndex === null) return;
    const ant = this.allAnts[this.manualAntIndex];
    if (!ant) return;
    const nx = ant.cx + dx, ny = ant.cy + dy;
    if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) return;
    if (this.grid[ny][nx] !== 1) return;
    ant.prevCx = ant.cx;
    ant.prevCy = ant.cy;
    ant.tx = nx;
    ant.ty = ny;
  }
```

Change `step()` so it advances the tick and drains commands before the existing work. The evaporation and movement body is unchanged:

```ts
  step() {
    this.tick++;
    this._runCommandsFor(this.tick);

    const decay = 1 - this.params.evapRate;
    // ... rest of the existing body unchanged ...
  }
```

Add `export * from "./commands";` to `src/sim/index.ts`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm test:client`

Expected: PASS, including all of `commands.test.ts`.

- [ ] **Step 6: Route every UI mutation through the bus**

Edit `src/AntSim.tsx`. Four changes; after them the UI holds no direct writes to simulation state.

First, add a helper beside `forceRender` that enqueues and, when paused, flushes and redraws so edits are visible immediately:

```tsx
  const runningRef = useRef(running);
  runningRef.current = running;

  const send = useCallback((cmd: Command) => {
    const sim = simRef.current;
    if (!sim) return;
    sim.enqueue(cmd);
    if (!runningRef.current) {
      sim.flushPending();
      forceRender();
    }
  }, [forceRender]);
```

Import the `Command` type from `./sim`.

Second, replace the params and ant-count effects at lines 801–807:

```tsx
  useEffect(() => {
    send({ kind: "setParam", key: "evapRate", value: params.evapRate });
  }, [params.evapRate, send]);

  useEffect(() => {
    send({ kind: "setParam", key: "trailPower", value: params.trailPower });
  }, [params.trailPower, send]);

  useEffect(() => {
    send({ kind: "setParam", key: "tankMax", value: params.tankMax });
  }, [params.tankMax, send]);

  useEffect(() => {
    send({ kind: "setCautionary", value: params.cautionary });
  }, [params.cautionary, send]);

  useEffect(() => {
    send({ kind: "setAntCount", n: numAnts });
  }, [numAnts, send]);
```

Third, replace the two manual-control effects at lines 809–831 with a single effect that names the ant in the command:

```tsx
  useEffect(() => {
    const sim = simRef.current;
    if (!sim) return;
    if (!manualControl) {
      send({ kind: "setManualAnt", index: null });
      return;
    }
    const idx = Math.floor(Math.random() * sim.allAnts.length);
    setWatchedAntIdx(idx);
    watchedAntIdxRef.current = idx;
    send({ kind: "setManualAnt", index: idx });
  }, [manualControl, send]);

  useEffect(() => {
    if (!manualControlRef.current) return;
    send({ kind: "setManualAnt", index: watchedAntIdx });
  }, [watchedAntIdx, send]);
```

Fourth, replace the body of `moveAnt` (line 833) and of `applyEdit` (line 885). `moveAnt` becomes:

```tsx
  const moveAnt = useCallback((ddx: number, ddy: number) => {
    if (!manualControlRef.current) return;
    send({ kind: "moveManualAnt", dx: ddx, dy: ddy });
  }, [send]);
```

`applyEdit` keeps the drag-direction gesture, which is a UI concern, but emits absolute commands and reads sim state only to decide what to emit:

```tsx
  const applyEdit = useCallback((gx: number, gy: number) => {
    const sim = simRef.current;
    if (!sim) return;
    const mode = editModeRef.current;

    if (mode === "wall") {
      const isNest = sim.colonies.some(c => c.nestX === gx && c.nestY === gy);
      if (isNest) return;
      const isFoodHere = sim.foodSources.some(s => s.x === gx && s.y === gy);
      if (isFoodHere) return;
      const wasWall = sim.grid[gy][gx] === 0;

      if (dragActionRef.current === null) {
        dragActionRef.current = wasWall ? "open" : "close";
      }
      if (dragActionRef.current === "open" && wasWall) {
        send({ kind: "setWall", x: gx, y: gy, open: true });
      } else if (dragActionRef.current === "close" && !wasWall) {
        send({ kind: "setWall", x: gx, y: gy, open: false });
      }
    } else if (mode === "food") {
      const isWall = sim.grid[gy][gx] === 0;
      const isNest = sim.colonies.some(c => c.nestX === gx && c.nestY === gy);
      if (isWall || isNest) return;
      const exists = sim.foodSources.some(s => s.x === gx && s.y === gy);
      send({ kind: "setFood", x: gx, y: gy, amount: exists ? 0 : foodPerSourceRef2.current });
    }
  }, [send]);
```

Delete the now-unused `foodPerSourceRef2`? No — `applyEdit` still uses it. Keep it.

- [ ] **Step 7: Verify the build**

Run: `pnpm typecheck && pnpm build && pnpm test:client`

Expected: all pass. Fix any unused-import errors the compiler reports in `AntSim.tsx`.

- [ ] **Step 8: Smoke check the rewired UI**

Run `PORT=3000 BASE_PATH=/ pnpm dev`. Confirm each rewired path still works both while running and while paused: painting and erasing walls by dragging; adding and removing food by clicking; all three sliders and the cautionary toggle changing behaviour mid-run; the ant-count slider adding and removing ants; "control one" selecting an ant and the arrow keys moving it. Edits made while paused must appear on the canvas immediately.

- [ ] **Step 9: Commit**

```bash
git add src/sim src/AntSim.tsx
git commit -m "feat: route every simulation mutation through a command bus

Adds a tick counter and a serializable Command union. The UI enqueues
commands rather than writing simulation state, and step() drains them at
the tick boundary, so a recorded run and a live run follow the same code
path. Edits made while paused flush at the current tick.

Guards that previously lived in the UI, such as refusing to wall over a
nest, move into the simulation so a replayed command cannot do something
a live one would not.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: State fingerprints

A periodic hash of simulation state, written during live runs and checked during replay, so a run that fails to reproduce reports itself instead of producing a plausible wrong answer.

**Files:**
- Create: `src/sim/fingerprint.ts`, `src/sim/fingerprint.test.ts`
- Modify: `src/sim/sim.ts`, `src/sim/index.ts`

**Interfaces:**
- Consumes: `Simulation` with `tick` and the command bus from Task 3.
- Produces: `fingerprint(sim: Simulation): string` returning 8 lowercase hex characters; `FINGERPRINT_INTERVAL = 500`. `Simulation` gains `fingerprints: { t: number; h: string }[]` and records one every `FINGERPRINT_INTERVAL` ticks.

- [ ] **Step 1: Write the failing fingerprint tests**

Create `src/sim/fingerprint.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { Simulation, DEFAULT_PARAMS, makeSeeds, fingerprint, FINGERPRINT_INTERVAL } from "./index";
import type { RunConfig } from "./index";

function config(overrides: Partial<RunConfig> = {}): RunConfig {
  return {
    seeds: makeSeeds("fingerprint-test"),
    numAnts: 20,
    params: DEFAULT_PARAMS,
    loopRate: 0.1,
    numColonies: 2,
    numFoodSources: 3,
    foodPerSource: 500,
    ...overrides,
  };
}

test("a fingerprint is eight lowercase hex characters", () => {
  const h = fingerprint(new Simulation(config()));
  assert.match(h, /^[0-9a-f]{8}$/);
});

test("identical simulations fingerprint identically at every checkpoint", () => {
  const c = config();
  const a = new Simulation(c);
  const b = new Simulation(c);
  for (let i = 0; i < 2000; i++) {
    a.step();
    b.step();
    if (i % 250 === 0) assert.equal(fingerprint(a), fingerprint(b), `diverged at step ${i}`);
  }
  assert.equal(fingerprint(a), fingerprint(b));
});

test("the fingerprint changes as the simulation advances", () => {
  const sim = new Simulation(config());
  const start = fingerprint(sim);
  for (let i = 0; i < 100; i++) sim.step();
  assert.notEqual(fingerprint(sim), start);
});

test("a single differing wall changes the fingerprint", () => {
  const c = config();
  const a = new Simulation(c);
  const b = new Simulation(c);
  assert.equal(fingerprint(a), fingerprint(b));

  let target: [number, number] | null = null;
  for (let y = 2; y < 28 && !target; y++) {
    for (let x = 2; x < 28 && !target; x++) {
      if (b.grid[y][x] !== 1) continue;
      if (b.colonies.some(k => k.nestX === x && k.nestY === y)) continue;
      if (b.foodSources.some(s => s.x === x && s.y === y)) continue;
      target = [x, y];
    }
  }
  assert.ok(target);
  b.enqueue({ kind: "setWall", x: target[0], y: target[1], open: false });
  b.flushPending();
  assert.notEqual(fingerprint(a), fingerprint(b));
});

test("a differing pheromone value changes the fingerprint", () => {
  const c = config();
  const a = new Simulation(c);
  const b = new Simulation(c);
  for (let i = 0; i < 50; i++) { a.step(); b.step(); }
  assert.equal(fingerprint(a), fingerprint(b));
  b.colonies[0].foodPhero[400] += 1e-6;
  assert.notEqual(fingerprint(a), fingerprint(b));
});

test("differing ant seeds diverge in fingerprint", () => {
  const base = config();
  const a = new Simulation(base);
  const b = new Simulation({ ...base, seeds: { ...base.seeds, master: null, ants: "0f0f0f0f" } });
  for (let i = 0; i < 300; i++) { a.step(); b.step(); }
  assert.notEqual(fingerprint(a), fingerprint(b));
});

test("the simulation records a fingerprint every interval", () => {
  const sim = new Simulation(config());
  assert.deepEqual(sim.fingerprints, []);
  for (let i = 0; i < FINGERPRINT_INTERVAL * 3; i++) sim.step();
  assert.equal(sim.fingerprints.length, 3);
  assert.deepEqual(
    sim.fingerprints.map(f => f.t),
    [FINGERPRINT_INTERVAL, FINGERPRINT_INTERVAL * 2, FINGERPRINT_INTERVAL * 3],
  );
  for (const f of sim.fingerprints) assert.match(f.h, /^[0-9a-f]{8}$/);
});

test("recorded fingerprints match a recomputation of the same run", () => {
  const c = config();
  const a = new Simulation(c);
  const b = new Simulation(c);
  for (let i = 0; i < FINGERPRINT_INTERVAL * 2; i++) {
    a.step();
    b.step();
  }
  assert.deepEqual(a.fingerprints, b.fingerprints);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test:client`

Expected: FAIL with `Cannot find module './fingerprint'`.

- [ ] **Step 3: Write the fingerprint module**

Create `src/sim/fingerprint.ts`.

Pheromone layers are hashed through a `Uint32Array` view of the `Float32Array` buffer, which compares exact bits rather than approximate values. That view is platform-endian; every browser and Node platform this project targets is little-endian, and using a `DataView` with an explicit byte order instead would cost far more per sample. This is an accepted assumption, not an oversight.

```ts
import { COLS, ROWS } from "./constants";
import type { Simulation } from "./sim";

export const FINGERPRINT_INTERVAL = 500;

const FNV_OFFSET = 2166136261;
const FNV_PRIME = 16777619;

function mixU32(h: number, v: number): number {
  h ^= v & 0xff;          h = Math.imul(h, FNV_PRIME);
  h ^= (v >>> 8) & 0xff;  h = Math.imul(h, FNV_PRIME);
  h ^= (v >>> 16) & 0xff; h = Math.imul(h, FNV_PRIME);
  h ^= (v >>> 24) & 0xff; h = Math.imul(h, FNV_PRIME);
  return h >>> 0;
}

const scratch = new Float64Array(1);
const scratchWords = new Uint32Array(scratch.buffer);

function mixF64(h: number, v: number): number {
  scratch[0] = v;
  return mixU32(mixU32(h, scratchWords[0]), scratchWords[1]);
}

function mixLayer(h: number, layer: Float32Array): number {
  const words = new Uint32Array(layer.buffer, layer.byteOffset, layer.length);
  for (let i = 0; i < words.length; i++) h = mixU32(h, words[i]);
  return h;
}

/** An exact hash of everything that determines how the run continues. */
export function fingerprint(sim: Simulation): string {
  let h = FNV_OFFSET;

  h = mixU32(h, sim.tick);
  h = mixU32(h, sim.numAnts);
  h = mixU32(h, sim.colonies.length);
  h = mixU32(h, sim.foodSources.length);
  h = mixU32(h, sim.manualAntIndex === null ? 0xffffffff : sim.manualAntIndex);

  h = mixF64(h, sim.params.evapRate);
  h = mixF64(h, sim.params.trailPower);
  h = mixF64(h, sim.params.tankMax);
  h = mixU32(h, sim.params.cautionary ? 1 : 0);

  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) h = mixU32(h, sim.grid[y][x]);
  }

  for (const src of sim.foodSources) {
    h = mixU32(h, src.x);
    h = mixU32(h, src.y);
    h = mixF64(h, src.remaining);
    h = mixF64(h, src.total);
  }

  for (const colony of sim.colonies) {
    h = mixU32(h, colony.id);
    h = mixU32(h, colony.nestX);
    h = mixU32(h, colony.nestY);
    h = mixU32(h, colony.foodCollected);
    h = mixLayer(h, colony.homePhero);
    h = mixLayer(h, colony.foodPhero);
    h = mixLayer(h, colony.cautPhero);
    for (const idx of [...colony.discoveredSources].sort((a, b) => a - b)) {
      h = mixU32(h, idx);
    }
    for (const ant of colony.ants) {
      h = mixF64(h, ant.x);
      h = mixF64(h, ant.y);
      h = mixU32(h, ant.cx);
      h = mixU32(h, ant.cy);
      h = mixU32(h, ant.tx);
      h = mixU32(h, ant.ty);
      h = mixU32(h, ant.prevCx);
      h = mixU32(h, ant.prevCy);
      h = mixU32(h, ant.state === "searching" ? 0 : 1);
      h = mixU32(h, ant.hasFood ? 1 : 0);
      h = mixU32(h, ant.manual ? 1 : 0);
      h = mixF64(h, ant.tank);
    }
  }

  return (h >>> 0).toString(16).padStart(8, "0");
}
```

`discoveredSources` is a `Set`, whose iteration order follows insertion. Two runs that discover the same sources in a different order would otherwise hash differently despite being in the same state, so the indices are sorted before mixing.

- [ ] **Step 4: Record fingerprints during the run**

Edit `src/sim/sim.ts`. Add the import:

```ts
import { fingerprint, FINGERPRINT_INTERVAL } from "./fingerprint";
```

Add the field:

```ts
  readonly fingerprints: { t: number; h: string }[] = [];
```

At the very end of `step()`, after the colony loop:

```ts
    if (this.tick % FINGERPRINT_INTERVAL === 0) {
      this.fingerprints.push({ t: this.tick, h: fingerprint(this) });
    }
  }
```

Add `export * from "./fingerprint";` to `src/sim/index.ts`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm test:client`

Expected: PASS, including all eight `fingerprint.test.ts` tests.

- [ ] **Step 6: Show the fingerprint in the Run panel**

This is what makes the manual cross-engine check possible. In `src/AntSim.tsx`, add state and update it in the animation loop beside `setColonyScores`:

```tsx
  const [latestFingerprint, setLatestFingerprint] = useState<{ t: number; h: string } | null>(null);
```

Inside the `if (frameCountRef.current >= framesPerTickRef.current)` block, after `sim.step()`:

```tsx
        const fp = sim.fingerprints[sim.fingerprints.length - 1];
        if (fp) setLatestFingerprint(fp);
```

Reset it in `initSim` beside `setFoodRate(0)`:

```tsx
    setLatestFingerprint(null);
```

Add a line to the Run panel below the seed helper text:

```tsx
          <p style={{ margin: 0, fontSize: "0.72rem", color: "#6b5a3e", fontFamily: "monospace" }}>
            {latestFingerprint
              ? `tick ${latestFingerprint.t} · ${latestFingerprint.h}`
              : "tick 0 · no checkpoint yet"}
          </p>
```

- [ ] **Step 7: Verify the build**

Run: `pnpm typecheck && pnpm build && pnpm test:client`

Then `PORT=3000 BASE_PATH=/ pnpm dev`, run a simulation, and confirm the fingerprint line updates roughly every 500 ticks. With a fixed seed and no edits, two runs must show the same hash at the same tick.

- [ ] **Step 8: Document the cross-engine check**

Add to `CONTRIBUTING.md`, after the Architecture section:

```markdown
## Determinism

Maze Simulator runs are reproducible from a seed. `pnpm test:client` covers
this within one engine. The cross-engine question cannot run in CI, because
Safari cannot be driven there, so check it by hand before a release that
touches `src/sim/`:

1. Open the app in Chrome, Firefox, and Safari.
2. Enter the same run seed in each and press reset.
3. Run each to at least tick 5000 without editing anything.
4. Compare the fingerprint shown in the Run panel at the same tick.

They must match. If they do not, something in `src/sim/` is relying on
behaviour the ECMAScript specification leaves implementation-defined;
`Math.pow`, `Math.log`, `Math.exp`, and the trigonometric functions are the
usual causes, and none of them may be used to compute simulation state.
```

- [ ] **Step 9: Commit**

```bash
git add src/sim src/AntSim.tsx CONTRIBUTING.md
git commit -m "feat: fingerprint simulation state every 500 ticks

Hashes the grid, pheromone layers, ants, food, and parameters with FNV-1a,
reading the Float32Array pheromone buffers through a Uint32Array view so
the comparison is exact. Recorded during live runs so a trace can carry
the values to check a later replay against, and shown in the Run panel so
the manual cross-engine check documented in CONTRIBUTING.md is possible.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Metrics buffer and CSV export

Always-on sampling into a capped ring buffer, plus the CSV form analysis tools want.

**Files:**
- Create: `src/sim/metrics.ts`, `src/sim/metrics.test.ts`
- Modify: `src/sim/types.ts`, `src/sim/sim.ts`, `src/sim/index.ts`, `src/AntSim.tsx`

**Interfaces:**
- Consumes: `Simulation`, `fingerprint` from Task 4.
- Produces: `METRICS_INTERVAL = 10`; `METRICS_CAPACITY = 20000`; `RATE_WINDOW_TICKS = 1000`; types `LayerStats`, `ColonySample`, `MetricsSample`; `class MetricsRecorder` with `samples`, `truncated`, `interval`, `maybeSample(sim)`, `reset()`; `shortestFromNest(grid, nestX, nestY): Int32Array`; `colonyHighwayScore(sim, colony): number`; `metricsToCsv(samples: MetricsSample[]): string`. `Ant` gains `stepsSinceNest`, `lastSourceX`, `lastSourceY`; `Colony` gains `recentTrips`. `TRIP_WINDOW = 50` is added to `constants.ts`.

Trip-tracking fields are observation state and do not affect how the run continues, so they are deliberately left out of the fingerprint.

- [ ] **Step 1: Write the failing metrics tests**

Create `src/sim/metrics.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  Simulation, DEFAULT_PARAMS, makeSeeds, COLS,
  MetricsRecorder, METRICS_INTERVAL, shortestFromNest, metricsToCsv,
} from "./index";
import type { RunConfig, MetricsSample } from "./index";

function config(overrides: Partial<RunConfig> = {}): RunConfig {
  return {
    seeds: makeSeeds("metrics-test"),
    numAnts: 20,
    params: DEFAULT_PARAMS,
    loopRate: 0.1,
    numColonies: 2,
    numFoodSources: 2,
    foodPerSource: 500,
    ...overrides,
  };
}

test("shortestFromNest measures reachable cells and marks the rest -1", () => {
  const sim = new Simulation(config());
  const nest = sim.colonies[0];
  const dist = shortestFromNest(sim.grid, nest.nestX, nest.nestY);

  assert.equal(dist.length, COLS * sim.grid.length);
  assert.equal(dist[nest.nestY * COLS + nest.nestX], 0);
  for (const src of sim.foodSources) {
    assert.ok(dist[src.y * COLS + src.x] > 0, "food should be reachable from the nest");
  }
  for (let y = 0; y < sim.grid.length; y++) {
    for (let x = 0; x < COLS; x++) {
      if (sim.grid[y][x] === 0) assert.equal(dist[y * COLS + x], -1);
    }
  }
});

test("the recorder samples on the interval and not between", () => {
  const sim = new Simulation(config());
  const rec = new MetricsRecorder();
  assert.equal(rec.samples.length, 0);

  for (let i = 0; i < METRICS_INTERVAL - 1; i++) { sim.step(); rec.maybeSample(sim); }
  assert.equal(rec.samples.length, 0);

  sim.step(); rec.maybeSample(sim);
  assert.equal(rec.samples.length, 1);
  assert.equal(rec.samples[0].t, METRICS_INTERVAL);
});

test("each sample carries one entry per colony and per food source", () => {
  const sim = new Simulation(config());
  const rec = new MetricsRecorder();
  for (let i = 0; i < METRICS_INTERVAL; i++) { sim.step(); rec.maybeSample(sim); }

  const s = rec.samples[0];
  assert.equal(s.colonies.length, 2);
  assert.equal(s.foodRemaining.length, 2);
  for (const c of s.colonies) {
    assert.equal(typeof c.food, "number");
    assert.equal(typeof c.ratePerKTick, "number");
    assert.ok(c.highwayScore >= 0 && c.highwayScore <= 1);
    assert.ok(c.pheroMass.home >= 0);
    assert.ok(c.pheroEntropy.home >= 0);
    assert.ok(c.meanTripRatio === null || c.meanTripRatio >= 1 - 1e-9);
  }
});

test("the buffer caps and flags truncation", () => {
  const sim = new Simulation(config());
  const rec = new MetricsRecorder(METRICS_INTERVAL, 5);
  for (let i = 0; i < METRICS_INTERVAL * 8; i++) { sim.step(); rec.maybeSample(sim); }

  assert.equal(rec.samples.length, 5);
  assert.equal(rec.truncated, true);
  assert.deepEqual(
    rec.samples.map(s => s.t),
    [METRICS_INTERVAL * 4, METRICS_INTERVAL * 5, METRICS_INTERVAL * 6, METRICS_INTERVAL * 7, METRICS_INTERVAL * 8],
  );
});

test("metrics are reproducible for the same seed", () => {
  const c = config();
  const a = new Simulation(c), b = new Simulation(c);
  const ra = new MetricsRecorder(), rb = new MetricsRecorder();
  for (let i = 0; i < 1000; i++) {
    a.step(); ra.maybeSample(a);
    b.step(); rb.maybeSample(b);
  }
  assert.deepEqual(ra.samples, rb.samples);
});

test("trip ratios appear once ants complete round trips", () => {
  const sim = new Simulation(config({ numAnts: 60, numColonies: 1, numFoodSources: 1 }));
  const rec = new MetricsRecorder();
  for (let i = 0; i < 6000; i++) { sim.step(); rec.maybeSample(sim); }

  const withRatio = rec.samples.filter(s => s.colonies[0].meanTripRatio !== null);
  assert.ok(withRatio.length > 0, "expected at least one sample with a trip ratio");
  for (const s of withRatio) {
    const r = s.colonies[0].meanTripRatio as number;
    assert.ok(r >= 1 - 1e-9, `a realized trip cannot beat the shortest path: ${r}`);
  }
});

test("reset clears samples and the truncation flag", () => {
  const sim = new Simulation(config());
  const rec = new MetricsRecorder(METRICS_INTERVAL, 2);
  for (let i = 0; i < METRICS_INTERVAL * 5; i++) { sim.step(); rec.maybeSample(sim); }
  assert.equal(rec.truncated, true);
  rec.reset();
  assert.deepEqual(rec.samples, []);
  assert.equal(rec.truncated, false);
});

test("metricsToCsv emits a header and one row per tick per colony", () => {
  const samples: MetricsSample[] = [
    {
      t: 10,
      colonies: [
        {
          food: 3, ratePerKTick: 300, highwayScore: 0.5,
          pheroMass: { home: 1, food: 2, caut: 0 },
          pheroEntropy: { home: 0.1, food: 0.2, caut: 0 },
          meanTripRatio: 1.5,
        },
        {
          food: 1, ratePerKTick: 100, highwayScore: 0.25,
          pheroMass: { home: 3, food: 4, caut: 0 },
          pheroEntropy: { home: 0.3, food: 0.4, caut: 0 },
          meanTripRatio: null,
        },
      ],
      foodRemaining: [497, 499],
    },
  ];

  const csv = metricsToCsv(samples);
  const lines = csv.trim().split("\n");
  assert.equal(lines.length, 3);
  assert.equal(
    lines[0],
    "t,colony,food,ratePerKTick,highwayScore,pheroMassHome,pheroMassFood,pheroMassCaut,pheroEntropyHome,pheroEntropyFood,pheroEntropyCaut,meanTripRatio,foodRemaining0,foodRemaining1",
  );
  assert.equal(lines[1], "10,0,3,300,0.5,1,2,0,0.1,0.2,0,1.5,497,499");
  assert.equal(lines[2], "10,1,1,100,0.25,3,4,0,0.3,0.4,0,,497,499");
});

test("metricsToCsv pads rows when the source count changes mid-run", () => {
  const base = {
    food: 0, ratePerKTick: 0, highwayScore: 0,
    pheroMass: { home: 0, food: 0, caut: 0 },
    pheroEntropy: { home: 0, food: 0, caut: 0 },
    meanTripRatio: null,
  };
  const samples: MetricsSample[] = [
    { t: 10, colonies: [base], foodRemaining: [100] },
    { t: 20, colonies: [base], foodRemaining: [100, 200] },
  ];
  const lines = metricsToCsv(samples).trim().split("\n");
  assert.ok(lines[0].endsWith("foodRemaining0,foodRemaining1"));
  assert.ok(lines[1].endsWith(",100,"));
  assert.ok(lines[2].endsWith(",100,200"));
});

test("metricsToCsv on an empty sample list returns only a header", () => {
  const csv = metricsToCsv([]);
  assert.equal(csv.trim(), "t,colony,food,ratePerKTick,highwayScore,pheroMassHome,pheroMassFood,pheroMassCaut,pheroEntropyHome,pheroEntropyFood,pheroEntropyCaut,meanTripRatio");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test:client`

Expected: FAIL with `Cannot find module './metrics'`.

- [ ] **Step 3: Add trip-tracking fields to the types**

In `src/sim/types.ts`, add to `Ant`:

```ts
  /** Cells traversed since the ant last left the nest. Observation only. */
  stepsSinceNest: number;
  /** Where the ant last picked up food, for the trip-efficiency metric. */
  lastSourceX: number | null;
  lastSourceY: number | null;
```

And to `Colony`:

```ts
  /** A trailing window of completed round trips, newest last. */
  recentTrips: { steps: number; sx: number; sy: number }[];
```

- [ ] **Step 4: Track trips in the simulation**

Edit `src/sim/sim.ts`.

In `_initColonies`, add `recentTrips: []` to the returned colony object.

In `_spawnAnts`, add the three new fields to each spawned ant:

```ts
      stepsSinceNest: 0,
      lastSourceX: null,
      lastSourceY: null,
```

Add the same three fields to the ant literal inside `setAntCount`.

`TRIP_WINDOW` comes from `./constants`, which `sim.ts` already imports. Add it
to that existing import rather than importing from `./metrics`: `sim.ts` must
not import a runtime value from `metrics.ts`, because `metrics.ts` imports
`Simulation` back. That import is type-only and erases at build time, so there
is no runtime cycle, and keeping it that way is deliberate.

In `_moveAnt`, immediately after the ant snaps to its target cell (`ant.cx = ant.tx; ant.cy = ant.ty;`), count the cell:

```ts
    ant.stepsSinceNest++;
```

In the food-pickup branch, after `ant.tank = tankMax;`, record where the food came from:

```ts
          ant.lastSourceX = src.x;
          ant.lastSourceY = src.y;
```

In the nest-arrival branch, after `colony.foodCollected++;`, close out the trip:

```ts
      if (ant.lastSourceX !== null && ant.lastSourceY !== null) {
        colony.recentTrips.push({ steps: ant.stepsSinceNest, sx: ant.lastSourceX, sy: ant.lastSourceY });
        if (colony.recentTrips.length > TRIP_WINDOW) colony.recentTrips.shift();
      }
      ant.stepsSinceNest = 0;
      ant.lastSourceX = null;
      ant.lastSourceY = null;
```

- [ ] **Step 5: Write the metrics module**

Create `src/sim/metrics.ts`:

```ts
import { COLS, ROWS, DIRS4 } from "./constants";
import type { CellType, Colony } from "./types";
import type { Simulation } from "./sim";

export const METRICS_INTERVAL = 10;
export const METRICS_CAPACITY = 20000;
export const RATE_WINDOW_TICKS = 1000;

export interface LayerStats {
  home: number;
  food: number;
  caut: number;
}

export interface ColonySample {
  food: number;
  ratePerKTick: number;
  highwayScore: number;
  pheroMass: LayerStats;
  pheroEntropy: LayerStats;
  meanTripRatio: number | null;
}

export interface MetricsSample {
  t: number;
  colonies: ColonySample[];
  foodRemaining: number[];
}

/** Breadth-first distance in cells from the nest. -1 means unreachable. */
export function shortestFromNest(grid: CellType[][], nestX: number, nestY: number): Int32Array {
  const dist = new Int32Array(COLS * ROWS).fill(-1);
  if (grid[nestY][nestX] !== 1) return dist;

  const queue = new Int32Array(COLS * ROWS);
  let head = 0, tail = 0;
  dist[nestY * COLS + nestX] = 0;
  queue[tail++] = nestY * COLS + nestX;

  while (head < tail) {
    const idx = queue[head++];
    const x = idx % COLS;
    const y = (idx - x) / COLS;
    for (const [dx, dy] of DIRS4) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) continue;
      if (grid[ny][nx] !== 1) continue;
      const nIdx = ny * COLS + nx;
      if (dist[nIdx] !== -1) continue;
      dist[nIdx] = dist[idx] + 1;
      queue[tail++] = nIdx;
    }
  }
  return dist;
}

/** The share of a colony's pheromone mass carried by its busiest tenth of cells. */
export function colonyHighwayScore(sim: Simulation, colony: Colony): number {
  const open: number[] = [];
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (sim.grid[y][x] !== 1) continue;
      const idx = y * COLS + x;
      open.push(colony.foodPhero[idx] + colony.homePhero[idx]);
    }
  }
  if (open.length === 0) return 0;
  const total = open.reduce((a, b) => a + b, 0);
  if (total < 1) return 0;
  open.sort((a, b) => b - a);
  const topN = Math.max(1, Math.floor(open.length * 0.1));
  const topSum = open.slice(0, topN).reduce((a, b) => a + b, 0);
  return topSum / total;
}

function layerStats(layer: Float32Array, openIdx: Int32Array): { mass: number; entropy: number } {
  let mass = 0;
  for (let i = 0; i < openIdx.length; i++) mass += layer[openIdx[i]];
  if (mass <= 0) return { mass: 0, entropy: 0 };
  let entropy = 0;
  for (let i = 0; i < openIdx.length; i++) {
    const p = layer[openIdx[i]] / mass;
    if (p > 0) entropy -= p * Math.log(p);
  }
  return { mass, entropy };
}

function openCellIndices(sim: Simulation): Int32Array {
  const out: number[] = [];
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) if (sim.grid[y][x] === 1) out.push(y * COLS + x);
  }
  return Int32Array.from(out);
}

/**
 * Always-on sampling into a capped ring buffer. Nothing here feeds back into
 * the simulation, so Math.log is safe to use even though its precision is
 * implementation-defined.
 */
export class MetricsRecorder {
  readonly interval: number;
  readonly capacity: number;
  samples: MetricsSample[] = [];
  truncated = false;

  private rateHistory: { t: number; food: number }[][] = [];
  private distCache: Int32Array[] | null = null;
  private distCacheVersion = -1;

  constructor(interval: number = METRICS_INTERVAL, capacity: number = METRICS_CAPACITY) {
    this.interval = interval;
    this.capacity = capacity;
  }

  reset() {
    this.samples = [];
    this.truncated = false;
    this.rateHistory = [];
    this.distCache = null;
    this.distCacheVersion = -1;
  }

  /** Call once after every sim.step(). Samples only on the interval. */
  maybeSample(sim: Simulation) {
    if (sim.tick === 0 || sim.tick % this.interval !== 0) return;
    this.samples.push(this.sample(sim));
    if (this.samples.length > this.capacity) {
      this.samples.shift();
      this.truncated = true;
    }
  }

  private distances(sim: Simulation): Int32Array[] {
    if (this.distCache && this.distCacheVersion === sim.gridVersion) return this.distCache;
    this.distCache = sim.colonies.map(c => shortestFromNest(sim.grid, c.nestX, c.nestY));
    this.distCacheVersion = sim.gridVersion;
    return this.distCache;
  }

  private sample(sim: Simulation): MetricsSample {
    const openIdx = openCellIndices(sim);
    const dists = this.distances(sim);

    const colonies: ColonySample[] = sim.colonies.map((colony, i) => {
      const home = layerStats(colony.homePhero, openIdx);
      const food = layerStats(colony.foodPhero, openIdx);
      const caut = layerStats(colony.cautPhero, openIdx);

      if (!this.rateHistory[i]) this.rateHistory[i] = [];
      const history = this.rateHistory[i];
      history.push({ t: sim.tick, food: colony.foodCollected });
      while (history.length > 1 && sim.tick - history[0].t > RATE_WINDOW_TICKS) history.shift();
      const oldest = history[0];
      const span = sim.tick - oldest.t;
      const ratePerKTick = span > 0
        ? ((colony.foodCollected - oldest.food) / span) * 1000
        : 0;

      const dist = dists[i];
      const ratios: number[] = [];
      for (const trip of colony.recentTrips) {
        const shortest = dist[trip.sy * COLS + trip.sx];
        if (shortest > 0) ratios.push(trip.steps / (2 * shortest));
      }
      const meanTripRatio = ratios.length > 0
        ? ratios.reduce((a, b) => a + b, 0) / ratios.length
        : null;

      return {
        food: colony.foodCollected,
        ratePerKTick,
        highwayScore: colonyHighwayScore(sim, colony),
        pheroMass: { home: home.mass, food: food.mass, caut: caut.mass },
        pheroEntropy: { home: home.entropy, food: food.entropy, caut: caut.entropy },
        meanTripRatio,
      };
    });

    return {
      t: sim.tick,
      colonies,
      foodRemaining: sim.foodSources.map(s => s.remaining),
    };
  }
}

const CSV_BASE_COLUMNS = [
  "t", "colony", "food", "ratePerKTick", "highwayScore",
  "pheroMassHome", "pheroMassFood", "pheroMassCaut",
  "pheroEntropyHome", "pheroEntropyFood", "pheroEntropyCaut",
  "meanTripRatio",
];

/** One row per tick per colony. Food sources become fixed-width columns. */
export function metricsToCsv(samples: MetricsSample[]): string {
  const maxSources = samples.reduce((m, s) => Math.max(m, s.foodRemaining.length), 0);
  const header = [
    ...CSV_BASE_COLUMNS,
    ...Array.from({ length: maxSources }, (_, i) => `foodRemaining${i}`),
  ];

  const rows: string[] = [header.join(",")];
  for (const s of samples) {
    const remaining = Array.from({ length: maxSources }, (_, i) =>
      i < s.foodRemaining.length ? String(s.foodRemaining[i]) : "");
    s.colonies.forEach((c, colonyIdx) => {
      rows.push([
        s.t, colonyIdx, c.food, c.ratePerKTick, c.highwayScore,
        c.pheroMass.home, c.pheroMass.food, c.pheroMass.caut,
        c.pheroEntropy.home, c.pheroEntropy.food, c.pheroEntropy.caut,
        c.meanTripRatio === null ? "" : c.meanTripRatio,
        ...remaining,
      ].join(","));
    });
  }
  return rows.join("\n") + "\n";
}
```

- [ ] **Step 6: Add the grid version counter**

`MetricsRecorder.distances` caches breadth-first results and must recompute when the grid changes. Add to `Simulation` in `src/sim/sim.ts`:

```ts
  /** Incremented whenever a wall opens or closes, so caches can invalidate. */
  gridVersion = 0;
```

and bump it at the end of `_applySetWall`, inside the guard so a rejected edit does not invalidate anything:

```ts
    this.grid[gy][gx] = open ? 1 : 0;
    this.gridVersion++;
```

Add `export * from "./metrics";` to `src/sim/index.ts`.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm test:client`

Expected: PASS, including all ten `metrics.test.ts` tests.

Note on the "trip ratios appear" test: if it reports no samples with a ratio, the ants never completed a round trip in 6000 ticks. Check that `stepsSinceNest` is incremented on cell arrival and reset at the nest before adjusting the test.

- [ ] **Step 8: Wire the recorder into the UI and make the food rate reproducible**

Edit `src/AntSim.tsx`.

Add the recorder ref beside `simRef`:

```tsx
  const metricsRef = useRef<MetricsRecorder>(new MetricsRecorder());
```

Import `MetricsRecorder`, `metricsToCsv`, and `RATE_WINDOW_TICKS` from `./sim`.

In `initSim`, reset it beside the other reset calls:

```tsx
    metricsRef.current.reset();
```

Replace the wall-clock food rate in the animation loop. Delete `foodTimestampsRef`, `prevTotalRef`, and the `Date.now()` block at lines 1017–1026, and replace the whole post-step body with:

```tsx
        sim.step();
        metricsRef.current.maybeSample(sim);
        setColonyScores(sim.colonies.map(c => c.foodCollected));
        const fp = sim.fingerprints[sim.fingerprints.length - 1];
        if (fp) setLatestFingerprint(fp);
        const latest = metricsRef.current.samples[metricsRef.current.samples.length - 1];
        if (latest) {
          setFoodRate(latest.colonies.reduce((a, c) => a + c.ratePerKTick, 0));
        }
```

Remove the now-unused `foodTimestampsRef` and `prevTotalRef` declarations and their resets in `initSim`.

The displayed rate now reads "per 1000 ticks" rather than per 30 seconds, so the number on screen matches the number in the log. Find the food-rate readout in the header and change its unit label to `/1k ticks`.

Add an Export metrics CSV button to the Run panel, beside the New seed button:

```tsx
            <button
              type="button"
              onClick={() => {
                const csv = metricsToCsv(metricsRef.current.samples);
                const blob = new Blob([csv], { type: "text/csv" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `stigsim-${activeSeed}-${simRef.current?.tick ?? 0}.csv`;
                a.click();
                URL.revokeObjectURL(url);
              }}
              style={{
                background: "#1a1208", color: "#f59e0b", border: "1px solid #3d2e18",
                borderRadius: 6, padding: "6px 10px", cursor: "pointer", fontSize: "0.8rem",
              }}
            >
              Export CSV
            </button>
```

- [ ] **Step 9: Verify the build**

Run: `pnpm typecheck && pnpm build && pnpm test:client`

Then `PORT=3000 BASE_PATH=/ pnpm dev`. Run a simulation for a while, press Export CSV, and open the downloaded file. Confirm it has a header row, one row per tick per colony, that `t` advances in steps of 10, and that `meanTripRatio` fills in once ants start returning food. Confirm the on-screen rate readout still moves sensibly.

- [ ] **Step 10: Commit**

```bash
git add src/sim src/AntSim.tsx
git commit -m "feat: sample run metrics into a capped buffer with CSV export

Records food, collection rate, per-colony highway score, pheromone mass
and entropy, and trip efficiency against breadth-first shortest paths,
every 10 ticks into a ring buffer that flags truncation rather than
silently dropping history.

Replaces the wall-clock food rate, which was not reproducible, with a
rate per 1000 ticks so the number on screen matches the number in the log.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Trace format

The file itself: building one from a running simulation, and parsing one back with validation. Replay comes in Task 7, so this task is reviewable on its own.

**Files:**
- Create: `src/sim/trace.ts`, `src/sim/trace.test.ts`
- Modify: `src/sim/index.ts`, `src/AntSim.tsx`

**Interfaces:**
- Consumes: `Simulation`, `MetricsRecorder`, `TimedCommand`, `RunSeeds`, `SimParams` from Tasks 2–5.
- Produces: `TRACE_FORMAT`, `TRACE_VERSION`, `SIM_VERSION`; types `Trace`, `TraceRunConfig`, `ParseResult`; `buildTrace(sim, recorder, createdAt?): Trace`; `serializeTrace(trace): string`; `parseTrace(text: string): ParseResult`; `traceToRunConfig(trace): RunConfig`; `traceFilename(trace): string`.

- [ ] **Step 1: Write the failing trace tests**

Create `src/sim/trace.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  Simulation, DEFAULT_PARAMS, makeSeeds, MetricsRecorder,
  buildTrace, serializeTrace, parseTrace, traceToRunConfig, traceFilename,
  TRACE_FORMAT, TRACE_VERSION, SIM_VERSION,
} from "./index";
import type { RunConfig, Trace } from "./index";

function config(overrides: Partial<RunConfig> = {}): RunConfig {
  return {
    seeds: makeSeeds("trace-test"),
    numAnts: 15,
    params: DEFAULT_PARAMS,
    loopRate: 0.1,
    numColonies: 1,
    numFoodSources: 2,
    foodPerSource: 400,
    ...overrides,
  };
}

function runSim(steps = 1200) {
  const sim = new Simulation(config());
  const rec = new MetricsRecorder();
  for (let i = 0; i < steps; i++) { sim.step(); rec.maybeSample(sim); }
  return { sim, rec };
}

test("a built trace carries the header, seeds, and config", () => {
  const { sim, rec } = runSim();
  const trace = buildTrace(sim, rec, "2026-08-27T00:00:00.000Z");

  assert.equal(trace.format, TRACE_FORMAT);
  assert.equal(trace.version, TRACE_VERSION);
  assert.equal(trace.simVersion, SIM_VERSION);
  assert.equal(trace.createdAt, "2026-08-27T00:00:00.000Z");
  assert.deepEqual(trace.run.seeds, makeSeeds("trace-test"));
  assert.equal(trace.run.config.numAnts, 15);
  assert.equal(trace.run.config.foodPerSource, 400);
  assert.equal(trace.endTick, 1200);
  assert.ok(trace.fingerprints.length >= 2);
  assert.ok(trace.metrics.samples.length > 0);
  assert.equal(trace.metrics.interval, rec.interval);
  assert.equal(trace.metrics.truncated, false);
});

test("commands are captured in the trace at their recorded ticks", () => {
  const sim = new Simulation(config());
  const rec = new MetricsRecorder();
  for (let i = 0; i < 30; i++) { sim.step(); rec.maybeSample(sim); }
  sim.enqueue({ kind: "setParam", key: "trailPower", value: 9 });
  for (let i = 0; i < 30; i++) { sim.step(); rec.maybeSample(sim); }

  const trace = buildTrace(sim, rec);
  assert.deepEqual(trace.commands, [{ t: 31, cmd: { kind: "setParam", key: "trailPower", value: 9 } }]);
});

test("a trace round-trips through serialize and parse", () => {
  const { sim, rec } = runSim();
  const trace = buildTrace(sim, rec, "2026-08-27T00:00:00.000Z");
  const result = parseTrace(serializeTrace(trace));

  assert.ok(result.ok, result.ok ? "" : result.error);
  assert.deepEqual(result.trace, trace);
  assert.equal(result.warning, undefined);
});

test("traceToRunConfig rebuilds a simulation that reproduces the original", () => {
  const { sim, rec } = runSim(600);
  const trace = buildTrace(sim, rec);

  const rebuilt = new Simulation(traceToRunConfig(trace));
  for (let i = 0; i < 600; i++) rebuilt.step();

  assert.deepEqual(rebuilt.fingerprints, sim.fingerprints);
  assert.equal(rebuilt.totalFoodCollected, sim.totalFoodCollected);
});

test("traceFilename uses the master seed, and falls back when there is none", () => {
  const { sim, rec } = runSim(200);
  const trace = buildTrace(sim, rec);
  assert.equal(traceFilename(trace), "stigsim-trace-test-200.trace.json");

  const anonymous: Trace = { ...trace, run: { ...trace.run, seeds: { ...trace.run.seeds, master: null } } };
  assert.equal(traceFilename(anonymous), "stigsim-custom-200.trace.json");
});

test("parseTrace rejects malformed input with a specific message", () => {
  const cases: [string, RegExp][] = [
    ["not json at all", /could not be read as JSON/i],
    ["[]", /not a Stigsim trace/i],
    ["{}", /not a Stigsim trace/i],
    [JSON.stringify({ format: "something-else", version: 1 }), /not a Stigsim trace/i],
  ];
  for (const [text, pattern] of cases) {
    const result = parseTrace(text);
    assert.ok(!result.ok, `should have rejected: ${text}`);
    assert.match(result.error, pattern);
  }
});

test("parseTrace refuses a newer format version", () => {
  const { sim, rec } = runSim(100);
  const trace = { ...buildTrace(sim, rec), version: TRACE_VERSION + 1 };
  const result = parseTrace(JSON.stringify(trace));
  assert.ok(!result.ok);
  assert.match(result.error, /newer version/i);
});

test("parseTrace rejects a trace with a broken command", () => {
  const { sim, rec } = runSim(100);
  const trace = buildTrace(sim, rec);
  const broken = { ...trace, commands: [{ t: 5, cmd: { kind: "setWall", x: "nope", y: 2, open: true } }] };
  const result = parseTrace(JSON.stringify(broken));
  assert.ok(!result.ok);
  assert.match(result.error, /command/i);
});

test("parseTrace rejects missing or malformed seeds and config", () => {
  const { sim, rec } = runSim(100);
  const trace = buildTrace(sim, rec);

  const noSeeds = JSON.stringify({ ...trace, run: { ...trace.run, seeds: { master: null, maze: "a" } } });
  const noSeedsResult = parseTrace(noSeeds);
  assert.ok(!noSeedsResult.ok);
  assert.match(noSeedsResult.error, /seed/i);

  const badConfig = JSON.stringify({ ...trace, run: { ...trace.run, config: { ...trace.run.config, numAnts: -3 } } });
  const badConfigResult = parseTrace(badConfig);
  assert.ok(!badConfigResult.ok);
  assert.match(badConfigResult.error, /config/i);
});

test("parseTrace loads a trace from a different sim version but warns", () => {
  const { sim, rec } = runSim(100);
  const trace = { ...buildTrace(sim, rec), simVersion: SIM_VERSION + 1 };
  const result = parseTrace(JSON.stringify(trace));
  assert.ok(result.ok, result.ok ? "" : result.error);
  assert.match(result.warning ?? "", /recorded under a different/i);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test:client`

Expected: FAIL with `Cannot find module './trace'`.

- [ ] **Step 3: Write the trace module**

Create `src/sim/trace.ts`:

```ts
import type { RunConfig, RunSeeds, SimParams } from "./types";
import type { TimedCommand } from "./commands";
import { isTimedCommand } from "./commands";
import type { MetricsSample, MetricsRecorder } from "./metrics";
import type { Simulation } from "./sim";

export const TRACE_FORMAT = "stigsim-trace";
/** The file format. Bump when the shape of a trace changes. */
export const TRACE_VERSION = 1;
/** Simulation behaviour. Bump whenever a change alters how the model runs. */
export const SIM_VERSION = 1;

export interface TraceRunConfig {
  numAnts: number;
  params: SimParams;
  loopRate: number;
  numColonies: number;
  numFoodSources: number;
  foodPerSource: number;
}

export interface Trace {
  format: typeof TRACE_FORMAT;
  version: number;
  simVersion: number;
  createdAt: string;
  run: { seeds: RunSeeds; config: TraceRunConfig };
  commands: TimedCommand[];
  fingerprints: { t: number; h: string }[];
  metrics: { interval: number; truncated: boolean; samples: MetricsSample[] };
  endTick: number;
}

export type ParseResult =
  | { ok: true; trace: Trace; warning?: string }
  | { ok: false; error: string };

export function buildTrace(
  sim: Simulation,
  recorder: MetricsRecorder,
  createdAt: string = new Date().toISOString(),
): Trace {
  return {
    format: TRACE_FORMAT,
    version: TRACE_VERSION,
    simVersion: SIM_VERSION,
    createdAt,
    run: {
      seeds: { ...sim.config.seeds },
      config: {
        numAnts: sim.config.numAnts,
        params: { ...sim.config.params },
        loopRate: sim.config.loopRate,
        numColonies: sim.config.numColonies,
        numFoodSources: sim.config.numFoodSources,
        foodPerSource: sim.config.foodPerSource,
      },
    },
    commands: sim.commandLog.map(c => ({ t: c.t, cmd: { ...c.cmd } })),
    fingerprints: sim.fingerprints.map(f => ({ ...f })),
    metrics: {
      interval: recorder.interval,
      truncated: recorder.truncated,
      samples: recorder.samples,
    },
    endTick: sim.tick,
  };
}

export function serializeTrace(trace: Trace): string {
  return JSON.stringify(trace);
}

export function traceToRunConfig(trace: Trace): RunConfig {
  return { seeds: { ...trace.run.seeds }, ...trace.run.config };
}

export function traceFilename(trace: Trace): string {
  const seed = trace.run.seeds.master ?? "custom";
  return `stigsim-${seed}-${trace.endTick}.trace.json`;
}

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === "string";

function validSeeds(v: unknown): v is RunSeeds {
  if (typeof v !== "object" || v === null) return false;
  const s = v as Record<string, unknown>;
  return (s.master === null || isStr(s.master)) && isStr(s.maze) && isStr(s.food) && isStr(s.ants);
}

function validParams(v: unknown): v is SimParams {
  if (typeof v !== "object" || v === null) return false;
  const p = v as Record<string, unknown>;
  return isNum(p.evapRate) && isNum(p.trailPower) && isNum(p.tankMax) && typeof p.cautionary === "boolean";
}

function validConfig(v: unknown): v is TraceRunConfig {
  if (typeof v !== "object" || v === null) return false;
  const c = v as Record<string, unknown>;
  return (
    isInt(c.numAnts) && c.numAnts >= 0 &&
    validParams(c.params) &&
    isNum(c.loopRate) && c.loopRate >= 0 && c.loopRate <= 1 &&
    isInt(c.numColonies) && c.numColonies >= 1 && c.numColonies <= 4 &&
    isInt(c.numFoodSources) && c.numFoodSources >= 0 &&
    isNum(c.foodPerSource) && c.foodPerSource > 0
  );
}

export function parseTrace(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "That file could not be read as JSON." };
  }

  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, error: "That file is not a Stigsim trace." };
  }
  const t = raw as Record<string, unknown>;

  if (t.format !== TRACE_FORMAT) {
    return { ok: false, error: "That file is not a Stigsim trace." };
  }
  if (!isInt(t.version)) {
    return { ok: false, error: "That trace has no readable format version." };
  }
  if (t.version > TRACE_VERSION) {
    return {
      ok: false,
      error: `That trace uses a newer version of the trace format (${t.version}) than this build understands (${TRACE_VERSION}).`,
    };
  }
  if (!isInt(t.simVersion)) {
    return { ok: false, error: "That trace has no readable simulation version." };
  }

  const run = t.run as Record<string, unknown> | undefined;
  if (typeof run !== "object" || run === null) {
    return { ok: false, error: "That trace is missing its run description." };
  }
  if (!validSeeds(run.seeds)) {
    return { ok: false, error: "That trace has missing or malformed run seeds." };
  }
  if (!validConfig(run.config)) {
    return { ok: false, error: "That trace has a missing or malformed run config." };
  }

  if (!Array.isArray(t.commands) || !t.commands.every(isTimedCommand)) {
    return { ok: false, error: "That trace contains a command this build does not recognise." };
  }
  if (!Array.isArray(t.fingerprints) ||
      !t.fingerprints.every(f =>
        typeof f === "object" && f !== null &&
        isInt((f as Record<string, unknown>).t) &&
        isStr((f as Record<string, unknown>).h))) {
    return { ok: false, error: "That trace has malformed fingerprints." };
  }

  const metrics = t.metrics as Record<string, unknown> | undefined;
  if (typeof metrics !== "object" || metrics === null ||
      !isInt(metrics.interval) || typeof metrics.truncated !== "boolean" ||
      !Array.isArray(metrics.samples)) {
    return { ok: false, error: "That trace has a malformed metrics block." };
  }
  if (!isInt(t.endTick) || t.endTick < 0) {
    return { ok: false, error: "That trace has no readable end tick." };
  }

  const trace = raw as Trace;
  if (trace.simVersion !== SIM_VERSION) {
    return {
      ok: true,
      trace,
      warning: `This trace was recorded under a different simulation version (${trace.simVersion}, this build is ${SIM_VERSION}). Exact replay is not expected.`,
    };
  }
  return { ok: true, trace };
}
```

Add `export * from "./trace";` to `src/sim/index.ts`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test:client`

Expected: PASS, including all ten `trace.test.ts` tests.

- [ ] **Step 5: Add Save trace to the UI**

In `src/AntSim.tsx`, import `buildTrace`, `serializeTrace`, and `traceFilename` from `./sim`.

Factor the download out of the CSV button so both buttons share it. Add beside `forceRender`:

```tsx
  const download = useCallback((contents: string, filename: string, mime: string) => {
    const blob = new Blob([contents], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }, []);
```

Rewrite the Export CSV click handler to use it, and add a Save trace button beside it:

```tsx
            <button
              type="button"
              onClick={() => {
                const sim = simRef.current;
                if (!sim) return;
                const trace = buildTrace(sim, metricsRef.current);
                download(serializeTrace(trace), traceFilename(trace), "application/json");
              }}
              style={{
                background: "#1a1208", color: "#f59e0b", border: "1px solid #3d2e18",
                borderRadius: 6, padding: "6px 10px", cursor: "pointer", fontSize: "0.8rem",
              }}
            >
              Save trace
            </button>
```

- [ ] **Step 6: Verify the build**

Run: `pnpm typecheck && pnpm build && pnpm test:client`

Then `PORT=3000 BASE_PATH=/ pnpm dev`. Run a simulation, paint a few walls, move a slider, then press Save trace. Open the downloaded file and confirm it holds the seeds, your edits as commands with plausible tick numbers, at least one fingerprint, and metrics samples.

- [ ] **Step 7: Commit**

```bash
git add src/sim src/AntSim.tsx
git commit -m "feat: add the trace file format with validation

A trace holds the seeds, the initial config, every recorded command, the
periodic fingerprints, and the metrics samples in one self-contained JSON
file. Parsing validates every field and returns a specific message rather
than throwing, refuses a newer format version outright, and warns rather
than refuses when the simulation version differs.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Replay, seek, and the golden trace

Loading a trace and watching it run, with divergence reported rather than hidden, plus the CI fixture that guards the whole mechanism.

**Files:**
- Create: `src/sim/replay.ts`, `src/sim/replay.test.ts`, `src/sim/fixtures/make-golden.ts`, `src/sim/fixtures/golden.trace.json`, `src/sim/golden.test.ts`
- Modify: `src/sim/index.ts`, `src/AntSim.tsx`, `package.json`, `CONTRIBUTING.md`

**Interfaces:**
- Consumes: `Trace`, `traceToRunConfig`, `parseTrace` from Task 6; `Simulation.loadSchedule` from Task 3; `fingerprint` from Task 4.
- Produces: `class Replayer` with `sim`, `trace`, `tick`, `endTick`, `atEnd`, `divergedAt`, `step(): boolean`, `seek(t: number): void`, `reset(): void`, `continueAfterDivergence(): void`.

- [ ] **Step 1: Write the failing replay tests**

Create `src/sim/replay.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  Simulation, DEFAULT_PARAMS, makeSeeds, MetricsRecorder,
  buildTrace, Replayer, fingerprint,
} from "./index";
import type { RunConfig, Trace } from "./index";

function config(overrides: Partial<RunConfig> = {}): RunConfig {
  return {
    seeds: makeSeeds("replay-test"),
    numAnts: 20,
    params: DEFAULT_PARAMS,
    loopRate: 0.1,
    numColonies: 1,
    numFoodSources: 2,
    foodPerSource: 400,
    ...overrides,
  };
}

/** A 1200-tick run containing a wall edit, a food drop, and a slider change. */
function recordRun(): { trace: Trace; sim: Simulation } {
  const sim = new Simulation(config());
  const rec = new MetricsRecorder();

  const editable = (() => {
    for (let y = 2; y < 28; y++) {
      for (let x = 2; x < 28; x++) {
        if (sim.grid[y][x] !== 1) continue;
        if (sim.colonies.some(c => c.nestX === x && c.nestY === y)) continue;
        if (sim.foodSources.some(s => s.x === x && s.y === y)) continue;
        return [x, y] as [number, number];
      }
    }
    throw new Error("no editable cell");
  })();

  for (let i = 0; i < 400; i++) { sim.step(); rec.maybeSample(sim); }
  sim.enqueue({ kind: "setWall", x: editable[0], y: editable[1], open: false });
  for (let i = 0; i < 400; i++) { sim.step(); rec.maybeSample(sim); }
  sim.enqueue({ kind: "setParam", key: "evapRate", value: 0.012 });
  sim.enqueue({ kind: "setCautionary", value: true });
  for (let i = 0; i < 400; i++) { sim.step(); rec.maybeSample(sim); }

  return { trace: buildTrace(sim, rec), sim };
}

test("a replay reproduces the recorded run exactly", () => {
  const { trace, sim } = recordRun();
  const r = new Replayer(trace);
  while (r.step());

  assert.equal(r.divergedAt, null);
  assert.equal(r.tick, trace.endTick);
  assert.equal(fingerprint(r.sim), fingerprint(sim));
  assert.equal(r.sim.totalFoodCollected, sim.totalFoodCollected);
  assert.deepEqual(r.sim.commandLog, trace.commands);
});

test("step stops at the end tick", () => {
  const { trace } = recordRun();
  const r = new Replayer(trace);
  while (r.step());
  assert.equal(r.atEnd, true);
  assert.equal(r.step(), false);
  assert.equal(r.tick, trace.endTick);
});

test("seeking forward matches stepping there", () => {
  const { trace } = recordRun();
  const stepped = new Replayer(trace);
  for (let i = 0; i < 900; i++) stepped.step();

  const sought = new Replayer(trace);
  sought.seek(900);

  assert.equal(sought.tick, 900);
  assert.equal(fingerprint(sought.sim), fingerprint(stepped.sim));
});

test("seeking backward rebuilds and lands on the same state", () => {
  const { trace } = recordRun();
  const r = new Replayer(trace);
  r.seek(1000);
  const at1000 = fingerprint(r.sim);
  r.seek(300);
  assert.equal(r.tick, 300);
  r.seek(1000);
  assert.equal(fingerprint(r.sim), at1000);
});

test("seeking past the end clamps", () => {
  const { trace } = recordRun();
  const r = new Replayer(trace);
  r.seek(999999);
  assert.equal(r.tick, trace.endTick);
  r.seek(-50);
  assert.equal(r.tick, 0);
});

test("a corrupted fingerprint is reported at the tick it fails", () => {
  const { trace } = recordRun();
  assert.ok(trace.fingerprints.length >= 2);
  const target = trace.fingerprints[1];
  const tampered: Trace = {
    ...trace,
    fingerprints: trace.fingerprints.map(f => f.t === target.t ? { ...f, h: "deadbeef" } : f),
  };

  const r = new Replayer(tampered);
  while (r.step());
  assert.equal(r.divergedAt, target.t);
  assert.ok(r.tick < tampered.endTick, "replay should stop at the divergence");
});

test("continueAfterDivergence lets playback finish", () => {
  const { trace } = recordRun();
  const target = trace.fingerprints[1];
  const tampered: Trace = {
    ...trace,
    fingerprints: trace.fingerprints.map(f => f.t === target.t ? { ...f, h: "deadbeef" } : f),
  };

  const r = new Replayer(tampered);
  while (r.step());
  assert.equal(r.divergedAt, target.t);

  r.continueAfterDivergence();
  while (r.step());
  assert.equal(r.tick, tampered.endTick);
});

test("reset returns to tick zero", () => {
  const { trace } = recordRun();
  const r = new Replayer(trace);
  r.seek(700);
  r.reset();
  assert.equal(r.tick, 0);
  assert.equal(r.divergedAt, null);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test:client`

Expected: FAIL with `Cannot find module './replay'`.

- [ ] **Step 3: Write the replay module**

Create `src/sim/replay.ts`:

```ts
import { Simulation } from "./sim";
import { fingerprint } from "./fingerprint";
import { traceToRunConfig, type Trace } from "./trace";

/**
 * Drives a Simulation from a recorded trace and checks it against the
 * fingerprints the trace carries. The simulation itself does not know it is
 * replaying; commands arrive through the same apply path a live run uses.
 */
export class Replayer {
  readonly trace: Trace;
  sim: Simulation;
  divergedAt: number | null = null;

  private expected: Map<number, string>;
  private checking = true;

  constructor(trace: Trace) {
    this.trace = trace;
    this.expected = new Map(trace.fingerprints.map(f => [f.t, f.h]));
    this.sim = this.build();
  }

  private build(): Simulation {
    const sim = new Simulation(traceToRunConfig(this.trace));
    sim.loadSchedule(this.trace.commands);
    return sim;
  }

  get tick(): number { return this.sim.tick; }
  get endTick(): number { return this.trace.endTick; }
  get atEnd(): boolean { return this.sim.tick >= this.trace.endTick; }

  reset() {
    this.sim = this.build();
    this.divergedAt = null;
  }

  /** Advances one tick. Returns false at the end or on divergence. */
  step(): boolean {
    if (this.divergedAt !== null) return false;
    if (this.atEnd) return false;

    this.sim.step();

    if (this.checking) {
      const want = this.expected.get(this.sim.tick);
      if (want !== undefined && fingerprint(this.sim) !== want) {
        this.divergedAt = this.sim.tick;
        return false;
      }
    }
    return true;
  }

  /** Rebuilds and re-runs when the target is behind the current tick. */
  seek(target: number) {
    const t = Math.max(0, Math.min(target, this.trace.endTick));
    if (t < this.sim.tick || this.divergedAt !== null) this.reset();
    while (this.sim.tick < t && this.step());
  }

  /** Stops checking fingerprints so a diverged replay can still be watched. */
  continueAfterDivergence() {
    this.divergedAt = null;
    this.checking = false;
  }
}
```

Add `export * from "./replay";` to `src/sim/index.ts`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test:client`

Expected: PASS, all eight `replay.test.ts` tests.

- [ ] **Step 5: Generate the golden trace fixture**

Create `src/sim/fixtures/make-golden.ts`. This is run once by hand and its output committed; it is not part of the test run.

```ts
/**
 * Regenerates the golden trace fixture. Run with:
 *   pnpm golden
 * Only regenerate when SIM_VERSION has been deliberately bumped, because the
 * point of the fixture is to fail when simulation behaviour changes.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Simulation, MetricsRecorder, DEFAULT_PARAMS, makeSeeds, buildTrace, serializeTrace } from "../index";

const sim = new Simulation({
  seeds: makeSeeds("golden-fixture"),
  numAnts: 25,
  params: DEFAULT_PARAMS,
  loopRate: 0.12,
  numColonies: 2,
  numFoodSources: 3,
  foodPerSource: 400,
});
const rec = new MetricsRecorder();

const advance = (n: number) => { for (let i = 0; i < n; i++) { sim.step(); rec.maybeSample(sim); } };

advance(600);
sim.enqueue({ kind: "setWall", x: 15, y: 15, open: false });
advance(400);
sim.enqueue({ kind: "setParam", key: "trailPower", value: 7 });
sim.enqueue({ kind: "setCautionary", value: true });
advance(400);
sim.enqueue({ kind: "setAntCount", n: 40 });
advance(600);

const trace = buildTrace(sim, rec, "2026-08-27T00:00:00.000Z");
const out = join(dirname(fileURLToPath(import.meta.url)), "golden.trace.json");
writeFileSync(out, serializeTrace(trace));
console.log(`wrote ${out}: ${trace.endTick} ticks, ${trace.commands.length} commands, ${trace.fingerprints.length} fingerprints`);
```

Add to the `scripts` block in `package.json`:

```json
    "golden": "tsx src/sim/fixtures/make-golden.ts",
```

Run it:

```bash
pnpm golden
```

Expected output: `wrote .../golden.trace.json: 2000 ticks, 4 commands, 4 fingerprints`.

- [ ] **Step 6: Write the golden trace test**

Create `src/sim/golden.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseTrace, Replayer, SIM_VERSION } from "./index";

const fixture = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "golden.trace.json");

test("the golden trace replays without diverging", () => {
  const result = parseTrace(readFileSync(fixture, "utf8"));
  assert.ok(result.ok, result.ok ? "" : result.error);
  assert.equal(result.warning, undefined);
  assert.equal(result.trace.simVersion, SIM_VERSION);

  const r = new Replayer(result.trace);
  while (r.step());

  assert.equal(
    r.divergedAt,
    null,
    `The golden trace diverged at tick ${r.divergedAt}.

This means simulation behaviour changed. Either the change was
unintended, or a mutation path was added without routing it through the
command bus, or the change was deliberate. If deliberate, bump
SIM_VERSION in src/sim/trace.ts and regenerate the fixture with
"pnpm golden".`,
  );
  assert.equal(r.tick, result.trace.endTick);
});

test("the golden trace still contains its recorded interventions", () => {
  const result = parseTrace(readFileSync(fixture, "utf8"));
  assert.ok(result.ok);
  assert.deepEqual(
    result.trace.commands.map(c => c.cmd.kind),
    ["setWall", "setParam", "setCautionary", "setAntCount"],
  );
});
```

Update the `test:client` script so it picks up both directories:

```json
    "test:client": "tsx --test src/sim/*.test.ts",
```

This already matches `golden.test.ts` because it sits in `src/sim/`. No change needed; confirm by running the suite.

- [ ] **Step 7: Run the full suite**

Run: `pnpm test`

Expected: PASS, client and server suites both.

- [ ] **Step 8: Add trace loading and the replay bar to the UI**

Edit `src/AntSim.tsx`. Import `Replayer`, `parseTrace` from `./sim`.

Add state and refs:

```tsx
  const replayRef = useRef<Replayer | null>(null);
  const [replayState, setReplayState] = useState<
    { tick: number; endTick: number; divergedAt: number | null } | null
  >(null);
  const [traceMessage, setTraceMessage] = useState<string | null>(null);
  const [seekInput, setSeekInput] = useState("0");

  const syncReplay = useCallback(() => {
    const r = replayRef.current;
    setReplayState(r ? { tick: r.tick, endTick: r.endTick, divergedAt: r.divergedAt } : null);
  }, []);
```

Add the enter and exit handlers:

```tsx
  const enterReplay = useCallback((text: string) => {
    const result = parseTrace(text);
    if (!result.ok) {
      setTraceMessage(result.error);
      return;
    }
    setRunning(false);
    setManualControl(false);
    setEditMode("none");
    cancelAnimationFrame(rafRef.current);
    const r = new Replayer(result.trace);
    replayRef.current = r;
    simRef.current = r.sim;
    setTraceMessage(result.warning ?? null);
    syncReplay();
    forceRender();
  }, [forceRender, syncReplay]);

  const exitReplay = useCallback(() => {
    setRunning(false);
    cancelAnimationFrame(rafRef.current);
    replayRef.current = null;
    setReplayState(null);
    setTraceMessage(null);
    initSim();
  }, [initSim]);
```

Replace the animation loop body at lines 1008–1030 so it drives whichever source is active:

```tsx
    const loop = () => {
      const ctx = canvasRef.current?.getContext("2d");
      if (!ctx) return;
      frameCountRef.current++;

      if (frameCountRef.current >= framesPerTickRef.current) {
        frameCountRef.current = 0;
        const replayer = replayRef.current;
        if (replayer) {
          const advanced = replayer.step();
          simRef.current = replayer.sim;
          syncReplay();
          if (!advanced) setRunning(false);
        } else {
          const sim = simRef.current;
          if (!sim) return;
          sim.step();
          metricsRef.current.maybeSample(sim);
          setColonyScores(sim.colonies.map(c => c.foodCollected));
          const fp = sim.fingerprints[sim.fingerprints.length - 1];
          if (fp) setLatestFingerprint(fp);
          const latest = metricsRef.current.samples[metricsRef.current.samples.length - 1];
          if (latest) setFoodRate(latest.colonies.reduce((a, c) => a + c.ratePerKTick, 0));
        }
      }

      const sim = simRef.current;
      if (sim) render(ctx, sim, viewModeRef.current, watchedAntIdxRef.current, editModeRef.current, hoverCellRef.current);
      rafRef.current = requestAnimationFrame(loop);
    };
```

Add a Load trace file input to the Run panel:

```tsx
            <label
              style={{
                background: "#1a1208", color: "#f59e0b", border: "1px solid #3d2e18",
                borderRadius: 6, padding: "6px 10px", cursor: "pointer", fontSize: "0.8rem",
              }}
            >
              Load trace
              <input
                type="file"
                accept=".json,application/json"
                style={{ display: "none" }}
                onChange={async e => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  enterReplay(await file.text());
                }}
              />
            </label>
```

Add the message line and the replay bar below the fingerprint line in the Run panel:

```tsx
          {traceMessage && (
            <p style={{ margin: 0, fontSize: "0.72rem", color: "#ff6b6b", lineHeight: 1.45 }}>
              {traceMessage}
            </p>
          )}

          {replayState && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
              <span style={{ fontSize: "0.75rem", color: "#a08060", fontFamily: "monospace" }}>
                replay {replayState.tick} / {replayState.endTick}
              </span>
              <input
                type="number"
                min={0}
                max={replayState.endTick}
                value={seekInput}
                onChange={e => setSeekInput(e.target.value)}
                aria-label="Seek to tick"
                style={{
                  width: 90, background: "#1a1208", color: "#e5d5b5",
                  border: "1px solid #3d2e18", borderRadius: 6, padding: "4px 6px",
                  fontFamily: "monospace", fontSize: "0.78rem",
                }}
              />
              <button
                type="button"
                onClick={() => {
                  const r = replayRef.current;
                  if (!r) return;
                  setRunning(false);
                  r.seek(Number(seekInput) || 0);
                  simRef.current = r.sim;
                  syncReplay();
                  forceRender();
                }}
                style={{
                  background: "#1a1208", color: "#f59e0b", border: "1px solid #3d2e18",
                  borderRadius: 6, padding: "4px 8px", cursor: "pointer", fontSize: "0.78rem",
                }}
              >
                Jump
              </button>
              {replayState.divergedAt !== null && (
                <button
                  type="button"
                  onClick={() => {
                    replayRef.current?.continueAfterDivergence();
                    syncReplay();
                  }}
                  style={{
                    background: "#1a1208", color: "#ff6b6b", border: "1px solid #5a2e2e",
                    borderRadius: 6, padding: "4px 8px", cursor: "pointer", fontSize: "0.78rem",
                  }}
                >
                  Continue anyway
                </button>
              )}
              <button
                type="button"
                onClick={exitReplay}
                style={{
                  background: "#1a1208", color: "#a08060", border: "1px solid #3d2e18",
                  borderRadius: 6, padding: "4px 8px", cursor: "pointer", fontSize: "0.78rem",
                }}
              >
                Exit replay
              </button>
            </div>
          )}

          {replayState && replayState.divergedAt !== null && (
            <p style={{ margin: 0, fontSize: "0.72rem", color: "#ff6b6b", lineHeight: 1.45 }}>
              This replay diverged from the recording at tick {replayState.divergedAt}. Results after
              this point are not the run that was recorded.
            </p>
          )}
```

Disable editing during replay. Where the wall and food edit-mode buttons are rendered, add `disabled={replayState !== null}` and gate the pointer handlers by returning early:

```tsx
  const handleCanvasPointerDown = useCallback((e: React.PointerEvent) => {
    if (replayRef.current) return;
    if (editModeRef.current === "none" || viewModeRef.current !== "all") return;
    // ... rest unchanged ...
```

Apply the same `if (replayRef.current) return;` guard to `handleCanvasPointerMove` and to `send`.

Also guard `handleReset` so it exits replay rather than resetting underneath it:

```tsx
  const handleReset = () => {
    if (replayRef.current) { exitReplay(); return; }
    setRunning(false);
    setManualControl(false);
    cancelAnimationFrame(rafRef.current);
    frameCountRef.current = 0;
    initSim();
  };
```

- [ ] **Step 9: Verify the build and exercise replay by hand**

Run: `pnpm typecheck && pnpm build && pnpm test`

Then `PORT=3000 BASE_PATH=/ pnpm dev`. Run a simulation with a few wall edits and slider changes, press Save trace, then press Load trace and choose the file. Confirm: the maze matches what you recorded; play advances the replay and the counter tracks; entering a tick and pressing Jump lands there and redraws, both forwards and backwards; the edit buttons are disabled; Exit replay returns to a fresh live run. Then open the saved file in an editor, change one fingerprint hash, save, and load it again: the replay must stop and report the tick, and Continue anyway must let it finish.

- [ ] **Step 10: Document the trace workflow**

Add to `CONTRIBUTING.md`, after the Determinism section:

```markdown
## Traces

A trace is one JSON file holding the run seeds, the initial configuration,
every recorded intervention, periodic state fingerprints, and the metrics
samples. Save one from the Run panel and load it back to replay the run
exactly.

`src/sim/fixtures/golden.trace.json` is replayed by `pnpm test:client` as a
regression guard. If that test fails, simulation behaviour changed. The usual
cause is a new mutation path that does not go through the command bus in
`src/sim/commands.ts`; every way of changing a running simulation must be a
command, or traces stop reproducing. If the change was deliberate, bump
`SIM_VERSION` in `src/sim/trace.ts` and regenerate the fixture with
`pnpm golden`.
```

Update the Architecture section of `CONTRIBUTING.md`, replacing the line about `src/AntSim.tsx`:

```markdown
- `src/sim/` contains the simulation core. It must not import React or touch
  the DOM, so it can run headless.
- `src/render.ts` draws a simulation to a canvas.
- `src/AntSim.tsx` is the standalone simulator interface.
```

- [ ] **Step 11: Commit**

```bash
git add src/sim src/AntSim.tsx package.json CONTRIBUTING.md
git commit -m "feat: replay traces with seek and divergence reporting

Loading a trace rebuilds the run from its seeds and feeds the recorded
commands through the same apply path a live run uses, checking each
fingerprint as it goes. A mismatch stops playback and names the tick
rather than producing a plausible wrong run.

Seeking rebuilds and re-runs rather than storing snapshots, which is cheap
at this grid size. Adds a golden trace fixture replayed in CI, which fails
the build if a mutation path is added without routing it through the
command bus.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Follow-on work, not in this plan

- The headless Node batch runner. The pieces it needs already exist after this plan: `RunConfig` accepts the three stream seeds independently, so pinning maze and food while varying ants is a loop over `new Simulation(...)`, and `metricsToCsv` already produces the output format.
- Ant-mill detection, which needs a detector definition to be agreed first.
- Forking a new live run from a point inside a trace.
- Infinite World reproducibility.
