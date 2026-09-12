# Stigsim — Stigmergy Simulator

Stigsim is a browser-based ant-colony simulator created for the **Stigmergy
Workshop** at the **Protocol Symposium 2026**, part of the Protocol Institute's
SIGFPT (Formal Protocol Theory) initiative.

Stigmergy is coordination through a shared environment: agents respond to
traces left by other agents instead of communicating directly or following a
central controller. In Stigsim, ants explore mazes, discover food, and reinforce
useful routes with pheromone trails. The project includes private experiments,
head-to-head War matches, and a persistent multiplayer world.

## Play online

### [Play the Maze Simulator →](https://stigsim.protocol-institute.org/maze)

Create a maze, configure competing colonies, and experiment privately in your
browser. This is the original, self-contained Stigsim experience.

### [Enter the Infinite World →](https://stigsim.protocol-institute.org/infinite)

Join one shared, persistent simulation with other players. Changes made by one
player become part of the world everyone inhabits.

### [Play Online War →](https://stigsim.protocol-institute.org/multiplayer)

Create or join a two-colony match, invite another player, spectate a running
game, or practice against a randomized colony.

## Simulation modes

| | Maze Simulator | Infinite World |
| --- | --- | --- |
| **Experience** | A configurable maze sandbox | One continuous shared world |
| **Players** | Single-player | Multiplayer |
| **Simulation authority** | Runs entirely in your browser | Runs on the shared simulation server |
| **World state** | Starts fresh and remains local to the tab | Shared by all connected players and saved to Postgres |
| **World shape** | Generated, bounded mazes | An expandable world that persists between visits |
| **Best for** | Controlled experiments and parameter tuning | Emergent collaboration, competition, and long-running colonies |

### Maze Simulator

The Maze Simulator is a laboratory you control. Generate a new maze, add up to
four competing colonies, and tune the conditions while the simulation runs.
Because the model executes locally, no account or server connection is needed
and your experiment is not visible to anyone else.

You can:

- Adjust maze loops and food sources
- Give each colony a doctrine: pick a preset or move its sliders — trail bias,
  evaporation, and, when the topology allows, the share of ants that act as
  spoilers, how strongly they mimic the other colony's chemical, and how the
  colony treats the other colony's trails
- Choose the field topology for a run: private trails, sensing the other
  colony's trails, mimicry, or one open food trail
- Set colony size and gland size for the run
- Edit walls and food sources while the simulation is running
- Observe whole colonies or control an individual ant

A doctrine is a small table of numbers per colony: how strongly ants of each
role follow each pheromone from each origin, and how much they lay. Today's
model is one point in that table, and the presets are a handful of others.
Every change is recorded in the run's trace, so a replay shows the same
colony reacting to the same doctrine at the same tick. Nest and food are
smells computed at read time rather than pheromone written into the field, so
the trails contain only what ants laid. Every live food source emits odor to
every colony; discovering a source is retained for metrics but no longer gates
whether ants can smell it.

Every run is reproducible from a seed. The Run panel shows the current run's
seed, lets you generate a new one, and saves a trace file that captures the
seed, the configuration, every edit you made and when you made it, periodic
state fingerprints, and the metrics log. Loading a trace replays it exactly:
the simulation runs the same commands at the same ticks and checks its
fingerprints against the ones recorded in the file, so a replay that fails to
reproduce the original run says so rather than silently producing a different
one. The replay bar lets you play, pause, and seek to any tick.

Loading a trace puts the simulator into replay mode. The controls that would
change the simulation are disabled for as long as the trace is loaded, and the
settings adopt the values the trace was recorded with, so what is on screen
describes the run being replayed rather than the run you had before. Leaving
replay starts a fresh live run from those same settings and seed. Metrics can
also be exported directly as CSV for analysis outside the browser.

### Infinite World

The Infinite World turns the same stigmergic ideas into a shared environment.
Every connected player sees the same walls, food, colonies, ants, and pheromone
activity. Player actions are sent to an authoritative server, broadcast to other
players in real time, and periodically saved so the world can survive server
restarts and continue between visits.

The durable world includes terrain, food resources, colony identities and
settings, colony ages, collected-food scores, and completed leaderboard
records. After a server restart, ants respawn at their colony nests and begin
laying fresh pheromone trails; individual ant positions and existing trails are
intentionally session-lived in this initial beta.

You can enter in **God Mode** to shape the environment and observe its colonies,
or use **Survive Mode** to place a colony and see how long it lasts in the world
other players have helped create. The leaderboard records colony lifespans.

### War Mode

War Mode is a bounded two-colony survival match powered by the shared
simulation core. It can run locally in one browser or authoritatively on the
server. The server owns the clock, validates doctrine changes, and persists
compact completed-match results. Replay checkpoints and playback are deferred.

Local and Online War share the same four field topologies, symmetric match-level
gland size, and per-colony doctrine model. Colony-level atoms such as
evaporation, spoiler allocation, and mimic rate apply at the next tick; ants
adopt new follow and lay behavior when they return to their nest. War tracing
remains deliberately deferred.

## How the shared world works

The website is a static React/Vite application hosted on GitHub Pages. Infinite
World adds two services behind that interface:

1. A Node.js simulation server owns the authoritative world and synchronizes
   players over WebSockets.
2. A Neon Postgres database stores snapshots and leaderboard results so the
   world is durable.

The production simulation server runs as a single Railway replica. Running one
replica matters because the active simulation lives in server memory between
database snapshots; multiple independent replicas would create conflicting
worlds.

Survive Mode ownership also belongs to the current browser connection. If a
player refreshes or disconnects, their colony remains in the shared world, but
the personal Survive HUD is not reclaimed automatically.

Infinite World is an experimental, anonymously editable public sandbox. Any
visitor can reshape terrain and add or remove food. A colony may be removed
only by the browser connection that created it; this session ownership is a
limited safeguard, not user authentication. Production origin filtering keeps
unapproved websites from using the API through a visitor's browser, but it is
not a substitute for identity or authorization against custom clients.

## Local development

Requirements:

- Node.js 22.13 or newer
- pnpm

Install dependencies and start the frontend:

```bash
pnpm install
PORT=3000 BASE_PATH=/ pnpm dev
```

Open the local [simulation index](http://localhost:3000/) or go directly to the
[Maze Simulator](http://localhost:3000/maze).

### Run server-backed modes locally

Start the simulation server in a second terminal:

```bash
pnpm dev:server
```

Then open the local [Infinite World](http://localhost:3000/infinite) or
[Online War](http://localhost:3000/multiplayer). During development both use
the server on port 3001.

No database is required for local experimentation. Without `DATABASE_URL`, the
server loads the bundled seed and keeps changes in memory for the current server
session. To test persistence, supply a Postgres connection string before
starting the server.

## Production configuration

The frontend build uses `VITE_INFINITE_SERVER_URL` to locate the public
simulation server. The server requires:

- `DATABASE_URL` for persistent Postgres storage
- `ALLOWED_ORIGINS` for the browser origins permitted to use the API and
  WebSocket
- `NODE_ENV=production`
- Exactly one running server replica

See [`server/README.md`](server/README.md) for the server setup and deployment
details.

## Build and contribute

Before submitting a change, run:

```bash
pnpm typecheck
pnpm build
pnpm test
```

The static site is written to `dist/`. Infinite World additionally requires its
long-running simulation server and Postgres database.

Contributions are welcome. See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the
development workflow and architecture, and [`status.md`](status.md) for current
work and the roadmap.

## Privacy

Stigsim does not include analytics or tracking. Maze Simulator activity remains
inside your browser. Infinite World sends the actions required to participate in
the shared simulation to its server.
