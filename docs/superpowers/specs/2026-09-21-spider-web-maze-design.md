# Spider-web maze layout — web authoring and the ant-maze transpiler

**Status:** proposed — design worked through with Venkat on 2026-09-21, tracked
in #27. Decisions 2 (what the server accepts) and 7 (symmetry in War) are the
ones a call has to make; the rest are implementation opinions and can be
settled in review.
**Date:** 2026-09-21

## Why

Both current generators carve a spanning tree and then open loops. That
produces corridor mazes with a uniform texture: every part of the map looks
like every other part, and the only structure an ant can exploit is the one
its own trail creates.

A web is a different kind of graph. It has a centre, a periphery, and two
qualitatively different ways to travel — along a radius, or around a spiral —
and those are not interchangeable. That difference should show up in the
pheromone field as structure the colony did not have to invent, which is worth
having in a workshop about coordination through a shared environment.

It is also the substrate a spider-god mode needs. The second layer this
generator emits — which strands are *sticky* — is meaningless to the existing
modes and is exactly what a spider-god would paint pheromone onto. Building the
generator so that layer exists from the start costs little and avoids
retrofitting it later.

## Scope

In scope: a module that authors a web as resolution-independent data, a
transpiler that lowers a web to an occupancy grid plus a sticky annotation, one
construction strategy that mimics an orb-weaver, and the wiring to make the
result a `MazeLayout`.

Out of scope, each with the hook that keeps it possible:

- **The spider-god mode itself.** The sticky layer is emitted and ignored. It
  becomes pre-laid pheromone through `layPheromone` (#26) when that lands, and
  the `Strand.sticky` flag is what that lowering reads.
- **A web-painting interface.** The plan is plain data, so a tool that edits one
  by hand is additive.
- **Strategies other than the orb-weaver.** `WebStrategy` is a function type
  from the start, so a second is a preset rather than a refactor.
- **Larger grids.** The plan is resolution-independent, so a bigger world gets
  better webs without a new generator.

## Decisions

| Question | Decision |
| --- | --- |
| **1. Draw a web, or simulate building one?** | Simulate. Construction order is what makes a web irregular, and irregularity is what makes it a maze rather than a diagram. |
| **2. Is `"web"` a `MazeLayout`?** | Yes, but see Integration: adding it to `MAZE_LAYOUTS` immediately makes the Online War server accept it, so it lands gated or it lands server-safe. |
| **3. How faithful to real spiders?** | The orb-weaver is preset #1, not the architecture. Strategies are data, as doctrine presets are. |
| **4. Is stickiness implied by a strand's role?** | No. It is a per-strand property the strategy sets. Dry radii and a sticky capture spiral are the orb-weaver preset's choice, not a rule. |
| **5. Where do anchors come from?** | Supplied as input, and **every nest spawn is always an anchor**. |
| **6. How is connectivity guaranteed?** | Structurally: a strand may only start from a point already on the web. See The connectivity invariant. |
| **7. Symmetry for War?** | Undecided. Honest construction is asymmetric and therefore unfair. A mirrored strategy would be a second preset, not a second code path. |
| **8. What does `loopRate` mean?** | The fraction of the auxiliary spiral retained. A finished web at 0; one caught mid-construction with its scaffolding up above that. |
| **9. Angles?** | Forbidden. See Determinism — `Math.sin` and `Math.cos` are implementation-defined, for the same reason `deterministicPow` exists. |

## The plan

The authoring module produces data, never a grid:

```ts
/** Normalised to the unit square, so a plan is independent of grid size. */
interface Point { x: number; y: number }

type StrandKind = "bridge" | "frame" | "radius" | "auxiliary" | "capture";

interface Strand {
  kind: StrandKind;
  /** Must already lie on the web. The bridge is the base case. */
  from: Point;
  to: Point;
  /** Dangling and swinging bend a strand; a taut line does not. */
  span: "taut" | "sag" | "arc";
  /** Set by the strategy. Not implied by kind. */
  sticky: boolean;
  /** Construction order, so a build can be replayed or animated. */
  step: number;
}

interface WebPlan {
  anchors: readonly Point[];
  hub: Point;
  strands: readonly Strand[];
}

type WebStrategy = (rng: Rng, anchors: readonly Point[]) => WebPlan;
```

Normalised coordinates are what make the plan resolution-independent. Callers
convert: a nest at cell `(1, 1)` on a 31×31 grid enters as `(1/30, 1/30)`.

### The orb-weaver strategy

| Step | Spider | Plan |
| --- | --- | --- |
| 1 | Releases silk until it snags, then tightens it | One `bridge` strand between two anchors |
| 2 | Drops from the bridge on a dragline, making a Y | A `sag` strand down to a third anchor; the junction is the **hub** |
| 3 | Lays perimeter threads between anchors | `frame` strands, the outer bound |
| 4 | Runs each radius hub→frame, walking back each time | `radius` strands. Dry in this preset |
| 5 | Spirals hub→outward as scaffolding | `auxiliary` strands. Dry |
| 6 | Spirals rim→inward, eating the scaffolding as it goes | `capture` strands. Sticky in this preset |

The ants walk on the silk: strands become open corridors and the gaps between
them become wall. That inversion is what makes the result a web rather than a
picture of one.

### The connectivity invariant

A spider lays silk from where it is standing, and it stands on silk. Enforcing
that gives connectivity for free.

Let `W` be the set of points the plan has placed so far.

- **Base case.** The bridge joins two anchors; `W` is that strand.
- **Step.** Every later strand has `from ∈ W`, and adds a path from `from` to
  `to`. `W` stays connected.
- **Therefore.** The plan is one connected component, always.

Combined with decision 5 — every nest spawn is an anchor, and every anchor is
some strand's endpoint — every colony sits on the web and no colony can be
sealed off. That is the same kind of structural guarantee the spanning-tree
generators get from never revisiting a cell, rather than a flood fill run
afterwards in hope.

The transpiler must preserve it, which is what the next section is about.

## The transpiler

```ts
function transpileWeb(
  plan: WebPlan, cols: number, rows: number,
): { grid: CellType[][]; sticky: boolean[][] };
```

The grid starts closed and strands open it. Cells covered by a sticky strand
are marked in the parallel `sticky` array; nothing in `sim-core` reads that
array today.

### Rasterising must be four-connected

`openNeighbours` filters `DIRS4`, so ants move only orthogonally. A Bresenham
line is eight-connected: it steps diagonally, and a diagonal step leaves two
open cells that are not neighbours. An ant reaching one cannot continue.

This is the single easiest way to build a web that looks right and is
impassable. Strand rasterising must therefore emit a four-connected path —
stepping in x and y separately rather than together — and the connectivity
invariant above only holds in the grid if it does.

A test should assert it directly: flood-fill the transpiled grid from one nest
with `DIRS4` and require every other nest and every open cell to be reached.

### Separation, and why the hub opens up

Two strands running within one cell of each other merge into a blob and the
maze quality collapses. At 31×31 the practical ceiling is roughly eight radii
and a few spiral turns.

Radii necessarily converge as they approach the hub, so they merge there — and
that is correct rather than a defect. Real orb webs have an open hub where the
spider sits. The strategy should space radii so they are separated at the
frame and let them merge near the centre, which produces the hub free zone
without special-casing it.

## Determinism

`sim-core` must produce identical results across engines; CONTRIBUTING has a
manual Chrome/Firefox/Safari fingerprint check for exactly this, and
`deterministicPow` exists because ECMAScript leaves `Math.pow`'s precision
implementation-defined.

**`Math.sin`, `Math.cos` and `Math.atan2` are implementation-defined in the
same way.** A generator that places radii by angle would produce a different
web in Safari than in Chrome, and — because the maze is part of the run — a
different run from the same seed. The existing cross-browser check would catch
it, but only if someone remembers to run it.

So the geometry is built without trigonometry:

- The frame is a polygon through the anchors.
- A radius ends at a point interpolated along a frame edge at a rational
  parameter `t = i / n`. Linear interpolation is `+`, `-`, `*`, `/` only, all
  exactly specified by IEEE-754.
- The spiral attaches to consecutive radii at increasing fractional distance
  from the hub — again interpolation, no angles.
- `sag` and `arc` are quadratic Bézier curves, which are also interpolation.

This is not a workaround. A spider does not compute angles either: it walks
from radius to radius and attaches where it arrives. Building the spiral by
walking the radii in order is both the deterministic implementation and the
faithful one.

## Integration

Adding `"web"` to `MAZE_LAYOUTS` is most of the wiring, because layout
validation is centralised on that one constant:

| Site | What it does |
| --- | --- |
| `maze-mode.ts:67` | Mode config parsing |
| `trace.ts:160` | Trace loader validation |
| `war-boundary.ts:124` | Online War settings decode |
| `server/src/war.ts:127` | **Server-side** match settings validation |
| `layout-choices.ts` | UI label and description — the one manual entry |
| `sim.ts:287` | Food placement, `mirrored` or random |

The last two need attention. `layout-choices.ts` is hand-maintained. And
`sim.ts:287` branches `layout === "mirrored" ? mirrored : random`, so a web
would silently inherit random food placement; a web wants its own policy, with
the hub as the obvious prize.

The server row is the one that needs a decision rather than code. The moment
`MAZE_LAYOUTS` grows, Online War will accept `layout: "web"` from a client, and
the generator will run inside an authoritative match. It must therefore be
deterministic, allocation-bounded, and fast enough to build during match setup
before it goes in the constant — or the constant entry waits.

## Risks

- **A web that is legal but unplayable.** Connectivity guarantees an ant *can*
  reach a nest, not that a match is any good. A web whose hub is a one-cell
  bottleneck may be miserable rather than interesting. Only playtesting tells
  us, so stage 1 should produce inspectable output early.
- **Coarseness.** Eight radii on 31×31 is a crude web. Acceptable, and the
  resolution-independent plan keeps the ceiling liftable, but worth agreeing on
  rather than discovering in review.
- **Fairness.** An honest web is asymmetric, so Online War would be handing one
  player a better start. Decision 7.
- **Anchors that cluster.** Nest spawns are the four corners. A strategy that
  also picks random anchors could place them all on one edge and produce a
  lopsided web. The strategy should spread anchors, and a test should assert it.

## Testing

- The plan is connected: every strand's `from` lies on an earlier strand.
- The transpiled grid is four-connected: flood-fill with `DIRS4` from one nest
  reaches every other nest and every open cell.
- Every nest cell is open in the transpiled grid.
- The same seed produces the same plan, and the same plan the same grid.
- No `Math.sin`, `Math.cos`, `Math.atan2` or `Math.pow` in the module — a
  source-level assertion, cheap and worth it given the failure is invisible in
  CI and only shows up in another browser.
- Sticky cells are a subset of open cells.

## Sequencing

1. `buildWeb`, `transpileWeb`, and the orb-weaver strategy. Pure, tested, no
   engine wiring, no new layout. Reviewable alone.
2. `layout: "web"` wired through, plus a web food policy and the
   `layout-choices.ts` entry. Sticky computed and unused.
3. Spider-god consumption of the sticky layer, after #26.
4. A web-painting tool in the setup interfaces.

Steps 1 and 2 stand alone: they give every existing mode a third map type, and
nothing before step 3 depends on a spider mode existing.

## Extensions noted, not designed

- **Other web types.** Funnel, sheet and tangle webs are structurally very
  different and would make genuinely different mazes. Presets, not new modules.
- **A mirrored strategy** for War, satisfying decision 7 as data.
- **Per-strand pheromone channel**, so one strand lures searching ants with
  food scent and another misleads returning ants with home scent.
- **Larger grids**, which the resolution-independent plan already anticipates.
- **Web damage over time** — strands breaking under traffic, which would make
  the map itself a stigmergic medium rather than a fixed background.
