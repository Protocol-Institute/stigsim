# Contributing to Stigsim

Contributions are welcome. Please open an issue before starting a large change so the approach can be discussed first.

## Development setup

Install Node.js 20 or newer and pnpm, then run:

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

Stigsim is currently a static React and TypeScript application built with Vite. The simulation runs entirely in the browser.

- `src/AntSim.tsx` contains the simulation model and interface.
- `src/App.tsx` is the application entry component.
- `src/styles.css` contains global styles; most simulation-specific presentation lives with the simulator.
- `public/` contains static site assets.
- `vite.config.ts` configures local development and static builds.

Keep the core simulation logic independent of React where practical. Avoid adding network services, persistent storage, analytics, or third-party runtime scripts without discussing the change first.

## Project guidance

`README.md`, this file, and `status.md` are the tool-neutral sources of truth. Client-specific files such as `CLAUDE.md` and `AGENTS.md` should point here rather than duplicate project instructions.

## Future shared-world mode

A server-hosted shared-world mode is on the roadmap. It should be designed as an optional extension so the standalone browser simulator remains easy to run, host, and understand.
