# Strategy Lab preview

Players invent strategies for collecting food, inspect each other's observer
and controller logic, and remix it. Fixed settings are ordinary entries.
A round tests frozen entries on the same fresh mazes.

The preview provides split observer/controller editors, a live single-maze
sandbox, a 100-maze evaluation, portable strategy/result files and replay traces,
and an organizer CLI.
Sharing happens through files or a repository. There is no hosted submission
service, public leaderboard, account system, or model provider dependency.

## Fixed challenge: `food-collection@1`

- Existing `maze@1` engine, simulation version 3; no physics changes.
- Random 31 × 31 maze, 10% loops, one colony of 20 foragers.
- Three finite food sources of 200 units each; gland capacity 6,400.
- Private trails, instant doctrine adoption, no death or reproduction.
- Every successful trial runs exactly 3,000 simulation ticks.
- Score: mean food **delivered home** at tick 3,000 across every maze/replicate.
  Carrying food does not count. Higher wins; equal scores tie.
- Each entry gets its own copy of the same maze, food placement and ant RNG
  stream. Entries never play in a shared world or against a changing opponent.
- Maze/food streams derive from `makeSeeds(mazeSeed)`; ant stream is
  `${mazeSeed}:ants:${replicate}`, with zero-based replicate index.

Initial/reference settings are evaporation 0.002, trail bias 7, food-trail
deposition 2. They were a strong candidate in earlier experiments, **not a
proof of a globally optimal fixed setting**. The gallery's circulation detector
is an illustrative controller, not a certified mill detector or a reproduction
of all earlier research results. Scores in this challenge must be established
afresh; the preview makes no claim that a pulse entry wins.

Changing horizon, maze distribution, ant count, action semantics, observation
schema, resource budgets, sandbox engine or scoring requires a new challenge
version. Changes to simulation behavior also follow the repository's
`SIM_VERSION` and golden-trace rules. Keep an old version runnable if publishing
results that rely on it. Practice results are not official records.

## Sandbox and evaluation

The main workspace places observer/controller code on the left and a live maze
on the right. Play, pause, single-step, reset, change speed, choose a seed or
create a new maze. Edits pause playback and require **Apply edits & restart**;
program/settings changes never silently enter an already-running trial. The
sandbox displays current delivered food, ant count, trail bias, interventions,
and an expandable signal/action inspector. Completed runs export a Maze replay
trace. One trial is for debugging, not a leaderboard score.

**Test on 100 mazes** evaluates only the selected strategy, with one ant-stream
replicate per maze. The test-set seed starts as a random UUID. Maze seeds are
`${testSetSeed}:maze:${i}`, with i from 1 to 100. Repeated tests reuse that exact
set, so strategies listed together have identical evaluation conditions.
**New test set** starts a fresh set and clears the session's local result table.

The evaluation shows per-trial progress, mean food, standard error across mazes
and failures. Cancellation terminates the worker and leaves a partial progress
summary, never a ranked score. Any failed trial makes a completed entry unranked.
Result exports contain all 100 outcomes and the reproducible manifest; only
maze 1 retains a full trace to bound storage. The CLI continues to retain every
trace by default. The local result table is session-lived: export files to save
results. No special reference competitor is automatically inserted.

## Observer and controller editors

Both functions belong to one submitted strategy. The observer chooses what to
measure, the signals' names/definitions, history and sampling times:

```js
function observe(o, state) {
  return { signals: { food: o.foodDelivered }, state: null,
    nextTick: Math.min(o.tickLimit + 1, o.tick + 10) };
}
```

The controller consumes those author-defined signals and returns settings:

```js
function control(signals, state, context) {
  return { state: null }; // Hold the initial settings.
}
```

Context includes `tick`, `tickLimit`, current `settings` and `initial` settings.
Each observation invokes the controller. The functions have separate JSON
state, initialized to null. Both must be synchronous. A small exported adapter
combines them into the existing `step` contract below; it retains initial
settings, observer state, controller state and the last signals. These all count
toward the same state and compute budgets. The signals are visible in the
sandbox inspector. Independent controller timers are not provided in this
version; the observer must schedule a call when restoration is needed.

Exports still use `stigsim-strategy@1`: the source contains both functions and
the adapter. Existing arbitrary `step` files import into a combined editor and
remain executable without rewriting. Split editors are shown only for a
lossless, recognized adapter source; custom code is never discarded.

## Portable strategy: `stigsim-strategy@1`

```json
{
  "format": "stigsim-strategy@1",
  "name": "My strategy",
  "description": "Explain the hypothesis and what changed.",
  "parent": null,
  "initial": { "evaporation": 0.002, "trailBias": 7, "foodDeposition": 2 },
  "source": "function step(o, state) { return { nextTick: 3001, state: null }; }"
}
```

A strategy ID is the SHA-256 hex hash of UTF-8 `JSON.stringify(parseStrategy(file))`,
using canonical field order from `contract.ts`. Identity includes metadata,
initial settings, source and parent. A remix records the original's ID in
`parent`; authors can publish both files together. A parent is provenance, not
an endorsement or a verified authorship claim. Files import as data and are
never evaluated in the browser or Node host's JavaScript context.

`step(observation, state)` is synchronous. It returns:

```js
{ nextTick: 137, state: { myHistory: [] }, settings: {
  evaporation: 0.002, trailBias: 0, foodDeposition: 2
} }
```

The first observation is at tick 0, before the first simulation step. Subsequent
observations happen exactly at the entrant's `nextTick`, after that tick has
completed. `nextTick` is an absolute integer greater than now and at most 3,001.
Choosing a value at or beyond 3,000 ends observation calls for that trial.
Observation calls take no simulation time. Settings changes enter the command
bus and apply **before physics on the following tick**. Initial settings also
apply at tick 1. Settings are optional; if included they must be complete:

| Setting | Bounds | Meaning |
| --- | --- | --- |
| evaporation | 0–1 | Per-tick trail fading |
| trailBias | 0–32 in 0.5 steps | Own food-following bias when searching and own home-following bias when returning |
| foodDeposition | Integer 0–3 | Returning foragers' own food-trail deposit weight |

All other doctrine fields use the engine's fixed defaults. Entrants cannot
change terrain, food, ant count, colony roles, gland size, simulation clock or
random seeds. Repeated identical settings do not consume setting-change budget.

## Observation is part of the entry

The host supplies raw **current** state, with no imposed detector or temporal
features. Entries choose sampling intervals, history windows, spatial features,
thresholds, hysteresis and interventions in their source. They can sample at
irregular ticks. There is no engine-supplied mill score.

| Field | Shape |
| --- | --- |
| tick, tickLimit | Current completed tick and fixed horizon |
| cols, rows | Map dimensions |
| open | Row-major array, 1 for open cells, 0 for walls |
| nest | `{x,y}` cell coordinates |
| ants | `{id,x,y,carrying}[]`, positions in continuous cell coordinates |
| food | `{x,y,remaining}[]` |
| trails | `{home: number[], food: number[]}`, row-major, raw full precision |
| foodDelivered | Food returned to nest |
| settings | Current permitted settings |

Ant IDs are stable zero-based array indices because this challenge has no
births/deaths. A cell index is `y * cols + x`. Ant centers are at cell coordinate
`x + 0.5, y + 0.5`. A snapshot includes the entire visible field; entries can
compute any subset/features, but each delivered snapshot costs its full UTF-8
JSON byte size. Selective sensor queries are a possible future version.

Only the explicitly returned JSON `state` persists between calls. A fresh
QuickJS VM is created for each call; top-level variables and hidden globals do
not persist. The VM receives copies, so editing an observation cannot change
the simulation. It has no future states, RNG state, seed labels, opponent source,
engine object, filesystem, network, timers, host callbacks or module loader.
`Date`, `Intl`, `WeakRef`, `FinalizationRegistry` and `Math.random` are unavailable.
Use explicit deterministic state if your strategy needs a pseudo-random policy.

## Equal resource budgets

| Resource | Per trial |
| --- | --- |
| Source | 32,000 UTF-8 bytes |
| Persistent JSON state | 64,000 UTF-8 bytes per decision |
| Observations | 16,000,000 UTF-8 JSON bytes cumulatively |
| VM memory / stack | 16 MiB / 256 KiB per call |
| Compute | 128 interrupt callbacks per call; 8,192 cumulatively |
| Setting changes | 128 (initial setting excluded) |

The pinned runtime is `quickjs-emscripten-core@0.32.0` with the
`@jitl/quickjs-wasmfile-release-sync@0.32.0` variant. Its deterministic interrupt
callback count is the compute meter; wall-clock speed is not a competitive
resource. Parsing and serializing in the VM count toward fuel. The runtime's
memory and interrupt limits contain runaway code; the Worker provides UI
responsiveness and cancellation, not the security boundary. See the
[QuickJS wrapper documentation](https://github.com/justjake/quickjs-emscripten).

A parse error, invalid decision, exhausted budget or runtime failure ends that
trial immediately and makes the entry **unranked for the round**. Partial food
remains visible for debugging but never contributes to a ranked score. There
is no silent fallback controller and no dropping inconvenient trials.

This is an initial sandbox implementation, not an independently audited public
execution service. Organizer CLI runs should use an unprivileged isolated
process/container with no credentials, alongside the VM limits. A future hosted
service needs a separate security and operations review.

## Evaluation and interpretation

A 100-maze local evaluation is substantially more useful than a single sandbox
run. It is still possible to overfit through repeated tuning on the same set.
Use another fresh set before making general claims. Official rounds should
freeze entries before selecting fresh organizer-held seeds.

For a larger round, average replicate outcomes within each maze, then compare
paired maze means. The reported standard error treats mazes as independent
units; ant replicates do not inflate the maze count. Publish distributions and
uncertainty alongside leaderboard means when making research claims. Precommit
the test size and compare on fresh held-out seeds before claiming improvement.

## Organizer workflow

1. Choose and publish the versioned challenge, deadline and scoring rules.
2. Collect strategy JSON files in a directory; freeze entries by content hash.
   Include the exported fixed reference if comparisons against it are wanted.
3. After the deadline, choose fresh random seeds not used in practice. Keep the
   round manifest private until evaluation ends. The browser does not pretend
   to hide seeds shipped in its assets.
4. Create a manifest, using 2–200 unique maze seeds and 1–3 replicates:

   ```json
   {
     "format": "stigsim-strategy-round@1",
     "name": "Round 1",
     "seeds": ["fresh-opaque-seed-a", "fresh-opaque-seed-b"],
     "replicates": 2
   }
   ```

5. On the pinned repository commit and Node version, run:

   ```sh
   pnpm install --frozen-lockfile
   pnpm strategy-round ./entries ./round.json ./results.json
   ```

   There must be 1–20 entries and no duplicate content IDs. The runner refuses
   to overwrite an existing result. It evaluates entrant source only inside
   QuickJS, using the same path as browser sandbox/evaluation.
6. Publish results, the manifest, all entry files and the repository commit/Node
   version used. A result includes entry sources/hashes, rules, budgets, engine
   version, per-trial fingerprints, action timing, resource usage and traces.
   Others can rerun the manifest. Exported individual traces also load in the
   existing Maze Simulator. Replays execute accepted commands, not guest code.
7. Invite explanations and remixes for the next round.

The preview does not authenticate result files or establish trusted organizer
identity. An official leaderboard needs human verification or a trusted runner;
local practice cannot submit an authoritative score.
