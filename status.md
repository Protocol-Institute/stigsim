# Status — Stigsim

## Active

- Point `stigsim.protocol-institute.org` (Cloudflare DNS) at GitHub Pages — repo side done, needs a CNAME DNS record added in Cloudflare.
- Integrate and deploy Infinite Mode using one Railway simulation server and Neon Postgres.

## Upcoming

- Continuous-space movement and terrain that holds pheromone differently
  (phases 1-4 of the continuous-ground plan).
- Add automated tests for core simulation behavior.
- Improve accessibility and mobile interaction.
- Add automated load and abuse testing for Infinite Mode.

## Done

- **2026-08-03** — Project container scaffolded and registered (`CLAUDE.md`, `status.md`, `README.md`, `.gitignore`); GitHub repo `Protocol-Institute/stigsim` created (public), initial commit pushed. (Venkat)
- **2026-08-05** — Verified repo write access (commit + push to `main`) for second contributor. (0xErgod)
- **2026-08-09** — Landed initial browser-based maze simulator (PR #1, danielfschmidt) and published via GitHub Pages. Switched deploy target from `protocol-institute.github.io/stigsim/` to custom domain `stigsim.protocol-institute.org` (added `public/CNAME`, changed build `BASE_PATH` to `/`, set GitHub Pages custom domain). (Venkat)
- **2026-08-29** — Foundations for the continuous-environment work: every model
  decision now draws from one seeded stream, the seed is editable and travels in
  the URL, and the previously unused highway score reads out live. Runs are
  reproducible and comparable, which the later tuning phases depend on.
- **2026-08-29** — Food now grows back. Both engines share one spawning policy:
  the world sustains a standing quantity rather than a fixed larder, and new
  sources cluster near where food has been so trails stay worth maintaining.
  On by default in the shared world (tunable by env, `FOOD_CAPACITY_UNITS=0`
  disables), opt-in in the maze so the lab stays controlled.
