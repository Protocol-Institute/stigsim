# `@stigsim/sim-core` — architecture

**Status:** partly landed — steps 1 and 2 are on `main`, the storage seam is on
`refactor/6-finish-extracting-the-simulation-core`. See
[Amendments](#amendments-from-building-the-storage-seam) for where the built
interfaces differ from what is proposed below; the proposal text is left as
written so the changes are legible.
**Date:** 2026-08-31

## Why

Ant movement, pheromone deposit and decay, neighbour selection and the parameters
that drive them are written out four times: the maze sandbox
(`src/AntSim.tsx`), the Infinite Mode server (`server/src/sim.ts`), a partial
copy in the Infinite client, and War Mode — which needs the core on a Node
server and gets it by importing a React component module:

```ts
// server/war-index.ts:7 on feat/war-mode
import { DEFAULT_PARAMS, Simulation } from "../src/AntSim";
```

The rules in these copies are the same. What differs is where the numbers are
stored: a dense `Float32Array` over a bounded 31×31 grid, against a sparse
`Map` of 32×32 chunks over unbounded space. `powerChoice` is the same roulette
wheel in both; only the read differs.

So the core does not need to choose a topology. It needs to not know one.

## Decisions

Four questions were open. All four are settled here.

| | Decision |
| --- | --- |
| **Depth** | The package owns `step()` orchestration, with a small set of named hooks. Not accessor helpers alone; not a general systems pipeline. |
| **Movement** | A `Movement` strategy interface. Grid-hop and continuous steering are both implementations. |
| **Determinism** | A core guarantee. No `Math.random` and no bare `Math.pow` inside the package, on any mode's path. |
| **Mutations** | One core-owned `Command` union, used as both the local mutation path and the multiplayer wire payload. |

## Packages

Source-only workspace packages. No build step: the server already runs
TypeScript under `tsx` and Vite compiles on the fly, so `exports` point at
source.

```
packages/
  sim-core/     rules, engine, fields, movement, commands, snapshot, fingerprint
  sim-trace/    traces, replay, metrics
  sim-worlds/   maze, kitchen and forest generation      (see caveat below)
```

The split exists for one reason: the Infinite Mode server must not pull replay
machinery or world generators into its import graph. It imports `sim-core`
alone. War Mode imports `sim-core` + `sim-worlds`. The browser imports all three.

**`sim-worlds` cannot be split out until world generation is inverted.** Today
`Simulation`'s constructor calls `generateMaze`, and `maze.ts` reads `COLS`,
`ROWS` and `COLONY_NESTS` back from core — a package cycle. The caller must
supply the world instead of the simulation building its own, which is the same
change `Occupancy` needs anyway, since Infinite Mode never generates a maze.
Until then `maze.ts` stays in `sim-core`.

**`fingerprint` is core, not trace.** `Simulation.step()` calls it as a value
every `FINGERPRINT_INTERVAL` ticks; only its `Simulation` import is type-only.
Housing it in `sim-trace` would put a runtime edge from core to trace against a
type edge back. It is core behaviour regardless — the simulation fingerprints
its own state whether or not anything is recording.

`pnpm-workspace.yaml` currently lists only `server`; add `packages/*` and depend
as `"@stigsim/sim-core": "workspace:*"`.

### Layout of `sim-core`

```
src/
  constants.ts     V, ARRIVE_THRESH, NEST_SEED, DEPOSIT_RATE, CELL, DIRS4
  params.ts        ColonyParams, defaults, range guards
  rng.ts           sfc32 streams, deterministicPow
  types.ts         AntBase, ColonyState, FoodSource, AntState
  field/           FieldSet interface · dense.ts · chunked.ts
  world/           Occupancy interface · dense-grid.ts · wall-set.ts
  movement/        Movement interface · grid-hop.ts · continuous.ts
  rules/           choose · deposit · decay · nest · forage
  hooks/           built-in hooks: starvation, reproduction, regrowth
  engine.ts        step() pipeline
  commands.ts      Command union, guards, apply
  snapshot.ts      canonical serialize / deserialize
```

**Hard constraint:** no React, no DOM globals, no `node:` imports. That coupling
is the specific thing being removed.

## The interfaces

### Field

Three pheromone channels per colony. They live behind one object rather than
three, because the chunked backing stores them in a single chunk — one map
lookup, better locality, and eviction is decided across `home` and `food`
together.

```ts
export type Channel = "home" | "food" | "caut";

export interface FieldSet {
  get(ch: Channel, cx: number, cy: number): number;
  add(ch: Channel, cx: number, cy: number, amount: number): void;
  set(ch: Channel, cx: number, cy: number, value: number): void;
  max(ch: Channel, cx: number, cy: number, value: number): void;

  /** Multiply every cell by `factor`; drop regions that fall below threshold. */
  decay(factor: number): void;

  /**
   * Region keys the backing store dropped since the last drain.
   * DenseField never drops and always returns empty.
   */
  drainEvicted(): readonly string[];
}
```

`DenseField` is a bounded flat `Float32Array` per channel. `ChunkedField` is a
`Map` of 32×32 chunks, evicting a chunk when neither `home` nor `food` holds
anything above `0.05` — exactly the behaviour in `server/src/sim.ts:123` today.

`drainEvicted` is how chunk eviction stays a *server* concern. The engine never
broadcasts; it hands the evicted keys to a hook and the Infinite server turns
them into `cleared` entries in its `phero` message.

### Occupancy

```ts
export interface Occupancy {
  isOpen(cx: number, cy: number): boolean;
  setOpen(cx: number, cy: number, open: boolean): void;
  /** Iteration bounds, or null when unbounded. */
  readonly bounds: { cols: number; rows: number } | null;
}
```

`DenseGrid` wraps `CellType[][]`, closed outside its bounds. `WallSet` wraps
`Set<"x,y">`, open everywhere except recorded walls.

### Ant and movement

Continuous ants carry a heading; grid-hop ants carry a target cell. The shared
part is small, so the ant type is generic and the engine follows it:

```ts
export interface AntBase {
  wx: number; wy: number;      // world-space pixel position
  colonyId: number;
  state: "searching" | "returning";
  hasFood: boolean;
  tank: number;
  energy: number;
}

export interface GridHopAnt extends AntBase {
  cx: number; cy: number;
  tx: number; ty: number;
  prevCx: number; prevCy: number;
  manual?: boolean;
}

export interface ContinuousAnt extends AntBase {
  heading: number;
}

export interface Movement<A extends AntBase> {
  spawn(nestX: number, nestY: number, ctx: MovementCtx<A>): A;
  step(ant: A, ctx: MovementCtx<A>): void;
}
```

This also settles a naming drift: the browser calls the position `x`/`y`, the
server calls it `wx`/`wy`. World space is the more general concept, so `wx`/`wy`
wins.

`MovementCtx` carries the field, occupancy, colony state, params, a food lookup
and the `Rng`. Nothing else — a movement implementation cannot reach the engine.

### The step pipeline

Every mode already runs this sequence. The package owns it once.

```
tick++
for each colony:
    field.decay(1 - params.evapRate)
    hook onCellsEvicted(colony, field.drainEvicted())
    seedNest(colony)
    reseedDiscoveredFood(colony)
    for each ant: movement.step(ant, ctx)
    hook afterAnts(colony, ctx)
hook afterColonies(colonies, ctx)
```

```ts
export interface EngineHooks<A extends AntBase> {
  onCellsEvicted?(colony: ColonyState<A>, keys: readonly string[]): void;
  afterAnts?(colony: ColonyState<A>, ctx: TickCtx): void;
  afterColonies?(colonies: ColonyState<A>[], ctx: TickCtx): void;
}
```

Three hooks, fixed order, each with a defined position in the tick. Not
open-ended middleware — if a future behaviour will not fit one of these, that is
a signal to reconsider the pipeline rather than to add a fourth hook casually.

### Built-in hooks

Energy drain, starvation and colony death exist on the Infinite server and were
independently reinvented on `feat/war-mode` with different numbers. Rather than
leave that to each mode, the package ships them as opt-in hooks:

```ts
import { starvation, reproduction, foodRegrowth } from "@stigsim/sim-core/hooks";

new Engine({
  movement: gridHop,
  hooks: [starvation({ energyMax: 4500 }), reproduction({ every: 600 })],
});
```

The maze passes none. Infinite passes `starvation`. War passes both. One
implementation, three configurations.

### Commands

One union, core-owned, serving as both the local mutation path and the
multiplayer wire payload.

```ts
export type Command =
  | { kind: "setWall"; x: number; y: number; open: boolean }
  | { kind: "setFood"; x: number; y: number; amount: number }
  | { kind: "addColony"; x: number; y: number; params?: Partial<ColonyParams> }
  | { kind: "removeColony"; colonyId: number }
  | { kind: "setParam"; target: ColonyTarget; key: NumericParamKey; value: number }
  | { kind: "setCautionary"; target: ColonyTarget; value: boolean }
  | { kind: "setAntCount"; target: ColonyTarget; n: number }
  | { kind: "setManualAnt"; colonyId: number; index: number | null }
  | { kind: "moveManualAnt"; colonyId: number; dx: number; dy: number };

export type ColonyTarget = number | "all";
```

Two problems dissolve here.

**`toggleWall` becomes `setWall{open}`.** The current wire protocol sends a
toggle, which is order-dependent: two players clicking the same cell in a
different order on client and server leave the world in different states.
`setWall{open}` is idempotent and replay-safe.

**`ColonyTarget` reconciles the params drift.** The maze applies one `SimParams`
to every colony; Infinite has per-colony `ColonyParams`. The stored shape is
per-colony everywhere; the maze UI simply sends `target: "all"`.

Every command carries the range guards PR #3 already wrote, so the trace loader,
the command bus and the server's untrusted-input boundary share one validation
path and cannot drift apart.

### Determinism

No `Math.random` and no bare `Math.pow` inside the package, on any path.

- RNG is injected and threaded through every draw. Seeds derive per stream
  (`maze`, `food`, `ants`) from one master.
- `deterministicPow` with `trailPower` constrained to half-steps, so
  `powerChoice` yields identical scores across engines and platforms. **This
  constrains Infinite Mode's trail-bias slider to half-steps.** That is a real
  UI change and a deliberate cost.
- `sfc32` state is four 32-bit words, so it serializes into the snapshot and
  replay resumes mid-run.
- Iteration order must stay insertion-ordered `Map`/`Set` — never plain-object
  key iteration. This is the one rule that is easy to break silently and needs a
  lint rule or a review note.

The payoff is that a server desync or an emergent-behaviour bug reproduces from
a seed instead of from log archaeology.

### Snapshots

One canonical format, used by Infinite's Postgres persistence, War's match
checkpoints and PR #3's traces.

```ts
export interface Snapshot {
  version: 2;
  tick: number;
  rng: RngState;
  occupancy: OccupancySnapshot;
  colonies: ColonySnapshot[];
  foodSources: FoodSource[];
}
```

Infinite Mode is deployed and holds live `PersistedWorld` v1 rows. v1 → v2 needs
a migration that runs before the new server accepts writes; the v1 reader stays
in the repo until the migration has run in production.

## How future work slots in

| Extension | Where it lands | Reopens the core? |
| --- | --- | --- |
| Continuous movement (PR #4) | `movement/continuous.ts` reading `FieldSet` bilinearly | No |
| Terrain surfaces | Optional per-cell modifier layer consulted by movement and `decay` | Adds one optional parameter to `decay` |
| Generated worlds (kitchen, forest) | `@stigsim/sim-worlds` | No |
| Food regrowth | A rule plus the `foodRegrowth` built-in hook | No |
| War reproduction and births | `reproduction` built-in hook | No |
| War combat | `afterAnts` hook; needs an ants-near-point query on the world | Adds one world query |
| Trace, replay, fingerprints | `@stigsim/sim-trace` wrapping engine + commands + rng | No |
| Match phases, rooms, victory | `afterColonies` hook plus server-side lifecycle | No |
| Weather, disease, seasons | New built-in hooks | No |

The two entries that do reopen the core are worth stating plainly rather than
pretending otherwise. Neither is speculative work to do now.

## What stays out

Rendering and React. Wire encoding and compression. Postgres and Drizzle. Match
and room lifecycle. The fixed-step accumulator (`server/src/fixed-step.ts`) stays
host-side — `step()` is pure and hosts decide when to call it, because the three
modes legitimately run at different rates (maze on rAF, Infinite at 50/s, War at
a configurable 15/s).

## Migration

Ordering matters more than usual: three branches currently rewrite
`src/AntSim.tsx`, and two of them independently create `src/sim/` with their own
`constants.ts` and `rng.ts`.

1. **Land PR #3 (`reproducible-runs-spec`).** It already does the React
   extraction, brings the seeded RNG and `deterministicPow`, and carries the only
   real test coverage of the core, including a golden trace. Both PR authors have
   independently said it should go first.
2. **Move `src/sim/` to `packages/sim-core` mechanically.** No behaviour change.
   Swap storage-typed helpers for the `FieldSet`/`Occupancy` interfaces and run
   the maze on `DenseField`. The golden trace proves nothing moved.
3. **Port `server/src/sim.ts` onto the engine behind `ChunkedField`**, keeping
   `sim.persistence.test.ts` and `sim.starvation.test.ts` green. Add an
   equivalence test: one seed, one bounded world, dense and chunked backings,
   identical ant trajectories.
4. **Reconcile the drift**, one decision per commit, each with a test — depleted
   food handling, `discoveredSources` keying, the cautionary exponent, the
   ant-position field names, the third copy of `DEFAULT_PARAMS` in
   `src/components/InfiniteSim.tsx:430`.
5. **Unify commands with the wire protocol**, replacing `toggleWall`.
6. **Rebase PR #4 and War Mode.** PR #4 contributes `movement/continuous.ts` and
   `sim-worlds`; War Mode drops its `../src/AntSim` import and its reinvented
   energy model in favour of the built-in hooks.

## Risks

- **Live Postgres state.** The v1 → v2 snapshot migration is the one step that
  can lose real data.
- **No browser-side coverage on `main`.** `pnpm test` is `typecheck +
  test:server`. Doing step 2 before step 1 would be a 1500-line refactor with
  nothing watching it.
- **The half-step constraint is user-visible** in Infinite Mode's slider.
- **Hook creep.** Three named hooks is the design. If the count grows past four,
  the pipeline decision should be revisited rather than quietly eroded.
- **Merge pressure.** Every week PRs #3 and #4 sit unmerged, `AntSim.tsx` gets
  rewritten again on a third branch.

## Done when

- `packages/sim-core` is React-free and DOM-free and is imported by both the
  browser bundle and the Node server.
- `V`, `ARRIVE_THRESH`, `NEST_SEED`, `DEPOSIT_RATE`, `powerChoice`,
  `openNeighbours`, `cellCenter` and the colony parameter defaults each appear
  exactly once in the repository.
- `server/war-index.ts` no longer imports from `src/AntSim.tsx`.
- A dense-vs-chunked equivalence test passes from a fixed seed.
- No `Math.random` or bare `Math.pow` remains under `packages/`.
- Each drift item is either reconciled or carries a comment saying why it is a
  deliberate mode-specific difference.

## Amendments from building the storage seam

**Date:** 2026-09-03 · Issue #6, step 3

Eight things came out differently once the interfaces above were built against
the golden trace. The proposal is left unedited; this section is the diff.

### `FieldSet` needs `layers()`

The six proposed methods give no canonical walk of a field, and `fingerprint`
reinterprets each layer as `Uint32Array` and hashes every word. With
`get/add/set/max/decay/drainEvicted` alone it has no source, and the golden
trace cannot survive the refactor. The interface gained a seventh method:

```ts
/** Every stored word, in the backing's canonical order. */
layers(): readonly Float32Array[];
```

`DenseField` returns home, food, caut — exactly the order `fingerprint` has
always hashed. A chunked backing's order will be canonical for itself and
deliberately not comparable to dense, since an evicted zero chunk does not hash
like a dense run of zeros. That is why the dense-vs-chunked equivalence test has
to compare trajectories rather than fingerprints.

### `decay` does not name a threshold

The proposal wrote `ChunkedField`'s 0.05 rule into the `FieldSet` comment. That
is one backing's eviction policy, not the contract. The interface says only that
every stored cell is multiplied and that a backing may drop regions, reporting
them through `drainEvicted`.

### Files stay flat, not in `field/` `world/` `movement/`

`test:client` and `test:coverage` in the root `package.json` glob
`packages/*/src/*.test.ts` — a single `*`. A test at
`packages/sim-core/src/field/dense.test.ts` would never run, and coverage would
still pass, because Node only reports on files it loaded. Either keep one file
per interface at `src/` or change both globs in the same commit. The former was
chosen while there is one implementation of each.

### `Movement`, `EngineHooks` and `engine.ts` are deferred

They are behaviour abstractions, not storage ones. Landing them alongside the
storage seam doubles the diff against the same single golden test, introduces
generics with one implementation to justify them, and adds hook call sites with
no caller — which the 97% functions gate rejects. They land with `ChunkedField`
and the server port, where `onCellsEvicted` finally has a consumer and
`continuous.ts` makes `Movement` a real choice.

### The world is a defaulted parameter, not a required one

"The caller supplies the world" does not by itself unblock `sim-worlds`: a
default still leaves the `sim.ts` → `maze.ts` edge. More importantly, making it
required forces a decision the proposal does not make. A trace stores a
*recipe* — `seeds.maze` plus `loopRate`, validated by `CONFIG_CHECKS` and
rebuilt by `traceToRunConfig`. A recipe exists only for generated worlds;
Infinite Mode has none. So a caller-supplied world in general means a trace must
carry either a generator id, adding a `sim-trace` → `sim-worlds` edge, or a
world snapshot, which is a format bump. That belongs to the commit that creates
`sim-worlds`.

### An unbounded world is refused, for now

`Occupancy.bounds: null` is in the interface, but `Simulation` throws on it.
Placing food iterates the whole world and `fingerprint` hashes it; neither has a
defined meaning over unbounded space, and the proposal never says what they
should do. That gets settled with `ChunkedField`, not before.

### Three different answers on accessors, by call frequency

- **`fingerprint`** walks `layers()` — raw arrays, no accessors.
- **`metrics`** goes fully through `FieldSet.get`. It samples every ten ticks,
  so the cost is under a millisecond and chunked compatibility comes free.
- **The renderer stays on raw dense access**, hoisting `DenseField.layer` once
  per colony per frame. It reads every cell of every channel each frame, and
  `field.get` there goes megamorphic the moment a second backing exists —
  typically 5–10× on a tight indexed loop. The cast lives in `src/render.ts`,
  outside the package, with a comment that maze mode is dense by construction.

Pretending one rule fits all three would have regressed the only loop that runs
sixty times a second.

### `computeHighwayScore` is gone

It had no callers; `colonyHighwayScore` in `sim-trace/metrics.ts` is the live
implementation and scores one colony rather than summing across all of them.

### Still open, unchanged from the proposal

Per-colony params, `discoveredSources` keying, the ant-position rename to
`wx`/`wy`, and the third copy of `DEFAULT_PARAMS` remain drift items for the
port. Two of them change `fingerprint` output, so they should land in one PR
with a single `SIM_VERSION` bump.
