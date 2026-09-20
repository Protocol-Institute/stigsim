# Status — Stigsim

## Active

- Reconcile the energy, starvation, death, and colony-extinction mechanics
  shared by War and Infinite Mode; War reproduction remains an explicit
  mode-specific policy.

## Upcoming

- Improve accessibility and mobile interaction.
- Add automated load and abuse testing for Infinite Mode.

## Done

- **2026-09-20** — Added the versioned `stigsim-run-record@1` research envelope,
  bounded research channels, JSON Schema and example fixture, and shared export
  and validation tooling for mode recordings. (PR #23)
- **2026-09-18** — Changed the War match defaults for both Local and Online War: 40 starting ants, five food sources at 200 food each, a 20% maze loop rate, instant doctrine adoption, and the Mimicry topology; the mirrored layout stays the default. Records saved before the topology setting existed now load on the Private topology they were played on, instead of whatever the current default is. (Patrick)
- **2026-09-18** — Added replayable research recording to Local War and
  authoritative recording, history playback, and downloads to Online War.
- **2026-09-12** — Added the mirrored map layout and made it the War Mode default: the maze equals its own 180-degree rotation, food is placed in rotated pairs weighted toward the crossings between the halves, with one pair near the nests when there are more than two sources and a single source at the centre. The asymmetric layout remains a match setting; the maze sandbox and the trace format default to it unchanged. Also exposed doctrine adoption (on return to nest, the default, or instant) as a War match setting so both can be playtested. (Patrick)
- **2026-09-11** — Completed the shared doctrine, adoption, topology, and
  symmetric gland integration for Local and Online War.
- **2026-09-07** — Integrated server-authoritative Online War with create,
  join, spectate, reconnect, rematch, and compact completed-match history.
- **2026-09-07** — Ported local two-player War Mode onto `@stigsim/sim-core`, preserving its survival behavior in a separately tested mode layer. (PR #11)
- **2026-08-27** — Made Maze Simulator runs reproducible from a seed: seeded PRNG streams, a command bus every mutation routes through, periodic state fingerprints, and a downloadable trace file that replays exactly with seek and divergence reporting. Added a Run panel (seed, save trace, load trace, replay bar, CSV export) and automated tests for core simulation behavior, including a golden-trace regression fixture (`pnpm golden`). Closes the "Add automated tests for core simulation behavior" item that was under Upcoming. (Patrick)
- **2026-08-20** — Added persistent multiplayer Infinite Mode backed by one
  authoritative simulation server and optional Postgres persistence. (PR #2)
- **2026-08-03** — Project container scaffolded and registered (`CLAUDE.md`, `status.md`, `README.md`, `.gitignore`); GitHub repo `Protocol-Institute/stigsim` created (public), initial commit pushed. (Venkat)
- **2026-08-05** — Verified repo write access (commit + push to `main`) for second contributor. (0xErgod)
- **2026-08-09** — Landed initial browser-based maze simulator (PR #1, danielfschmidt) and published via GitHub Pages. Switched deploy target from `protocol-institute.github.io/stigsim/` to custom domain `stigsim.protocol-institute.org` (added `public/CNAME`, changed build `BASE_PATH` to `/`, set GitHub Pages custom domain). (Venkat)
