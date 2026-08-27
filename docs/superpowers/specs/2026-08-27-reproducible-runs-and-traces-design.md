# Reproducible Runs and Downloadable Traces

Design document, 2026-08-27.

## Context

Stigsim's Maze Simulator draws randomness from `Math.random()` in four places, keeps
no tick counter, and lets the user mutate the simulation mid-run through wall
painting, food placement, parameter sliders, the ant-count slider, and arrow-key
control of a single ant. None of that is recorded. Two runs from identical
settings therefore differ, and no run can be shared, re-examined, or used as a
regression test.

The workshop discussion has asked for this repeatedly. Ergod on 6/18 wanted
"seed/stream mechanisms for randomness to have reproducible runs to be able to
share them between researchers", and on 6/17 wanted to hold a maze fixed and
"average out the randomness" across many runs. Venkat on 6/19 asked for "a
research API that sets up a run, logs the data, and saves it for analysis", with
the example experiment "probability of ant mills as a function of number of food
sources". Patrick's 8/24 summary lists fixed randomness and the API as the first
two pieces of work. Vibhav asked on 8/21 how determinism is currently tested; it
is not.

This document specifies the foundation both asks depend on: a deterministic
simulation core, and a trace file that captures a run exactly.

## Goals

A run is fully determined by a seed, an initial configuration, and a recorded
list of user interventions. Replaying those three reproduces the run exactly.
Every run also accumulates a metrics log suitable for analysis. Both travel in a
single downloadable file. A replay that fails to reproduce says so rather than
producing a plausible wrong answer.

## Non-goals

Infinite World is out of scope. Reproducing a run in a shared, anonymously
edited, server-authoritative world is a substantially different problem, and the
deterministic core specified here is a prerequisite for attempting it.

The headless Node batch runner is deferred to a follow-on spec. This design
constrains the simulation core so that runner is a small addition: nothing under
`src/sim/` may import React or touch the DOM.

Ant-mill detection is deferred. It needs a detector definition we would have to
invent and defend, and it is separable from the logging machinery.

Forking a new run from a point inside a trace is deferred.

## Decisions

### Module layout

`src/AntSim.tsx` currently holds the simulation, the canvas renderer, and the
whole UI in 1587 lines. The simulation moves out:

```
src/sim/
  rng.ts           seeded PRNG and named streams
  maze.ts          seeded maze generation
  sim.ts           Simulation: step(), enqueue(), apply()
  commands.ts      Command union and validation
  metrics.ts       samplers
  fingerprint.ts   state hash
  trace.ts         trace read/write and version checks
  replay.ts        Replayer
  index.ts         public surface
src/render.ts      canvas renderer, extracted
src/AntSim.tsx     UI and wiring only
```

The `src/render.ts` extraction is not required by this feature. It is included
because the file is being split anyway and it leaves the remaining UI file
readable. It can be dropped without affecting anything else here.

This layout follows the existing instruction in `CONTRIBUTING.md` to keep core
simulation logic independent of React where practical.

### Randomness

The generator is sfc32: four lines, 32-bit integer operations only, passes
PractRand. It performs no multiplication, so it contains nothing
implementation-defined and produces identical output on every engine.

A run has three named streams rather than one, each derived from a master seed
by hashing the seed together with the stream name:

- `maze` drives the direction shuffle and loop carving
- `food` drives food source placement
- `ants` drives every `powerChoice` draw

The trace stores the master seed and the three derived seeds. Storing the
derived seeds is what allows the deferred batch runner to pin the maze and food
while varying ant behaviour alone, which is the axis Ergod asked for. Storing
the master is what lets the user interface show one short, typeable, shareable
value.

The derived seeds are authoritative when a trace is loaded. A run whose streams
were set independently, which only the batch runner will do, has no meaningful
master, so `seeds.master` is null and the seed field displays "custom".

Selecting which ant the user controls needs no stream, because the chosen index
is carried in the recorded command. The UI may pick it any way it likes,
including with `Math.random()`, since the outcome is captured rather than
regenerated. A `setManualAnt` command carrying `null` returns the ant to
autonomous behaviour.

Two call sites need more than a swapped randomness source.

`generateMaze` at line 96 shuffles directions with
`sort(() => Math.random() - 0.5)`. A random comparator is not a uniform shuffle
and the outcome depends on the engine's sort algorithm. It becomes Fisher-Yates
over the `maze` stream.

`powerChoice` at line 155 calls `Math.pow(pheromone + 1, trailPower)`. The
ECMAScript specification marks `Math.pow` implementation-approximated, so
engines may differ in the last bit. Multiplication and square root are both
exactly specified by IEEE-754, and the trail-bias slider steps in halves, so
every exponent it can produce is reachable without `Math.pow`:

```js
function deterministicPow(base, power) {
  const whole = Math.floor(power);
  let r = 1;
  for (let i = 0; i < whole; i++) r *= base;
  return power === whole ? r : r * Math.sqrt(base);
}
```

The slider keeps its current range and 0.5 step. The result is not bit-identical
to a correctly-rounded `pow`, since it accumulates slightly more rounding error,
but the requirement is reproducibility rather than numerical exactness and the
model is a heuristic.

The practical risk from `Math.pow` was small. A one-bit difference flips a
weighted choice only when the draw falls within one ulp of a boundary, roughly
2e-16 per decision, so a long run making a million decisions diverges with
probability near 1e-10. The fix is taken because it costs about ten lines and no
user-facing capability, not because divergence was likely.

### The command bus

Every mutation becomes a serializable object:

```ts
type Command =
  | { kind: "setWall";       x: number; y: number; open: boolean }
  | { kind: "setFood";       x: number; y: number; amount: number }  // 0 removes
  | { kind: "setParam";      key: keyof SimParams; value: number | boolean }
  | { kind: "setAntCount";   n: number }
  | { kind: "setManualAnt";  index: number | null }
  | { kind: "moveManualAnt"; dx: number; dy: number }
```

The UI calls `sim.enqueue(cmd)` and never touches simulation state directly.
`step()` increments the tick, drains the queue in FIFO order applying each
command, then performs the existing evaporation and movement work. Recording is
appending `{t, cmd}` as commands drain, which means a recorded run and a live
run follow the same code path and cannot diverge from each other.

Applying commands only at tick boundaries is what makes recording faithful. An
edit made partway between two ticks in wall-clock time is applied at tick N
unambiguously, so a replay cannot disagree about when it happened. Edits made
while the simulation is paused all land on the current tick.

This replaces the direct mutation in `applyEdit` (line 885), the params effect
(line 801), the ant-count effect (line 805), and `moveAnt` (line 833).

Dragging a slider fires `onChange` continuously, so one drag records on the
order of thirty `setParam` commands. This is accepted. Throttling would change
how the control feels for a saving in file size that does not matter.

### Metrics

Sampled every 10 ticks by default into a ring buffer capped at 20,000 samples.
On overflow the oldest sample is dropped and a `truncated` flag is set in the
trace header, so a partial log cannot be mistaken for a complete one.

Each sample carries, per colony: food collected, collection rate, per-colony
highway score, pheromone mass and Shannon entropy for each of the home, food,
and cautionary layers, and mean trip efficiency. Each sample also carries
remaining food per source.

Three items need new code.

Trip efficiency needs a breadth-first search from each nest for true shortest
distances, recomputed lazily whenever a `setWall` command invalidates the grid.
Each ant tracks steps since leaving the nest and the index of the source it last
visited. The metric is realized round trip over twice the shortest distance to
that source, reported as null until enough trips have completed to average.

Per-colony highway score is a variant of the existing `computeHighwayScore`,
which sums across all colonies at line 121. The global version is retained for
the heads-up display.

The displayed food rate at line 1018 is computed from `Date.now()` over a
30-second wall-clock window, which is not reproducible. In the metrics it
becomes food per thousand ticks over a trailing tick window. The heads-up
display changes to match, so that the number on screen is the number in the log.
This is a small user-visible change to an existing readout.

Entropy uses `Math.log`, which is also implementation-approximated. This is
acceptable because metrics are outputs and never simulation inputs, so a
last-bit difference cannot alter the run. It does mean fingerprints must cover
simulation state only, never metrics.

### Fingerprints

Every 500 ticks, an FNV-1a hash over the grid, each colony's three pheromone
buffers read through a `Uint32Array` view, the ant fields, the food sources, the
per-colony food counts, and the tick. The list of `{t, hash}` pairs is stored in
the trace.

Writing fingerprints happens during live runs, because a trace can only be
verified later if it carries the values recorded when the run originally
happened. Replay recomputes and compares as it advances; a mismatch stops replay
and reports the tick, with an option to continue anyway. The same mechanism runs
in CI against a committed fixture.

The interval of 500 ticks bounds a divergence to a window rather than
pinpointing the exact tick, which is enough to know a run is untrustworthy and
where to start looking. Estimated cost is roughly 30 operations per tick
amortized, which should be invisible next to the per-tick evaporation pass that
already touches every one of those floats. This estimate should be measured once
the code exists.

### Trace format

```jsonc
{
  "format": "stigsim-trace",
  "version": 1,
  "simVersion": 1,
  "createdAt": "2026-08-27T19:04:00Z",
  "run": {
    "seeds": {
      "master": "quiet-ember-4417",
      "maze": "3f2a9c01", "food": "b7e40128", "ants": "91cc5de3"
    },
    "config": {
      "numAnts": 20,
      "params": { "evapRate": 0.005, "trailPower": 5, "tankMax": 6400,
                  "cautionary": false },
      "loopRate": 0.1,
      "numColonies": 1,
      "numFoodSources": 1,
      "foodPerSource": 500
    }
  },
  "commands":     [ { "t": 412, "kind": "setWall", "x": 7, "y": 12, "open": false } ],
  "fingerprints": [ { "t": 500, "h": "a3f1c209" } ],
  "metrics":      { "interval": 10, "truncated": false, "samples": [] },  // elided
  "endTick": 8400
}
```

`version` covers the file format. `simVersion` covers simulation behaviour and
must be incremented whenever a change alters how the model runs. The ant model
is under active development, so old traces will replay differently after model
changes; the version lets a load report that exact replay is not expected rather
than producing a wrong run that looks correct.

`createdAt` is metadata for humans and is never read by the simulation.
`endTick` is the tick reached at the moment the trace was saved, which may be
mid-run.

`run.config` deliberately omits `framesPerTick`. Simulation speed controls how
many animation frames pass between ticks and has no effect on the run itself, so
it is a property of watching a run rather than of the run. A replay uses
whatever speed the viewer has set.

Traces download as `stigsim-<master-seed>-<endTick>.trace.json` via a Blob,
falling back to `stigsim-custom-<endTick>.trace.json` when there is no master.
An 8400-tick run is roughly 170KB, so no compression is needed at version 1.

Metrics also export separately as CSV, since that is the form analysis tools
want. The CSV is derived from the same samples, flattened to one row per tick
per colony, with the per-source remaining food repeated across those rows. The
trace remains the canonical self-contained artifact.

### Replay and seek

Replay constructs the simulation from `run`, indexes the commands by tick, and
drains each tick's scheduled commands through the same `apply` path a live run
uses. The simulation does not know whether it is live or replaying.

Seeking to tick N rebuilds from scratch and steps N times with rendering
disabled. A step at 31x31 with 20 ants is cheap, so seeking ten thousand ticks
should complete well under a second. Four colonies of 400 ants will be slower;
this should be measured and given a progress indicator if it needs one. No state
snapshots are stored.

Editing is disabled during replay, since an edit would contradict the trace.

### User interface

A Run panel containing a seed text field showing the current run's seed, a
button to generate a new seed, Save trace, Export metrics CSV, and Load trace.

Editing the seed field does not disturb the run in progress. The new seed takes
effect on the next reset, which is the same rule the existing maze-shape and
colony-count controls follow. The field indicates when the displayed seed
differs from the seed the current run is using.

Loading a trace enters replay mode and reveals a replay bar with play and pause,
a tick readout, and a field to jump to a tick.

The Run panel also displays the most recent fingerprint, which is what makes the
manual cross-engine check described under Testing possible.

## Error handling

A malformed trace is validated against the schema and rejected with a specific
message. It is never partially applied and replay mode is not entered.

An unrecognised `format`, or a `version` higher than this build understands, is
refused with a clear message.

A `simVersion` differing from the current build loads, but warns prominently
that replay may diverge.

A fingerprint mismatch during replay stops playback and names the tick, offering
to continue anyway.

A full metrics buffer sets `truncated` and the run continues.

A seek past `endTick` clamps to `endTick`.

## Testing

`pnpm test` currently runs server tests only. Client simulation tests use the
same `tsx --test` runner rather than introducing a second framework.

1. The RNG reproduces a sequence from a seed, and the three streams are
   independent of one another.
2. `deterministicPow` matches `Math.pow` within tolerance across the slider's
   full value set, and returns identical results across repeated calls.
3. A given seed produces an identical maze grid; different seeds differ.
4. Two simulations built from one configuration and stepped 2000 times produce
   identical fingerprints.
5. The same maze seed with different ant seeds produces the same grid and
   different ant outcomes.
6. A scripted live run containing edits, saved and then replayed, matches
   fingerprints at every interval.
7. A golden trace committed as a fixture replays in CI with matching
   fingerprints.
8. Traces round-trip through serialization and parsing.
9. Malformed and wrong-version traces are rejected.

Test 7 is the one that earns its keep. It fails the build when someone adds a
mutation path and forgets to route it through the command bus, which is the most
likely way this quietly breaks.

The cross-engine question cannot run in CI, because Safari cannot be driven
there. It is documented in `CONTRIBUTING.md` as a manual check: open the app in
each browser with a fixed seed, run to tick 5000, and compare the fingerprint
shown in the Run panel.

## Sequencing

Six changes, each independently shippable as its own pull request, matching the
review workflow agreed on 8/14.

1. Extract the simulation into `src/sim/` with no behaviour change.
2. Seeded RNG, `deterministicPow`, Fisher-Yates, and the seed field in the UI.
3. Tick counter and command bus; route every UI mutation through it.
4. Fingerprints and the determinism tests.
5. Metrics buffer and CSV export.
6. Trace save, load, replay, seek, and the golden-trace test.

## Risks

The extraction in step 1 touches a large part of `AntSim.tsx` while changing
nothing observable. Keeping it as a separate behaviour-preserving commit means
that when something breaks later, it is possible to tell whether the extraction
or the new logic caused it. It needs a manual smoke check, since there are no
client tests before step 4.

The trace format will change as the simulator grows. Versioning from the first
release, and refusing unknown versions, keeps that from producing silently wrong
replays.

Fingerprinting and metrics sampling add per-tick work. The estimates here are
small but unmeasured; both intervals are configurable, so they can be relaxed if
measurement disagrees.
