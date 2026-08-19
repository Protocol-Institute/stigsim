# Infinite Mode server

This Express and WebSocket service owns the single authoritative Infinite Mode
world. Run exactly one production replica: simulation state is held in memory
and snapshotted to Postgres every 60 seconds.

## Local development

From the repository root:

```bash
pnpm install
pnpm dev:server
```

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
