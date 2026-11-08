# Individual-agent maze benchmark

Maze Agent Lab (`/maze-agent-lab`) evaluates an **executable system built by a
participant and their AI assistant**. The system may implement any memory,
mapping, exploration, planning or rule-following scheme within the declared
resource limits. Its JavaScript chooses every movement. No observer/controller
split is required.

This first version supports executable JavaScript systems. Models assist during
authoring; runtime model/network calls are not available. It measures the
submitted system's performance, not a model's isolated turn-by-turn reasoning
or coordination with other agents.

## Challenge `local-maze-agent@1` / runtime `maze-agent@1`

- One agent, no colonies, food, pheromones or coordination channels.
- Existing sim-core random maze generator: 31×31 cells, loop rate 0.1.
- Terrain RNG: `makeRng(seed + ':terrain')`. Start at (1,1).
- Breadth-first enumerate reachable cells from the start in N,E,S,W order.
  Candidate exits have shortest-path distance at least 12. Choose one uniformly
  by index using the first `makeRng(seed + ':exit')()` draw. An exit is a target
  cell inside the maze, not necessarily a boundary doorway.
- Goal position, terrain, RNG state and seed labels are hidden from the policy.
  The exit is recognized only on entering its cell; the host stops immediately.
- Exactly one decision per movement attempt, up to 4,000 attempts. A blocked
  move consumes an attempt, stays in place and increments the illegal-move count.
- Every maze starts with fresh memory. Evaluation source/prompts/code are frozen
  across mazes; the agent cannot receive the evaluation index or other results.
- At the end of a practice trial the UI reveals the full maze for inspection.
  That information is never supplied to an active policy.

Changing sensors, goal distribution, movement semantics, generator behavior,
budgets or scoring requires a new challenge version. There are no changes to
the existing Maze Simulator or its trace behavior.

## Local interface and memory

An entry is a JSON file:

```json
{
  "format": "stigsim-maze-agent@1",
  "name": "My explorer",
  "description": "What my system does and why.",
  "parent": null,
  "source": "function step(o,state){ return {move:'N',state:null}; }"
}
```

`step(o, state)` must return a synchronous `{move, state}` object. `move` is
`N`, `E`, `S` or `W`. Coordinates are reliable absolute cell coordinates: east
increases x, south increases y. Observation fields are exactly:

```js
{
  position: { x: 1, y: 1 },
  exits: { N: false, E: true, S: false, W: false },
  step: 0,
  stepLimit: 4000,
  atGoal: false,
  lastMove: null // then { direction: 'E', moved: true }
}
```

The four exit flags describe only immediate cardinal neighbors. There are no
diagonals, goal bearing, hidden-map excerpts, global metrics or shortest-path
hints. Past observations may be remembered and assembled into a learned map.
Mutating an observation cannot mutate the maze or position.

State begins null. Only the returned JSON state persists between decisions;
VM globals/closures are recreated. The participant may implement arbitrary
maps, stacks, search algorithms, rules or a deterministic PRNG in that state.
No host callbacks, filesystem, module loader, network, timers, wall clock,
`Date`, `Intl` or `Math.random` are available inside the VM.

## Budgets

The pinned interpreter is `quickjs-emscripten-core@0.32.0`, release-sync variant.
Limits apply equally to all entries:

| Resource | Limit |
| --- | --- |
| Source | 32,000 UTF-8 bytes |
| JSON state | 128,000 UTF-8 bytes per decision |
| VM memory / stack | 16 MiB / 256 KiB per decision |
| Deterministic compute | 64 interrupt callbacks per decision; 32,000 per maze |
| Observations | 2,000,000 UTF-8 JSON bytes per maze |
| Movement attempts | 4,000 per maze |

Compute includes guest parsing, source execution and output serialization.
Returned JSON state size and peak state usage are recorded. Illegal output,
JavaScript errors or exhausted resources end the trial as a failure worth zero.
A Worker provides responsive playback and cancellation; the isolated VM is
the guest execution boundary. Organizer runs should additionally use an
unprivileged process/container with no credentials before accepting public code.

## Development and evaluation

The browser exposes a fixed public corpus of 20 practice seeds:
`maze-agent-practice-v1:1` through `maze-agent-practice-v1:20`.
Repeated debugging on those same mazes is allowed. Practice playback has play,
pause, single-step, speed selection and an observation/memory inspector.
Code edits require Apply & restart. Run exports retain the exact applied code.
A depth-first explorer and a right-hand-wall policy are provided as examples.

The **Starter kit for your AI** opens an editable briefing containing the full
contract, budgets, practice corpus, scoring and current entry. Copy or download
it, work with an assistant, and import its returned entry JSON.

**Freeze & test on 100 mazes** snapshots the entry and evaluates one identical
system on 100 distinct seeds. A random local set ID generates seeds as
`maze-agent-local:${setId}:${i}`, i=1..100. The same set is reused for comparisons.
A fresh set clears the local session's table. No code, memory or result feedback
passes from one test maze to another. Cancelled batches show progress but never
enter the table. Up to ten completed local result sets remain in memory;
export files to save them across reloads.

A local browser cannot enforce secret tests or police all external authoring.
The 20-maze allowance is a provided development corpus, not proof that an
entrant used no additional training data. Code/generator access lets someone
construct other mazes offline. A formal model-comparison study must control the
authoring environment and separately log/limit development time, inference and
practice access. This preview does not meter external AI authoring costs.

Likewise, using local evaluation feedback makes that set development data.
Official evaluation must freeze source hashes before choosing private seeds,
run outside the entrant's browser and publish the manifest only afterward.

## Scoring

The main score is:

```
100 × mean(solved ? shortest_path_length / movement_attempts : 0)
```

All 100 mazes count, including failures. The shortest route is calculated by
the host with the full map strictly for scoring, and is never given to the
policy during play. Search/exploration overhead counts: this is an efficiency
measure for an unknown-goal task, not evidence that an agent should know the
shortest route in advance.

Also report completion rate, mean attempted moves among successful runs,
blocked moves, errors, total compute, and per-trial peak JSON memory. Mean moves
among successes is descriptive, not the ranking metric: solving only easy
mazes cannot improve the main score by excluding failures. The standard error
is calculated across per-maze scores with sample variance (n−1 denominator).
Small differences should be checked on a fresh set rather than repeatedly
optimized against the same test outcomes.

## Organizer CLI

1. Collect 1–20 entry JSON files in a directory and freeze their content hashes.
   The ID is SHA-256 of UTF-8 `JSON.stringify(parseEntry(entry))` with canonical
   field order: format, name, description, parent, source.
2. After freezing, create a manifest with exactly 100 unique, non-practice seeds:

   ```json
   {
     "format": "stigsim-maze-agent-round@1",
     "name": "Round 1",
     "seeds": ["organizer-private-1", "...99 more actual unique seeds..."]
   }
   ```

3. On a pinned repository commit and Node version:

   ```sh
   pnpm install --frozen-lockfile
   pnpm maze-agent-round ./entries ./manifest.json ./results.json
   ```

4. Publish the manifest, sources, results, repository commit and Node version.
   The runner refuses to overwrite a result file. Sources execute only in
   QuickJS, using the same runtime as browser practice and evaluation.

Results are `stigsim-maze-agent-results@1`: frozen entry source/IDs, rules,
budgets, interpreter version, manifest, all outcomes, resource usage and
movement logs. `replay(entry, seed, outcome)` applies logged movement commands
without executing guest code and checks positions, blocked moves, completion,
shortest distance and efficiency. It does not remeasure guest compute or memory.
These records are separate from ant-simulation traces and have no trusted
signature; organizers are responsible for authenticating official results.
