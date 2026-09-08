# Stigsim as a Coworld — packaging and blockers

**Status:** draft for discussion at the 2026-09-11 SIGFPT call. Not a proposal to
start work; the standing decision is that this happens after the symposium.
**Date:** 2026-09-08, revised.

## What a Coworld requires of us

A Coworld is a packaged game distributed as container images and described by a
`coworld_manifest.json`. A game container owns the rules and the authoritative
state; player containers connect over WebSocket and choose actions. The platform
supplies identity, policy uploads, hosted evaluation, league scheduling, replay
storage, and the ladder.

The game container contract, concretely:

- Read configuration from `COGAME_CONFIG_URI` at startup.
- Serve `GET /healthz`, a player WebSocket at `/player?slot=...&token=...`, a
  browser client at `GET /client/player`, and a spectator stream at `/global`
  with `GET /client/global`.
- Answer every WebSocket Ping with a Pong carrying the same payload, per RFC
  6455. Games that skip this silently drop policies around the 40-second mark.
- Write results JSON to `COGAME_RESULTS_URI` and replay bytes to
  `COGAME_SAVE_REPLAY_URI`, publishing atomically via temp-file-then-rename.
- Declare a `config_schema` that requires a string-array `tokens` field and a
  `results_schema` containing a `scores` array.

The player contract is transport-level only. There is no gym or PettingZoo
interface and no imposed observation or action space; whatever protocol we
publish is the protocol. An LLM policy and a trained policy are both just
containers on the same socket.

## What we already have

More than expected, most of it landed for unrelated reasons.

PR #15 is close to the shape a game container needs. It runs one isolated
authoritative `WarSimulation` per match with its own seed, settings, clock
accumulation and completion state. The Node server imports the simulation module
rather than a React component. Client/server messages live in
`shared/war-contract.ts`. Doctrine changes cross one narrow `set-doctrine`
boundary that is authorized, range-validated, and applied only to the sender's
colony. Matches are bounded and end on last-colony-standing, and completed
matches persist a compact record with settings, seed, winner, final tick, final
aggregate metrics, and final doctrines.

Underneath that, the determinism work from #5 gives seeded PRNG streams, a
command bus every mutation routes through, `deterministicPow` keeping the score
path off implementation-defined math, and periodic fingerprints. Coworld asks for
"reproducible seeded episodes" and we have a stronger guarantee than that phrase
implies. `sim-trace` is the natural replay artifact. `src/render.ts` plus the
replay bar is most of a replay viewer.

PR #13 supplies the action space. Before it there was one global `SimParams` and
nothing per-colony, so there was nothing a player could do that another player
could not also do to them. After it there is a validated per-colony `Doctrine`, a
whole-value `setDoctrine` command, per-ant adoption, and a `Topology` setting.

## The packaging route

We read their process in and apply it to this repo.

Softmax's builder repository is markdown:
`playbooks/make-coworld.md`, staged prompts `10-design.md` through
`80-close.md`, agent definitions, and CI templates
(`ci.yml`, `coworld-release.yml`, `coworld-submit.yml`). The playbook describes
itself as "a faithful rewrite of the local `softmax:make-coworld` skill," so the
skill is real and this is its cloud version. The orchestration around it — an
idea board, crons, a fleet deploy script — is how they run it at volume and has
nothing to do with us. Nothing needs to be pointed at anything.

Their own process is not green-field either. Phase 0 opens with "Never
green-field. Fork the conventions of the closest existing coworld," and gives a
table mapping game shapes to starter repositories. It is a conventions
transplant, which is exactly the kind of thing you apply to a repository that
already exists.

Phase 0 is the only phase that assumes a new repo, and it is the one we skip: we
already have the simulator, the determinism work, traces, and a renderer. Phases
1 through 6 operate on a repository that already exists, by dispatching workflows
inside it. Phase 1 states its prerequisites as a short additive checklist:

- `compose.yaml`, service name matching the coworld name, `platform:
  linux/amd64`.
- `coworld_manifest_template.json` with an image placeholder,
  `"replay_viewer": {"bundle": "static-replay-viewer"}`, and `num_agents` inside
  every variant's `game_config` and inside the certification fixture's
  `game_config`.
- `.github/workflows/ci.yml` and `.github/workflows/coworld-release.yml` copied
  from their `templates/`.

Then `gh workflow run coworld-release.yml -R <repo> --ref main -f version=0.1.0`
builds, certifies and uploads in one dispatch. All of that is additive to a repo
that already exists.

### Requirements the playbook makes explicit

These are not obvious from the role contracts and they change what we build.

- **Replays are a static file plus a browser viewer, never a pod.** The manifest
  declares `static-replay-viewer`, the repo ships `tools/build_replay_viewer.sh`,
  and the viewer re-derives every frame from the recorded events in the browser,
  contacting nothing but S3 for the `.replay` file. Declaring a `/client/replay`
  live-server viewer is explicitly forbidden. This suits us unusually well: their
  Nim games compile the sim module to wasm through emscripten, whereas ours is
  already TypeScript and `src/render.ts` is already a browser renderer, so we
  ship the module directly. Our trace already re-derives state from a seed and a
  command stream, which is the property the requirement is really asking for.
- **`num_agents` goes inside each variant's `game_config`,** never at the
  variant's top level, which is rejected. Without it the ladder schedules zero
  episodes.
- **Ship two policies from day one** in one image, switched by environment: an
  LLM/strategy policy via `PLAYER_PROMPT` and a scripted baseline via
  `PLAYER_SCRIPTED=<name>`.
- **Degrade, never hang.** The game container is not given a timeout value;
  assume the 1200-second episode budget and settle or score early, playing inside
  about 60 per cent of it. An overrun episode is silently discarded.
- **Two name spaces.** Agents see anonymous aliases so they cannot meta-game; the
  replay viewer maps aliases back to real names for non-baseline seats.
- **A league needs two ranked real policies.** One where only trivial fillers
  play is called a failure state, so baseline plus one genuine strategy policy is
  the minimum bar, not a stretch goal.
- The repo must be public for certification, since the source check 404s on
  private. Ours already is.

### Still genuinely open

1. Whether a Node game container is fine on their runner. The CLI is Python and
   the examples are Nim and Python; containers are just images, so it should be
   fine, but I found no Node example.
2. Whether the release workflow and certification are happy with a repo outside
   their organization. Their Phase 0 pins the name `cogame-<slug>` under their
   org, but the stated certification requirement is only that the repo is public.
   Worth one question rather than an assumption.
3. Credentials: the release workflow wants an API key secret, and someone has to
   hold the platform account the upload runs against.

## What would still have to be written

A headless game container, roughly a thin service around `sim-core` and
`WarSimulation`: config in from `COGAME_CONFIG_URI` instead of a match-setup UI,
the routes above, results and replay out, plus manifest, Dockerfile and a
certification fixture.

Two pieces of real design work sit inside that. The observation protocol does not
exist and Coworld will not design it for us; what a player may see about the
opponent interacts directly with the topology decision. And the score needs to be
graded rather than win/loss, since last-colony-standing alone makes a thin
ladder. Comparable Coworlds use a margin term — one uses
`100 * outcome + survivors[s] - survivors[opp]` summed over two games with
swapped sides, another `100 * games_won + mean(points)`. Something like
`100 * win + food-delivered margin`, played both sides, is the obvious start.

Most of PR #15 does not carry over, and that is fine: the lobby, create/join/
spectate, ready-up, reconnect tokens, seat reservation, rematch and browser-local
identity are all the platform's job, since the roster is fixed before the
container starts and tokens are injected. The durable part is exactly what PR #15
kept behind narrow seams.

## Sealed or live

Two established interaction shapes, and we can ship either.

The sealed variant: each seat connects, receives an observation with the config,
submits one doctrine inside a submission window, and the episode runs to its tick
limit with no player I/O. Two well-known Coworlds work this way. It avoids
in-episode I/O entirely, avoids player containers blocking the tick, and needs a
much smaller observation protocol.

The live variant lets players change doctrine during the match, which is what #13
designed for and what makes the human game interesting. The platform supports it;
one existing Coworld has a commander issuing orders every twenty simulation ticks
under fog of war. Cadence matters because LLM-backed players go through a sidecar
capped at 30 calls per minute per slot with a per-episode spend limit. A
doctrine-cadence loop fits comfortably; anything faster does not.

Recommendation: sealed first, live second. Sealed is a fraction of the work, it
exercises the whole packaging and certification path, and it is a coherent game
on its own. It is also what #13 already calls a "preregistered round."

## Rough sequencing

Assuming this starts after the symposium and after package 4 lands.

1. Read `playbooks/make-coworld.md` and the release templates properly, and
   put the three open questions above to the partner.
2. Write down the observation protocol and the score function. A document, not
   code, and the part that needs the most team input.
3. Build the headless game container for the sealed variant on `WarSimulation`.
4. Manifest, Dockerfile, local `coworld run-episode`, then `coworld certify`.
5. Replay: dump the trace as replay bytes, adapt `render.ts` into the viewer
   bundle.
6. Upload, baseline player, league. Then consider the live variant.

## Blockers

1. **The three packaging questions**, above: the Node runner, whether the repo
   can live outside their organization, and credentials. Small individually, but
   they gate the first release dispatch.
2. **War Mode doctrine changes are not recorded in the trace system.** PR #15
   says so directly: doctrine messages carry the complete `SimParams`
   representation and "are not yet recorded through the trace system." No
   recorded command stream means no replay artifact, and replay is one of the
   main things a Coworld is supposed to give us. Package 5 in #9.
3. **The doctrine representation is still `SimParams`.** The Coworld action space
   wants #13's validated whole-value `Doctrine`, which rejects rather than
   clamps — the right behaviour when the sender is someone else's container
   rather than our own UI. This puts package 4 and #13 on the critical path
   rather than alongside it.
4. **The topology decision.** Under option 1 the colonies interact only through
   food depletion, which is a race rather than a game and would make a thin
   ladder. Already Friday's agenda item; it now has a second reason.
5. **The observation protocol does not exist**, and cannot be settled before the
   topology decision.

Two things that would normally be blockers and are not. Identity and
authentication, which PR #15 flags as fragile, become the platform's problem
entirely. And determinism, normally the hard part of packaging a simulation for a
league, is already our strongest guarantee; a container is also easier than the
browser case, since it is one Node engine and the cross-engine concern in
`CONTRIBUTING.md` does not apply.

## Open questions for Friday

1. Working with partner on the three open questions above.
2. Sealed variant first, or wait and do the live one?
3. Does this change the ordering in #9? My reading is no, but it raises the value
   of packages 4 and 5.

## What I verified, and what I did not

Verified from the `coworld` package documentation and the public Coworld
repositories: manifest fields, the game and player role contracts, environment
variables and routes, the LLM sidecar rate limits, the designs of three existing
Coworlds, the builder pipeline's stages and output location, and the statement
about there being no hosted game-only lobby.

Not verified: I have not run the CLI, built a container, or read a reference
Coworld's source. I read several documents through a summarizing fetch, so I have
the contracts at the level of field names and routes but not verified message
envelopes. Effort estimates are guesses.
