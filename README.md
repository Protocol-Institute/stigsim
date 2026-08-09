# Stigsim — Stigmergy Simulator

Stigsim is a browser-based simulator built for the **Stigmergy Workshop** at the **Protocol Symposium 2026**, part of the Protocol Institute's SIGFPT (Formal Protocol Theory) initiative.

Stigmergy is a coordination mechanism in which agents respond to traces left in a shared environment. In Stigsim, ant colonies explore generated mazes, discover food, and reinforce useful routes with pheromone trails—without direct communication or central control.

## Features

- Generate mazes with adjustable loops and food sources
- Simulate up to four competing ant colonies
- Tune colony size, simulation speed, evaporation, trail bias, and gland size
- Enable cautionary pheromones that discourage unsustainable routes
- Edit walls and food sources while the simulation is running
- Observe the colony or control an individual ant
- Run entirely in the browser with no backend, database, accounts, or analytics

## Play online

The simulator is published through GitHub Pages at:

<https://stigsim.protocol-institute.org/>

## Local development

Requirements:

- Node.js 20 or newer
- pnpm

```bash
pnpm install
PORT=3000 BASE_PATH=/ pnpm dev
```

Open <http://localhost:3000>.

`PORT` selects the development-server port. `BASE_PATH` sets the URL prefix used for assets and is `/` for a root deployment.

## Build

```bash
pnpm build
```

The static production site is written to `dist/` and can be hosted on any static hosting service.

## Roadmap

The current simulator runs locally in one browser. A future shared-world mode could let multiple people place colonies, food, and obstacles in the same persistent server-hosted environment.

See [`status.md`](status.md) for current progress and upcoming work. See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the development workflow.

## Privacy

Stigsim does not include analytics or tracking and does not send simulation data anywhere. The current version runs locally in the browser.
