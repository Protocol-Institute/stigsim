# Model Ant experiment

Open `/model-ant` from the simulation index. One language model chooses each
move in a seeded 31 × 31 maze. The exit is reachable; the model is not promised
to find it. This experiment is separate from the deterministic colony modes.

The model's goal is: “Solve the maze as fast and cheaply as possible: minimize
elapsed time, movement and model usage. How you use your conversation context
and pebbles is up to you.” Separate tool descriptions explain the mechanics.
No exploration algorithm, marker convention, journal format or memory structure
is assigned.

Version 3 supplies only current coordinates, four adjacent cells, local pebble
counts and the previous action result. The automatic notebook and visit counts
are observer bookkeeping only and are never sent to the model. The model keeps
its actual conversation of observations, public replies, tool calls and results.
The observer can view the whole maze or the ant's immediate view.

## Connect a model locally

Start the frontend with `pnpm dev`. In a second terminal, set the following
server environment variables and run `pnpm dev:server`:

- `ANT_MODEL`: exact model ID from your provider's catalog.
- `NEON_AI_GATEWAY_BASE_URL` and `NEON_AI_GATEWAY_TOKEN`: your existing Neon
  gateway host and credential. The adapter appends `/v1/chat/completions`.

Alternatively, set `ANT_MODEL_BASE_URL` to a chat-completions-compatible base
URL ending in `/v1`, and optionally `ANT_MODEL_API_KEY` for its bearer token.
This supports a local model endpoint as well as hosted providers. These
variables override the Neon connection. Export them in your shell; the server
does not automatically load a dotenv file. Never put credentials in Vite vars.

The provider must support chat-completions function tools. `act` accepts only
`direction` and `pebbleAction`. No reason or memory rewrite is required.
Public assistant text is optional. `compact_context(summary)` lets the model
replace older conversation with a brief factual continuation summary; the
current observation and system mechanics are retained. Summaries remain
model-authored messages, never system instructions. There is no automatic
summary or silent truncation. The next tool result includes the previous
step's provider-reported token usage, allowing the model to observe usage.

The UI pauses after each movement attempt. A step may use up to six model
requests for optional text or context management before acting, within a
60-second deadline and a 250,000-character conversation bound. Reaching a
limit pauses with an error instead of making an automatic move. Runs stop at
the exit or 200 movement attempts. Pause finishes the current step.

Conversations are isolated by random run IDs on the local server. Reset starts
a new conversation; restarting the server or one hour of inactivity expires
context and requires a reset. At most 16 sessions are retained. An identical
retry of the last completed step returns its cached decision without a new
provider request. Failed steps do not advance context or the maze. The UI
records failed attempts and unavailable usage explicitly.

Activity shows actual actions, outcomes, context summaries and any optional
public explanation. It is not a private chain-of-thought trace. Hidden provider
reasoning fields are neither read nor displayed. Provider-reported output-token
usage may include reasoning tokens, but does not expose their contents.

This initial endpoint is disabled in production because the app currently has
no account-based authorization or inference budgets. Use the local development
server for experiments. Hosted access and model competition are future work.

Download experiment saves the seed, exact system prompt, observations,
validated decisions, model IDs, and request latency. This is an inspection log,
not a Mode SDK replay trace. Model calls themselves are not reproducible;
maze generation is. Swarms, shared memory, and competitive scoring are not yet
part of this prototype.

Implementation: `shared/model-ant.ts` owns the observation/action contract;
`src/modes/model-ant/maze.ts` owns the environment and observation notebook; `server/src/model-ant.ts` owns the HTTP/session boundary;
`server/src/model-ant-agent.ts` owns model conversations and tool handling. Future models can use the same observation contract.

Provider reference: https://neon.com/docs/ai-gateway/chat-completions

## This local workspace

The experiment is configured for `typesafeai-jev-1-14-0` in action-selection mode on the Neon preview project's
`model-ant-experiment` branch. Its inference-only credential is stored in the
gitignored, owner-readable `.env.model-ant.local` file. Start the configured
server with `pnpm dev:model-ant` and the frontend with `pnpm dev`.

The previous comparison model was `gpt-5-mini`. The model is selected by
`ANT_MODEL` in the local environment file. Restart the configured server and
start a fresh browser run after changing it. Inference uses your Neon AI Gateway
credits.

## Pebble experiment

The ant starts with 12 identical reusable pebbles. The `act` tool includes
`pebbleAction`: `none`, `drop`, or `pick`, plus a movement direction. Drop and
pick transfer one pebble on the current cell **before** movement; stacking is
allowed. Impossible transfers fail explicitly but movement still proceeds.
A wall collision still applies the chosen pebble action on the current cell.
The total number of pebbles is conserved. Reset clears the field and restores 12.

Only current and adjacent pebble counts reach the model. Remote placements are
sent as a global field; the model may remember placements in conversation. Observer view shows every placed pebble; local view hides
remote markers. The automatic notebook is no longer supplied to the model in version 3.

The prompt explains mechanics but assigns no meaning or strategy to markers.
No pebbles are placed automatically. Downloads now use
`stigsim-model-ant-experiment@3`, with exact goal, mechanics and tool definitions,
local observations, decisions, optional public explanations, model-selected
compactions, actual outcomes, per-step request/token usage, failed attempts,
and final pebble placements. Earlier version-1 and version-2 downloads remain
unchanged. These files are inspection logs, not SDK replay traces. Dollar costs
are not estimated: actual prices and cached-input discounts belong to provider
billing. Full context is resent until the model chooses to compact, which can
increase token use.

## Shared browser-only maze generator (version 4)

Model Ant now calls `generateMaze` from `@stigsim/sim-core`, using the same
`makeSeeds(master).maze` stream and random layout as the browser-only Maze
Simulator. Both use 31 × 31 cells and default to 10% extra holes (loops). Enter
the same master seed and loop rate in each mode to reproduce the same terrain.
Seeds may be text, including the browser simulator's generated seed names.

The loop slider runs from 0% to 50%, matching the browser-only mode; changing
it or resetting a seed starts a fresh model conversation and clears pebbles.
Model Ant still starts at (1,1), with the exit at the opposite nest corner,
(29,29), sensed only when adjacent. The 200-attempt limit still applies.

Downloads use `stigsim-model-ant-experiment@4` and include the generator name,
layout, dimensions and loop rate. A version-4 seed produces different terrain
from the old 15 × 15 generator; old downloaded logs are unchanged.

## Persistent model-authored policy (version 5)

Each run begins with a blank policy document. The `update_policy(policy)` tool
lets the model replace the entire document or clear it with an empty string.
There is no required template, initial strategy, marker convention, or
requirement to create a policy. The free-form text is limited to 8,000 characters.
It is an observable strategy artifact; no private reasoning trace is requested.

The current policy is supplied on every provider request as a separate
model-authored message, not a system instruction. Context compaction replaces
conversation history but leaves the policy intact. Updating a policy does not
move the ant or automatically choose an action. A fresh/reset/expired session
starts blank. Model text does not change the environment's rules.

Policy changes and conversation changes commit together only when a valid
movement action is returned. If a step fails, its attempted revisions may
appear in failed-attempt events, but they do not replace the last committed
policy. The six-request/60-second step bounds still apply, including policy
updates. Token usage includes those extra model requests and the policy text.

The Policy panel shows the current document and numbered revision history,
including each previous version and the move it preceded. This records stated
strategy; it does not establish that actions followed the policy. Downloads
now use `stigsim-model-ant-experiment@5`, adding final policy, revision count,
per-step policy snapshots, and policy-change events with previous text.

Claude gateway requests omit `parallel_tool_calls`, which this gateway rejects
for Claude models. The adapter still validates one tool call at a time.

## Token and spending stats

The main stats show tokens used and estimated USD cost for the current run.
They include all recorded successful steps and failed requests with usage data,
including policy/context-management requests. Reset clears these run totals.
A `+` on tokens and a partial label indicate missing usage or pricing; missing
data is never counted as a known zero.

Estimates use the checked-in public Neon price snapshot in
`src/modes/model-ant/model-pricing.json`, with separate input and output rates
per million tokens. They exclude cache discounts and are not Neon's actual
billing ledger. Unsupported/unknown prices show an unavailable or partial
estimate. Small dollar amounts display up to four decimal places.
Downloads include an additive `accounting` summary with known tokens, estimated
cost, completeness flags, pricing date/source and the model rates used.

## Jev and action-selection comparisons (version 6)

The local experiment is now configured for `typesafeai-jev-1-14-0` (Jev 1.14),
with `ANT_EXPERIMENT_MODE=selection`. Decision models always use selection mode,
including `openjev-qwen35-4b`. Requests use the existing Neon credential on
`/typesafe/v1/systemone`. An alternative decision host can be supplied with
`ANT_DECISION_BASE_URL`, ending in `/typesafe/v1`. No SDK dependency is needed.

Each request asks a single choice question over the same 12 combinations:
4 movement directions × 3 pebble actions (none/drop/pick). Every option is
always present, even when blocked or impossible. The selected action is applied
directly, and failures consume a movement attempt as in the agent mode.

State consists of the same goal and mechanics, current local observation, and
all prior local observations paired with their selected action IDs. No hidden
maze, seed, automatic notebook or visit counts are sent. No policy authoring or
context compaction is available in selection mode. History remains isolated by
run ID; reset clears it. Retries of the same completed step are cached.

To compare GPT or Claude under the same action interface, set `ANT_MODEL` to
`gpt-5-mini` or `claude-sonnet-4-6`, retain `ANT_EXPERIMENT_MODE=selection`,
restart `pnpm dev:model-ant`, and start a fresh browser run. The chat adapter
supplies identical state and options through one forced `select_action` tool.
For the original policy-writing experiment, set `ANT_EXPERIMENT_MODE=agent`
and use a chat model. There is no cross-mode automatic conversion of a run.

The UI identifies selection mode and shows the last chosen action, reported
confidence, and per-option probabilities when provided. These scores are not
explanations or calibrated accuracy. GPT/Claude comparison calls do not invent
probabilities if their provider does not return them.

Jev's provider-reported input/output token counts are both displayed, but only
input tokens are billed. Its cost snapshot therefore has a zero output rate.
Version-6 downloads record experiment mode, action options, question, selected
actions, provider probabilities/confidence, served model ID (when supplied),
usage and outcomes. Free-form agent runs and selection runs should be analyzed
as different experimental conditions.

The browser paces requests against a conservative 160,000-token rolling minute
budget, estimating the next request from reported usage and context growth.
This changes timing only; it does not discard history or choose actions.
HTTP 429 triggers a visible 60-second cooldown. Running experiments retry
automatically, then pause after three consecutive rate-limit responses.
Paused experiments remain paused. Exported pacing settings are separate from
provider-reported usage and estimated costs. Other clients sharing the gateway
can still exhaust its limit; Neon support can raise eligible account limits.


### Observed-map comparison

Selection mode now has a “Give the model an observed map” checkbox, off by
default. Reset before changing the condition. Both conditions retain the same
full history, question, action options, pebbles, maze and move limit. The
assisted condition additionally supplies `observedMap`: sorted coordinates,
observed cell types, and cell-entry counts. Adjacent passages with zero entries
are visible but unvisited; absent coordinates remain unknown. Blocked attempts
do not count as entries. No hidden terrain, exit coordinates, route planning,
frontier ranking or move filtering is added. The map is automatic bookkeeping,
not model-authored memory. This comparison applies to GPT/Claude selection mode
as well as Jev. Agent mode is unchanged.

Version-7 exports label the observation-support condition and retain the exact
map supplied with each successful step, before its action. The UI lets observers
inspect that snapshot. Compare fresh runs with identical seeds and loop rates;
assistance is fixed within a run. Providing a map tests navigation with explicit
state rather than the ability to reconstruct that state from history.

### Supplied-policy execution test

“Supply an exploration policy” enables observed-map support and supplies the
fixed `exploration-v1` policy on every selection request. This is a separate
condition from broad-goal navigation. The policy prefers adjacent unvisited
passages, otherwise a shortest known route to a visited cell bordering an
unvisited passage. Ties use north/east/south/west, including lexicographic route
ties. If no frontier is reachable, no direction is prescribed. Pebbles remain
unconstrained. Settings are fixed per run; reset to change them.

After the provider chooses, a breadth-first checker computes the expected
movement using only the same observed map. It never filters options, overrides
action choices, or supplies its result to subsequent model requests. The UI
reports departures over checked moves; exhausted-map steps are unscored.
Version-8 exports retain supplied policy text and each step's expected/actual
direction, compliance and check basis. Observed maps are request-time snapshots.

For supplied-policy runs, the decision question explicitly requires compliance:
“Which action follows the supplied policy? Treat its movement rules and
tie-breaks as mandatory, taking priority over the general speed and cost
objective. Pebble use remains up to you.” Broad-goal runs retain their original
question. Version-9 exports record the exact question on every successful step
and at the run level, so older policy-in-state tests remain distinguishable.

### New experiment setup (version 10)

The Model Ant page opens a setup screen before any run. Choose a server-approved
model, seed (or randomize it), loop rate, history-only or automatic-map inputs,
and one of four strategies: model chooses, right-hand wall following, unvisited
passages first, or custom text (up to 8,000 characters). Exploration requires the
automatic map. Right-hand following exposes an initial heading; only successful
moves update it. It may loop in mazes with extra connections. Custom instructions
are mandatory but have no automatic compliance score.

Every UI-created experiment uses selection mode for comparable model inputs and
action options. Free-form agent mode remains available through the existing API
but is not an option on this setup screen. Start opens a paused run; model calls
begin only with Run or One step. Active-run settings are read-only. New experiment
pauses the run and opens prefilled setup; Back returns to it, while Start creates
a fresh run. Download the previous record before replacing it.

The server supplies its permitted model IDs via `/status`. With Neon, the default
shortlist is the configured model plus Jev, OpenJev, GPT-5 mini and Claude Sonnet
4.6. Set `ANT_ALLOWED_MODELS` to a comma-separated shortlist to override the
additional options. This list is an application allowlist, not live confirmation
of account quota or provider availability. Custom endpoints default to only the
configured model. Clients cannot select arbitrary provider URLs or credentials.
Each session fixes model, strategy, custom text, initial heading, information
condition and execution mode; a changed configuration is rejected before cache
lookup. Version-10 exports include the complete setup alongside step records.

### Policy-authoring interface (version 11)

Setup now distinguishes action-only comparison from policy-authoring agents.
Text-generating models may use either. Jev/OpenJev are action-only; the server
rejects authoring requests for them even if the UI is bypassed. Authoring starts
with a blank model-owned policy and enables act, update_policy and compact_context.
Policies, revisions, factual summaries and optional public explanations are
visible and exported. No private reasoning is requested or displayed. The model
chooses whether and when to use these capabilities. All calls, including those
before a move, contribute to usage, cost and step latency.

Authoring uses history only and no supplied strategy or automatic map. Switching
to authoring clears incompatible setup options. These differences are explained
before starting, and interface mode is fixed per run, included in its summary
and recorded in version-11 downloads. Compare like interfaces when evaluating
navigation; authoring is a separate condition with additional capabilities.

## Protected hosted preview

`pnpm preview:model-ant` serves the built site and Model Ant API on one origin,
without attaching multiplayer services or connecting a database. Create a separate Railway service with build command
`pnpm install --frozen-lockfile && pnpm build`, start command
`pnpm preview:model-ant`, and health check `/api/healthz`. New Railway services
use service settings rather than the deprecated config-as-code files. Do not
change the production world service. Configure `NODE_ENV=production`,
`MODEL_ANT_PREVIEW_ENABLED=true`, and `MODEL_ANT_PREVIEW_PASSWORD` (at least 16
characters), plus the existing server-only model gateway variables. The browser
prompts for username `preview` and the shared password. Every page and model API
requires authentication; only `/api/healthz` is public. HTTPS is required at the
hosting edge. Credentials must never be committed or put into a share URL.

Model requests remain disabled in normal production deployments. The explicit
preview flag plus password enables the protected API. Runs are in memory and
are lost on redeployment; download records first. The isolated preview requires
no `DATABASE_URL` and must not receive production database credentials.


The shared preview is deployed from `codex/model-ant-preview` in Railway's
`model-ant-preview` environment, service `stigsim-model-ant-preview`:
https://stigsim-model-ant-preview-model-ant-preview.up.railway.app/model-ant
Gateway credentials and the shared access password live in service variables.
A local ignored `.env.model-ant-preview.local` retains the generated password
for the owner. Never commit that file or include the password in the URL.

## Shared Pebbles team experiment

`/swarm-ant` is a separate mode for 2–4 text-generating model agents in one shared
31×31 maze. Select the same or different server-approved models, seed, loop rate,
and a total team movement budget (20–800 attempts). All agents start at the nest;
any agent reaching the exit wins for the team. Agents can share a cell. Each
starts with 12 reusable, individually identified pebbles. Turns interleave in a
fixed rotation: logical co-presence, not simultaneous model requests.

An agent receives only its private observation/action history and current local
view. It can read carried pebbles and pebbles on its cell and four adjacent
cells, including all inscriptions attached to those pebbles. Nearby agent
positions are visible, but distant agents, hidden terrain, and other agents'
private histories are absent. There is no team-wide chat feed in model input.
Each inscription records author, model, server UTC timestamp, and team turn.
Messages append; they remain with a pebble when any agent carries or moves it.

The act tool combines movement, optional drop/pick, optional pebble ID and an
optional inscription up to 300 characters. Transfers and inscriptions happen
before movement. A message with no transfer targets a pebble on the current
cell; it cannot create a pebble or write remotely. Invalid transfers or writes
are recorded, while movement still proceeds. Blocked movement consumes a turn.
No conventions or navigation policy are prescribed. Jev is unavailable because
its decision-only interface cannot author free text.

The server owns shared state and private history selection. Retrying an already
committed turn returns its snapshot without another model call. Sessions are
bounded, expire after one hour idle, and disappear on server restart. The same
preview password protects the team API. Aggregate token/cost totals include
reported failed-request usage and mark missing usage as partial. Browser pacing
spans the team's successful requests; provider errors pause the run.

The observer may inspect any agent's local pebble view and carried messages;
observer access does not change model input. Version-1 `stigsim-swarm-ant`
downloads contain configuration, rules, observations, actions, pebbles,
inscriptions, outcomes, usage and pricing metadata.
