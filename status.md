# Status — Stigsim

## Active

- Point `stigsim.protocol-institute.org` (Cloudflare DNS) at GitHub Pages — repo side done, needs a CNAME DNS record added in Cloudflare.

## Upcoming

- Add automated tests for core simulation behavior.
- Improve accessibility and mobile interaction.
- Design an optional shared-world mode where multiple people can play in the same persistent server-hosted environment.

## Done

- **2026-08-03** — Project container scaffolded and registered (`CLAUDE.md`, `status.md`, `README.md`, `.gitignore`); GitHub repo `Protocol-Institute/stigsim` created (public), initial commit pushed. (Venkat)
- **2026-08-05** — Verified repo write access (commit + push to `main`) for second contributor. (0xErgod)
- **2026-08-09** — Landed initial browser-based maze simulator (PR #1, danielfschmidt) and published via GitHub Pages. Switched deploy target from `protocol-institute.github.io/stigsim/` to custom domain `stigsim.protocol-institute.org` (added `public/CNAME`, changed build `BASE_PATH` to `/`, set GitHub Pages custom domain). (Venkat)
