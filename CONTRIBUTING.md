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

- `packages/sim-core/` contains the simulation core. It must not import React
  or touch the DOM, so it can run headless on the server as well as in a browser.
- `packages/sim-trace/` contains run metrics, the trace format, and replay. It
  depends on `sim-core`; nothing in `sim-core` may depend on it.
- `src/render.ts` draws a simulation to a canvas.
- `src/AntSim.tsx` is the standalone simulator interface.
- `src/App.tsx` is the application entry component.
- `src/styles.css` contains global styles; most simulation-specific presentation lives with the simulator.
- `public/` contains static site assets.
- `vite.config.ts` configures local development and static builds.
- `src/components/InfiniteSim.tsx` renders the shared world and connects to its API.
- `shared/infinite-contract.ts` is the wire contract shared by browser and server.
- `server/` contains the authoritative simulation, WebSocket API, and Postgres persistence.

Keep the core simulation logic independent of React where practical. Preserve the standalone mode when changing Infinite Mode.

## Determinism

Maze Simulator runs are reproducible from a seed. `pnpm test:client` covers
this within one engine. The cross-engine question cannot run in CI, because
Safari cannot be driven there, so check it by hand before a release that
touches `packages/sim-core/`:

1. Open the app in Chrome, Firefox, and Safari.
2. Enter the same run seed in each and press reset.
3. Run each to at least tick 5000 without editing anything.
4. Compare the fingerprint shown in the Run panel at the same tick.

They must match. If they do not, something in `packages/sim-core/` is relying on
behaviour the ECMAScript specification leaves implementation-defined;
`Math.pow`, `Math.log`, `Math.exp`, and the trigonometric functions are the
usual causes, and none of them may be used to compute simulation state.

`deterministicPow` in `packages/sim-core/src/rng.ts` replaces `Math.pow`. It is defined only
on exponents that are multiples of a half, and throws on anything else rather
than returning an approximation that would look like a valid run. Anything that
can set the trail-bias exponent has to screen it with `isHalfStep` first.

Fingerprints cover the position of the ant random stream as well as the visible
state. Two simulations can agree on every ant and every cell while standing at
different points in the sequence, and from there they diverge for good, so a
hash of visible state alone would report a match well past the point where a
replay had stopped reproducing the recording.

## Traces

A trace is one JSON file holding the run seeds, the initial configuration,
every recorded intervention, periodic state fingerprints, and the metrics
samples. Save one from the Run panel and load it back to replay the run
exactly.

A trace is an ordinary file, so `parseTrace` treats one as untrusted: it bounds
every number against the limits in `packages/sim-core/src/constants.ts` before the trace is
allowed to become a running simulation. Without those bounds a corrupt or
hand-edited file can exhaust the heap, stall a tick for minutes, or drive the
pheromone field to infinity. Any new field a trace carries needs a bound too,
and command values are bounded by the same guards in
`packages/sim-core/src/commands.ts` so
the loader and the command bus cannot drift apart.

`packages/sim-trace/src/fixtures/golden.trace.json` is replayed by
`pnpm test:client` as a
regression guard. If that test fails, simulation behaviour changed. The usual
cause is a new mutation path that does not go through the command bus in
`packages/sim-core/src/commands.ts`; every way of changing a running simulation
must be a
command, or traces stop reproducing. If the change was deliberate, bump
`SIM_VERSION` in `packages/sim-trace/src/trace.ts` and regenerate the fixture with
`pnpm golden`.

## Project guidance

`README.md`, this file, and `status.md` are the tool-neutral sources of truth. Client-specific files such as `CLAUDE.md` and `AGENTS.md` should point here rather than duplicate project instructions.

## Shared-world mode

Run `pnpm dev:server` alongside `pnpm dev`. Production must use one server replica and Postgres persistence; see `server/README.md`.
