# Status — Stigsim

## Active

- Point `stigsim.protocol-institute.org` (Cloudflare DNS) at GitHub Pages — repo side done, needs a CNAME DNS record added in Cloudflare.
- Integrate and deploy Infinite Mode using one Railway simulation server and Neon Postgres.

## Upcoming

- Port continuous movement and terrain to Infinite Mode, which needs the
  shared-core extraction and a wire-contract change (phase 4).
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
- **2026-08-29** — Ants move continuously. The simulation moved out of the React
  component into `src/sim/`, ants gained a position and heading and now steer by
  smelling three points ahead, deposit is measured per distance travelled rather
  than per step, and collisions slide along walls. Sensor geometry was tuned by
  sweeping 32 seeds headlessly and both antennae are now controls. First
  frontend tests added.
- **2026-08-29** — Terrain landed in the maze simulator. Six surfaces differing
  in speed, how fast pheromone evaporates on them, how much of a deposit they
  hold, and whether food grows there; scarps additionally fall one way. Terrain
  is an overlay, and a world with nothing painted runs identically to one
  without the feature. Verified that colonies route around mire when the way
  through is no shorter.
