# Maze Memory Lab

Build a navigation system for a small model. Your code interprets local observations,
prepares instructions/context, and writes free-form JSON notes in the maze. The
model chooses **every** N/E/S/W move. There is no persistent private strategy
state or conversation history. This preview integrates the PR #34 workshop and evaluation tool into the
existing password-protected Model Ant service. Results are not a trusted leaderboard.

## Protected preview integration

The preview branch exposes `/maze-memory` beside the other experimental modes.
`server/src/model-ant-preview.ts` mounts `/api/maze-memory` behind the same
preview flag and Basic authentication as Model Ant. An additional same-origin
check rejects foreign browser origins. Ordinary production does not mount it.
Credentials stay server-side; no extra public port or database is required.
The existing gateway variables are reused. `MAZE_MEMORY_MODEL` can override
`ANT_MODEL`; the default is Jev. Calls serialize across this lab's runs.

Use `pnpm preview:model-ant` after building. For Vite development, run the
protected backend on port 3018 (or set `DEV_MEMORY_API_TARGET`) and `pnpm dev`;
the development proxy sends `/api/maze-memory` to that backend. The browser uses
relative same-origin API paths. All pages retain the existing preview password.

Starting a sandbox allocates a run but makes no paid request. Play/step makes
model calls; starting an evaluation begins calls immediately. No inference is
needed to import and watch a recording. Export in-memory runs before redeploying.

The source PR's standalone loopback runner remains available for CLI experiments;
its `/local-maze-memory` API retains local-origin checks. The integrated UI uses
the authenticated preview API instead of that standalone endpoint.

## Run locally

Node 22.13+, pnpm, and a model endpoint are required. Install and build:

```sh
pnpm install
pnpm build
```

Keep credentials in an untracked file outside the repository (never use `VITE_`
variables). Example configuration, with your own endpoint and credential:

```dotenv
MAZE_MEMORY_MODEL=typesafeai-jev-1-14-0
ANT_DECISION_BASE_URL=https://your-provider.example/typesafe/v1
ANT_MODEL_API_KEY=your-credential
```

Optional standalone API:

```sh
# Terminal 1: inference credential holder, bound to 127.0.0.1:3016
node --env-file=/path/to/model.env --import tsx scripts/maze-memory-server.ts

# The standalone API is for local clients; the integrated UI uses the preview host.
```

The standalone runner can be used by local API clients. To use the integrated UI,
run the protected preview host as described above. The runner refuses production startup.
Ordinary static hosting does not expose an inference endpoint. Do not expose
the standalone runner publicly. The status indicator confirms configuration,
not provider availability or remaining credits.

Typesafe model names beginning `typesafeai-` use the `systemone` choice endpoint.
Other model names use a chat-compatible endpoint with a forced `choose_move`
function. Set `ANT_MODEL_BASE_URL` for chat inference. Existing `ANT_MODEL`,
`ANT_MODEL_API_KEY`, `ANT_DECISION_BASE_URL`, or
`NEON_AI_GATEWAY_BASE_URL`/`NEON_AI_GATEWAY_TOKEN` configuration is supported.
Model endpoints and credentials remain server-side. Inference uses the configured
endpoint and consumes credits. No designer model is
called automatically.

## Create → watch → evaluate → export

1. Copy **Starter kit for your AI** into your preferred coding assistant. Have it
   return one strategy JSON file. Import it or edit the starter in the sandbox.
2. Apply the strategy to one of 20 reproducible practice mazes. Step or play;
   inspect the local notes and recent model decisions. Writes commit only after
   a valid, uncancelled model response. No fallback or automatic retry replaces it.
3. Pause and watch **Memory replay**. Step, seek, change speed or select a maze.
   Inspect before/after notes, proposed conditional writes and exact prompts.
   Replay reconstructs movements and writes without executing imported source
   or contacting the model. Import a run file to inspect someone else's results.
4. Freeze the strategy and test on 1–100 evaluation mazes, **sequentially**.
   An explicit total request budget covers the entire batch. Reuse a round ID
   to compare strategies on the same mazes; choose a new ID for fresh mazes.
5. Export the strategy and run/results. Export before starting over or leaving:
   runs are in-memory, page navigation cancels/deletes the active run, and idle
   sessions expire after one hour. Imported recordings can be watched without a model connection.

The starter chooses the least-used open passage; ties use N,E,S,W. Code stores
`{visits:n}` on each undirected passage and prepares conditional increments for
possible moves. Only the passage actually crossed is updated. This is one
example; the storage system prescribes no field names or meanings.

## Strategy contract

A strategy file has `format:"stigsim-maze-memory-strategy@1"`, `name`,
`description`, `parent:null` (or a 64-character parent hash), and `source`.
Implement synchronous `prepare(o)` returning `{instructions,context,writes}`.
Returning `state`, `move` or `action` is rejected. Each preparation runs in a
fresh QuickJS VM; ordinary variables cannot survive calls. Code may compute
recommendations: requiring a model-selected move does not prove independent
navigation reasoning. We evaluate the whole designed system.

Observation fields:

- `position:{x,y}`: reliable coordinates; start (1,1), east +x, south +y.
- `exits:{N,E,S,W}`: current adjacent open/blocked passages.
- `step`, `stepLimit`, `atGoal`, and `lastMove:{direction,moved}|null`.
- `environment:{cell:JSON|null,passages:{openDirection:JSON|null}}`.

No hidden maze, goal location or seed is supplied to code or the model. The
model always receives the original local observation plus instructions/context.
Only the current cell and open adjacent passages can be read or written.
Passage notes are shared between their two endpoints. Notes reset each maze.

```js
function prepare(o) {
  return {
    instructions: 'Explore open passages. Use the local notes to avoid repeated routes.',
    context: { cellNote: o.environment.cell },
    writes: [
      { target: 'cell', value: { status: 'visited', note: 'An arbitrary JSON note' } }
    ]
  };
}
```

A write replaces the entire note; `value:null` clears it. Read/merge an existing
object in code if desired. Targets are `cell`, an open compass direction, or
`chosenPassage`. Optional `when:"chosen"` is valid only on compass targets and
applies only if that exact movement succeeds. `chosenPassage` likewise requires
successful movement. Other writes commit after a valid response even when
movement is blocked. All targets refer to the pre-movement position. Multiple
writes apply in array order. Failed, invalid or cancelled inference commits
nothing. Duplicate completed-step requests never repeat inference or writes.

| Resource | Limit |
| --- | ---: |
| Source | 32,000 UTF-8 bytes |
| Instructions | 8,000 characters |
| Context | 24,000 JSON bytes |
| Note | 2 KiB JSON bytes/location |
| Writes | 16 operations, 8 KiB JSON bytes/decision |
| Environmental storage | 1 MiB serialized JSON/maze |
| JSON depth | 32 |
| VM | 16 MiB heap, 256 KiB stack |
| Execution | 64 interpreter interruption checks/call, 32,000/maze |
| Cumulative code observations | 2,000,000 bytes/maze |
| Movement | Up to 4,000 attempts/maze |
| Hosted requests | Explicit shared cap, up to 100,000/run |
| Logs | 64 MiB/run; no silent truncation |

There is no filesystem/network/clock access or ambient randomness. Preparation
is synchronous. All possible local write outcomes are validated before a paid
request. Raw local notes consume inference tokens as well as code observation
budget. Limits cause explicit failures/stops, never silent note truncation.

## Results and interrupted runs

Completion and cost are separate. Display requests, input/output tokens, unknown
usage and finished/solved maze counts. Tokens per solution is total reported
input+output tokens divided by solved mazes, **including spending on unsuccessful
mazes**, and is shown only for a fully finished batch with known usage and at
least one solution. Tokens are an equal-weight proxy, not dollar pricing.

Blocked valid moves consume a movement. Movement-limit, malformed model-response
and strategy-code failures are unsuccessful completed trials. A provider failure,
request/log-budget stop or cancellation leaves an incomplete, unranked run;
it does not silently discard unattempted mazes. Stop aborts an active request,
but cancellation cannot guarantee reversal of an inference charge. The runner
serializes model calls across its sessions to reduce rate-limit pressure.

Live snapshots contain only the last ten decisions. The exported
`stigsim-maze-memory-run@1` record retains the frozen strategy and hash, model,
limits, manifest, outcomes, all bounded observations/preparations/writes,
validated public answers and token usage. Hidden provider reasoning is not
requested or exposed. Inference is not deterministically replayable; its
**recorded actions and memory writes** are. Import validates them against the
seeded maze and local notes. It never executes imported source. Browser imports are validated in a background
worker with a 30-second validation budget. Recordings are
unsigned diagnostics: users can fabricate model answers or reported costs, so
these files are not authoritative leaderboard submissions.

## Headless evaluation

Provide an organizer manifest `{ "name":"Round one", "seeds":["private-1", ...] }`
with 1–100 unique non-practice seeds, and an exported strategy:

```sh
node --env-file=/path/to/model.env --import tsx scripts/maze-memory-round.ts \
  strategy.json manifest.json results.json 20000 4000
```

The final arguments are the shared request cap and moves/maze (defaults 1,000
and 4,000). The same runtime, preparation VM, provider validation and sequential
run path are used. Existing output files are preserved. Credentials are never
included in recordings. Local browser rounds use visible, reproducible seeds;
trusted hidden rounds, hosted submissions, authentication and public rankings
are intentionally outside this MVP.

## Architecture and validation

`maze-memory@1` uses the Mode SDK and the shared core's seeded maze generator.
`Trial.apply` is the sole movement/write mutation path, also used by playback.
The mode does not change colony physics or reuse War/Infinite lifecycle rules.
Code executes server-side inside pinned QuickJS 0.32.0; the browser lazily loads
only this lab and its replay tools. Provider calls are injected in tests; CI
makes no hosted calls.

Run `pnpm test:maze-memory`, `pnpm typecheck`, `pnpm build`, and the full
`pnpm test` before submission. Tests cover local information boundaries, fresh
VMs, forbidden state/movement, budgets, free-form JSON and conditional writes,
cancellation, duplicates, sequential 100-maze batches, cost accounting, replay
tampering and the loopback HTTP boundary. Browser-check the built preview:
import/export, sandbox movement, memory changes, playback and short evaluations.
