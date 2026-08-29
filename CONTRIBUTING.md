# Contributing to Stigsim

Contributions are welcome. Please open an issue before starting a large change so the approach can be discussed first.

## Development setup

Install Node.js 22.13 or newer and pnpm, then run:

```bash
pnpm install
PORT=3000 BASE_PATH=/ pnpm dev
```

Before submitting a change, run:

```bash
pnpm typecheck
pnpm build
```

## Architecture

Stigsim has a standalone React/Vite simulator and an optional server-authoritative shared-world mode.

- `src/AntSim.tsx` contains the simulation model and interface.
- `src/App.tsx` is the application entry component.
- `src/styles.css` contains global styles; most simulation-specific presentation lives with the simulator.
- `public/` contains static site assets.
- `vite.config.ts` configures local development and static builds.
- `src/components/InfiniteSim.tsx` renders the shared world and connects to its API.
- `shared/infinite-contract.ts` is the wire contract shared by browser and server.
- `server/` contains the authoritative simulation, WebSocket API, and Postgres persistence.

Keep the core simulation logic independent of React where practical. Preserve the standalone mode when changing Infinite Mode.

## Tuning the movement model

Ants steer by sampling the pheromone field at three points ahead of them, so
sensor geometry decides how well trails hold. The defaults in
`src/sim/constants.ts` were chosen by sweeping the real simulation across 32
seeds and scoring each configuration by food returned.

Because `src/sim/` is free of React, a sweep runs headlessly and takes seconds:

```ts
import { Simulation, DEFAULT_PARAMS, computeHighwayScore } from "./src/sim/simulation";

const sim = new Simulation(20, { ...DEFAULT_PARAMS, sensorAngle: 0.9 }, 0.1, 1, 1, 500, "seed");
for (let i = 0; i < 4000; i++) sim.step();
console.log(sim.totalFoodCollected, computeHighwayScore(sim));
```

Two things are worth knowing before changing these numbers. Sensor *spread* is
the sensitive parameter — below about 0.5 radians the three readings sit too
close together to tell directions apart, and colonies barely follow trails at
all. Sensor *reach* has a broad plateau from roughly one to one and a quarter
cells, within which differences between neighbouring values are seed noise
rather than signal; judge a change across many seeds, never one.

## Project guidance

`README.md`, this file, and `status.md` are the tool-neutral sources of truth. Client-specific files such as `CLAUDE.md` and `AGENTS.md` should point here rather than duplicate project instructions.

## Shared-world mode

Run `pnpm dev:server` alongside `pnpm dev`. Production must use one server replica and Postgres persistence; see `server/README.md`.
