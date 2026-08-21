# Infinite Mode server

This Express and WebSocket service owns the single authoritative Infinite Mode
world. Run exactly one production replica: simulation state is held in memory
and snapshotted to Postgres every 60 seconds.

## Persistence boundary

World snapshots preserve walls, food resources, stable colony IDs and settings,
colony ages, and collected-food scores. Completed leaderboard records are
stored separately in Postgres. Together these form the durable shared-world
state used after restarts and deployments.

If historical leaderboard reads fail, the endpoint remains available with live
colonies only. The server logs the degraded state at most once per minute and
logs once when database reads recover.

Individual ant positions, ant movement state, discovered-source caches, and
pheromone fields are intentionally transient in the initial beta. Restored ants
respawn at their colony nests and lay new trails. Browser-to-colony Survive Mode
assignment is connection-scoped and is not reclaimed after a refresh or
reconnect.

## Public editing and access control

Infinite Mode is currently an anonymously editable public sandbox. Connected
visitors may modify walls and food or place colonies. A colony can be removed
only by the WebSocket connection that created it; ownership is not recovered
after reconnecting.

In production, WebSocket connections must include an `Origin` listed in
`ALLOWED_ORIGINS`. Origin and CORS checks constrain browser access only: custom
clients can supply an allowed Origin and are not authenticated. Strong player
identity, durable ownership, moderator roles, and per-identity abuse controls
remain future work.

## Streaming limits

Tick and pheromone messages are complete, high-frequency snapshots. If a
client's WebSocket has more than 512 KiB waiting to send, the server drops these
disposable frames until the client catches up. State-changing wall, food, and
colony events are not dropped. Player-triggered food edits use constant-size
deltas, suppress no-op removals, and are limited per connection to five edits
per second with a burst of ten. The complete initial and tick snapshots remain
authoritative reconciliation points. Viewport filtering and compact delta or
binary encoding for recurring snapshots remain future scaling work.

## Simulation clock

The server advances the simulation at 50 fixed steps per second using an
elapsed-time accumulator with bounded catch-up. Colony ages sent to browsers,
persisted ages, death results, and leaderboard ranks all use this authoritative
simulation clock; browsers do not independently estimate survival time.

Ants begin with roughly 90 seconds of energy, lose energy on every simulation
step, and recover it only after returning food to their nest. Starved ants are
removed permanently; when a colony has no ants left, the colony dies and is not
silently respawned.

## Local development

From the repository root:

```bash
pnpm install
pnpm dev:server
```

Run the type checks, unit tests, and two-client WebSocket integration test with:

```bash
pnpm test
```

Pull requests run this test suite and the production build in GitHub Actions.

No environment variables are required locally. The server listens on port 3001
and loads `seeds/infinite-world.json` without database persistence.

## Production variables

- `DATABASE_URL`: Postgres connection string; required for durable world state.
- `ALLOWED_ORIGINS`: comma-separated browser origins allowed to use the API and
  WebSocket, for example `https://stigsim.protocol-institute.org`.
- `PORT`: injected by the hosting platform.
- `NODE_ENV=production`: makes missing origin configuration a startup error.

Initialize the schema once:

```bash
DATABASE_URL="postgresql://..." pnpm --dir server db:push
```

`railway.json` builds from the repository root because the server and frontend
share `shared/infinite-contract.ts`. Configure one Railway replica and use
`/api/healthz` as its health check.
