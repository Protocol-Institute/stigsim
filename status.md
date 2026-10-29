# Status — Stigsim

## Active

- Reconcile the energy, starvation, death, and colony-extinction mechanics
  shared by War and Infinite Mode; War reproduction remains an explicit
  mode-specific policy.

## Upcoming

- Improve accessibility and mobile interaction.
- Add automated load and abuse testing for Infinite Mode.

## Done

- **2026-10-29** — Published the Model Ant feature branch and configured an
  isolated, password-protected Railway preview from GitHub. Production world
  services and database settings are unchanged.

- **2026-10-29** — Streamlined Model Ant run layout: consolidated configuration
  and New experiment in the header card, moved execution controls above the
  maze, and separated reference explanations from the live rail.

- **2026-10-29** — Clarified Model Ant upstream HTTP 5xx errors with safe
  retry guidance instead of implying a configuration or quota diagnosis.

- **2026-10-29** — Exposed policy-authoring agents alongside action-only Model
  Ant comparisons, with capability validation for Jev, explicit setup
  constraints, restored policy/revision views, and version-11 exports.

- **2026-10-29** — Added Model Ant experiment setup with server-approved model
  selection, seed and loop settings, information conditions, right-hand and
  exploration presets, custom instructions, fixed run summaries and version-10
  configuration exports. New experiments open paused; no branch was created.

- **2026-10-28** — Made supplied-policy compliance explicit in the Model Ant
  decision question, with per-step instruction recording and version-9 exports.

- **2026-10-28** — Added a supplied exploration-policy condition for Model Ant,
  with observed-map-only compliance checks, visible departure counts, and
  version-8 exports. Model choices are never overridden.

- **2026-10-28** — Added optional observed-map assistance for Model Ant selection
  comparisons: observed cell types and entry counts only, fixed per run, with
  inspectable request snapshots and version-7 exports.

- **2026-10-28** — Added token-aware Model Ant request pacing and visible
  60-second rate-limit cooldowns, with automatic retries during running
  experiments and a pause after three consecutive 429 responses.

- **2026-10-28** — Added Jev/OpenJev decision adapters and a navigation-only
  comparison mode shared with GPT/Claude: 12 joint actions, full local history,
  reported confidence/probabilities, input-only Jev costs and version-6 exports.

- **2026-10-28** — Added per-run tokens and estimated USD spending to Model Ant’s
  main stats, with catalog-rate snapshots, partial-total handling, and exported
  accounting metadata.

- **2026-10-28** — Configured the local Model Ant comparison for Claude Sonnet
  4.6 and added a gateway compatibility guard for its unsupported
  `parallel_tool_calls` option.

- **2026-10-28** — Added Model Ant’s blank, model-authored persistent policy
  workspace and `update_policy` tool. Policies survive context compaction;
  current text and revision history are visible and exported in version 5.

- **2026-10-28** — Model Ant now uses the browser-only Maze Simulator’s shared
  31 × 31 generator, seed streams, and 0–50% loop control (10% default), with
  version-4 environment metadata in experiment downloads.

- **2026-10-28** — Model Ant now uses a persistent tool-driven conversation,
  model-chosen context compaction, a speed/usage objective, optional public
  explanations, and version-3 usage-aware exports. The automatic notebook is
  no longer supplied to the model; memory and journal rewrites are not required.

- **2026-10-28** — Added model-controlled reusable pebbles to Model Ant, with
  local sensing, finite inventory, drop/pick actions, visible markers, action
  outcomes, and version-2 experiment exports.

- **2026-10-27** — Model Ant now retains an automatic notebook of personally
  observed cells and entry counts, without revealing unseen terrain or choosing
  moves for the model.

- **2026-10-27** — Added the local Model Ant prototype: one model-controlled ant,
  seeded maze, adjacent-cell observations, bounded model memory, step/run
  controls, decision journal and export, and a server-side inference adapter.
  Live inference requires a configured model endpoint.

- **2026-09-21** — Added a transparent deterministic OODA opponent for Online
  War, including versioned agent contracts, server-side state analysis,
  preset-scored doctrine decisions, an in-match decision journal, and the
  `Play against agent` flow. (Codex)

- **2026-09-20** — Verified the production deployment: the Cloudflare-managed
  `stigsim.protocol-institute.org` CNAME resolves to GitHub Pages, and Infinite
  Mode runs on one Railway replica with Neon Postgres persistence. (Daniel)
- **2026-09-20** — Added the versioned `stigsim-run-record@1` research envelope,
  bounded research channels, JSON Schema and example fixture, and shared export
  and validation tooling for mode recordings, including replayable Local War
  recording and authoritative Online War recording, history playback, and
  downloads. (PR #23)
- **2026-09-18** — Changed the War match defaults for both Local and Online War: 40 starting ants, five food sources at 200 food each, a 20% maze loop rate, instant doctrine adoption, and the Mimicry topology; the mirrored layout stays the default. Records saved before the topology setting existed now load on the Private topology they were played on, instead of whatever the current default is. (Patrick)
- **2026-09-14** — Completed the shared doctrine, adoption, topology, and
  symmetric gland integration for Local and Online War. (PR #19)
- **2026-09-12** — Added the mirrored map layout and made it the War Mode default: the maze equals its own 180-degree rotation, food is placed in rotated pairs weighted toward the crossings between the halves, with one pair near the nests when there are more than two sources and a single source at the centre. The asymmetric layout remains a match setting; the maze sandbox and the trace format default to it unchanged. Also exposed doctrine adoption (on return to nest, the default, or instant) as a War match setting so both can be playtested. (Patrick)
- **2026-09-09** — Integrated server-authoritative Online War with create,
  join, spectate, reconnect, rematch, and compact completed-match history.
  (PR #15)
- **2026-09-07** — Ported local two-player War Mode onto `@stigsim/sim-core`, preserving its survival behavior in a separately tested mode layer. (PR #11)
- **2026-08-27** — Made Maze Simulator runs reproducible from a seed: seeded PRNG streams, a command bus every mutation routes through, periodic state fingerprints, and a downloadable trace file that replays exactly with seek and divergence reporting. Added a Run panel (seed, save trace, load trace, replay bar, CSV export) and automated tests for core simulation behavior, including a golden-trace regression fixture (`pnpm golden`). Closes the "Add automated tests for core simulation behavior" item that was under Upcoming. (Patrick)
- **2026-08-20** — Added persistent multiplayer Infinite Mode backed by one
  authoritative simulation server and optional Postgres persistence. (PR #2)
- **2026-08-03** — Project container scaffolded and registered (`CLAUDE.md`, `status.md`, `README.md`, `.gitignore`); GitHub repo `Protocol-Institute/stigsim` created (public), initial commit pushed. (Venkat)
- **2026-08-05** — Verified repo write access (commit + push to `main`) for second contributor. (0xErgod)
- **2026-08-09** — Landed initial browser-based maze simulator (PR #1, danielfschmidt) and published via GitHub Pages. Switched deploy target from `protocol-institute.github.io/stigsim/` to custom domain `stigsim.protocol-institute.org` (added `public/CNAME`, changed build `BASE_PATH` to `/`, set GitHub Pages custom domain). (Venkat)
