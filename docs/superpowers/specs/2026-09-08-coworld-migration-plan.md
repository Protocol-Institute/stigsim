# Stigsim on Softmax Coworlds — rough migration plan and blockers

**Status:** for discussion at the 2026-09-11 SIGFPT call. This is not a proposal
to start work. The standing decision from the Sep 6 thread is that Softmax work
happens after the symposium, and nothing here asks to change that.
**Date:** 2026-09-08
**Author:** Claude, at Venkat's request in the Sep 8 thread. Reviewed by nobody yet.

## What a Coworld is

A Coworld is a packaged game distributed as container images and described by a
`coworld_manifest.json`. Two roles are required. A game container owns the rules
and the authoritative state. One or more player containers connect to it over
WebSocket and choose actions. Optional roles (grader, diagnoser, optimizer,
reporter) consume the evidence after an episode ends. Softmax supplies identity,
policy uploads, hosted evaluation, league scheduling, replay storage, and the
ladder. The Coworld supplies the game.

The game container contract is specific. It reads its configuration from
`COGAME_CONFIG_URI` at startup, serves `GET /healthz`, serves a player WebSocket
at `/player?slot=...&token=...` plus a browser client at `GET /client/player`,
serves a spectator stream at `/global` and `GET /client/global`, and on
completion writes results JSON to `COGAME_RESULTS_URI` and replay bytes to
`COGAME_SAVE_REPLAY_URI`. The manifest declares a `config_schema` that must
require a string-array `tokens` field, and a `results_schema` that must include a
`scores` array. Player containers are handed a fully-formed
`COWORLD_PLAYER_WS_URL` and speak whatever protocol the game declares.

The player contract is at the transport level only. There is no gym or
PettingZoo interface and no imposed observation or action space. Whatever
protocol we publish is the protocol. An LLM policy and a trained policy are both
just containers on the same socket.

## What hosting on Softmax does and does not mean

This is the question Dan raised on Sep 6 and I think it is the most important one
to settle before anything else, because the two readings imply completely
different amounts of work.

It does not mean moving stigsim.protocol-institute.org onto Softmax. The Coworld
docs say directly that the platform "does not currently provide a supported
hosted game-only lobby where users connect their own remote players." Local
browser play happens through `coworld play`; hosted play means submitting
policies to leagues where the platform runs the game and every player container.
There is no hosted mode where humans sit in our lobby and play each other.

So the realistic reading is that a Coworld is a second front end onto the same
simulation core, aimed at agents rather than people. Our site keeps the human
product: the maze sandbox, local War Mode, online War Mode, Infinite World. The
Coworld adds an agent league with replays, a ladder, and matchmaking we do not
have to build. Those are genuinely useful, and they are things PR #15 explicitly
defers.

That framing also means the Coworld is additive rather than a migration, which
is worth saying out loud since "migration plan" implies moving something. Almost
nothing moves. We package a headless variant of what we already have.

## What we already have

More than I expected, and most of it landed for unrelated reasons.

PR #15 is close to the shape a game container needs. It runs one isolated
authoritative `WarSimulation` per match with its own seed, settings, clock
accumulation, and completion state. The Node server imports the simulation
module rather than a React component. The client/server messages live in
`shared/war-contract.ts`. Doctrine changes cross one narrow `set-doctrine`
boundary that is authorized, range-validated, and applied only to the sender's
colony. Matches are bounded and end on last-colony-standing. Completed matches
persist a compact record with player names, settings, seed, winner, final tick,
final aggregate metrics, and final doctrines. Room count, message rate, payload
size, snapshot frequency, and stale-room lifetime are all bounded.

Underneath that, the determinism work from #5 gives us seeded PRNG streams, a
command bus every mutation routes through, `deterministicPow` keeping the score
path off implementation-defined math, and periodic state fingerprints. Coworld
requires "reproducible seeded episodes" and we have a stronger guarantee than
that phrase implies. `sim-trace` gives a bounded, validated trace format with
exact replay, seek, and divergence reporting, which is the natural replay
artifact. `src/render.ts` plus the replay bar is most of a replay viewer.

PR #13 supplies the action space. Before it there was one global `SimParams` and
nothing per-colony, so there was nothing a player could do that another player
could not also do to them. After it there is a validated per-colony `Doctrine`, a
whole-value `setDoctrine` command, per-ant adoption, and a `Topology` setting.
The spec anticipated non-human emitters: "a preset, a slider drag, a
preregistered round, a replay, and a later LLM or evolutionary emitter all
produce the same object."

## What we would have to build

A new headless game container, roughly a thin service around `sim-core` and
`WarSimulation`. Concretely:

- Read config from `COGAME_CONFIG_URI` (seed, maze parameters, colony count,
  topology, tank size, tick limit) instead of from a match-setup UI.
- Serve `/healthz`, `/player`, `/client/player`, `/global`, `/client/global`.
- Answer every WebSocket Ping with a Pong carrying the same payload, per RFC
  6455. The player docs warn that games which fail this silently drop policies
  around the 40-second mark.
- Write results JSON to `COGAME_RESULTS_URI` and replay bytes to
  `COGAME_SAVE_REPLAY_URI`, publishing atomically via temp-file-then-rename.
- Define and publish the observation protocol. This is the real design work and
  it is where the game lives; what a player may see about the opponent
  interacts directly with the topology decision.
- Write `coworld_manifest.json` with at least three tags, a `config_schema`
  requiring `tokens`, a `results_schema` containing `scores`, at least one
  variant, and a certification fixture. Add a Dockerfile.
- Design a graded score. Last-colony-standing gives win/loss, which makes a poor
  ladder. Comparable Coworlds use a margin term: MAgent battle uses
  `100 * outcome + survivors[s] - survivors[opp]` summed over two games with
  swapped sides; Battlecode uses `100 * games_won + mean(points)`. Something
  like `100 * win + food-delivered margin`, played both sides, is the obvious
  starting point.

A large part of PR #15 does not carry over, and that is fine. The lobby,
create/join/spectate flows, ready-up, reconnect tokens, seat reservation,
rematch, and browser-local identity are all the platform's job in a Coworld: the
roster is fixed before the container starts and tokens are injected. The durable
part is exactly the part PR #15 kept behind narrow seams, which is a good sign
for that PR's design independent of any of this.

## Two variants, and which one first

The platform has two established interaction shapes, and we can ship either.

The sealed variant is the cheaper and more common one. Each seat connects,
receives an observation with the config, submits one doctrine inside a
submission window, and the episode then runs to its tick limit with no player
I/O at all. Sugarscape works this way (one declarative SugarLang ruleset per
seat, then 1,000 ticks untouched) and so does Battlecode-as-a-Coworld (a sealed
JSON sheet of named knobs at t=0). It avoids in-episode I/O entirely, avoids the
problem of player containers blocking the tick, and needs a much smaller
observation protocol.

The live variant lets players change doctrine during the match, which is what
#13 designed for and what makes the human game interesting. MAgent battle shows
the platform supports this: one commander issues squad orders every twenty
simulation ticks under fog of war. For us the cadence matters because LLM-backed
players go through a Bedrock sidecar capped at 30 calls per minute per slot with
a per-episode spend limit. A doctrine-cadence loop fits inside that comfortably;
anything faster does not.

My recommendation is sealed first, live second. Sealed is a fraction of the work,
it exercises the whole packaging and certification path, and it is a coherent
game on its own. It also matches what the #13 spec already calls a
"preregistered round," and a sealed doctrine plus a transition rule list is
close to Ergod's Aug 21 framing that fixed configurations plus transition rules
make a protocol rather than a procedure.

## Rough sequencing

Assuming this starts after the symposium and after package 4 lands.

1. Settle the ownership and route question with Emmett (below). Nothing else
   should start first.
2. Design and write down the observation protocol and the score function. This
   is a document, not code, and it is the part that needs the most team input.
3. Build the headless game container for the sealed variant, reusing
   `WarSimulation` and `sim-core`.
4. Manifest, Dockerfile, local `coworld run-episode`, then `coworld certify`.
5. Replay: dump the trace as replay bytes, and adapt `render.ts` into the static
   replay viewer bundle.
6. Upload, baseline player, league. Then consider the live variant.

My guess at effort is two to three weeks of focused work for steps 2 through 5,
most of it in the observation protocol and the container plumbing rather than in
the simulation. That guess has wide error bars because none of us has run
`coworld certify` and I do not know what it rejects.

## Blockers

Ordered by what blocks the most. The first two need Emmett; the rest are ours.

1. **Who builds it, and who owns the repository.** Venkat relayed that Emmett
   "said they've got a skill that basically does it." The closest thing I found
   is `Metta-AI/coworld-builder`, described as an autonomous agent that takes an
   idea from an Asana board through design, build, certification, upload, league
   creation and a Discord announcement, with "no human in the loop for any of
   it," publishing to a public repo named `Metta-AI/cogame-<slug>`. If that is
   what was meant, it builds a Coworld from an idea rather than porting an
   existing codebase, and the output would be a reimplementation of Stigsim
   living under Metta-AI rather than Protocol Institute. That may be entirely
   fine, but it is a governance decision and not a technical one, and it should
   be made deliberately. I am inferring the ownership implication from the
   repository naming pattern and the README; it should be confirmed rather than
   assumed.

2. **What "hosting" means.** Covered above. If the expectation on either side is
   that stigsim.protocol-institute.org moves onto Softmax, that expectation is
   wrong and is better corrected now than after work starts.

3. **War Mode doctrine changes are not recorded in the trace system.** PR #15
   states this explicitly: doctrine messages carry the complete `SimParams`
   representation and "are not yet recorded through the trace system." Without a
   recorded command stream there is no replay artifact, and replay is one of the
   main things a Coworld is supposed to give us. This is package 5 work in #9.

4. **The doctrine representation is still `SimParams`.** The Coworld action
   space wants the #13 `Doctrine` shape, which is validated, whole-value, and
   rejects rather than clamps — the right behaviour when the sender is an
   adversarial container rather than our own UI. This puts package 4 and #13 on
   the critical path rather than alongside it.

5. **The topology decision.** Under option 1 the colonies interact only through
   food depletion, which is a race rather than a game and would make a thin
   ladder. Options 2, 3 and 4 all give real interaction. This is already Friday's
   agenda item; it now has a second reason to be decided.

6. **A Node game container is unverified.** The `coworld` CLI is Python and the
   examples I looked at are Nim and Python. Containers are just images so a Node
   game should be fine in principle, but I found no Node example and would rather
   ask than assume.

7. **The observation protocol does not exist.** Coworld will not design it for
   us. It is the largest single piece of design work and it cannot be settled
   before the topology decision.

Two things that are usually blockers and are not here. Identity and
authentication, which PR #15 flags as fragile, become the platform's problem
entirely. And determinism, which is normally the hard part of packaging a
simulation for a league, is already the strongest guarantee we have; running in
a container is also easier than the browser case, since it is all one Node
engine and the cross-engine concern in `CONTRIBUTING.md` does not apply.

## Open questions for Friday

1. Do we port it ourselves, with Protocol Institute owning the repository, or do
   we let Softmax's builder produce it? What does Emmett actually mean by the
   skill?
2. Do we agree that the Coworld is an agent league alongside the site, not a
   move of the site?
3. Sealed variant first, or wait and do the live one?
4. Does this change anything about the ordering in #9, or does it stay strictly
   after the symposium as decided on Sep 6? My reading is that nothing here
   argues for reordering, but it does raise the value of packages 4 and 5.
5. Who owns it when it starts.

## What I verified, and what I did not

Verified from the `coworld` package documentation and the public Coworld
repositories: the manifest fields, the game and player role contracts, the
environment variables and routes, the Bedrock rate limits, the Sugarscape and
MAgent and Battlecode designs, and the statement about there being no hosted
game-only lobby.

Not verified: I have not run the `coworld` CLI, built a container, or read the
Paint Arena source. I read several documents through a summarizing fetch rather
than end to end, so I have the contracts at the level of field names and routes
but not verified message envelopes. The ownership implication in blocker 1 is an
inference. Effort estimates are guesses.
