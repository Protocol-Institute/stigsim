# Pheromone Update API Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the doctrine vocabulary, adoption semantics, field topology, and maze-sandbox UI from the spec on one demo branch, so the team can play with the mechanic before the Sep 11 call.

**Architecture:** `sim-core` gains a per-colony `Doctrine` (two role tables, three colony-level scalars) consumed by a new score path and a new lay path in `_moveAnt`; nest and food beacons become an odor term computed at read time; every change travels as a whole-value `setDoctrine` command so traces replay; the field topology is a `Topology` setting with a read mode and a mimic switch. The React sandbox replaces its four parameter sliders with a colony selector, presets, and sliders bound to doctrine atoms.

**Tech Stack:** TypeScript 5.9, pnpm workspace, `node:test` via `tsx`, React 19, Vite 7.

**Spec:** `docs/superpowers/specs/2026-09-05-pheromone-update-api-design.md` — read it first; every task below cites the section it implements.

## Global Constraints

- Branch: `demo/pheromone-update-api`, created from `spec/pheromone-update-api` so the spec travels with the code. Never commit to `main`.
- Determinism (spec "Hard constraints", `CONTRIBUTING.md` "Determinism"): no `Math.random`, no bare `Math.pow`, no `Math.log`/`exp`/trig on any `sim-core` state path. Exponentiation only via `deterministicPow`, whose domain is multiples of 0.5; any exponent from outside the program is screened with `isHalfStep`.
- Every mutation of a running simulation is a `Command`: a plain JSON object with a `kind`, applied at a tick boundary, recorded in `commandLog`, bounded by `isCommand`, which the trace loader shares. Never mutate simulation state from outside `apply`.
- `sim-core` must not import React or touch the DOM. `sim-trace` depends on `sim-core`; nothing in `sim-core` may depend on `sim-trace`.
- Coverage gates (`pnpm test:coverage`): lines 95, branches 92, functions 97. Every exported function needs a caller in a test; every branch of a read mode needs a test.
- `tsconfig` has `noUnusedLocals: true` and `isolatedModules: true`. Remove an import the moment it becomes unused; use `import type` for types.
- `sim-core` `lib` is `ES2022` only: do not use `structuredClone`. Clone doctrines with `cloneDoctrine`.
- Regenerate the golden trace (`pnpm golden`) only in the tasks that say so. Any other golden failure means behaviour changed unintentionally.
- Finish every task with `pnpm test` (typecheck + all package tests + coverage + server tests) green, then commit. Commit messages: imperative summary line, plain prose body, and end with `Co-Authored-By: Claude <model> <noreply@anthropic.com>` naming the model that made the change.
- Model tier per task, in the task heading: **haiku** for mechanical work with the code given in full; **sonnet** for ordinary implementation; **sonnet + adversarial review** where the reviewer is briefed to refute against the spec section and to hunt for determinism and RNG draw-count regressions. The design lead verifies every task by reading the diff and running `pnpm test` before the next task starts.

## Execution notes

- Tasks 1–10 are the spec's PR 1 (plus the sandbox UI); tasks 11–16 are PR 2. If the branch is later split into real PRs, the split is between tasks 10 and 11.
- Between task 4 and task 9 the sandbox's evaporation and trail-bias sliders send `setParam` commands that the engine no longer reads. That is expected on this branch; task 9 replaces them.
- Under `nest` adoption an ant adopts a new doctrine only at the nest event, and a searching ant reaches the nest only after picking up food. An ant that never finds food never adopts. This is by design (spec "Adoption"); the sandbox defaults to `instant`.
- Two items from the spec's surface section are deliberately not in the demo: tournament subsets (the panel's five sliders are the demo's subset; a tournament layer is a data file over the same paths) and the event feed with tick-of-effect (the command log already carries it; the UI to show it is a follow-up). Everything else in the spec's PR 1 and PR 2 scope has a task.

## File structure

New files:

| File | Responsibility |
| --- | --- |
| `packages/sim-core/src/doctrine.ts` | `Doctrine` and `RoleTable` types, `DEFAULT_DOCTRINE`, `makeRoleTable`, `isDoctrine`, `doctrineNumbers`, `cloneDoctrine` |
| `packages/sim-core/src/doctrine.test.ts` | validator and helper tests |
| `packages/sim-core/src/topology.ts` | `Topology` type, the four named options, `isTopology`, `cloneTopology` |
| `packages/sim-core/src/topology.test.ts` | validator tests |
| `packages/sim-core/src/score.ts` | `readPair`, `odor`, `scoreCell`, `chooseNext` — the response side |
| `packages/sim-core/src/score.test.ts` | bit-equivalence with the old rule, odor privacy, read modes |
| `src/doctrine-presets.ts` | presets as data |
| `src/doctrine-presets.test.ts` | every preset validates |
| `src/DoctrinePanel.tsx` | colony selector, presets, atom sliders, adopted meter, debounce |
| `scripts/doctrine-matchup.ts` | headless two-colony matchup under each topology |

Modified files: `packages/sim-core/src/{types,constants,commands,sim,fingerprint,index}.ts` and their tests; `packages/sim-trace/src/{trace,golden.test,fixtures/make-golden}.ts` and `trace.test.ts`, `replay.test.ts`; `src/{AntSim.tsx,render.ts}`; `package.json`; `README.md`, `CONTRIBUTING.md`, `status.md`.

---

### Task 1: The doctrine type, default, and validator — **haiku**

Implements spec "The vocabulary".

**Files:**
- Create: `packages/sim-core/src/doctrine.ts`
- Create: `packages/sim-core/src/doctrine.test.ts`
- Modify: `packages/sim-core/src/index.ts`

**Interfaces:**
- Consumes: `MAX_EVAP_RATE`, `MAX_TRAIL_POWER` from `constants.ts`; `isHalfStep` from `rng.ts`; `AntState` from `types.ts`.
- Produces: `Role`, `DoctrineChannel`, `Origin`, `AdoptionMode`, `LayEntry`, `RoleTable`, `Doctrine`; constants `ROLES`, `STATES`, `DOCTRINE_CHANNELS`, `ORIGINS`, `MAX_LAY_GAIN`, `DEFAULT_DOCTRINE`; functions `makeRoleTable(spec)`, `isDoctrine(v): v is Doctrine`, `doctrineNumbers(d): number[]` (35 numbers), `cloneDoctrine(d): Doctrine`.

- [ ] **Step 1: Create the branch**

```bash
git switch spec/pheromone-update-api
git switch -c demo/pheromone-update-api
```

- [ ] **Step 2: Write the failing test**

Create `packages/sim-core/src/doctrine.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_DOCTRINE, MAX_LAY_GAIN, cloneDoctrine, doctrineNumbers, isDoctrine, makeRoleTable,
} from "./doctrine";
import { MAX_TRAIL_POWER } from "./constants";

test("the default doctrine validates and is the Deneubourg point", () => {
  assert.equal(isDoctrine(DEFAULT_DOCTRINE), true);
  assert.equal(DEFAULT_DOCTRINE.forager.follow.searching.food.own, 5);
  assert.equal(DEFAULT_DOCTRINE.forager.follow.returning.home.own, 5);
  assert.equal(DEFAULT_DOCTRINE.forager.lay.searching.home.own, 1);
  assert.equal(DEFAULT_DOCTRINE.forager.lay.returning.food.own, 1);
  assert.equal(DEFAULT_DOCTRINE.spoilerFraction, 0);
  assert.equal(DEFAULT_DOCTRINE.mimicRate, 0);
  assert.equal(DEFAULT_DOCTRINE.evapRate, 0.005);
});

test("makeRoleTable fills every entry and defaults unspecified ones to zero", () => {
  const t = makeRoleTable({ follow: { searching: { food: { own: 3 } } } });
  assert.equal(t.follow.searching.food.own, 3);
  assert.equal(t.follow.searching.food.enemy, 0);
  assert.equal(t.follow.returning.home.own, 0);
  assert.deepEqual(t.lay.returning.food, { own: 0, mimic: 0 });
});

test("doctrineNumbers lists 35 numbers in a fixed order", () => {
  const n = doctrineNumbers(DEFAULT_DOCTRINE);
  assert.equal(n.length, 35);
  // forager, searching, food, own is the 3rd follow entry (home/own, home/enemy, food/own).
  assert.equal(n[2], 5);
  assert.deepEqual(n.slice(32), [0, 0, 0.005]);
});

test("cloneDoctrine returns an independent copy", () => {
  const c = cloneDoctrine(DEFAULT_DOCTRINE);
  c.forager.follow.searching.food.own = 9;
  assert.equal(DEFAULT_DOCTRINE.forager.follow.searching.food.own, 5);
  assert.equal(isDoctrine(c), true);
});

function mutate(edit: (d: ReturnType<typeof cloneDoctrine>) => void) {
  const d = cloneDoctrine(DEFAULT_DOCTRINE);
  edit(d);
  return d;
}

test("isDoctrine rejects each violation individually", () => {
  assert.equal(isDoctrine(null), false);
  assert.equal(isDoctrine({}), false);
  assert.equal(isDoctrine({ ...cloneDoctrine(DEFAULT_DOCTRINE), extra: 1 }), false);
  const missing = cloneDoctrine(DEFAULT_DOCTRINE) as unknown as Record<string, unknown>;
  delete missing.mimicRate;
  assert.equal(isDoctrine(missing), false);
  assert.equal(isDoctrine(mutate(d => { (d as unknown as { v: number }).v = 2; })), false);
  assert.equal(isDoctrine(mutate(d => { d.forager.follow.searching.food.own = 2.3; })), false);
  assert.equal(isDoctrine(mutate(d => { d.forager.follow.searching.food.own = MAX_TRAIL_POWER + 0.5; })), false);
  assert.equal(isDoctrine(mutate(d => { d.forager.follow.searching.food.own = -MAX_TRAIL_POWER; })), true);
  assert.equal(isDoctrine(mutate(d => {
    d.forager.follow.searching.food.own = 20;
    d.forager.follow.searching.home.enemy = 13;
  })), false, "row sum above MAX_TRAIL_POWER");
  assert.equal(isDoctrine(mutate(d => { d.forager.lay.searching.home.own = MAX_LAY_GAIN + 1; })), false);
  assert.equal(isDoctrine(mutate(d => { d.forager.lay.searching.home.own = 1.5; })), false);
  assert.equal(isDoctrine(mutate(d => { d.forager.lay.searching.food.mimic = 1; })), false, "foragers never mimic");
  assert.equal(isDoctrine(mutate(d => { d.spoiler.lay.searching.food.mimic = 1; })), true);
  assert.equal(isDoctrine(mutate(d => { d.spoiler.lay.searching.food.mimic = 2; })), false);
  assert.equal(isDoctrine(mutate(d => { d.spoilerFraction = 1.5; })), false);
  assert.equal(isDoctrine(mutate(d => { d.mimicRate = -0.1; })), false);
  assert.equal(isDoctrine(mutate(d => { d.evapRate = 2; })), false);
  assert.equal(isDoctrine(mutate(d => { d.evapRate = Number.NaN; })), false);
  const badRow = cloneDoctrine(DEFAULT_DOCTRINE) as unknown as { forager: { follow: Record<string, unknown> } };
  delete badRow.forager.follow.returning;
  assert.equal(isDoctrine(badRow), false);
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm exec tsx --test packages/sim-core/src/doctrine.test.ts`
Expected: FAIL — cannot find module `./doctrine`.

- [ ] **Step 4: Write the implementation**

Create `packages/sim-core/src/doctrine.ts`:

```ts
import { MAX_EVAP_RATE, MAX_TRAIL_POWER } from "./constants";
import { isHalfStep } from "./rng";
import type { AntState } from "./types";

export type Role = "forager" | "spoiler";
export type DoctrineChannel = "home" | "food";
export type Origin = "own" | "enemy";
export type AdoptionMode = "instant" | "nest";

export const ROLES: readonly Role[] = ["forager", "spoiler"];
export const STATES: readonly AntState[] = ["searching", "returning"];
export const DOCTRINE_CHANNELS: readonly DoctrineChannel[] = ["home", "food"];
export const ORIGINS: readonly Origin[] = ["own", "enemy"];

/** Largest own-target lay gain. Multiplies DEPOSIT_RATE. */
export const MAX_LAY_GAIN = 3;

export interface LayEntry {
  /** Integer 0..MAX_LAY_GAIN, multiplying DEPOSIT_RATE. */
  own: number;
  /** 0 or 1: lay mimicRate * DEPOSIT_RATE of the opponent's chemical. Always 0 on the forager table. */
  mimic: number;
}

export interface RoleTable {
  /** Signed half-step exponent per (state, channel, origin). 0 means ignore. */
  follow: Record<AntState, Record<DoctrineChannel, Record<Origin, number>>>;
  lay: Record<AntState, Record<DoctrineChannel, LayEntry>>;
}

export interface Doctrine {
  /** Descriptor kind. A second kind can be added later without a trace format change. */
  v: 1;
  forager: RoleTable;
  spoiler: RoleTable;
  /** Fraction of the colony's ants roled as spoilers, [0, 1]. Colony-level. */
  spoilerFraction: number;
  /** Scale on mimic deposits, [0, 1]. Colony-level. */
  mimicRate: number;
  /** Decay applied to this colony's layer each tick, [0, MAX_EVAP_RATE]. Colony-level. */
  evapRate: number;
}

type FollowSpec = Partial<Record<AntState, Partial<Record<DoctrineChannel, Partial<Record<Origin, number>>>>>>;
type LaySpec = Partial<Record<AntState, Partial<Record<DoctrineChannel, Partial<LayEntry>>>>>;

/** A full role table from a sparse description; everything unspecified is zero. */
export function makeRoleTable(spec: { follow?: FollowSpec; lay?: LaySpec } = {}): RoleTable {
  const follow = {} as RoleTable["follow"];
  const lay = {} as RoleTable["lay"];
  for (const s of STATES) {
    follow[s] = {} as Record<DoctrineChannel, Record<Origin, number>>;
    lay[s] = {} as Record<DoctrineChannel, LayEntry>;
    for (const c of DOCTRINE_CHANNELS) {
      follow[s][c] = {
        own: spec.follow?.[s]?.[c]?.own ?? 0,
        enemy: spec.follow?.[s]?.[c]?.enemy ?? 0,
      };
      lay[s][c] = {
        own: spec.lay?.[s]?.[c]?.own ?? 0,
        mimic: spec.lay?.[s]?.[c]?.mimic ?? 0,
      };
    }
  }
  return { follow, lay };
}

function deepFreeze<T>(v: T): T {
  if (typeof v === "object" && v !== null) {
    for (const k of Object.keys(v)) deepFreeze((v as Record<string, unknown>)[k]);
    Object.freeze(v);
  }
  return v;
}

/**
 * Today's model as a point in the doctrine space: four nonzero atoms. The
 * spoiler table is only consulted once spoilerFraction is raised; its default
 * is an explorer that drifts toward the opponent and lays false food trail.
 */
export const DEFAULT_DOCTRINE: Doctrine = deepFreeze({
  v: 1,
  forager: makeRoleTable({
    follow: { searching: { food: { own: 5 } }, returning: { home: { own: 5 } } },
    lay: { searching: { home: { own: 1 } }, returning: { food: { own: 1 } } },
  }),
  spoiler: makeRoleTable({
    follow: { searching: { food: { own: 1 }, home: { enemy: 2 } }, returning: { home: { own: 5 } } },
    lay: { searching: { food: { mimic: 1 } }, returning: { food: { own: 1 } } },
  }),
  spoilerFraction: 0,
  mimicRate: 0,
  evapRate: 0.005,
});

/** A mutable deep copy. Doctrines hold only finite numbers, so JSON is exact. */
export function cloneDoctrine(d: Doctrine): Doctrine {
  return JSON.parse(JSON.stringify(d)) as Doctrine;
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

function hasExactKeys(v: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(v);
  return own.length === keys.length && keys.every(k => Object.hasOwn(v, k));
}

const isFollowWeight = (v: unknown): v is number =>
  isNum(v) && isHalfStep(v) && Math.abs(v) <= MAX_TRAIL_POWER;
const isLayGain = (v: unknown): v is number =>
  isNum(v) && Number.isInteger(v) && v >= 0 && v <= MAX_LAY_GAIN;
const isFlag = (v: unknown): v is number => v === 0 || v === 1;

function isRoleTable(v: unknown, mimicAllowed: boolean): v is RoleTable {
  if (!isObj(v) || !hasExactKeys(v, ["follow", "lay"])) return false;
  const { follow, lay } = v;
  if (!isObj(follow) || !hasExactKeys(follow, STATES)) return false;
  if (!isObj(lay) || !hasExactKeys(lay, STATES)) return false;
  for (const s of STATES) {
    const fRow = follow[s], lRow = lay[s];
    if (!isObj(fRow) || !hasExactKeys(fRow, DOCTRINE_CHANNELS)) return false;
    if (!isObj(lRow) || !hasExactKeys(lRow, DOCTRINE_CHANNELS)) return false;
    let rowSum = 0;
    for (const c of DOCTRINE_CHANNELS) {
      const w = fRow[c], l = lRow[c];
      if (!isObj(w) || !hasExactKeys(w, ORIGINS)) return false;
      if (!isObj(l) || !hasExactKeys(l, ["own", "mimic"])) return false;
      if (!isFollowWeight(w.own) || !isFollowWeight(w.enemy)) return false;
      rowSum += Math.abs(w.own) + Math.abs(w.enemy);
      if (!isLayGain(l.own) || !isFlag(l.mimic)) return false;
      if (!mimicAllowed && l.mimic !== 0) return false;
    }
    // The single exponent was bounded so 5000^32 stays finite; the product of
    // four factors is bounded the same way when the row's |w| sum is.
    if (rowSum > MAX_TRAIL_POWER) return false;
  }
  return true;
}

/**
 * The one predicate the command bus and the trace loader share, so the two
 * cannot drift. Exact key sets: a doctrine with an unknown field is rejected
 * rather than silently carried.
 */
export function isDoctrine(v: unknown): v is Doctrine {
  if (!isObj(v)) return false;
  if (!hasExactKeys(v, ["v", "forager", "spoiler", "spoilerFraction", "mimicRate", "evapRate"])) return false;
  return v.v === 1 &&
    isRoleTable(v.forager, false) &&
    isRoleTable(v.spoiler, true) &&
    isNum(v.spoilerFraction) && v.spoilerFraction >= 0 && v.spoilerFraction <= 1 &&
    isNum(v.mimicRate) && v.mimicRate >= 0 && v.mimicRate <= 1 &&
    isNum(v.evapRate) && v.evapRate >= 0 && v.evapRate <= MAX_EVAP_RATE;
}

/**
 * Every number in a doctrine, in one fixed order: follow entries by role,
 * state, channel, origin; then lay entries by role, state, channel as
 * (own, mimic); then the three scalars. The fingerprint hashes this.
 */
export function doctrineNumbers(d: Doctrine): number[] {
  const out: number[] = [];
  for (const r of ROLES) for (const s of STATES) for (const c of DOCTRINE_CHANNELS) for (const o of ORIGINS) {
    out.push(d[r].follow[s][c][o]);
  }
  for (const r of ROLES) for (const s of STATES) for (const c of DOCTRINE_CHANNELS) {
    out.push(d[r].lay[s][c].own, d[r].lay[s][c].mimic);
  }
  out.push(d.spoilerFraction, d.mimicRate, d.evapRate);
  return out;
}
```

Add to `packages/sim-core/src/index.ts`, after the `./commands` line:

```ts
export * from "./doctrine";
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm exec tsx --test packages/sim-core/src/doctrine.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 6: Run the full suite and commit**

Run: `pnpm test`
Expected: PASS (nothing else changed).

```bash
git add packages/sim-core/src/doctrine.ts packages/sim-core/src/doctrine.test.ts packages/sim-core/src/index.ts
git commit -m "Add the doctrine type, default, and validator

The vocabulary from the pheromone update API spec: two role tables of
follow exponents and lay gains, three colony-level scalars, a validator
shared by the command bus and the trace loader, and the fixed number
order the fingerprint will hash.

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

### Task 2: The topology type and the four named options — **haiku**

Implements spec "Topology" (the type and the options; the engine reads land in tasks 4 and 5, the validator widens in task 11).

**Files:**
- Create: `packages/sim-core/src/topology.ts`
- Create: `packages/sim-core/src/topology.test.ts`
- Modify: `packages/sim-core/src/index.ts`

**Interfaces:**
- Produces: `ReadMode`, `Topology`, `READ_MODES`, `TOPOLOGY_PRIVATE`, `TOPOLOGY_SENSING`, `TOPOLOGY_MIMICRY`, `TOPOLOGY_OPEN`, `DEFAULT_TOPOLOGY` (= `TOPOLOGY_PRIVATE`), `isTopology(v): v is Topology`, `cloneTopology(t)`. Until task 11, `isTopology` accepts only `read: "private"` with `mimicEnemy: false`.

- [ ] **Step 1: Write the failing test**

Create `packages/sim-core/src/topology.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_TOPOLOGY, TOPOLOGY_MIMICRY, TOPOLOGY_OPEN, TOPOLOGY_PRIVATE, TOPOLOGY_SENSING,
  cloneTopology, isTopology,
} from "./topology";

test("the private topology is the default and validates", () => {
  assert.equal(DEFAULT_TOPOLOGY, TOPOLOGY_PRIVATE);
  assert.equal(isTopology(TOPOLOGY_PRIVATE), true);
  assert.deepEqual(TOPOLOGY_PRIVATE, {
    read: "private", mimicEnemy: false, visible: { home: false, food: false }, maxMimicRate: 1, provenance: false,
  });
});

test("the cross-colony options are not accepted until the engine implements them", () => {
  // Widened in the task that lands the shared and separable reads.
  assert.equal(isTopology(TOPOLOGY_SENSING), false);
  assert.equal(isTopology(TOPOLOGY_MIMICRY), false);
  assert.equal(isTopology(TOPOLOGY_OPEN), false);
});

test("isTopology rejects malformed input", () => {
  assert.equal(isTopology(null), false);
  assert.equal(isTopology({}), false);
  assert.equal(isTopology({ ...TOPOLOGY_PRIVATE, extra: true }), false);
  assert.equal(isTopology({ ...TOPOLOGY_PRIVATE, read: "sideways" }), false);
  assert.equal(isTopology({ ...TOPOLOGY_PRIVATE, maxMimicRate: 2 }), false);
  assert.equal(isTopology({ ...TOPOLOGY_PRIVATE, maxMimicRate: Number.NaN }), false);
  assert.equal(isTopology({ ...TOPOLOGY_PRIVATE, visible: { home: false } }), false);
  assert.equal(isTopology({ ...TOPOLOGY_PRIVATE, visible: { home: 1, food: false } }), false);
  assert.equal(isTopology({ ...TOPOLOGY_PRIVATE, provenance: "yes" }), false);
});

test("cloneTopology returns an independent copy", () => {
  const c = cloneTopology(TOPOLOGY_PRIVATE);
  c.visible.home = true;
  assert.equal(TOPOLOGY_PRIVATE.visible.home, false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec tsx --test packages/sim-core/src/topology.test.ts`
Expected: FAIL — cannot find module `./topology`.

- [ ] **Step 3: Write the implementation**

Create `packages/sim-core/src/topology.ts`:

```ts
export type ReadMode = "private" | "shared" | "separable";

/**
 * How colonies' layers are read and written across colony lines. Nothing in
 * the doctrine depends on this; the origin and target axes are simply inert
 * under the options that do not use them.
 */
export interface Topology {
  read: ReadMode;
  /** May spoilers' mimic deposits reach the other colony's chemical? */
  mimicEnemy: boolean;
  /** Which channels cross colony lines at all. An invisible channel is private under every read mode. */
  visible: { home: boolean; food: boolean };
  /** Match rule, [0, 1]; the engine clamps mimic deposits to min(doctrine.mimicRate, this). */
  maxMimicRate: number;
  /** Keep a spoiler-colony -> target sublayer for spectators and metrics. Ants never read it. */
  provenance: boolean;
}

export const READ_MODES: readonly ReadMode[] = ["private", "shared", "separable"];

function frozen(t: Topology): Topology {
  Object.freeze(t.visible);
  return Object.freeze(t);
}

/** Option 1: colonies interact only through food and walls. What the Infinite server keeps. */
export const TOPOLOGY_PRIVATE: Topology = frozen({
  read: "private", mimicEnemy: false, visible: { home: false, food: false }, maxMimicRate: 1, provenance: false,
});
/** Option 2: read-only sensing of the opponent's trails. */
export const TOPOLOGY_SENSING: Topology = frozen({
  read: "separable", mimicEnemy: false, visible: { home: true, food: true }, maxMimicRate: 1, provenance: false,
});
/** Option 3: separable with mimicry. The spec's recommendation. */
export const TOPOLOGY_MIMICRY: Topology = frozen({
  read: "separable", mimicEnemy: true, visible: { home: true, food: true }, maxMimicRate: 0.5, provenance: true,
});
/** Option 4: one summed food field, home private. */
export const TOPOLOGY_OPEN: Topology = frozen({
  read: "shared", mimicEnemy: true, visible: { home: false, food: true }, maxMimicRate: 0.5, provenance: false,
});

export const DEFAULT_TOPOLOGY: Topology = TOPOLOGY_PRIVATE;

/**
 * What the engine implements today. A trace must never be able to claim a
 * read mode the engine does not run, so the validator is widened in the same
 * change that lands the cross-colony read.
 */
const IMPLEMENTED: { reads: readonly ReadMode[]; mimic: readonly boolean[] } = {
  reads: ["private"],
  mimic: [false],
};

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isBool = (v: unknown): v is boolean => typeof v === "boolean";
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

function hasExactKeys(v: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(v);
  return own.length === keys.length && keys.every(k => Object.hasOwn(v, k));
}

export function isTopology(v: unknown): v is Topology {
  if (!isObj(v) || !hasExactKeys(v, ["read", "mimicEnemy", "visible", "maxMimicRate", "provenance"])) return false;
  if (!IMPLEMENTED.reads.includes(v.read as ReadMode)) return false;
  if (!isBool(v.mimicEnemy) || !IMPLEMENTED.mimic.includes(v.mimicEnemy)) return false;
  const vis = v.visible;
  if (!isObj(vis) || !hasExactKeys(vis, ["home", "food"]) || !isBool(vis.home) || !isBool(vis.food)) return false;
  if (!isNum(v.maxMimicRate) || v.maxMimicRate < 0 || v.maxMimicRate > 1) return false;
  return isBool(v.provenance);
}

export function cloneTopology(t: Topology): Topology {
  return { ...t, visible: { ...t.visible } };
}
```

Add to `packages/sim-core/src/index.ts`, after the `./doctrine` line:

```ts
export * from "./topology";
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec tsx --test packages/sim-core/src/topology.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Run the full suite and commit**

Run: `pnpm test`
Expected: PASS.

```bash
git add packages/sim-core/src/topology.ts packages/sim-core/src/topology.test.ts packages/sim-core/src/index.ts
git commit -m "Add the topology type and its four named options

Read mode, the mimic switch, per-channel visibility, the mimic cap, and
the provenance flag, with option 1 as the default. The validator accepts
only option 1 until the cross-colony read lands, so no trace can claim
a mode the engine does not run.

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

### Task 3: The simulation stores doctrine, adoption, and topology — **sonnet**

Implements spec "Adoption" (storage, version map, re-stamping) and the three commands from "Commands". No physics changes yet: the golden trace must still pass without regeneration.

**Files:**
- Modify: `packages/sim-core/src/types.ts` (Ant, Colony)
- Modify: `packages/sim-core/src/commands.ts` (three new kinds)
- Modify: `packages/sim-core/src/sim.ts` (colony construction, ant construction, apply, nest event)
- Modify: `packages/sim-core/src/commands.test.ts` (isCommand cases)
- Create: `packages/sim-core/src/adoption.test.ts`

**Interfaces:**
- Consumes: `Doctrine`, `AdoptionMode`, `DEFAULT_DOCTRINE`, `cloneDoctrine`, `isDoctrine` (task 1); `Topology`, `DEFAULT_TOPOLOGY`, `cloneTopology`, `isTopology` (task 2).
- Produces: `Ant.role: Role`, `Ant.doctrineVersion: number`; `Colony.doctrine: Doctrine`, `Colony.doctrineVersion: number`, `Colony.doctrines: Map<number, Doctrine>`, `Colony.doctrineRefs: Map<number, number>`; `Simulation.adoption: AdoptionMode`, `Simulation.topology: Topology`, `Simulation.doctrineFor(ant, colony): Doctrine`; commands `setDoctrine`, `setAdoption`, `setTopology`.

- [ ] **Step 1: Write the failing tests**

Add to `packages/sim-core/src/commands.test.ts`, at the end of the file:

```ts
test("isCommand accepts the doctrine, adoption, and topology commands", () => {
  assert.equal(isCommand({ kind: "setDoctrine", colony: 0, doctrine: DEFAULT_DOCTRINE }), true);
  assert.equal(isCommand({ kind: "setDoctrine", colony: 3, doctrine: DEFAULT_DOCTRINE }), true);
  assert.equal(isCommand({ kind: "setDoctrine", colony: 4, doctrine: DEFAULT_DOCTRINE }), false);
  assert.equal(isCommand({ kind: "setDoctrine", colony: -1, doctrine: DEFAULT_DOCTRINE }), false);
  assert.equal(isCommand({ kind: "setDoctrine", colony: 0.5, doctrine: DEFAULT_DOCTRINE }), false);
  assert.equal(isCommand({ kind: "setDoctrine", colony: 0, doctrine: { ...DEFAULT_DOCTRINE, evapRate: 9 } }), false);
  assert.equal(isCommand({ kind: "setAdoption", mode: "instant" }), true);
  assert.equal(isCommand({ kind: "setAdoption", mode: "nest" }), true);
  assert.equal(isCommand({ kind: "setAdoption", mode: "later" }), false);
  assert.equal(isCommand({ kind: "setTopology", topology: DEFAULT_TOPOLOGY }), true);
  assert.equal(isCommand({ kind: "setTopology", topology: { ...DEFAULT_TOPOLOGY, read: "shared" } }), false);
});
```

and extend the import at the top of that file to include `DEFAULT_DOCTRINE, DEFAULT_TOPOLOGY`:

```ts
import {
  Simulation, DEFAULT_PARAMS, makeSeeds, isCommand, MAX_ANTS_PER_COLONY, DEFAULT_DOCTRINE, DEFAULT_TOPOLOGY,
} from "./index";
```

Create `packages/sim-core/src/adoption.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  Simulation, DEFAULT_PARAMS, DEFAULT_DOCTRINE, DenseField, DenseGrid, cloneDoctrine, makeSeeds,
} from "./index";
import type { CellType, RunConfig, WorldSpec } from "./index";

function config(overrides: Partial<RunConfig> = {}): RunConfig {
  return {
    seeds: makeSeeds("adoption-test"),
    numAnts: 8,
    params: DEFAULT_PARAMS,
    loopRate: 0.1,
    numColonies: 2,
    numFoodSources: 1,
    foodPerSource: 500,
    ...overrides,
  };
}

/** A 9x9 room with the nest and one food source a few cells apart, so round trips are quick. */
function room(): WorldSpec {
  const size = 9;
  const cells: CellType[][] = Array.from({ length: size }, (_, y) =>
    Array.from({ length: size }, (_, x) =>
      (x === 0 || y === 0 || x === size - 1 || y === size - 1 ? 0 : 1) as CellType));
  return {
    occupancy: new DenseGrid(cells),
    nests: [[1, 1], [7, 7], [7, 1], [1, 7]],
    createField: () => new DenseField(size, size),
  };
}

function refs(sim: Simulation, colony: number) {
  return Object.fromEntries([...sim.colonies[colony].doctrineRefs].sort((a, b) => a[0] - b[0]));
}

test("a fresh simulation runs the default doctrine at version 0 in every colony", () => {
  const sim = new Simulation(config());
  for (const colony of sim.colonies) {
    assert.deepEqual(colony.doctrine, DEFAULT_DOCTRINE);
    assert.equal(colony.doctrineVersion, 0);
    assert.deepEqual([...colony.doctrines.keys()], [0]);
    assert.ok(colony.ants.every(a => a.doctrineVersion === 0 && a.role === "forager"));
  }
  assert.deepEqual(refs(sim, 0), { 0: 8 });
  assert.equal(sim.adoption, "instant");
  assert.equal(sim.topology.read, "private");
});

test("under instant adoption a doctrine change re-stamps every ant at the tick boundary", () => {
  const sim = new Simulation(config());
  const d = cloneDoctrine(DEFAULT_DOCTRINE);
  d.forager.follow.searching.food.own = 7;
  sim.enqueue({ kind: "setDoctrine", colony: 1, doctrine: d });
  assert.equal(sim.colonies[1].doctrineVersion, 0, "not applied before the step");
  sim.step();
  const colony = sim.colonies[1];
  assert.equal(colony.doctrineVersion, 1);
  assert.equal(colony.doctrine.forager.follow.searching.food.own, 7);
  assert.ok(colony.ants.every(a => a.doctrineVersion === 1));
  assert.deepEqual([...colony.doctrines.keys()], [1], "the unreferenced old version is dropped");
  assert.deepEqual(refs(sim, 1), { 1: 8 });
  // Colony 0 is untouched.
  assert.equal(sim.colonies[0].doctrineVersion, 0);
  assert.deepEqual(sim.commandLog.map(c => c.cmd.kind), ["setDoctrine"]);
});

test("the stored doctrine is a copy, not the caller's object", () => {
  const sim = new Simulation(config());
  const d = cloneDoctrine(DEFAULT_DOCTRINE);
  sim.enqueue({ kind: "setDoctrine", colony: 0, doctrine: d });
  sim.step();
  d.evapRate = 0.9;
  assert.equal(sim.colonies[0].doctrine.evapRate, 0.005);
});

test("under nest adoption ants keep their doctrine until they come home", () => {
  const sim = new Simulation(config({ numColonies: 1 }), { world: room() });
  sim.enqueue({ kind: "setAdoption", mode: "nest" });
  sim.step();
  assert.equal(sim.adoption, "nest");

  const d = cloneDoctrine(DEFAULT_DOCTRINE);
  d.evapRate = 0.01;
  sim.enqueue({ kind: "setDoctrine", colony: 0, doctrine: d });
  sim.step();
  const colony = sim.colonies[0];
  assert.equal(colony.doctrineVersion, 1);
  assert.ok(colony.ants.every(a => a.doctrineVersion === 0), "nobody has been home yet");
  assert.deepEqual([...colony.doctrines.keys()], [0, 1]);
  assert.deepEqual(refs(sim, 0), { 0: 8, 1: 0 });

  // Run until the first ant delivers food; it adopts at that nest event.
  let adopted = 0;
  for (let i = 0; i < 6000 && adopted === 0; i++) {
    sim.step();
    adopted = colony.ants.filter(a => a.doctrineVersion === 1).length;
  }
  assert.ok(adopted > 0, "expected at least one ant to come home within 6000 ticks");
  assert.equal(colony.ants.filter(a => a.doctrineVersion === 0).length, 8 - adopted);
  assert.deepEqual([...colony.doctrines.keys()], [0, 1], "both versions live while ants hold both");
  assert.deepEqual(refs(sim, 0), { 0: 8 - adopted, 1: adopted });
});

test("setAntCount keeps the reference counts honest", () => {
  const sim = new Simulation(config({ numColonies: 1 }));
  sim.enqueue({ kind: "setAntCount", n: 12 });
  sim.step();
  assert.deepEqual(refs(sim, 0), { 0: 12 });
  assert.ok(sim.colonies[0].ants.every(a => a.doctrineVersion === 0));
  sim.enqueue({ kind: "setAntCount", n: 3 });
  sim.step();
  assert.deepEqual(refs(sim, 0), { 0: 3 });
});

test("a doctrine for a colony the run does not have is ignored", () => {
  const sim = new Simulation(config({ numColonies: 1 }));
  sim.enqueue({ kind: "setDoctrine", colony: 3, doctrine: DEFAULT_DOCTRINE });
  assert.doesNotThrow(() => sim.step());
  assert.equal(sim.colonies[0].doctrineVersion, 0);
});

test("setTopology stores a copy", () => {
  const sim = new Simulation(config());
  const t = { read: "private" as const, mimicEnemy: false, visible: { home: false, food: false }, maxMimicRate: 0.25, provenance: false };
  sim.enqueue({ kind: "setTopology", topology: t });
  sim.step();
  assert.equal(sim.topology.maxMimicRate, 0.25);
  t.maxMimicRate = 0.75;
  assert.equal(sim.topology.maxMimicRate, 0.25);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec tsx --test packages/sim-core/src/adoption.test.ts packages/sim-core/src/commands.test.ts`
Expected: FAIL — `doctrineRefs` undefined, `isCommand` returns false for the new kinds.

- [ ] **Step 3: Extend the types**

In `packages/sim-core/src/types.ts`, add at the top:

```ts
import type { Doctrine, Role } from "./doctrine";
```

Extend `Colony` (after `recentTrips`):

```ts
  /** The doctrine new arrivals adopt. Colony-level atoms take effect from here. */
  doctrine: Doctrine;
  /** Monotonic; incremented by every setDoctrine. */
  doctrineVersion: number;
  /** Every version some ant still holds, plus the current one. */
  doctrines: Map<number, Doctrine>;
  /** Ants holding each version. A version with no holders that is not current is dropped. */
  doctrineRefs: Map<number, number>;
```

Extend `Ant` (after `colonyId`):

```ts
  role: Role;
  /** Which of the colony's doctrines this ant runs. Re-stamped at the nest event. */
  doctrineVersion: number;
```

- [ ] **Step 4: Extend the commands**

In `packages/sim-core/src/commands.ts`, extend the imports:

```ts
import {
  MAX_ANTS_PER_COLONY, MAX_COLONIES, MAX_EVAP_RATE, MAX_FOOD_AMOUNT, MAX_TANK, MAX_TRAIL_POWER,
} from "./constants";
import { isHalfStep } from "./rng";
import { isDoctrine, type Doctrine, type AdoptionMode } from "./doctrine";
import { isTopology, type Topology } from "./topology";
import type { SimParams } from "./types";
```

Extend the `Command` union with three members after `moveManualAnt`:

```ts
  | { kind: "setDoctrine"; colony: number; doctrine: Doctrine }
  | { kind: "setAdoption"; mode: AdoptionMode }
  | { kind: "setTopology"; topology: Topology };
```

Add three cases to `isCommand` before `default`:

```ts
    case "setDoctrine":
      return isInt(c.colony) && c.colony >= 0 && c.colony < MAX_COLONIES && isDoctrine(c.doctrine);
    case "setAdoption":
      return c.mode === "instant" || c.mode === "nest";
    case "setTopology":
      return isTopology(c.topology);
```

- [ ] **Step 5: Store doctrine state in the simulation**

In `packages/sim-core/src/sim.ts`, extend the imports:

```ts
import { DEFAULT_DOCTRINE, cloneDoctrine, type AdoptionMode, type Doctrine } from "./doctrine";
import { DEFAULT_TOPOLOGY, cloneTopology, type Topology } from "./topology";
```

and remove `AntState` from the existing `import type { ... } from "./types"` list: the only use was the cast in `_spawnAnts`, which this task deletes, and `noUnusedLocals` fails the typecheck on an unused import.

Add two public fields after `gridVersion`:

```ts
  /** When a doctrine change reaches the ants. Set by the setAdoption command. */
  adoption: AdoptionMode = "instant";
  /** How layers are read and written across colonies. Set by the setTopology command. */
  topology: Topology = DEFAULT_TOPOLOGY;
```

Replace `_initColonies` and `_spawnAnts` with:

```ts
  private _initColonies(): Colony[] {
    return Array.from({ length: this.numColonies }, (_, id) => {
      const [nestX, nestY] = this.world.nests[id];
      this.occupancy.setOpen(nestX, nestY, true);
      const doctrine = cloneDoctrine(DEFAULT_DOCTRINE);
      const colony: Colony = {
        id,
        nestX,
        nestY,
        field: this.world.createField(),
        ants: [],
        foodCollected: 0,
        discoveredSources: new Set<number>(),
        recentTrips: [],
        doctrine,
        doctrineVersion: 0,
        doctrines: new Map([[0, doctrine]]),
        doctrineRefs: new Map([[0, 0]]),
      };
      colony.ants = Array.from({ length: this.numAnts }, () => this._newAnt(colony));
      return colony;
    });
  }

  /** A fresh ant at the nest, holding the colony's current doctrine. */
  private _newAnt(colony: Colony): Ant {
    const { px, py } = cellCenter(colony.nestX, colony.nestY);
    this._ref(colony, colony.doctrineVersion, +1);
    return {
      x: px, y: py,
      cx: colony.nestX, cy: colony.nestY,
      tx: colony.nestX, ty: colony.nestY,
      prevCx: colony.nestX, prevCy: colony.nestY,
      state: "searching",
      hasFood: false,
      tank: this.params.tankMax,
      colonyId: colony.id,
      stepsSinceNest: 0,
      lastSourceX: null,
      lastSourceY: null,
      role: "forager",
      doctrineVersion: colony.doctrineVersion,
    };
  }

  /**
   * Adjusts the holder count of one doctrine version. A version nobody holds
   * is dropped unless it is the current one, which the next arrival adopts.
   */
  private _ref(colony: Colony, version: number, delta: number) {
    const next = (colony.doctrineRefs.get(version) ?? 0) + delta;
    if (next <= 0 && version !== colony.doctrineVersion) {
      colony.doctrineRefs.delete(version);
      colony.doctrines.delete(version);
    } else {
      colony.doctrineRefs.set(version, next);
    }
  }

  /** Re-stamps an ant with the colony's current doctrine. The nest event. */
  private _adopt(ant: Ant, colony: Colony) {
    if (ant.doctrineVersion === colony.doctrineVersion) return;
    this._ref(colony, ant.doctrineVersion, -1);
    ant.doctrineVersion = colony.doctrineVersion;
    this._ref(colony, ant.doctrineVersion, +1);
  }

  /** The doctrine an ant is running, which under nest adoption need not be the colony's current one. */
  doctrineFor(ant: Ant, colony: Colony): Doctrine {
    return colony.doctrines.get(ant.doctrineVersion)!;
  }
```

Replace the body of `setAntCount` so it uses `_newAnt` and keeps the counts:

```ts
  setAntCount(n: number) {
    for (const colony of this.colonies) {
      if (n > colony.ants.length) {
        const toAdd = n - colony.ants.length;
        for (let i = 0; i < toAdd; i++) colony.ants.push(this._newAnt(colony));
      } else if (n < colony.ants.length) {
        const removed = colony.ants.splice(n);
        for (const ant of removed) this._ref(colony, ant.doctrineVersion, -1);
      }
    }
    this.numAnts = n;
    this._reindexManualAnt();
  }
```

Add three cases to `apply`:

```ts
      case "setDoctrine":   this._applySetDoctrine(cmd.colony, cmd.doctrine); break;
      case "setAdoption":   this.adoption = cmd.mode; break;
      case "setTopology":   this.topology = cloneTopology(cmd.topology); break;
```

Add the handler after `_applySetFood`:

```ts
  private _applySetDoctrine(index: number, doctrine: Doctrine) {
    const colony = this.colonies[index];
    if (!colony) return;
    const previous = colony.doctrineVersion;
    const version = previous + 1;
    const copy = cloneDoctrine(doctrine);
    colony.doctrines.set(version, copy);
    colony.doctrineRefs.set(version, 0);
    colony.doctrine = copy;
    colony.doctrineVersion = version;
    if (this.adoption === "instant") {
      for (const ant of colony.ants) this._adopt(ant, colony);
    }
    // A colony with no ants, or one whose ants all re-stamped, has no holder
    // of the previous version left; _adopt drops it as the last holder leaves,
    // and this covers the case where there was no holder to begin with.
    if ((colony.doctrineRefs.get(previous) ?? 0) <= 0) {
      colony.doctrineRefs.delete(previous);
      colony.doctrines.delete(previous);
    }
  }
```

In `_moveAnt`, inside the nest-arrival block (the `if (ant.state === "returning" && ant.cx === colony.nestX ...)` branch), add one line immediately after `ant.state = "searching";`:

```ts
      this._adopt(ant, colony);
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm exec tsx --test packages/sim-core/src/adoption.test.ts packages/sim-core/src/commands.test.ts`
Expected: PASS.

- [ ] **Step 7: Run the full suite and commit**

Run: `pnpm test`
Expected: PASS, including the golden trace: nothing about physics changed, and the default doctrine's numbers are not yet read anywhere.

```bash
git add packages/sim-core/src/types.ts packages/sim-core/src/commands.ts packages/sim-core/src/sim.ts packages/sim-core/src/commands.test.ts packages/sim-core/src/adoption.test.ts
git commit -m "Store per-colony doctrines with per-ant adoption

Each colony holds its current doctrine, a version counter, and the map
of versions its ants still reference. setDoctrine replaces the current
doctrine at the tick boundary; under instant adoption every ant is
re-stamped there, under nest adoption an ant re-stamps when it arrives
home. setAdoption and setTopology are stored the same way. Nothing reads
the doctrine yet.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Scoring from the doctrine table, odor in place of beacons — **sonnet + adversarial review**

Implements spec "The substrate" (odor, reads) and "Scoring, laying, and roles" (the score). Behaviour changes, so this task bumps `SIM_VERSION` and regenerates the golden. The reviewer's brief: check bit-equivalence with the old rule under the default doctrine, that exactly one RNG draw is spent per decision, that no `Math.pow` entered, and that odor never leaks across colonies.

**Files:**
- Create: `packages/sim-core/src/score.ts`
- Create: `packages/sim-core/src/score.test.ts`
- Modify: `packages/sim-core/src/constants.ts` (odor constants, comment)
- Modify: `packages/sim-core/src/sim.ts` (delete `powerChoice`, `_seedNest`, re-seeding; decay from doctrine; choose via `chooseNext`)
- Modify: `packages/sim-core/src/index.ts`
- Modify: `packages/sim-trace/src/trace.ts` (`SIM_VERSION`)
- Regenerate: `packages/sim-trace/src/fixtures/golden.trace.json`

**Interfaces:**
- Consumes: `Colony.field`, `Colony.doctrine`, `Simulation.doctrineFor`, `Simulation.topology` (task 3); `RoleTable`, `DOCTRINE_CHANNELS` (task 1).
- Produces: `ODOR_LEVEL = 1000`, `NEST_HALO = 0.85`; `ReadContext { colonies, foodSources, topology }`; `STATE_CHANNEL`; `readPair(ctx, colony, ch, cx, cy): [own, enemy]`; `odor(colony, foodSources, state, cx, cy): number`; `scoreCell(ctx, colony, table, state, cx, cy): number`; `chooseNext(ctx, colony, table, state, cells, rng): [x, y]`. `Simulation` satisfies `ReadContext` structurally.

- [ ] **Step 1: Write the failing tests**

Create `packages/sim-core/src/score.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  Simulation, DEFAULT_PARAMS, DEFAULT_DOCTRINE, ODOR_LEVEL, NEST_HALO,
  TOPOLOGY_OPEN, TOPOLOGY_SENSING, cloneDoctrine, deterministicPow, makeRng, makeSeeds,
} from "./index";
import { STATE_CHANNEL, chooseNext, odor, readPair, scoreCell } from "./score";
import type { RunConfig } from "./index";

function config(overrides: Partial<RunConfig> = {}): RunConfig {
  return {
    seeds: makeSeeds("score-test"),
    numAnts: 20,
    params: DEFAULT_PARAMS,
    loopRate: 0.1,
    numColonies: 2,
    numFoodSources: 2,
    foodPerSource: 500,
    ...overrides,
  };
}

/** An open cell at least two steps from every nest and not a food source: no odor lands there. */
function plainCell(sim: Simulation): [number, number] {
  for (let y = 2; y < sim.bounds.rows - 2; y++) {
    for (let x = 2; x < sim.bounds.cols - 2; x++) {
      if (!sim.occupancy.isOpen(x, y)) continue;
      if (sim.colonies.some(c => Math.abs(c.nestX - x) + Math.abs(c.nestY - y) <= 1)) continue;
      if (sim.foodSources.some(s => s.x === x && s.y === y)) continue;
      return [x, y];
    }
  }
  throw new Error("no plain cell");
}

/** The rule this generalises: (trail + 1) ^ power over one channel of the colony's own field. */
const legacy = (value: number, power: number) => deterministicPow(value + 1, power);

test("with the default doctrine and a private field the score is the old rule bit for bit", () => {
  const sim = new Simulation(config());
  const colony = sim.colonies[0];
  const [x, y] = plainCell(sim);
  for (const v of [0, 0.5, 1, 61, 123.456, 1000, 5000]) {
    colony.field.set("food", x, y, v);
    colony.field.set("home", x, y, v * 0.37);
    const searching = scoreCell(sim, colony, DEFAULT_DOCTRINE.forager, "searching", x, y);
    assert.ok(Object.is(searching, legacy(colony.field.get("food", x, y), 5)), `searching at ${v}`);
    const returning = scoreCell(sim, colony, DEFAULT_DOCTRINE.forager, "returning", x, y);
    assert.ok(Object.is(returning, legacy(colony.field.get("home", x, y), 5)), `returning at ${v}`);
  }
});

test("a negative exponent repels", () => {
  const sim = new Simulation(config());
  const colony = sim.colonies[0];
  const [x, y] = plainCell(sim);
  const table = cloneDoctrine(DEFAULT_DOCTRINE).forager;
  table.follow.searching.food.own = -2;
  colony.field.set("food", x, y, 99);
  assert.equal(scoreCell(sim, colony, table, "searching", x, y), 1 / (100 * 100));
});

test("searching ants steer by food and returning ants by home", () => {
  assert.equal(STATE_CHANNEL.searching, "food");
  assert.equal(STATE_CHANNEL.returning, "home");
});

test("nest odor is private to the colony and haloed to its neighbours", () => {
  const sim = new Simulation(config());
  const [a, b] = sim.colonies;
  assert.equal(odor(a, sim.foodSources, "returning", a.nestX, a.nestY), ODOR_LEVEL);
  assert.equal(odor(a, sim.foodSources, "returning", a.nestX + 1, a.nestY), ODOR_LEVEL * NEST_HALO);
  assert.equal(odor(a, sim.foodSources, "returning", a.nestX + 1, a.nestY + 1), 0, "diagonals are not neighbours");
  assert.equal(odor(a, sim.foodSources, "returning", a.nestX + 2, a.nestY), 0);
  assert.equal(odor(b, sim.foodSources, "returning", a.nestX, a.nestY), 0, "another colony's nest has no smell");
  assert.equal(odor(a, sim.foodSources, "searching", a.nestX, a.nestY), 0, "a searching ant does not smell home");
});

test("food odor is on a live source and gone when it is empty", () => {
  const sim = new Simulation(config());
  const src = sim.foodSources[0];
  const colony = sim.colonies[0];
  assert.equal(odor(colony, sim.foodSources, "searching", src.x, src.y), ODOR_LEVEL);
  assert.equal(odor(colony, sim.foodSources, "searching", src.x + 1, src.y), 0, "no halo on food");
  assert.equal(odor(colony, sim.foodSources, "returning", src.x, src.y), 0, "a returning ant does not smell food");
  src.remaining = 0;
  assert.equal(odor(colony, sim.foodSources, "searching", src.x, src.y), 0);
});

test("odor enters the read, so it pulls regardless of trail strength", () => {
  const sim = new Simulation(config());
  const colony = sim.colonies[0];
  const nest = scoreCell(sim, colony, DEFAULT_DOCTRINE.forager, "returning", colony.nestX, colony.nestY);
  assert.ok(Object.is(nest, legacy(ODOR_LEVEL, 5)));
});

test("readPair follows the topology's read mode and visibility", () => {
  const sim = new Simulation(config());
  const [a, b] = sim.colonies;
  const [x, y] = plainCell(sim);
  a.field.set("food", x, y, 10);
  b.field.set("food", x, y, 3);
  a.field.set("home", x, y, 7);
  b.field.set("home", x, y, 2);

  assert.deepEqual(readPair(sim, a, "food", x, y), [10, 0], "private: own only");

  sim.topology = TOPOLOGY_SENSING;
  assert.deepEqual(readPair(sim, a, "food", x, y), [10, 3], "separable: own and the others' sum");
  assert.deepEqual(readPair(sim, b, "home", x, y), [2, 7]);

  sim.topology = TOPOLOGY_OPEN;
  assert.deepEqual(readPair(sim, a, "food", x, y), [13, 0], "shared: one sum, no origin");
  assert.deepEqual(readPair(sim, a, "home", x, y), [7, 0], "home is invisible under the open option");
});

test("chooseNext spends exactly one draw and returns a candidate", () => {
  const sim = new Simulation(config());
  const colony = sim.colonies[0];
  const [x, y] = plainCell(sim);
  const cells: [number, number][] = [[x, y], [x + 1, y], [x, y + 1]];
  const rng = makeRng("choose");
  const before = rng.draws;
  const next = chooseNext(sim, colony, DEFAULT_DOCTRINE.forager, "searching", cells, rng);
  assert.equal(rng.draws - before, 1);
  assert.ok(cells.some(([cx, cy]) => cx === next[0] && cy === next[1]));
});

test("the nest and food cells are no longer written into the field", () => {
  const sim = new Simulation(config({ numColonies: 1 }));
  const colony = sim.colonies[0];
  sim.step();
  assert.equal(colony.field.get("home", colony.nestX, colony.nestY), 0, "no ant has left the nest yet, so nothing is there");
  // At the first pickup the old engine set the source cell to 1000 food
  // pheromone; nothing has returned through it yet, so it now reads zero.
  let carrier = null as null | { lastSourceX: number | null; lastSourceY: number | null };
  for (let i = 0; i < 4000 && carrier === null; i++) {
    sim.step();
    carrier = colony.ants.find(a => a.hasFood) ?? null;
  }
  assert.ok(carrier && carrier.lastSourceX !== null && carrier.lastSourceY !== null, "expected a pickup within 4000 ticks");
  assert.equal(colony.field.get("food", carrier.lastSourceX, carrier.lastSourceY), 0);
});

test("each colony's layer decays at its own doctrine's rate", () => {
  const sim = new Simulation(config());
  const [a, b] = sim.colonies;
  const still = cloneDoctrine(DEFAULT_DOCTRINE);
  still.evapRate = 0;
  const fast = cloneDoctrine(DEFAULT_DOCTRINE);
  fast.evapRate = 0.5;
  sim.enqueue({ kind: "setDoctrine", colony: 0, doctrine: still });
  sim.enqueue({ kind: "setDoctrine", colony: 1, doctrine: fast });
  sim.step();
  const [x, y] = plainCell(sim);
  a.field.set("food", x, y, 100);
  b.field.set("food", x, y, 100);
  sim.step();
  assert.equal(a.field.get("food", x, y), 100);
  assert.equal(b.field.get("food", x, y), 50);
});

test("ants still collect food within 4000 steps", () => {
  const sim = new Simulation(config({ numColonies: 1 }));
  for (let i = 0; i < 4000; i++) sim.step();
  assert.ok(sim.totalFoodCollected > 0, `expected foraging, got ${sim.totalFoodCollected}`);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec tsx --test packages/sim-core/src/score.test.ts`
Expected: FAIL — cannot find module `./score`.

- [ ] **Step 3: Add the odor constants**

In `packages/sim-core/src/constants.ts`, add after the `DEPOSIT_RATE` line:

```ts

// ─── Odor (computed at read time, never stored) ─────────────────────────────
/** What a returning ant reads on its own nest cell, and a searching ant on a live food cell. */
export const ODOR_LEVEL = 1000;
/** Fraction of ODOR_LEVEL on the nest's four orthogonal neighbours. */
export const NEST_HALO = 0.85;
```

and in the comment above `MAX_TRAIL_POWER`, replace `powerChoice's scores` with `scoreCell's products`.

- [ ] **Step 4: Write `score.ts`**

Create `packages/sim-core/src/score.ts`:

```ts
import { NEST_HALO, ODOR_LEVEL } from "./constants";
import { DOCTRINE_CHANNELS, type DoctrineChannel, type RoleTable } from "./doctrine";
import { deterministicPow, type Rng } from "./rng";
import type { Topology } from "./topology";
import type { AntState, Colony, FoodSource } from "./types";

/** What a read needs to know about the world. Simulation satisfies this. */
export interface ReadContext {
  readonly colonies: readonly Colony[];
  readonly foodSources: readonly FoodSource[];
  readonly topology: Topology;
}

/** The channel a state steers by: searching ants follow food, returning ants follow home. */
export const STATE_CHANNEL: Record<AntState, DoctrineChannel> = { searching: "food", returning: "home" };

/**
 * The (own, enemy) pair an ant of `colony` reads on one channel at one cell.
 * Under `private` the enemy is zero; under `shared` every layer is summed
 * into own and the origin axis collapses; under `separable` the others' sum
 * is reported apart. An invisible channel is private under every mode.
 */
export function readPair(
  ctx: ReadContext, colony: Colony, ch: DoctrineChannel, cx: number, cy: number,
): [number, number] {
  const own = colony.field.get(ch, cx, cy);
  const { read, visible } = ctx.topology;
  if (read === "private" || !visible[ch]) return [own, 0];
  let others = 0;
  for (const other of ctx.colonies) {
    if (other !== colony) others += other.field.get(ch, cx, cy);
  }
  return read === "shared" ? [own + others, 0] : [own, others];
}

/**
 * Nest and food as smells rather than stored pheromone: a pure function of
 * world state, private to the colony by construction for the nest, and not
 * something any ant can lay or any evaporation can erase.
 */
export function odor(
  colony: Colony, foodSources: readonly FoodSource[], state: AntState, cx: number, cy: number,
): number {
  if (state === "returning") {
    const d = Math.abs(cx - colony.nestX) + Math.abs(cy - colony.nestY);
    if (d === 0) return ODOR_LEVEL;
    if (d === 1) return ODOR_LEVEL * NEST_HALO;
    return 0;
  }
  for (const src of foodSources) {
    if (src.x === cx && src.y === cy && src.remaining > 0) return ODOR_LEVEL;
  }
  return 0;
}

/**
 * Product over (channel, origin) of (read + 1) ^ follow. A zero exponent is
 * skipped rather than computed, so the default doctrine costs one
 * deterministicPow per candidate, as the single exponent did. Odor is added
 * inside the read of the steering channel: outside the power it would lose to
 * any strong trail, and the beacon it replaces never did.
 */
export function scoreCell(
  ctx: ReadContext, colony: Colony, table: RoleTable, state: AntState, cx: number, cy: number,
): number {
  let score = 1;
  const row = table.follow[state];
  const steer = STATE_CHANNEL[state];
  for (const ch of DOCTRINE_CHANNELS) {
    const w = row[ch];
    if (w.own === 0 && w.enemy === 0) continue;
    const pair = readPair(ctx, colony, ch, cx, cy);
    const own = ch === steer ? pair[0] + odor(colony, ctx.foodSources, state, cx, cy) : pair[0];
    if (w.own !== 0) score *= deterministicPow(own + 1, w.own);
    if (w.enemy !== 0) score *= deterministicPow(pair[1] + 1, w.enemy);
  }
  return score;
}

/** The roulette wheel, unchanged: one draw, weighted by score. */
export function chooseNext(
  ctx: ReadContext, colony: Colony, table: RoleTable, state: AntState,
  cells: [number, number][], rng: Rng,
): [number, number] {
  const scores = cells.map(([cx, cy]) => scoreCell(ctx, colony, table, state, cx, cy));
  const total = scores.reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (let i = 0; i < cells.length; i++) { r -= scores[i]; if (r <= 0) return cells[i]; }
  return cells[cells.length - 1];
}
```

Add to `packages/sim-core/src/index.ts`, after the `./topology` line:

```ts
export * from "./score";
```

- [ ] **Step 5: Switch the simulation over**

In `packages/sim-core/src/sim.ts`:

Replace the import block at the top with exactly:

```ts
import {
  CELL, V, ARRIVE_THRESH, DEPOSIT_RATE,
  DIRS4, TRIP_WINDOW,
} from "./constants";
import type {
  Ant, Colony, FoodSource, Occupancy, SimParams,
  SimulationOptions, WorldSpec,
} from "./types";
import type { RunConfig } from "./types";
import { inBounds } from "./world";
import { mazeWorld } from "./maze";
import { makeRng, shuffleInPlace, type Rng } from "./rng";
import type { Command, TimedCommand } from "./commands";
import { fingerprint, FINGERPRINT_INTERVAL } from "./fingerprint";
import { DEFAULT_DOCTRINE, cloneDoctrine, type AdoptionMode, type Doctrine } from "./doctrine";
import { DEFAULT_TOPOLOGY, cloneTopology, type Topology } from "./topology";
import { chooseNext } from "./score";
```

Delete the exported `powerChoice` function entirely.

Delete the `_seedNest` method entirely, and the line in the constructor that calls it (`for (const colony of this.colonies) this._seedNest(colony);`).

Replace the body of `step()` with:

```ts
  step() {
    this.tick++;
    this._runCommandsFor(this.tick);

    for (const colony of this.colonies) {
      colony.field.decay(1 - colony.doctrine.evapRate);
      for (const ant of colony.ants) this._moveAnt(ant, colony);
    }

    if (this.tick % FINGERPRINT_INTERVAL === 0) {
      this.fingerprints.push({ t: this.tick, h: fingerprint(this) });
    }
  }
```

In `_moveAnt`, in the food-pickup block, delete the line `colony.field.set("food", src.x, src.y, NEST_SEED);`.

In `_moveAnt`, replace the final choice — the `const ch: Channel = ...` line and the `powerChoice(...)` call — with:

```ts
    const table = this.doctrineFor(ant, colony)[ant.role];
    const next = chooseNext(this, colony, table, ant.state, candidates, this.antsRng);
```

Also delete the now-unused destructuring of `trailPower` at the top of `_moveAnt`: change `const { tankMax, trailPower } = this.params;` to `const { tankMax } = this.params;`.

- [ ] **Step 6: Bump the simulation version and regenerate the golden**

In `packages/sim-trace/src/trace.ts` change `export const SIM_VERSION = 2;` to `export const SIM_VERSION = 3;`.

Run: `pnpm golden`
Expected: `wrote .../golden.trace.json: 2200 ticks, 5 commands, ...`.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm exec tsx --test packages/sim-core/src/score.test.ts`
Expected: PASS, 11 tests.

Run: `pnpm test`
Expected: PASS. If `golden.test.ts` fails, the regeneration in step 6 did not run; if `equivalence.test.ts` fails, a read went through something other than `FieldSet.get`.

- [ ] **Step 8: Commit**

```bash
git add packages/sim-core/src/score.ts packages/sim-core/src/score.test.ts packages/sim-core/src/constants.ts packages/sim-core/src/sim.ts packages/sim-core/src/index.ts packages/sim-trace/src/trace.ts packages/sim-trace/src/fixtures/golden.trace.json
git commit -m "Score moves from the doctrine table and smell the nest and food

The response side becomes a product over (channel, origin) of
(read + 1) ^ follow, read through the topology's mode, with the default
doctrine reproducing the old rule bit for bit. Nest and food stop being
written into the field as 1000-level beacons: they are odor, computed
at read time and private to the colony. Each layer decays at its own
doctrine's rate. SIM_VERSION 3, golden regenerated.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Laying from the doctrine table, and roles — **sonnet + adversarial review**

Implements spec "Scoring, laying, and roles" (laying, roles, the state machine). Behaviour changes (the cautionary deposit goes away, lay gains apply), so the golden is regenerated. Reviewer's brief: confirm three deposits per cell, that the tank drains identically on every path, that mimic deposits land where the topology says and nowhere else, that role assignment spends no RNG draw, and that the instant re-stamp also re-roles.

**Files:**
- Modify: `packages/sim-core/src/constants.ts` (`DEPOSITS_PER_CELL`)
- Modify: `packages/sim-core/src/sim.ts` (`_lay`, `_depositMimic`, `_roleFor`, nest event, ant loop index, instant re-role)
- Create: `packages/sim-core/src/lay.test.ts`
- Regenerate: `packages/sim-trace/src/fixtures/golden.trace.json`

**Interfaces:**
- Consumes: `doctrineFor`, `topology` (tasks 3, 4); `DOCTRINE_CHANNELS`, `Role`, `DoctrineChannel` (task 1); `TOPOLOGY_MIMICRY`, `TOPOLOGY_OPEN` (task 2).
- Produces: `DEPOSITS_PER_CELL = 3`; `Ant.role` now assigned by index at spawn, at the nest event, and on an instant re-stamp; `_newAnt(colony, index, total)`; `_moveAnt(ant, colony, index)`.

- [ ] **Step 1: Write the failing tests**

Create `packages/sim-core/src/lay.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  Simulation, DEFAULT_PARAMS, DEFAULT_DOCTRINE, DEPOSIT_RATE, DEPOSITS_PER_CELL,
  TOPOLOGY_MIMICRY, TOPOLOGY_OPEN, cloneDoctrine, makeSeeds,
} from "./index";
import type { Doctrine, RunConfig } from "./index";

function config(overrides: Partial<RunConfig> = {}): RunConfig {
  return {
    seeds: makeSeeds("lay-test"),
    numAnts: 1,
    params: DEFAULT_PARAMS,
    loopRate: 0.1,
    numColonies: 2,
    numFoodSources: 1,
    foodPerSource: 500,
    ...overrides,
  };
}

/** A doctrine that never evaporates, so deposits can be counted exactly. */
function still(edit: (d: Doctrine) => void = () => {}): Doctrine {
  const d = cloneDoctrine(DEFAULT_DOCTRINE);
  d.evapRate = 0;
  edit(d);
  return d;
}

/** Applies a doctrine to every colony before the first step. */
function start(sim: Simulation, doctrine: Doctrine) {
  for (const colony of sim.colonies) sim.enqueue({ kind: "setDoctrine", colony: colony.id, doctrine });
  sim.flushPending();
}

test("an ant deposits three times into the cell it leaves", () => {
  const sim = new Simulation(config());
  start(sim, still());
  const colony = sim.colonies[0];
  // Tick 1 chooses a target; ticks 2, 3, 4 transit at distances 16, 12, 8 and
  // deposit; tick 5 arrives at distance 4 without depositing.
  for (let i = 0; i < 5; i++) sim.step();
  assert.equal(DEPOSITS_PER_CELL, 3);
  assert.equal(colony.field.get("home", colony.nestX, colony.nestY), DEPOSITS_PER_CELL * DEPOSIT_RATE);
  assert.equal(colony.field.get("food", colony.nestX, colony.nestY), 0, "a searching ant lays home, not food");
});

test("a lay gain scales the deposit", () => {
  const sim = new Simulation(config());
  start(sim, still(d => { d.forager.lay.searching.home.own = 2; }));
  const colony = sim.colonies[0];
  for (let i = 0; i < 5; i++) sim.step();
  assert.equal(colony.field.get("home", colony.nestX, colony.nestY), 3 * 2 * DEPOSIT_RATE);
});

test("a zero lay gain stops laying", () => {
  const sim = new Simulation(config());
  start(sim, still(d => { d.forager.lay.searching.home.own = 0; }));
  const colony = sim.colonies[0];
  for (let i = 0; i < 5; i++) sim.step();
  assert.equal(colony.field.get("home", colony.nestX, colony.nestY), 0);
});

test("the tank drains by what was laid and stops deposits at zero", () => {
  const sim = new Simulation(config({ params: { ...DEFAULT_PARAMS, tankMax: 50 } }));
  start(sim, still());
  const colony = sim.colonies[0];
  const ant = colony.ants[0];
  for (let i = 0; i < 5; i++) sim.step();
  // 20, 20, then the remaining 10.
  assert.equal(colony.field.get("home", colony.nestX, colony.nestY), 50);
  assert.equal(ant.tank, 0);
  const next: [number, number] = [ant.cx, ant.cy];
  for (let i = 0; i < 4; i++) sim.step();
  assert.equal(colony.field.get("home", next[0], next[1]), 0, "an empty tank lays nothing");
});

test("spoilers are the first floor(fraction * total) ants by index", () => {
  const sim = new Simulation(config({ numAnts: 8, numColonies: 1 }));
  start(sim, still(d => { d.spoilerFraction = 0.25; }));
  assert.deepEqual(sim.colonies[0].ants.map(a => a.role),
    ["spoiler", "spoiler", "forager", "forager", "forager", "forager", "forager", "forager"]);
  // Under instant adoption a fraction change re-roles at the tick boundary.
  sim.enqueue({ kind: "setDoctrine", colony: 0, doctrine: still(d => { d.spoilerFraction = 0.5; }) });
  sim.step();
  assert.equal(sim.colonies[0].ants.filter(a => a.role === "spoiler").length, 4);
});

test("under nest adoption a role change waits for the nest event", () => {
  const sim = new Simulation(config({ numAnts: 8, numColonies: 1 }));
  sim.enqueue({ kind: "setAdoption", mode: "nest" });
  sim.enqueue({ kind: "setDoctrine", colony: 0, doctrine: still(d => { d.spoilerFraction = 0.5; }) });
  sim.step();
  assert.ok(sim.colonies[0].ants.every(a => a.role === "forager"), "nobody has been home");
});

test("setAntCount roles new ants against the new total", () => {
  const sim = new Simulation(config({ numAnts: 4, numColonies: 1 }));
  start(sim, still(d => { d.spoilerFraction = 0.5; }));
  assert.deepEqual(sim.colonies[0].ants.map(a => a.role), ["spoiler", "spoiler", "forager", "forager"]);
  sim.enqueue({ kind: "setAntCount", n: 8 });
  sim.step();
  // Existing ants keep their roles; ants 4..7 sit above floor(0.5 * 8) = 4.
  assert.deepEqual(sim.colonies[0].ants.map(a => a.role),
    ["spoiler", "spoiler", "forager", "forager", "forager", "forager", "forager", "forager"]);
});

/** Everyone is a spoiler laying only mimic food while searching. */
function allSpoilers(mimicRate: number): Doctrine {
  return still(d => {
    d.spoilerFraction = 1;
    d.mimicRate = mimicRate;
  });
}

test("a mimic deposit charges the tank but lands nowhere under the private topology", () => {
  const sim = new Simulation(config());
  start(sim, allSpoilers(0.5));
  const [a, b] = sim.colonies;
  for (let i = 0; i < 5; i++) sim.step();
  assert.equal(a.ants[0].tank, DEFAULT_PARAMS.tankMax - 3 * 0.5 * DEPOSIT_RATE);
  assert.equal(a.field.get("food", a.nestX, a.nestY), 0);
  assert.equal(b.field.get("food", a.nestX, a.nestY), 0);
});

test("under separable mimicry the deposit lands in the other colony's layer", () => {
  const sim = new Simulation(config());
  sim.topology = TOPOLOGY_MIMICRY; // maxMimicRate 0.5; the validator does not admit this yet
  start(sim, allSpoilers(0.5));
  const [a, b] = sim.colonies;
  for (let i = 0; i < 5; i++) sim.step();
  assert.equal(b.field.get("food", a.nestX, a.nestY), 3 * 0.5 * DEPOSIT_RATE);
  assert.equal(a.field.get("food", a.nestX, a.nestY), 0);
});

test("under the open topology the deposit lands in the spoiler's own layer", () => {
  const sim = new Simulation(config());
  sim.topology = TOPOLOGY_OPEN;
  start(sim, allSpoilers(0.5));
  const [a, b] = sim.colonies;
  for (let i = 0; i < 5; i++) sim.step();
  assert.equal(a.field.get("food", a.nestX, a.nestY), 3 * 0.5 * DEPOSIT_RATE);
  assert.equal(b.field.get("food", a.nestX, a.nestY), 0);
});

test("the topology's cap clamps the mimic rate", () => {
  const sim = new Simulation(config());
  sim.topology = { ...TOPOLOGY_MIMICRY, visible: { ...TOPOLOGY_MIMICRY.visible }, maxMimicRate: 0.25 };
  start(sim, allSpoilers(1));
  const [a, b] = sim.colonies;
  for (let i = 0; i < 5; i++) sim.step();
  assert.equal(b.field.get("food", a.nestX, a.nestY), 3 * 0.25 * DEPOSIT_RATE);
});

test("with three colonies a mimic deposit is split between the other two", () => {
  const sim = new Simulation(config({ numColonies: 3 }));
  sim.topology = TOPOLOGY_MIMICRY;
  start(sim, allSpoilers(0.5));
  const [a, b, c] = sim.colonies;
  for (let i = 0; i < 5; i++) sim.step();
  assert.equal(b.field.get("food", a.nestX, a.nestY), 3 * 0.5 * DEPOSIT_RATE / 2);
  assert.equal(c.field.get("food", a.nestX, a.nestY), 3 * 0.5 * DEPOSIT_RATE / 2);
});

test("role assignment spends no random draws", () => {
  const a = new Simulation(config({ numAnts: 8, numColonies: 1 }));
  const b = new Simulation(config({ numAnts: 8, numColonies: 1 }));
  start(a, still());
  start(b, still(d => { d.spoilerFraction = 0.5; }));
  assert.equal(a.antsDraws, b.antsDraws);
  a.step(); b.step();
  assert.equal(a.antsDraws, b.antsDraws);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec tsx --test packages/sim-core/src/lay.test.ts`
Expected: FAIL — `DEPOSITS_PER_CELL` is not exported; role assertions fail.

- [ ] **Step 3: Add the constant**

In `packages/sim-core/src/constants.ts`, after `DEPOSIT_RATE`:

```ts
/**
 * Transit frames that deposit per cell: distances 16, 12, 8 deposit and 4 is
 * within ARRIVE_THRESH. The old gland label used CELL / V = 4 and overstated
 * trail reach by a third.
 */
export const DEPOSITS_PER_CELL = 3;
```

- [ ] **Step 4: Rewrite laying and add roles in `sim.ts`**

Extend the doctrine import to:

```ts
import {
  DEFAULT_DOCTRINE, DOCTRINE_CHANNELS, cloneDoctrine,
  type AdoptionMode, type Doctrine, type DoctrineChannel, type Role,
} from "./doctrine";
```

Change `_newAnt` to take an index and a total, and to assign the role:

```ts
  /** A fresh ant at the nest, holding the colony's current doctrine, roled by index. */
  private _newAnt(colony: Colony, index: number, total: number): Ant {
```

and inside it replace `role: "forager",` with `role: this._roleFor(colony, index, total),`.

Add after `_newAnt`:

```ts
  /** Spoilers are the first floor(fraction * total) ants by index. No draw is spent. */
  private _roleFor(colony: Colony, index: number, total: number): Role {
    return index < Math.floor(colony.doctrine.spoilerFraction * total) ? "spoiler" : "forager";
  }

  /** The nest event: adopt the current doctrine and take the role the index implies. */
  private _nestEvent(ant: Ant, colony: Colony, index: number) {
    this._adopt(ant, colony);
    ant.role = this._roleFor(colony, index, colony.ants.length);
  }
```

In `_initColonies`, change the ant construction to pass index and total:

```ts
      colony.ants = Array.from({ length: this.numAnts }, (_, i) => this._newAnt(colony, i, this.numAnts));
```

In `setAntCount`, change the growth loop to:

```ts
        for (let i = colony.ants.length; i < n; i++) colony.ants.push(this._newAnt(colony, i, n));
```

In `_applySetDoctrine`, replace the instant loop with:

```ts
    if (this.adoption === "instant") {
      colony.ants.forEach((ant, i) => {
        this._adopt(ant, colony);
        ant.role = this._roleFor(colony, i, colony.ants.length);
      });
    }
```

In `step()`, pass the index:

```ts
      for (let i = 0; i < colony.ants.length; i++) this._moveAnt(colony.ants[i], colony, i);
```

Change the signature to `private _moveAnt(ant: Ant, colony: Colony, index: number) {` and, in the nest-arrival block, replace `this._adopt(ant, colony);` with `this._nestEvent(ant, colony, index);`.

Replace the transit block at the top of `_moveAnt` (from `if (dist > ARRIVE_THRESH) {` to its closing `return; }`) with:

```ts
    if (dist > ARRIVE_THRESH) {
      this._lay(ant, colony);
      const scale = V / dist;
      ant.x += dx * scale;
      ant.y += dy * scale;
      return;
    }
```

Add the two methods after `_nestEvent`:

```ts
  /**
   * Deposits into the cell being left, once per transit frame. Channels go in
   * a fixed order — home then food, own then mimic — so the tank drains the
   * same way on every engine. Mimicry costs foraging deposition: both draw
   * on one tank and both stop when it is empty.
   */
  private _lay(ant: Ant, colony: Colony) {
    if (ant.tank <= 0) return;
    const doctrine = this.doctrineFor(ant, colony);
    const row = doctrine[ant.role].lay[ant.state];
    const mimicRate = Math.min(doctrine.mimicRate, this.topology.maxMimicRate);
    for (const ch of DOCTRINE_CHANNELS) {
      const entry = row[ch];
      if (entry.own > 0 && ant.tank > 0) {
        const amount = Math.min(ant.tank, entry.own * DEPOSIT_RATE);
        colony.field.add(ch, ant.cx, ant.cy, amount);
        ant.tank -= amount;
      }
      if (entry.mimic === 1 && ant.tank > 0) {
        const amount = Math.min(ant.tank, mimicRate * DEPOSIT_RATE);
        if (amount > 0) {
          this._depositMimic(colony, ch, ant.cx, ant.cy, amount);
          ant.tank -= amount;
        }
      }
    }
  }

  /**
   * Where a mimic deposit lands is the topology's call; the tank is charged
   * either way. Under `shared` there is one chemical, so mimicking it is laying
   * it. With more than two colonies the amount is split equally.
   */
  private _depositMimic(colony: Colony, ch: DoctrineChannel, cx: number, cy: number, amount: number) {
    const { read, mimicEnemy } = this.topology;
    if (!mimicEnemy || read === "private") return;
    if (read === "shared") { colony.field.add(ch, cx, cy, amount); return; }
    const others = this.colonies.filter(c => c !== colony);
    if (others.length === 0) return;
    const share = amount / others.length;
    for (const other of others) other.field.add(ch, cx, cy, share);
  }
```

In `_moveAnt`, the destructuring `const { tankMax } = this.params;` stays: `tankMax` is still used at pickup and at the nest.

- [ ] **Step 5: Regenerate the golden and run everything**

Run: `pnpm golden`
Run: `pnpm exec tsx --test packages/sim-core/src/lay.test.ts`
Expected: PASS, 13 tests.

Run: `pnpm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/sim-core/src/constants.ts packages/sim-core/src/sim.ts packages/sim-core/src/lay.test.ts packages/sim-trace/src/fixtures/golden.trace.json
git commit -m "Lay from the doctrine table and role ants by index

Deposits follow the ant's role and state through the lay table: own
gains scale DEPOSIT_RATE, a mimic flag lays the opponent's chemical
where the topology allows, and one tank pays for both. Spoilers are the
first floor(fraction * total) ants, assigned at spawn, at the nest
event, and on an instant re-stamp, with no random draw. The cautionary
deposit is gone. Golden regenerated.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: The fingerprint covers doctrine state — **sonnet + adversarial review**

Implements spec "Commands, traces, fingerprint, versions" (fingerprint). Reviewer's brief: every piece of state that affects evolution and was added in tasks 3–5 is hashed, in a fixed order, and nothing that no longer affects evolution is.

**Files:**
- Modify: `packages/sim-core/src/fingerprint.ts`
- Modify: `packages/sim-core/src/fingerprint.test.ts`
- Regenerate: `packages/sim-trace/src/fixtures/golden.trace.json`

- [ ] **Step 1: Write the failing tests**

Append to `packages/sim-core/src/fingerprint.test.ts`, and extend its import to include `DEFAULT_DOCTRINE, TOPOLOGY_PRIVATE, cloneDoctrine`:

```ts
test("one differing doctrine atom changes the fingerprint before anything moves", () => {
  const c = config();
  const a = new Simulation(c);
  const b = new Simulation(c);
  const d = cloneDoctrine(DEFAULT_DOCTRINE);
  d.evapRate = 0.006;
  b.enqueue({ kind: "setDoctrine", colony: 0, doctrine: d });
  b.flushPending();
  assert.notEqual(fingerprint(a), fingerprint(b));
});

test("a differing role, adoption mode, or topology changes the fingerprint", () => {
  const c = config();
  const base = fingerprint(new Simulation(c));

  const role = new Simulation(c);
  role.colonies[0].ants[0].role = "spoiler";
  assert.notEqual(fingerprint(role), base);

  const adoption = new Simulation(c);
  adoption.enqueue({ kind: "setAdoption", mode: "nest" });
  adoption.flushPending();
  assert.notEqual(fingerprint(adoption), base);

  const topology = new Simulation(c);
  topology.topology = { ...TOPOLOGY_PRIVATE, visible: { home: false, food: false }, maxMimicRate: 0.5 };
  assert.notEqual(fingerprint(topology), base);
});

test("under nest adoption the fingerprint sees every version ants still hold", () => {
  const c = config();
  const a = new Simulation(c);
  const b = new Simulation(c);
  for (const s of [a, b]) { s.enqueue({ kind: "setAdoption", mode: "nest" }); s.flushPending(); }
  assert.equal(fingerprint(a), fingerprint(b));
  const d = cloneDoctrine(DEFAULT_DOCTRINE);
  d.forager.follow.searching.food.own = 6;
  b.enqueue({ kind: "setDoctrine", colony: 0, doctrine: d });
  b.flushPending();
  // No ant has adopted, every ant still runs version 0, yet the pending
  // doctrine is state the run's future depends on.
  assert.ok(b.colonies[0].ants.every(x => x.doctrineVersion === 0));
  assert.notEqual(fingerprint(a), fingerprint(b));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec tsx --test packages/sim-core/src/fingerprint.test.ts`
Expected: the three new tests FAIL (fingerprints equal).

- [ ] **Step 3: Extend the fingerprint**

In `packages/sim-core/src/fingerprint.ts`, add imports:

```ts
import { doctrineNumbers } from "./doctrine";
import { READ_MODES } from "./topology";
```

Replace the four `sim.params` lines with:

```ts
  h = mixF64(h, sim.params.tankMax);
  h = mixU32(h, sim.adoption === "instant" ? 0 : 1);
  h = mixU32(h, READ_MODES.indexOf(sim.topology.read));
  h = mixU32(h, sim.topology.mimicEnemy ? 1 : 0);
  h = mixU32(h, sim.topology.visible.home ? 1 : 0);
  h = mixU32(h, sim.topology.visible.food ? 1 : 0);
  h = mixF64(h, sim.topology.maxMimicRate);
  h = mixU32(h, sim.topology.provenance ? 1 : 0);
```

In the colony loop, after the `foodCollected` line, add:

```ts
    h = mixU32(h, colony.doctrineVersion);
    // Every version some ant still holds, in version order, as its numbers in
    // table order. Under nest adoption the pending doctrine is state the
    // run's future depends on even before any ant has adopted it.
    for (const v of [...colony.doctrines.keys()].sort((x, y) => x - y)) {
      h = mixU32(h, v);
      for (const n of doctrineNumbers(colony.doctrines.get(v)!)) h = mixF64(h, n);
    }
```

In the ant loop, after the `ant.tank` line, add:

```ts
      h = mixU32(h, ant.doctrineVersion);
      h = mixU32(h, ant.role === "spoiler" ? 1 : 0);
```

Update the doc comment above `fingerprint` to add one sentence: "It also covers every doctrine a colony's ants still hold, each ant's version and role, the adoption mode, and the topology, so two runs that differ only in a doctrine atom diverge at the next checkpoint rather than silently."

- [ ] **Step 4: Regenerate the golden and run everything**

Run: `pnpm golden`
Run: `pnpm exec tsx --test packages/sim-core/src/fingerprint.test.ts`
Expected: PASS.

Run: `pnpm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/sim-core/src/fingerprint.ts packages/sim-core/src/fingerprint.test.ts packages/sim-trace/src/fixtures/golden.trace.json
git commit -m "Hash doctrine, adoption, and topology into the fingerprint

Per run the adoption mode and topology; per colony the version and
every doctrine its ants still hold, as numbers in table order; per ant
the adopted version and role. The four old global parameters leave the
hash, tankMax stays. Golden regenerated.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: Presets as data — **haiku**

Implements spec "Presets, surface, and transport" (presets).

**Files:**
- Create: `src/doctrine-presets.ts`
- Create: `src/doctrine-presets.test.ts`
- Modify: `package.json` (a `test:presets` script, included in `test`)

**Interfaces:**
- Consumes: `DEFAULT_DOCTRINE`, `cloneDoctrine`, `Doctrine`, `Topology` from `@stigsim/sim-core`.
- Produces: `DoctrinePreset { name, intent, doctrine, available(topology) }`, `PRESETS: readonly DoctrinePreset[]`, `withExponent(base, p): Doctrine`.

- [ ] **Step 1: Write the failing test**

Create `src/doctrine-presets.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_DOCTRINE, TOPOLOGY_MIMICRY, TOPOLOGY_OPEN, TOPOLOGY_PRIVATE, TOPOLOGY_SENSING, isDoctrine,
} from "@stigsim/sim-core";
import { PRESETS, withExponent } from "./doctrine-presets";

test("every preset is a valid doctrine with a unique name", () => {
  for (const p of PRESETS) assert.equal(isDoctrine(p.doctrine), true, p.name);
  assert.equal(new Set(PRESETS.map(p => p.name)).size, PRESETS.length);
});

test("withExponent sets both steering exponents and nothing else", () => {
  const d = withExponent(DEFAULT_DOCTRINE, 8);
  assert.equal(d.forager.follow.searching.food.own, 8);
  assert.equal(d.forager.follow.returning.home.own, 8);
  assert.equal(d.forager.follow.searching.home.own, 0);
  assert.equal(DEFAULT_DOCTRINE.forager.follow.searching.food.own, 5, "the base is untouched");
});

test("presets whose atoms are inert under a topology say so", () => {
  const by = Object.fromEntries(PRESETS.map(p => [p.name, p]));
  assert.equal(by.Poacher.available(TOPOLOGY_PRIVATE), false);
  assert.equal(by.Poacher.available(TOPOLOGY_SENSING), true);
  assert.equal(by.Poacher.available(TOPOLOGY_OPEN), false, "there is no enemy origin to poach under the open option");
  assert.equal(by.Saboteur.available(TOPOLOGY_PRIVATE), false);
  assert.equal(by.Saboteur.available(TOPOLOGY_MIMICRY), true);
  assert.equal(by.Saboteur.available(TOPOLOGY_OPEN), true);
  assert.equal(by.Highway.available(TOPOLOGY_PRIVATE), true);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec tsx --test src/doctrine-presets.test.ts`
Expected: FAIL — cannot find module `./doctrine-presets`.

- [ ] **Step 3: Write the presets**

Create `src/doctrine-presets.ts`:

```ts
import { DEFAULT_DOCTRINE, cloneDoctrine } from "@stigsim/sim-core";
import type { Doctrine, Topology } from "@stigsim/sim-core";

/**
 * A named doctrine with a one-line intent. The engine never sees a preset;
 * picking one emits setDoctrine with its doctrine.
 */
export interface DoctrinePreset {
  name: string;
  intent: string;
  doctrine: Doctrine;
  /** Whether the preset's nonzero atoms mean anything under this topology. */
  available: (topology: Topology) => boolean;
}

/** Today's single trail-bias slider set both steering exponents; presets do the same. */
export function withExponent(base: Doctrine, p: number): Doctrine {
  const d = cloneDoctrine(base);
  d.forager.follow.searching.food.own = p;
  d.forager.follow.returning.home.own = p;
  return d;
}

const always = () => true;

const scout = withExponent(DEFAULT_DOCTRINE, 2);
scout.evapRate = 0.01;

const volatile = cloneDoctrine(DEFAULT_DOCTRINE);
volatile.evapRate = 0.02;

const saboteur = cloneDoctrine(DEFAULT_DOCTRINE);
saboteur.spoilerFraction = 0.2;
saboteur.mimicRate = 0.5;

const poacher = cloneDoctrine(DEFAULT_DOCTRINE);
poacher.forager.follow.searching.food.enemy = 3;

export const PRESETS: readonly DoctrinePreset[] = [
  { name: "Default", intent: "the Deneubourg model as shipped", doctrine: cloneDoctrine(DEFAULT_DOCTRINE), available: always },
  { name: "Highway", intent: "exploit the best route hard", doctrine: withExponent(DEFAULT_DOCTRINE, 8), available: always },
  { name: "Scout", intent: "explore widely, forget quickly", doctrine: scout, available: always },
  { name: "Volatile", intent: "resist fakes and escape mills, at the cost of memory", doctrine: volatile, available: always },
  { name: "Saboteur", intent: "send a fifth of the colony to lay false trail", doctrine: saboteur, available: t => t.mimicEnemy },
  { name: "Poacher", intent: "follow the other colony's food trail", doctrine: poacher, available: t => t.read === "separable" },
];
```

In `package.json`, add a script and include it in `test`:

```json
    "test": "pnpm typecheck && pnpm test:routes && pnpm test:presets && pnpm test:coverage && pnpm test:server",
    "test:routes": "tsx --test src/routes.test.ts",
    "test:presets": "tsx --test src/doctrine-presets.test.ts",
```

- [ ] **Step 4: Run the test to verify it passes, then the suite, then commit**

Run: `pnpm exec tsx --test src/doctrine-presets.test.ts`
Expected: PASS, 3 tests.

Run: `pnpm test`
Expected: PASS.

```bash
git add src/doctrine-presets.ts src/doctrine-presets.test.ts package.json
git commit -m "Add doctrine presets as data

Six named doctrines with one-line intents, each saying which topologies
its atoms mean something under. The engine never sees them.

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

### Task 8: The doctrine panel — **sonnet**

Implements spec "Presets, surface, and transport" (the human surface) as a component the sandbox mounts in task 9. `ParamCard` moves out of `AntSim.tsx` so both can use it.

**Files:**
- Create: `src/ParamCard.tsx`
- Create: `src/DoctrinePanel.tsx`
- Modify: `src/AntSim.tsx` (delete the local `ParamCard`, import it)

**Interfaces:**
- Consumes: `PRESETS` (task 7); `Doctrine`, `Topology`, `cloneDoctrine` from `@stigsim/sim-core`; `COLONY_COLORS` from `./render`.
- Produces: `ParamCard` (same props as today, exported); `DoctrinePanel` with props `{ numColonies, selected, onSelect, doctrine, adopted, topology, disabled, onCommit }` where `onCommit(colony: number, doctrine: Doctrine)` fires debounced 100 ms after the last slider movement and immediately on a preset click.

- [ ] **Step 1: Move `ParamCard`**

Create `src/ParamCard.tsx` containing exactly the `ParamCard` function that sits at the top of `src/AntSim.tsx` today (from `function ParamCard({` through its closing `}`), with `export` added:

```tsx
export function ParamCard({
  label, description, value, displayValue, min, max, step, onChange, onPointerUp, disabled,
}: {
  label: string;
  description: string;
  value: number;
  displayValue: string;
  min: number; max: number; step: number;
  onChange: (v: number) => void;
  onPointerUp?: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <div style={{
      background: "#0f0a04",
      border: "1px solid #3d2e18",
      borderRadius: 10,
      padding: "14px 16px",
      display: "flex",
      flexDirection: "column",
      gap: 8,
      flex: "1 1 270px",
      minWidth: 0,
      opacity: disabled ? 0.4 : 1,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <span style={{ fontSize: "0.8rem", fontWeight: 600, color: "#e5d5b5" }}>{label}</span>
        <span style={{ fontSize: "0.85rem", fontWeight: 700, color: "#f59e0b", whiteSpace: "nowrap" }}>{displayValue}</span>
      </div>
      <p style={{ margin: 0, fontSize: "0.72rem", color: "#a08060", lineHeight: 1.45 }}>{description}</p>
      <input
        type="range"
        min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        onPointerUp={onPointerUp ? e => onPointerUp(Number((e.target as HTMLInputElement).value)) : undefined}
        disabled={disabled}
        style={{ width: "100%", accentColor: "#f59e0b", cursor: disabled ? "not-allowed" : "pointer", margin: "2px 0" }}
      />
    </div>
  );
}
```

In `src/AntSim.tsx`, delete the local `ParamCard` definition (the `// ─── Param card` comment through the function's closing brace) and add after the `./render` imports:

```ts
import { ParamCard } from "./ParamCard";
```

- [ ] **Step 2: Write the panel**

Create `src/DoctrinePanel.tsx`:

```tsx
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { cloneDoctrine } from "@stigsim/sim-core";
import type { Doctrine, Topology } from "@stigsim/sim-core";
import { COLONY_COLORS } from "./render";
import { ParamCard } from "./ParamCard";
import { PRESETS } from "./doctrine-presets";

/** A slider drag commits once, this long after the last movement. */
const COMMIT_DELAY_MS = 100;

const heading: CSSProperties = {
  margin: "4px 0 8px", fontSize: "0.65rem", fontWeight: 700, letterSpacing: "0.1em",
  textTransform: "uppercase", color: "#6b5a3e",
};

export function DoctrinePanel({
  numColonies, selected, onSelect, doctrine, adopted, topology, disabled, onCommit,
}: {
  numColonies: number;
  selected: number;
  onSelect: (colony: number) => void;
  /** The selected colony's doctrine as last committed. */
  doctrine: Doctrine;
  /** Fraction of the selected colony's ants running its current doctrine. */
  adopted: number;
  topology: Topology;
  disabled: boolean;
  onCommit: (colony: number, doctrine: Doctrine) => void;
}) {
  const [draft, setDraft] = useState<Doctrine>(doctrine);
  const timer = useRef<number | null>(null);

  // A colony switch or a reset replaces the draft; a commit echoes back the
  // same object, which is fine.
  useEffect(() => { setDraft(doctrine); }, [doctrine, selected]);
  useEffect(() => () => { if (timer.current !== null) window.clearTimeout(timer.current); }, []);

  const edit = (change: (d: Doctrine) => void) => {
    const next = cloneDoctrine(draft);
    change(next);
    setDraft(next);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { timer.current = null; onCommit(selected, next); }, COMMIT_DELAY_MS);
  };

  const pick = (d: Doctrine) => {
    const next = cloneDoctrine(d);
    if (timer.current !== null) { window.clearTimeout(timer.current); timer.current = null; }
    setDraft(next);
    onCommit(selected, next);
  };

  const exponent = draft.forager.follow.searching.food.own;
  const showMimic = topology.mimicEnemy;
  const showPoach = topology.read === "separable";

  return (
    <div style={{ width: "100%", maxWidth: 600 }}>
      <p style={heading}>Doctrine</p>

      {numColonies > 1 && (
        <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
          {Array.from({ length: numColonies }, (_, i) => (
            <button
              key={i}
              onClick={() => onSelect(i)}
              disabled={disabled}
              style={{
                padding: "5px 12px", borderRadius: 16, fontSize: "0.75rem", fontWeight: 700, cursor: disabled ? "not-allowed" : "pointer",
                border: `1px solid ${COLONY_COLORS[i].primary}`,
                background: i === selected ? COLONY_COLORS[i].primary : "transparent",
                color: i === selected ? "#000" : COLONY_COLORS[i].primary,
              }}
            >
              Colony {i + 1}
            </button>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
        {PRESETS.filter(p => p.available(topology)).map(p => (
          <button
            key={p.name}
            title={p.intent}
            onClick={() => pick(p.doctrine)}
            disabled={disabled}
            style={{
              padding: "5px 10px", borderRadius: 8, fontSize: "0.72rem", cursor: disabled ? "not-allowed" : "pointer",
              border: "1px solid #3d2e18", background: "#1a1208", color: "#e5d5b5",
            }}
          >
            {p.name}
          </button>
        ))}
      </div>

      <p style={{ margin: "0 0 10px", fontSize: "0.72rem", color: "#a08060" }}>
        {Math.round(adopted * 100)}% of this colony's ants are running its current doctrine.
      </p>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "stretch" }}>
        <ParamCard
          label="Trail bias"
          description="How strongly ants prefer stronger trails. Power 1 is nearly random exploration; power 10 follows the most-travelled path almost always. Sets both the food-seeking and home-seeking exponents."
          value={exponent}
          displayValue={`power ${exponent}`}
          min={1} max={10} step={0.5}
          onChange={v => edit(d => {
            d.forager.follow.searching.food.own = v;
            d.forager.follow.returning.home.own = v;
          })}
          disabled={disabled}
        />
        <ParamCard
          label="Evaporation rate"
          description="How quickly this colony's trails fade. Higher forgets faster and shakes off false trail; lower keeps old paths alive."
          value={draft.evapRate}
          displayValue={`${(draft.evapRate * 1000).toFixed(0)}‰ / step`}
          min={0.001} max={0.02} step={0.001}
          onChange={v => edit(d => { d.evapRate = v; })}
          disabled={disabled}
        />
        {showMimic && (
          <ParamCard
            label="Spoilers"
            description="The share of the colony that explores toward the opponent and lays their chemical instead of foraging. Assigned to the first ants by index; they wear a white ring."
            value={draft.spoilerFraction}
            displayValue={`${Math.round(draft.spoilerFraction * 100)}% of ants`}
            min={0} max={0.5} step={0.05}
            onChange={v => edit(d => { d.spoilerFraction = v; })}
            disabled={disabled}
          />
        )}
        {showMimic && (
          <ParamCard
            label="Mimic rate"
            description="How much of the opponent's chemical a spoiler lays per step, as a fraction of a normal deposit. Draws on the same gland as foraging."
            value={draft.mimicRate}
            displayValue={`${Math.round(draft.mimicRate * 100)}%`}
            min={0} max={1} step={0.05}
            onChange={v => edit(d => { d.mimicRate = v; })}
            disabled={disabled}
          />
        )}
        {showPoach && (
          <ParamCard
            label="Poach weight"
            description="How this colony's foragers treat the opponent's food trail. Positive follows it, negative avoids it, zero ignores it."
            value={draft.forager.follow.searching.food.enemy}
            displayValue={`${draft.forager.follow.searching.food.enemy}`}
            min={-4} max={4} step={0.5}
            onChange={v => edit(d => { d.forager.follow.searching.food.enemy = v; })}
            disabled={disabled}
          />
        )}
      </div>

      <details style={{ marginTop: 10 }}>
        <summary style={{ fontSize: "0.72rem", color: "#a08060", cursor: "pointer" }}>All atoms</summary>
        <pre style={{ fontSize: "0.65rem", color: "#a08060", overflowX: "auto", margin: "6px 0 0" }}>
          {JSON.stringify(draft, null, 1)}
        </pre>
      </details>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck and commit**

Run: `pnpm typecheck`
Expected: PASS. `AntSim.tsx` still renders its old sliders; the panel has no caller yet, which is fine for a component file.

Run: `pnpm test`
Expected: PASS.

```bash
git add src/ParamCard.tsx src/DoctrinePanel.tsx src/AntSim.tsx
git commit -m "Add the doctrine panel

Colony selector, presets filtered by topology, sliders bound to doctrine
atoms with a trailing debounce so a drag records one command, the
adopted-fraction meter, and the full atom table behind a disclosure.
ParamCard moves to its own file so both the panel and the sandbox use it.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 9: The sandbox runs on doctrines — **sonnet**

Implements spec "Presets, surface, and transport" (legibility affordances) and "Commands" (initial commands, debounce) in `AntSim.tsx`, and the renderer changes. After this task the four old sliders and the cautionary toggle are gone and every behaviour change goes through `setDoctrine`.

**Files:**
- Modify: `src/AntSim.tsx`
- Modify: `src/render.ts`

**Interfaces:**
- Consumes: `DoctrinePanel` (task 8); `DEFAULT_DOCTRINE`, `DEFAULT_TOPOLOGY`, `DEPOSITS_PER_CELL`, `cloneDoctrine`, `Doctrine` from `@stigsim/sim-core`.
- Produces: the sandbox issues `setAdoption`, `setTopology`, and one `setDoctrine` per colony before the first step of every run; `tankMax` is a run-level setting that restarts the run; spoiler ants are drawn with a white ring; the cautionary layer is no longer drawn.

- [ ] **Step 1: Rewrite the renderer**

In `src/render.ts`:

Replace the import line with:

```ts
import { COLS, ROWS, CELL, W, H, cellCenter, DenseField } from "@stigsim/sim-core";
```

Replace `layersOf` with:

```ts
function layersOf(colony: Colony) {
  const field = colony.field as DenseField;
  return { home: field.layer("home"), food: field.layer("food") };
}
```

Replace the three maxima blocks (`maxH`, `maxF`, `maxCH`) with two. Trails are now at ant scale, so the floor is a hundred rather than the old beacon level:

```ts
  const TRAIL_FLOOR = 100;
  const layers = sim.colonies.map(layersOf);
  const maxH = layers.map(l => {
    let m = TRAIL_FLOOR;
    for (let i = 0; i < l.home.length; i++) if (l.home[i] > m) m = l.home[i];
    return m;
  });
  const maxF = layers.map(l => {
    let m = TRAIL_FLOOR;
    for (let i = 0; i < l.food.length; i++) if (l.food[i] > m) m = l.food[i];
    return m;
  });
```

Delete the `if (sim.params.cautionary) { ... }` block inside the per-cell colony loop.

In the ant loop, after `ctx.fill();` that paints the ant body (the line after `ctx.fillStyle = ant.hasFood ? "#facc15" : colColor;`), add:

```ts
      if (ant.role === "spoiler") {
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1.25;
        ctx.stroke();
      }
```

- [ ] **Step 2: Rewire the sandbox state**

In `src/AntSim.tsx`:

Change the `@stigsim/sim-core` value import to:

```ts
import {
  Simulation,
  COLS, ROWS, CELL, W, H, DEPOSIT_RATE, DEPOSITS_PER_CELL, DEFAULT_NUM_ANTS,
  DEFAULT_PARAMS, DEFAULT_NUM_COLONIES, DEFAULT_NUM_FOOD_SOURCES,
  DEFAULT_FOOD_PER_SOURCE, DEFAULT_DOCTRINE, DEFAULT_TOPOLOGY, MAX_COLONIES,
  cloneDoctrine, makeSeeds, generateMasterSeed,
} from "@stigsim/sim-core";
import type { Command, Doctrine } from "@stigsim/sim-core";
```

(`SimParams` leaves the imports. `V` leaves too if the gland label was its only use; if the typecheck then reports `V` as undefined elsewhere, put it back — `noUnusedLocals` and a missing name both fail the typecheck, so it settles the question either way.) Add after the `./ParamCard` import:

```ts
import { DoctrinePanel } from "./DoctrinePanel";
```

Replace `const [params, setParams] = useState<SimParams>(DEFAULT_PARAMS);` with:

```ts
  const [tankMax, setTankMax] = useState(DEFAULT_PARAMS.tankMax);
  const [tankDraft, setTankDraft] = useState(DEFAULT_PARAMS.tankMax);
  const [doctrines, setDoctrines] = useState<Doctrine[]>(
    () => Array.from({ length: MAX_COLONIES }, () => cloneDoctrine(DEFAULT_DOCTRINE)),
  );
  const [selectedColony, setSelectedColony] = useState(0);
  const [adopted, setAdopted] = useState<number[]>([1]);
```

Replace `const paramsRef = useRef(params); paramsRef.current = params;` with:

```ts
  const tankMaxRef = useRef(tankMax);
  tankMaxRef.current = tankMax;
  const doctrinesRef = useRef(doctrines);
  doctrinesRef.current = doctrines;
```

Delete the four `useEffect` blocks that `send` `setParam` and `setCautionary` (evapRate, trailPower, tankMax, cautionary). Keep the `setAntCount` one.

Delete the `updateParam` function.

Replace the body of `initSim` up to `setColonyScores` with:

```ts
  const initSim = useCallback(() => {
    const master = seedInputRef.current.trim() || generateMasterSeed();
    setActiveSeed(master);
    const sim = new Simulation({
      seeds: makeSeeds(master),
      numAnts: numAntsRef.current,
      params: { ...DEFAULT_PARAMS, tankMax: tankMaxRef.current },
      loopRate: loopRateRef.current,
      numColonies: numColoniesRef.current,
      numFoodSources: numFoodSourcesRef.current,
      foodPerSource: foodPerSourceRef.current,
    });
    // The run's settings travel as commands, applied before the first
    // physics step and recorded at tick 1, so a trace carries them.
    sim.enqueue({ kind: "setAdoption", mode: "instant" });
    sim.enqueue({ kind: "setTopology", topology: DEFAULT_TOPOLOGY });
    sim.colonies.forEach((_, i) => sim.enqueue({ kind: "setDoctrine", colony: i, doctrine: doctrinesRef.current[i] }));
    sim.flushPending();
    simRef.current = sim;
    setAdopted(sim.colonies.map(() => 1));
    setColonyScores(sim.colonies.map(() => 0));
```

and leave the rest of `initSim` as it is (`setFoodRate(0)` onward). Add a commit callback after `send`:

```ts
  const commitDoctrine = useCallback((colony: number, doctrine: Doctrine) => {
    setDoctrines(prev => prev.map((d, i) => (i === colony ? doctrine : d)));
    send({ kind: "setDoctrine", colony, doctrine });
  }, [send]);
```

In `enterReplay`, replace `setParams(cfg.params);` with `setTankMax(cfg.params.tankMax); setTankDraft(cfg.params.tankMax);`. In `syncReplay`, after `setColonyScores(...)`, add:

```ts
    setDoctrines(prev => prev.map((d, i) => (r.sim.colonies[i] ? cloneDoctrine(r.sim.colonies[i].doctrine) : d)));
    setAdopted(r.sim.colonies.map(c => c.ants.length === 0 ? 1
      : c.ants.filter(a => a.doctrineVersion === c.doctrineVersion).length / c.ants.length));
```

In the structure-reset effect, add `tankMax` to the dependency list: `}, [loopRate, numColonies, numFoodSources, foodPerSource, tankMax]);`.

In the animation loop, after `setColonyScores(sim.colonies.map(c => c.foodCollected));`, add:

```ts
          setAdopted(sim.colonies.map(c => c.ants.length === 0 ? 1
            : c.ants.filter(a => a.doctrineVersion === c.doctrineVersion).length / c.ants.length));
```

Replace the gland label line with:

```ts
  const tankCells = Math.round(tankMax / (DEPOSIT_RATE * DEPOSITS_PER_CELL));
  const colonyIdx = Math.min(selectedColony, numColonies - 1);
```

- [ ] **Step 3: Replace the ant-settings section and the legend entries**

In the legend, delete both cautionary entries: the `...(params.cautionary ? [...] : [])` spread in the single-colony list, and the `{params.cautionary && (...)}` block in the multi-colony list. In the multi-colony list, after the "Carrying food" entry, add:

```tsx
            {doctrines.slice(0, numColonies).some(d => d.spoilerFraction > 0) && (
              <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: "0.7rem", opacity: 0.7 }}>
                <div style={{ width: 9, height: 9, borderRadius: "50%", background: "transparent", border: "1.5px solid #fff", flexShrink: 0 }} />
                <span>Spoiler</span>
              </div>
            )}
```

Replace the whole `{/* ── Ant settings ── */}` block (the `<div style={{ width: "100%", maxWidth: 600 }}>` that holds the three `ParamCard`s and the cautionary toggle, through its closing `</div>`) with:

```tsx
      {/* ── Doctrine ──────────────────────────────────────────────────────────── */}
      <DoctrinePanel
        numColonies={numColonies}
        selected={colonyIdx}
        onSelect={setSelectedColony}
        doctrine={doctrines[colonyIdx]}
        adopted={adopted[colonyIdx] ?? 1}
        topology={DEFAULT_TOPOLOGY}
        disabled={replaying}
        onCommit={commitDoctrine}
      />

      {/* ── Ant settings ───────────────────────────────────────────────────────── */}
      <div style={{ width: "100%", maxWidth: 600 }}>
        <p style={{ margin: "4px 0 8px", fontSize: "0.65rem", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#6b5a3e" }}>
          Ant settings
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "stretch" }}>
          <ParamCard
            label="Gland size"
            description="How much pheromone each ant carries. Fixed for the run and the same for every colony; releasing the slider restarts the simulation."
            value={tankDraft}
            displayValue={`~${tankCells} cells`}
            min={1600} max={16000} step={800}
            onChange={setTankDraft}
            onPointerUp={setTankMax}
            disabled={replaying}
          />
        </div>
      </div>
```

- [ ] **Step 4: Typecheck, build, and check by hand**

Run: `pnpm typecheck && pnpm build`
Expected: PASS. If the typecheck reports an unused import, remove it.

Run: `PORT=3000 BASE_PATH=/ pnpm dev` and open the maze simulator. Check: two colonies; the colony selector switches which doctrine the sliders show; the Highway preset changes trail bias to 8 and the ants visibly exploit; the evaporation slider changes only the selected colony; the Spoilers, Mimic rate and Poach weight sliders are absent (the topology is still option 1); saving a trace and loading it replays without divergence and the panel shows the trace's doctrines with its controls disabled; the gland label reads `~107 cells` at 6400.

- [ ] **Step 5: Run the suite and commit**

Run: `pnpm test`
Expected: PASS.

```bash
git add src/AntSim.tsx src/render.ts
git commit -m "Run the sandbox on doctrines

The four parameter sliders and the cautionary toggle give way to the
doctrine panel; every run starts with setAdoption, setTopology and one
setDoctrine per colony as recorded commands; gland size becomes a
run-level setting that restarts the simulation. The renderer stops
drawing the cautionary layer, normalises trails at ant scale, and rings
spoilers in white. The gland label now counts three deposits per cell.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 10: Retire the old parameters and move the trace format to version 2 — **sonnet + adversarial review**

Implements spec "Commands, traces, fingerprint, versions" (removed commands, `SimParams`, `TRACE_VERSION`, the older-version rejection) and "What left the doctrine". Reviewer's brief: nothing outside `server/` still references `setParam`, `setCautionary`, `NumericParamKey`, `NEST_SEED`, `isEvapRate`, `isTrailPower`; a version-1 trace is rejected with a clear message; the golden's command list is what `make-golden.ts` says it is.

**Files:**
- Modify: `packages/sim-core/src/types.ts`, `constants.ts`, `commands.ts`, `sim.ts`
- Modify: `packages/sim-core/src/commands.test.ts`
- Modify: `packages/sim-trace/src/trace.ts`, `trace.test.ts`, `replay.test.ts`, `golden.test.ts`, `fixtures/make-golden.ts`
- Regenerate: `packages/sim-trace/src/fixtures/golden.trace.json`

- [ ] **Step 1: Shrink `SimParams` and the constants**

In `packages/sim-core/src/types.ts`, replace the `SimParams` interface and `DEFAULT_PARAMS` with:

```ts
/** What is fixed at construction and the same for every colony. Live behaviour lives in each colony's Doctrine. */
export interface SimParams {
  tankMax: number;
}

export const DEFAULT_PARAMS: SimParams = {
  tankMax: 6400,
};
```

In `packages/sim-core/src/constants.ts`, delete the `NEST_SEED` line. (`ODOR_LEVEL` replaced it in task 4; the server keeps its own copy.)

- [ ] **Step 2: Remove the two commands**

In `packages/sim-core/src/commands.ts`:

Replace the imports with:

```ts
import { MAX_ANTS_PER_COLONY, MAX_COLONIES, MAX_FOOD_AMOUNT, MAX_TANK } from "./constants";
import { isDoctrine, type Doctrine, type AdoptionMode } from "./doctrine";
import { isTopology, type Topology } from "./topology";
import type { SimParams } from "./types";
```

Delete the `NumericParamKey` type. Delete the `setParam` and `setCautionary` members of the `Command` union. Delete `isEvapRate`, `isTrailPower`, `PARAM_GUARDS`, and `isParamKey`. Keep `isTankMax`. Replace `validParams` with:

```ts
export function validParams(v: unknown): v is SimParams {
  if (typeof v !== "object" || v === null) return false;
  return isTankMax((v as Record<string, unknown>).tankMax);
}
```

Delete the `setParam` and `setCautionary` cases from `isCommand`.

In `packages/sim-core/src/sim.ts`, delete the two `apply` cases `case "setParam"` and `case "setCautionary"`.

- [ ] **Step 3: Move the trace format to version 2**

In `packages/sim-trace/src/trace.ts`, change `TRACE_VERSION = 1` to `TRACE_VERSION = 2`, and after the `if (t.version > TRACE_VERSION) { ... }` block add:

```ts
  if (t.version < TRACE_VERSION) {
    return {
      ok: false,
      error: `That trace uses an older version of the trace format (${t.version}) than this build reads (${TRACE_VERSION}). It was recorded before doctrines existed and cannot be replayed here.`,
    };
  }
```

Replace `packages/sim-trace/src/fixtures/make-golden.ts` with:

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
import { Simulation, DEFAULT_PARAMS, DEFAULT_DOCTRINE, cloneDoctrine, makeSeeds } from "@stigsim/sim-core";
import { MetricsRecorder, buildTrace, serializeTrace } from "../index";

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

const highway = cloneDoctrine(DEFAULT_DOCTRINE);
highway.forager.follow.searching.food.own = 7;
highway.forager.follow.returning.home.own = 7;
const volatile = cloneDoctrine(DEFAULT_DOCTRINE);
volatile.evapRate = 0.01;

advance(600);
sim.enqueue({ kind: "setWall", x: 15, y: 15, open: false });
advance(400);
sim.enqueue({ kind: "setDoctrine", colony: 0, doctrine: highway });
sim.enqueue({ kind: "setAdoption", mode: "nest" });
advance(400);
// A paused edit: flushPending applies immediately instead of waiting for the
// next step(), exercising the tick+1 recording path a live pause uses. Every
// other edit here goes through enqueue, which never touched this path — the
// exact gap that let the C1 replay-off-by-one bug through seven reviews.
sim.enqueue({ kind: "setDoctrine", colony: 1, doctrine: volatile });
sim.flushPending();
advance(200);
sim.enqueue({ kind: "setAntCount", n: 40 });
advance(600);

const trace = buildTrace(sim, rec, "2026-08-27T00:00:00.000Z");
const out = join(dirname(fileURLToPath(import.meta.url)), "golden.trace.json");
writeFileSync(out, serializeTrace(trace));
console.log(`wrote ${out}: ${trace.endTick} ticks, ${trace.commands.length} commands, ${trace.fingerprints.length} fingerprints`);
```

In `packages/sim-trace/src/golden.test.ts`, change the expected kinds to:

```ts
    ["setWall", "setDoctrine", "setAdoption", "setDoctrine", "setAntCount"],
```

- [ ] **Step 4: Update the tests that used the old commands**

`packages/sim-core/src/commands.test.ts`:
- Add `validParams` to the import list from `./index`.
- Delete the test `"setParam and setCautionary reach the running simulation"` entirely.
- In `"a loaded schedule replays commands at the recorded ticks"`, replace `live.enqueue({ kind: "setParam", key: "evapRate", value: 0.01 });` with `live.enqueue({ kind: "setDoctrine", colony: 0, doctrine: DEFAULT_DOCTRINE });`.
- In `"isCommand accepts valid commands and rejects malformed input"`, replace the two valid entries `{ kind: "setParam", key: "tankMax", value: 3200 }` and `{ kind: "setCautionary", value: false }` with `{ kind: "setAdoption", mode: "nest" }`, and replace the two invalid entries `{ kind: "setParam", key: "cautionary", value: true }` and `{ kind: "setParam", key: "trailPower", value: "8" }` with `{ kind: "setParam", key: "trailPower", value: 8 }` and `{ kind: "setCautionary", value: true }` — both are now unknown kinds.
- Delete the three tests `"setParam rejects an evaporation rate that amplifies pheromone"`, `"setParam rejects a trail power outside the exponent domain"`, and `"setParam rejects an out-of-range tank and an unknown key"`, and add in their place:

```ts
test("validParams accepts a tank in range and rejects anything else", () => {
  assert.equal(validParams({ tankMax: 6400 }), true);
  assert.equal(validParams({ tankMax: 0 }), false);
  assert.equal(validParams({ tankMax: 1e12 }), false);
  assert.equal(validParams({ tankMax: "6400" }), false);
  assert.equal(validParams(null), false);
});

test("the retired parameter commands are unknown kinds", () => {
  assert.equal(isCommand({ kind: "setParam", key: "evapRate", value: 0.005 }), false);
  assert.equal(isCommand({ kind: "setCautionary", value: true }), false);
});
```

`packages/sim-trace/src/trace.test.ts`:
- In `"commands are captured in the trace at their recorded ticks"`, replace the enqueue with `sim.enqueue({ kind: "setAdoption", mode: "nest" });` and the expectation with `[{ t: 31, cmd: { kind: "setAdoption", mode: "nest" } }]`.
- Replace the test `"the loader rejects params that stall a tick or amplify pheromone"` with:

```ts
test("the loader rejects a tank outside its range", () => {
  assert.equal(parseTrace(traceWith({}, { tankMax: 0 })).ok, false);
  assert.equal(parseTrace(traceWith({}, { tankMax: 1e12 })).ok, false);
});
```

- In `"the loader still accepts everything the sliders can produce"`, replace the two parameter overrides `{ evapRate: 0.001, trailPower: 10, tankMax: 16000 }` and `{ evapRate: 0.02, trailPower: 1, tankMax: 1600 }` with `{ tankMax: 16000 }` and `{ tankMax: 1600 }`.
- Replace `{ kind: "setCautionary", value: true }` in the late-command check with `{ kind: "setAdoption", mode: "nest" }`, and `sim.enqueue({ kind: "setCautionary", value: true });` in `"a trace saved during a paused edit still loads"` with `sim.enqueue({ kind: "setAdoption", mode: "nest" });`.
- Add after `"parseTrace refuses a newer format version"`:

```ts
test("parseTrace refuses an older format version", () => {
  const { sim, rec } = runSim(10);
  const trace = { ...buildTrace(sim, rec), version: TRACE_VERSION - 1 };
  const result = parseTrace(JSON.stringify(trace));
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.error, /older version/i);
});
```

`packages/sim-trace/src/replay.test.ts`:
- Extend the import: `import { Simulation, DEFAULT_PARAMS, DEFAULT_DOCTRINE, cloneDoctrine, makeSeeds, fingerprint } from "@stigsim/sim-core";`
- Add a helper after `config`:

```ts
/** The default doctrine with one evaporation rate, the slider change the run records. */
function evaporating(rate: number) {
  const d = cloneDoctrine(DEFAULT_DOCTRINE);
  d.evapRate = rate;
  return d;
}
```

- In `recordRun`, replace the two enqueues `setParam evapRate 0.012` and `setCautionary true` with `sim.enqueue({ kind: "setDoctrine", colony: 0, doctrine: evaporating(0.012) });` and `sim.enqueue({ kind: "setAdoption", mode: "nest" });`.
- Replace both remaining `sim.enqueue({ kind: "setParam", key: "evapRate", value: 0.02 });` lines with `sim.enqueue({ kind: "setDoctrine", colony: 0, doctrine: evaporating(0.02) });`.

- [ ] **Step 5: Confirm nothing outside the server references the retired names**

Run: `grep -rnE 'setParam\b|setCautionary|NumericParamKey|NEST_SEED|isEvapRate|isTrailPower' packages src --include='*.ts' --include='*.tsx'`
Expected: no output.

- [ ] **Step 6: Regenerate the golden, run everything, commit**

Run: `pnpm golden`
Expected: `... 2200 ticks, 5 commands, ...`.

Run: `pnpm test`
Expected: PASS.

```bash
git add packages/sim-core/src/types.ts packages/sim-core/src/constants.ts packages/sim-core/src/commands.ts packages/sim-core/src/sim.ts packages/sim-core/src/commands.test.ts packages/sim-trace/src/trace.ts packages/sim-trace/src/trace.test.ts packages/sim-trace/src/replay.test.ts packages/sim-trace/src/golden.test.ts packages/sim-trace/src/fixtures/make-golden.ts packages/sim-trace/src/fixtures/golden.trace.json
git commit -m "Retire the global parameters and move traces to format 2

SimParams keeps only tankMax, fixed at construction. setParam and
setCautionary are gone: evaporation and trail bias live in each
colony's doctrine, and cautionary pheromone is no longer laid. A
version-1 trace is refused by version with a message that says why.
The golden fixture records doctrine changes instead of slider changes.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## PR 2 scope begins here

### Task 11: Widen the topology validator and drive the read modes by command — **sonnet + adversarial review**

Implements spec "Topology" (the options become selectable). Reviewer's brief: every option is reachable only through `setTopology`; the behaviour under each matches the spec's table for reads and writes; no golden change is needed because the golden runs under option 1.

**Files:**
- Modify: `packages/sim-core/src/topology.ts`, `topology.test.ts`
- Modify: `packages/sim-core/src/commands.test.ts`
- Create: `packages/sim-core/src/topology-play.test.ts`

- [ ] **Step 1: Update the tests**

In `packages/sim-core/src/topology.test.ts`, replace the test `"the cross-colony options are not accepted until the engine implements them"` with:

```ts
test("all four named options validate", () => {
  for (const t of [TOPOLOGY_PRIVATE, TOPOLOGY_SENSING, TOPOLOGY_MIMICRY, TOPOLOGY_OPEN]) {
    assert.equal(isTopology(t), true, t.read);
  }
});
```

In `packages/sim-core/src/commands.test.ts`, in `"isCommand accepts the doctrine, adoption, and topology commands"`, change the `read: "shared"` assertion to expect `true` and add one that expects `false` for `{ ...DEFAULT_TOPOLOGY, read: "sideways" }`.

Create `packages/sim-core/src/topology-play.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  Simulation, DEFAULT_PARAMS, DEFAULT_DOCTRINE, DEPOSIT_RATE,
  TOPOLOGY_MIMICRY, TOPOLOGY_OPEN, TOPOLOGY_PRIVATE, TOPOLOGY_SENSING,
  cloneDoctrine, makeSeeds, readPair,
} from "./index";
import type { Doctrine, RunConfig, Topology } from "./index";

function config(overrides: Partial<RunConfig> = {}): RunConfig {
  return {
    seeds: makeSeeds("topology-play"),
    numAnts: 1,
    params: DEFAULT_PARAMS,
    loopRate: 0.1,
    numColonies: 2,
    numFoodSources: 1,
    foodPerSource: 500,
    ...overrides,
  };
}

function allSpoilers(): Doctrine {
  const d = cloneDoctrine(DEFAULT_DOCTRINE);
  d.evapRate = 0;
  d.spoilerFraction = 1;
  d.mimicRate = 0.5;
  return d;
}

/** A run under one topology, set by command; colony 0 runs `doctrine0`, colony 1 is all spoilers. */
function play(topology: Topology, doctrine0: Doctrine = allSpoilers(), ticks = 5): Simulation {
  const sim = new Simulation(config());
  sim.enqueue({ kind: "setTopology", topology });
  sim.enqueue({ kind: "setDoctrine", colony: 0, doctrine: doctrine0 });
  sim.enqueue({ kind: "setDoctrine", colony: 1, doctrine: allSpoilers() });
  sim.flushPending();
  for (let i = 0; i < ticks; i++) sim.step();
  return sim;
}

test("setTopology reaches the simulation for every option", () => {
  for (const t of [TOPOLOGY_PRIVATE, TOPOLOGY_SENSING, TOPOLOGY_MIMICRY, TOPOLOGY_OPEN]) {
    const sim = new Simulation(config());
    sim.enqueue({ kind: "setTopology", topology: t });
    sim.step();
    assert.deepEqual(sim.topology, t);
    assert.deepEqual(sim.commandLog.map(c => c.cmd.kind), ["setTopology"]);
  }
});

test("option 1: a mimic deposit reaches nobody", () => {
  const sim = play(TOPOLOGY_PRIVATE);
  const [a, b] = sim.colonies;
  assert.equal(b.field.get("food", a.nestX, a.nestY), 0);
  assert.equal(a.field.get("food", a.nestX, a.nestY), 0);
});

test("option 2: the opponent's trail is readable but nothing is written across", () => {
  // Colony 0 forages normally, so its departing ant lays home into its nest
  // cell; colony 1 can read that under this option but cannot write there.
  const sim = play(TOPOLOGY_SENSING, cloneDoctrine(DEFAULT_DOCTRINE));
  const [a, b] = sim.colonies;
  assert.equal(a.field.get("food", b.nestX, b.nestY), 0, "mimicry is off: colony 1's spoiler laid nothing into colony 0");
  const homeAtNest = a.field.get("home", a.nestX, a.nestY);
  assert.ok(homeAtNest > 0, "colony 0 laid home leaving its nest");
  assert.deepEqual(readPair(sim, b, "home", a.nestX, a.nestY), [0, homeAtNest]);
});

test("option 3: a mimic deposit lands in the opponent's layer at the capped rate", () => {
  const sim = play(TOPOLOGY_MIMICRY);
  const [a, b] = sim.colonies;
  assert.equal(b.field.get("food", a.nestX, a.nestY), 3 * 0.5 * DEPOSIT_RATE);
  assert.deepEqual(readPair(sim, b, "food", a.nestX, a.nestY), [3 * 0.5 * DEPOSIT_RATE, 0],
    "the victim reads it as its own");
});

test("option 4: the deposit is the spoiler's own, summed into one field for everyone", () => {
  const sim = play(TOPOLOGY_OPEN);
  const [a, b] = sim.colonies;
  const laid = 3 * 0.5 * DEPOSIT_RATE;
  assert.equal(a.field.get("food", a.nestX, a.nestY), laid);
  assert.equal(b.field.get("food", a.nestX, a.nestY), 0);
  assert.deepEqual(readPair(sim, b, "food", a.nestX, a.nestY), [laid, 0], "b reads the sum with no origin");
  assert.deepEqual(readPair(sim, b, "home", a.nestX, a.nestY), [0, 0], "home stays private under the open option");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec tsx --test packages/sim-core/src/topology.test.ts packages/sim-core/src/topology-play.test.ts`
Expected: FAIL — the validator still refuses the cross-colony options.

- [ ] **Step 3: Widen the validator**

In `packages/sim-core/src/topology.ts`, delete the `IMPLEMENTED` constant and its comment, and replace the two lines in `isTopology` that used it with:

```ts
  if (!READ_MODES.includes(v.read as ReadMode)) return false;
  if (!isBool(v.mimicEnemy)) return false;
```

- [ ] **Step 4: Run everything and commit**

Run: `pnpm test`
Expected: PASS, golden untouched.

```bash
git add packages/sim-core/src/topology.ts packages/sim-core/src/topology.test.ts packages/sim-core/src/commands.test.ts packages/sim-core/src/topology-play.test.ts
git commit -m "Accept every topology option

The shared and separable reads and the mimic switch have been in the
engine since the score and lay paths landed; the validator now admits
them, and each option is exercised through setTopology.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 12: The provenance sublayer — **sonnet**

Implements spec "Topology" (`provenance`) so spectators can see who laid what. Ants never read it.

**Files:**
- Modify: `packages/sim-core/src/types.ts` (`Colony.received`)
- Modify: `packages/sim-core/src/sim.ts` (`_depositMimic`, decay, `mimicMassReceived`)
- Create: `packages/sim-core/src/provenance.test.ts`

**Interfaces:**
- Produces: `Colony.received: Map<number, FieldSet>` keyed by the spoiler colony's id, holding what that colony laid into this one; `mimicMassReceived(colony): number`.

- [ ] **Step 1: Write the failing tests**

Create `packages/sim-core/src/provenance.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  Simulation, DEFAULT_PARAMS, DEFAULT_DOCTRINE, DEPOSIT_RATE, TOPOLOGY_MIMICRY, TOPOLOGY_OPEN,
  cloneDoctrine, makeSeeds, mimicMassReceived,
} from "./index";
import type { Doctrine, RunConfig, Topology } from "./index";

function config(overrides: Partial<RunConfig> = {}): RunConfig {
  return {
    seeds: makeSeeds("provenance"),
    numAnts: 1,
    params: DEFAULT_PARAMS,
    loopRate: 0.1,
    numColonies: 2,
    numFoodSources: 1,
    foodPerSource: 500,
    ...overrides,
  };
}

function spoilers(evapRate: number): Doctrine {
  const d = cloneDoctrine(DEFAULT_DOCTRINE);
  d.evapRate = evapRate;
  d.spoilerFraction = 1;
  d.mimicRate = 0.5;
  return d;
}

function play(topology: Topology, victimEvap = 0): Simulation {
  const sim = new Simulation(config());
  sim.enqueue({ kind: "setTopology", topology });
  sim.enqueue({ kind: "setDoctrine", colony: 0, doctrine: spoilers(0) });
  sim.enqueue({ kind: "setDoctrine", colony: 1, doctrine: spoilers(victimEvap) });
  sim.flushPending();
  for (let i = 0; i < 5; i++) sim.step();
  return sim;
}

test("with provenance on, the victim keeps a sublayer per spoiler colony", () => {
  const sim = play(TOPOLOGY_MIMICRY);
  const [a, b] = sim.colonies;
  const fromA = b.received.get(a.id);
  assert.ok(fromA, "colony 1 records what colony 0 laid into it");
  assert.equal(fromA.get("food", a.nestX, a.nestY), 3 * 0.5 * DEPOSIT_RATE);
  assert.equal(fromA.get("food", a.nestX, a.nestY), b.field.get("food", a.nestX, a.nestY),
    "the sublayer mirrors the deposit in the real layer");
  assert.equal(a.received.size, 0, "colony 0 received nothing");
  assert.equal(mimicMassReceived(b), 3 * 0.5 * DEPOSIT_RATE);
  assert.equal(mimicMassReceived(a), 0);
});

test("the sublayer decays at the victim's rate, like the layer it mirrors", () => {
  const sim = play(TOPOLOGY_MIMICRY, 0.5);
  const [a, b] = sim.colonies;
  const fromA = b.received.get(a.id)!;
  const v = fromA.get("food", a.nestX, a.nestY);
  assert.ok(v > 0 && v < 3 * 0.5 * DEPOSIT_RATE, "decayed but present");
  assert.equal(v, b.field.get("food", a.nestX, a.nestY));
});

test("with provenance off, nothing is recorded", () => {
  const sim = play({ ...TOPOLOGY_MIMICRY, visible: { ...TOPOLOGY_MIMICRY.visible }, provenance: false });
  assert.equal(sim.colonies[1].received.size, 0);
  assert.equal(sim.colonies[1].field.get("food", sim.colonies[0].nestX, sim.colonies[0].nestY), 3 * 0.5 * DEPOSIT_RATE,
    "the real deposit still lands");
});

test("under the open option there is no target to attribute to", () => {
  const sim = play({ ...TOPOLOGY_OPEN, visible: { ...TOPOLOGY_OPEN.visible }, provenance: true });
  assert.equal(sim.colonies[0].received.size, 0);
  assert.equal(sim.colonies[1].received.size, 0);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec tsx --test packages/sim-core/src/provenance.test.ts`
Expected: FAIL — `received` undefined.

- [ ] **Step 3: Implement**

In `packages/sim-core/src/types.ts`, add to `Colony` after `doctrineRefs`:

```ts
  /**
   * What each other colony laid into this one, by that colony's id, kept only
   * when the topology asks for provenance. Spectator and metrics data; ants
   * never read it, so it is not fingerprinted: it is derived from deposits
   * the real layer already carries.
   */
  received: Map<number, FieldSet>;
```

and import `FieldSet` is already in scope in that file.

In `packages/sim-core/src/sim.ts`:

In `_initColonies`, add `received: new Map(),` to the colony literal.

Replace `_depositMimic` with:

```ts
  private _depositMimic(colony: Colony, ch: DoctrineChannel, cx: number, cy: number, amount: number) {
    const { read, mimicEnemy, provenance } = this.topology;
    if (!mimicEnemy || read === "private") return;
    if (read === "shared") { colony.field.add(ch, cx, cy, amount); return; }
    const others = this.colonies.filter(c => c !== colony);
    if (others.length === 0) return;
    const share = amount / others.length;
    for (const other of others) {
      other.field.add(ch, cx, cy, share);
      if (provenance) this._receivedFrom(other, colony.id).add(ch, cx, cy, share);
    }
  }

  /** The sublayer recording what `from` laid into `target`, allocated on first use. */
  private _receivedFrom(target: Colony, from: number): FieldSet {
    let sub = target.received.get(from);
    if (!sub) {
      sub = this.world.createField();
      target.received.set(from, sub);
    }
    return sub;
  }
```

Add `FieldSet` to the `import type { ... } from "./types"` list.

In `step()`, after `colony.field.decay(1 - colony.doctrine.evapRate);` add:

```ts
      for (const sub of colony.received.values()) sub.decay(1 - colony.doctrine.evapRate);
```

Add an exported function at the bottom of `sim.ts`:

```ts
/** Total pheromone other colonies have laid into this one, across every sublayer and channel. */
export function mimicMassReceived(colony: Colony): number {
  let mass = 0;
  for (const sub of colony.received.values()) {
    for (const layer of sub.layers()) for (let i = 0; i < layer.length; i++) mass += layer[i];
  }
  return mass;
}
```

- [ ] **Step 4: Run everything and commit**

Run: `pnpm exec tsx --test packages/sim-core/src/provenance.test.ts`
Expected: PASS, 4 tests.

Run: `pnpm test`
Expected: PASS.

```bash
git add packages/sim-core/src/types.ts packages/sim-core/src/sim.ts packages/sim-core/src/provenance.test.ts
git commit -m "Record who laid what with a provenance sublayer

When the topology asks for it, each colony keeps a field per spoiler
colony mirroring the mimic deposits it received, decaying at its own
rate. Ants never read it; it exists for spectators and metrics.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 13: Draw the provenance sublayer and label it — **sonnet**

Implements spec "Presets, surface, and transport" (spectator rendering of mimicry).

**Files:**
- Modify: `src/render.ts`
- Modify: `src/AntSim.tsx` (legend)

- [ ] **Step 1: Render received deposits in the spoiler colony's colour**

In `src/render.ts`, immediately after the per-cell colony loop closes (after the `for (let y ...)` block that paints trails, before `// Draw nests`), add:

```ts
  // What other colonies laid into each colony, in the spoiler's colour and
  // inset so it reads as a mark on the trail rather than the trail itself.
  // Players' ants see their own chemical; this is the spectator's view.
  const INSET = 4;
  for (const target of sim.colonies) {
    for (const [from, sub] of target.received) {
      const dense = sub as DenseField;
      const food = dense.layer("food");
      const home = dense.layer("home");
      const rgb = COLONY_COLORS[from].primary;
      for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
          const idx = y * COLS + x;
          const v = food[idx] + home[idx];
          if (v <= 0.5) continue;
          const alpha = Math.min(0.9, 0.3 + v / 100);
          ctx.globalAlpha = alpha;
          ctx.fillStyle = rgb;
          ctx.fillRect(x * CELL + INSET, y * CELL + INSET, CELL - 2 * INSET, CELL - 2 * INSET);
        }
      }
    }
  }
  ctx.globalAlpha = 1;
```

- [ ] **Step 2: Add the legend entry**

In `src/AntSim.tsx`, in the multi-colony legend, after the Spoiler entry added in task 9, add:

```tsx
            {doctrines.slice(0, numColonies).some(d => d.spoilerFraction > 0) && (
              <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: "0.7rem", opacity: 0.7 }}>
                <div style={{ width: 12, height: 12, borderRadius: 2, background: "#2a1e0e", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <div style={{ width: 5, height: 5, background: COLONY_COLORS[1].primary }} />
                </div>
                <span>False trail (in the spoiler's colour)</span>
              </div>
            )}
```

- [ ] **Step 3: Typecheck, build, commit**

Run: `pnpm typecheck && pnpm build && pnpm test`
Expected: PASS.

```bash
git add src/render.ts src/AntSim.tsx
git commit -m "Show mimic deposits to spectators

Each colony's received sublayers are drawn inset in the spoiler
colony's colour, with a legend entry, so a game tape shows who laid a
false trail while the victim's ants still see their own chemical.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 14: Choose the topology in the sandbox — **sonnet**

Implements the sandbox side of spec "Topology": the four options as a run-level setting.

**Files:**
- Create: `src/topology-choices.ts`
- Modify: `src/AntSim.tsx`

**Interfaces:**
- Produces: `TopologyChoice { name, label, description, topology }`, `TOPOLOGY_CHOICES`, `choiceFor(topology): TopologyChoice`.

- [ ] **Step 1: The choices as data**

Create `src/topology-choices.ts`:

```ts
import { TOPOLOGY_MIMICRY, TOPOLOGY_OPEN, TOPOLOGY_PRIVATE, TOPOLOGY_SENSING } from "@stigsim/sim-core";
import type { Topology } from "@stigsim/sim-core";

export interface TopologyChoice {
  name: "private" | "sensing" | "mimicry" | "open";
  label: string;
  description: string;
  topology: Topology;
}

export const TOPOLOGY_CHOICES: readonly TopologyChoice[] = [
  { name: "private", label: "Private", description: "Each colony smells only its own trails. Colonies compete only for food.", topology: TOPOLOGY_PRIVATE },
  { name: "sensing", label: "Sensing", description: "Colonies can smell each other's trails and choose to follow or avoid them. Nobody can fake anything.", topology: TOPOLOGY_SENSING },
  { name: "mimicry", label: "Mimicry", description: "As Sensing, and spoilers can lay the other colony's chemical, which its ants cannot tell from their own.", topology: TOPOLOGY_MIMICRY },
  { name: "open", label: "Open", description: "One shared food trail for everyone. Nobody can tell whose trail is whose; home stays private.", topology: TOPOLOGY_OPEN },
];

/** The choice a running simulation's topology corresponds to, by read mode and mimic switch. */
export function choiceFor(t: Topology): TopologyChoice {
  return TOPOLOGY_CHOICES.find(c => c.topology.read === t.read && c.topology.mimicEnemy === t.mimicEnemy)
    ?? TOPOLOGY_CHOICES[0];
}
```

- [ ] **Step 2: Wire it into the sandbox**

In `src/AntSim.tsx`:

Add the import:

```ts
import { TOPOLOGY_CHOICES, choiceFor } from "./topology-choices";
import type { TopologyChoice } from "./topology-choices";
```

and remove `DEFAULT_TOPOLOGY` from the `@stigsim/sim-core` import (it is no longer used directly).

Add state after `selectedColony`:

```ts
  const [topologyChoice, setTopologyChoice] = useState<TopologyChoice>(TOPOLOGY_CHOICES[0]);
  const topologyRef = useRef(topologyChoice);
  topologyRef.current = topologyChoice;
```

In `initSim`, replace `sim.enqueue({ kind: "setTopology", topology: DEFAULT_TOPOLOGY });` with `sim.enqueue({ kind: "setTopology", topology: topologyRef.current.topology });`.

Add `topologyChoice` to the structure-reset effect's dependency list.

In `syncReplay`, after the `setAdopted(...)` line added in task 9, add `setTopologyChoice(choiceFor(r.sim.topology));`.

In the `DoctrinePanel` element, replace `topology={DEFAULT_TOPOLOGY}` with `topology={topologyChoice.topology}`.

In the "Colony settings" section, after the "Colony size" `ControlCard`, add:

```tsx
          <div style={{
            background: "#0f0a04", border: "1px solid #3d2e18", borderRadius: 10, padding: "14px 16px",
            display: "flex", flexDirection: "column", gap: 8, flex: "1 1 270px", minWidth: 0,
            opacity: replaying ? 0.4 : 1,
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
              <span style={{ fontSize: "0.8rem", fontWeight: 600, color: "#e5d5b5" }}>Field topology</span>
              <span style={{ fontSize: "0.85rem", fontWeight: 700, color: "#f59e0b" }}>{topologyChoice.label}</span>
            </div>
            <p style={{ margin: 0, fontSize: "0.72rem", color: "#a08060", lineHeight: 1.45 }}>
              {topologyChoice.description} <strong style={{ color: "#e5d5b5" }}>Changing this restarts the simulation.</strong>
            </p>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {TOPOLOGY_CHOICES.map(c => (
                <button
                  key={c.name}
                  onClick={() => setTopologyChoice(c)}
                  disabled={replaying || numColonies < 2}
                  style={{
                    padding: "5px 10px", borderRadius: 8, fontSize: "0.72rem", cursor: replaying ? "not-allowed" : "pointer",
                    border: "1px solid #3d2e18",
                    background: c.name === topologyChoice.name ? "#f59e0b" : "#1a1208",
                    color: c.name === topologyChoice.name ? "#000" : "#e5d5b5",
                  }}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>
```

- [ ] **Step 3: Typecheck, build, check by hand, commit**

Run: `pnpm typecheck && pnpm build && pnpm test`
Expected: PASS.

Run the dev server. Check: with two colonies, choosing Mimicry restarts the run and the panel now shows the Spoilers, Mimic rate, and Poach weight sliders and the Saboteur and Poacher presets; picking Saboteur for colony 1 makes a fifth of its ants wear white rings and, after they reach colony 2's territory, inset marks in colony 1's colour appear on colony 2's trails; choosing Open hides Poach weight and shows Saboteur; loading a trace recorded under Mimicry shows Mimicry selected.

```bash
git add src/topology-choices.ts src/AntSim.tsx
git commit -m "Choose the field topology in the sandbox

The four options as a run-level setting that restarts the simulation,
with the doctrine panel hiding sliders and presets whose atoms are inert
under the chosen one. A loaded trace selects the option it was recorded
under.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 15: A headless matchup script — **sonnet**

Implements the tuning tool from spec "Testing". Not a test and not in CI; it runs under `tsx` and prints a table.

**Files:**
- Create: `scripts/doctrine-matchup.ts`
- Modify: `package.json` (`matchup` script)

- [ ] **Step 1: Write the script**

Create `scripts/doctrine-matchup.ts`:

```ts
/**
 * Two colonies, one running a preset against the default, under each
 * topology option, over several seeds, both ways round so nest position is
 * controlled for. Prints deliveries, first-delivery tick, and mimic mass
 * received. Run with:
 *   pnpm matchup [ticks] [seeds] [preset]
 * e.g. pnpm matchup 6000 5 Saboteur
 */
import {
  Simulation, DEFAULT_PARAMS, DEFAULT_DOCTRINE, cloneDoctrine, makeSeeds, mimicMassReceived,
} from "@stigsim/sim-core";
import type { Doctrine, Topology } from "@stigsim/sim-core";
import { PRESETS } from "../src/doctrine-presets";
import { TOPOLOGY_CHOICES } from "../src/topology-choices";

const ticks = Number(process.argv[2] ?? 6000);
const seedCount = Number(process.argv[3] ?? 5);
const presetName = process.argv[4] ?? "Saboteur";
const preset = PRESETS.find(p => p.name === presetName);
if (!preset) throw new Error(`no preset named ${presetName}; have ${PRESETS.map(p => p.name).join(", ")}`);

interface Row {
  topology: string; seed: string; challenger: string;
  challengerFood: number; defaultFood: number;
  challengerFirst: number | null; defaultFirst: number | null;
  mimicOnDefault: number;
}

function firstDelivery(sim: Simulation, colony: number, seen: (number | null)[]) {
  if (seen[colony] === null && sim.colonies[colony].foodCollected > 0) seen[colony] = sim.tick;
}

function run(topology: Topology, seed: string, challenger: Doctrine, challengerIs: 0 | 1): Row {
  const sim = new Simulation({
    seeds: makeSeeds(seed), numAnts: 40, params: DEFAULT_PARAMS,
    loopRate: 0.12, numColonies: 2, numFoodSources: 3, foodPerSource: 500,
  });
  sim.enqueue({ kind: "setAdoption", mode: "instant" });
  sim.enqueue({ kind: "setTopology", topology });
  sim.enqueue({ kind: "setDoctrine", colony: challengerIs, doctrine: challenger });
  sim.enqueue({ kind: "setDoctrine", colony: 1 - challengerIs, doctrine: cloneDoctrine(DEFAULT_DOCTRINE) });
  sim.flushPending();
  const first: (number | null)[] = [null, null];
  for (let i = 0; i < ticks; i++) {
    sim.step();
    firstDelivery(sim, 0, first);
    firstDelivery(sim, 1, first);
  }
  const d = 1 - challengerIs;
  return {
    topology: topology.read + (topology.mimicEnemy ? "+mimic" : ""),
    seed,
    challenger: `${preset!.name} as colony ${challengerIs + 1}`,
    challengerFood: sim.colonies[challengerIs].foodCollected,
    defaultFood: sim.colonies[d].foodCollected,
    challengerFirst: first[challengerIs],
    defaultFirst: first[d],
    mimicOnDefault: Math.round(mimicMassReceived(sim.colonies[d])),
  };
}

const rows: Row[] = [];
for (const choice of TOPOLOGY_CHOICES) {
  if (!preset.available(choice.topology) && choice.name !== "private") continue;
  for (let s = 1; s <= seedCount; s++) {
    const seed = `matchup-${s}`;
    rows.push(run(choice.topology, seed, preset.doctrine, 0));
    rows.push(run(choice.topology, seed, preset.doctrine, 1));
  }
}
console.table(rows);

const byTopology = new Map<string, { c: number; d: number; n: number }>();
for (const r of rows) {
  const agg = byTopology.get(r.topology) ?? { c: 0, d: 0, n: 0 };
  agg.c += r.challengerFood; agg.d += r.defaultFood; agg.n += 1;
  byTopology.set(r.topology, agg);
}
for (const [t, agg] of byTopology) {
  console.log(`${t}: ${preset.name} averaged ${(agg.c / agg.n).toFixed(1)} food, default ${(agg.d / agg.n).toFixed(1)}, over ${agg.n} runs`);
}
```

In `package.json` scripts, add:

```json
    "matchup": "tsx scripts/doctrine-matchup.ts",
```

- [ ] **Step 2: Run it once and commit**

Run: `pnpm matchup 2000 2`
Expected: a table with rows for `private`, `separable+mimic`, and `shared+mimic` (Saboteur is unavailable under Sensing and is skipped), then three summary lines. The exact numbers are not asserted; the point is that it runs.

```bash
git add scripts/doctrine-matchup.ts package.json
git commit -m "Add a headless doctrine matchup script

A preset against the default under each topology, over several seeds,
both ways round, reporting deliveries, first delivery, and mimic mass
received. The tool for tuning presets and the mimic cap before the
workshop.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 16: Documentation — **haiku**

**Files:**
- Modify: `README.md`, `CONTRIBUTING.md`, `status.md`

- [ ] **Step 1: README**

In `README.md`, under "Maze Simulator", replace the bullet list beginning "You can:" with:

```markdown
You can:

- Adjust maze loops and food sources
- Give each colony a doctrine: pick a preset or move its sliders — trail bias,
  evaporation, and, when the topology allows, the share of ants that act as
  spoilers, how strongly they mimic the other colony's chemical, and how the
  colony treats the other colony's trails
- Choose the field topology for a run: private trails, sensing the other
  colony's trails, mimicry, or one open food trail
- Set colony size and gland size for the run
- Edit walls and food sources while the simulation is running
- Observe whole colonies or control an individual ant
```

and add after that list:

```markdown
A doctrine is a small table of numbers per colony: how strongly ants of each
role follow each pheromone from each origin, and how much they lay. Today's
model is one point in that table, and the presets are a handful of others.
Every change is recorded in the run's trace, so a replay shows the same
colony reacting to the same doctrine at the same tick. Nest and food are
smells computed at read time rather than pheromone written into the field, so
the trails contain only what ants laid.
```

- [ ] **Step 2: CONTRIBUTING**

In `CONTRIBUTING.md`, in the "Architecture" list, after the `packages/sim-core/` bullet, add:

```markdown
  - `doctrine.ts` is the vocabulary of colony behaviour, `topology.ts` the field
    settings, and `score.ts` the response side. `sim.ts` owns laying, roles,
    and adoption.
```

In "Determinism", replace the sentence beginning "Anything that can set the trail-bias exponent" with:

```markdown
Anything that can set a follow exponent has to screen it with `isHalfStep`
first; `isDoctrine` does, and the trace loader shares it.
```

In "Traces", after the sentence ending "or traces stop reproducing.", add:

```markdown
A doctrine, an adoption mode, or a topology change is a command like any
other: `setDoctrine` carries the whole doctrine as data, validated by
`isDoctrine` on both the bus and the loader. Never call into a colony's
doctrine from outside `apply`.
```

- [ ] **Step 3: status.md**

In `status.md`, under "Active", add:

```markdown
- Demo branch `demo/pheromone-update-api` builds the pheromone update API spec end to end for the Sep 11 SIGFPT call: per-colony doctrines, adoption, field topology, presets, and spectator rendering of mimicry.
```

Under "Done", add at the top:

```markdown
- **2026-09-05** — Designed the pheromone update API: a per-colony doctrine vocabulary indexed by role, state, channel and origin; per-ant adoption with instant and nest modes; field topology as a separate setting; presets as data. Spec at `docs/superpowers/specs/2026-09-05-pheromone-update-api-design.md`. (Patrick, with Claude)
```

- [ ] **Step 4: Commit**

```bash
git add README.md CONTRIBUTING.md status.md
git commit -m "Document doctrines, topology, and the demo branch

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

## Design-lead verification (not a subagent task)

After each task, before the next starts: read the diff against the spec section the task cites; run `pnpm test`; for tasks 4, 5, 6, 10 and 11 also run `pnpm golden` a second time and confirm `git status` shows the fixture unchanged (regeneration is idempotent, which is the cheap determinism check). After task 16: `pnpm build`, `pnpm matchup 4000 3`, play the demo under each topology, and ask Patrick to run the by-hand cross-engine check from `CONTRIBUTING.md` on the branch, since Safari cannot be driven here.
