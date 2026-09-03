# Status — Stigsim

## Active

- Port local two-player War Mode onto `@stigsim/sim-core`, preserving the prototype's survival behavior in a separately tested mode layer.
- Point `stigsim.protocol-institute.org` (Cloudflare DNS) at GitHub Pages — repo side done, needs a CNAME DNS record added in Cloudflare.
- Integrate and deploy Infinite Mode using one Railway simulation server and Neon Postgres.

## Upcoming

- Improve accessibility and mobile interaction.
- Add automated load and abuse testing for Infinite Mode.

## Done

- **2026-08-27** — Made Maze Simulator runs reproducible from a seed: seeded PRNG streams, a command bus every mutation routes through, periodic state fingerprints, and a downloadable trace file that replays exactly with seek and divergence reporting. Added a Run panel (seed, save trace, load trace, replay bar, CSV export) and automated tests for core simulation behavior, including a golden-trace regression fixture (`pnpm golden`). Closes the "Add automated tests for core simulation behavior" item that was under Upcoming. (Patrick)
- **2026-08-03** — Project container scaffolded and registered (`CLAUDE.md`, `status.md`, `README.md`, `.gitignore`); GitHub repo `Protocol-Institute/stigsim` created (public), initial commit pushed. (Venkat)
- **2026-08-05** — Verified repo write access (commit + push to `main`) for second contributor. (0xErgod)
- **2026-08-09** — Landed initial browser-based maze simulator (PR #1, danielfschmidt) and published via GitHub Pages. Switched deploy target from `protocol-institute.github.io/stigsim/` to custom domain `stigsim.protocol-institute.org` (added `public/CNAME`, changed build `BASE_PATH` to `/`, set GitHub Pages custom domain). (Venkat)
