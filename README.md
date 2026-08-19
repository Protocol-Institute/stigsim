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
- Use the standalone simulator entirely in the browser
- Join the optional `/infinite` server-authoritative shared world

## Play online

The simulator is published through GitHub Pages at:

<https://stigsim.protocol-institute.org/>

## Local development

Requirements:

- Node.js 22.13 or newer
- pnpm

```bash
pnpm install
PORT=3000 BASE_PATH=/ pnpm dev
```

Open <http://localhost:3000>.

`PORT` selects the development-server port. `BASE_PATH` sets the URL prefix used for assets and is `/` for a root deployment.

### Infinite Mode

Infinite Mode uses a separate authoritative Node server. In another terminal:

```bash
pnpm dev:server
```

Then open <http://localhost:3000/infinite>. Vite proxies local `/api` HTTP and
WebSocket traffic to the server on port 3001. Without `DATABASE_URL`, the
server uses the bundled seed and keeps state in memory for the current session.

Production uses `VITE_INFINITE_SERVER_URL` for the public server origin and
requires `DATABASE_URL` plus `ALLOWED_ORIGINS` on the server. See
[`server/README.md`](server/README.md).

## Build

```bash
pnpm build
```

The static production site is written to `dist/` and can be hosted on any static hosting service. Infinite Mode additionally requires its long-running server.

## Roadmap

The shared-world mode is under active integration and deployment testing.

See [`status.md`](status.md) for current progress and upcoming work. See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the development workflow.

## Privacy

Stigsim does not include analytics or tracking. The standalone mode remains local to the browser; Infinite Mode sends simulation commands to the shared server.
