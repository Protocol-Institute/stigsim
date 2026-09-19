# Mode SDK guide

Stigsim's mode SDK gives each simulation mode a stable identity, one validated
construction recipe, and optional adapters for tracing, wire messages, and
persisted state. The workspaces are private and source-only today; this is the
contract for code in this repository, not yet a separately versioned public npm
API.

## The layers

| Layer | Owns | Does not own |
| --- | --- | --- |
| `@stigsim/sim-core` | Mode identity, config parsing, runtime construction, shared simulation primitives | React, DOM APIs, network or database framing |
| `@stigsim/sim-trace` | Mode trace envelopes, command parsing hooks, recording, replay, divergence checks, and versioned research records | Mode-specific commands, observations, or hidden state |
| Mode boundary | Mode-specific wire encoding and persistence parsing | WebSocket, HTTP, JSON or database lifecycle |
| Host | UI, clocks, connections, JSON framing and storage calls | Simulation behavior or unvalidated reconstruction |

Keeping these responsibilities separate matters more than making every mode
look alike. Infinite emits byte-scaled sparse pheromone chunks. War emits
three-decimal dense layers. Those are different deployed protocols and must not
be folded into one pheromone codec.

## Define a mode

A mode runtime needs a monotonic `tick` and a `step()` method. The mode
definition supplies a stable lowercase id, a behavior version, an untrusted
config parser, and the only supported runtime factory.

```ts
import {
  defineMode,
  type ModeConfigResult,
} from "@stigsim/sim-core";

interface ExampleConfig {
  seed: string;
}

function parseExampleConfig(value: unknown): ModeConfigResult<ExampleConfig> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, error: "Example config must be an object." };
  }
  const seed = (value as Record<string, unknown>).seed;
  return typeof seed === "string" && seed.length > 0
    ? { ok: true, value: { seed } }
    : { ok: false, error: "Example config has an invalid seed." };
}

export const exampleMode = defineMode({
  id: "example",
  version: 1,
  parseConfig: parseExampleConfig,
  create: (config: ExampleConfig) => new ExampleSimulation(config.seed),
});
```

`parseConfig` is a security and reproducibility boundary. It must:

- reject malformed, unbounded and non-finite values;
- return a fresh canonical value rather than retaining caller-owned objects;
- discard unknown properties;
- include every input needed to reconstruct behavior;
- return lossless JSON data if the mode will be traced.

Use `ModeRegistry` when a host reconstructs a mode from data. Resolution is by
the exact `id@version`; it never silently substitutes a newer behavior version.

```ts
const registry = new ModeRegistry().register(exampleMode);
const created = registry.create({
  id: "example",
  version: 1,
  config: { seed: "amber-lattice" },
});
```

Do not call a runtime constructor directly from production host code. Direct
construction remains useful in focused unit and differential tests.

## Make a mode traceable

A trace adapter owns the pieces that cannot be generic: command validation,
command application, and a fingerprint covering all continuation-relevant
state.

```ts
import {
  defineTraceMode,
  ModeTraceRecorder,
  ModeTraceRegistry,
  ModeTraceReplayer,
} from "@stigsim/sim-trace";

export const exampleTraceMode = defineTraceMode({
  mode: exampleMode,
  parseCommand: parseExampleCommand,
  applyCommand: (runtime, command) => runtime.apply(command),
  fingerprint: runtime => runtime.fingerprint(),
});

const traceRegistry = new ModeTraceRegistry().register(exampleTraceMode);
const recorder = new ModeTraceRecorder(exampleTraceMode, { seed: "amber-lattice" });
recorder.command({ type: "set-rate", value: 2 });
recorder.step();
const trace = recorder.build();
const replay = new ModeTraceReplayer(trace, traceRegistry);
```

For a traceable mode:

- `step()` must advance exactly one tick, or not advance at all when paused or
  finished;
- every external mutation must have a validated, canonical command;
- the fingerprint must cover RNG position and mode-owned state as well as
  visible core state;
- mode-specific RNG streams and policies must be reconstructible from config;
- parser bounds must make synchronous replay safe.

Commands recorded while the runtime is at tick `n` are scheduled immediately
before replay step `n + 1`. `ModeTraceRecorder` adds a final fingerprint unless
the last command is deliberately queued against a paused runtime.

Legacy Maze files remain in the `stigsim-trace` envelope identified by
`TRACE_VERSION`. `parseModeTrace` upgrades supported files to a `maze@1`
reference in memory. New mode-aware files use
`stigsim-mode-trace@1`.

## Add research recording

Replay and research are related but different contracts. A `ModeTrace` is the
small deterministic primitive: construction config, canonical commands,
fingerprints, and an end tick. A `ModeRunRecord` adds recording-local
participants, the source and within-tick order of each accepted command,
versioned observation channels, and an optional outcome.

Define research views beside the mode rather than exposing its runtime object:

```ts
import {
  ModeRunRecorder,
  defineRecordingMode,
  defineResearchChannel,
} from "@stigsim/sim-trace";

export const exampleRecordingMode = defineRecordingMode({
  trace: exampleTraceMode,
  channels: {
    population: defineResearchChannel({
      version: 1,
      defaultInterval: 10,
      defaultCapacity: 20_000,
      capture: runtime => ({ count: runtime.population }),
      parse: parsePopulationObservation,
    }),
  },
  outcome: {
    version: 1,
    capture: runtime => runtime.finished ? { winner: runtime.winner } : undefined,
    parse: parseExampleOutcome,
  },
});

const recorder = new ModeRunRecorder(exampleRecordingMode, config, {
  participants: [{ id: "colony-a", kind: "player", slot: "colony-0" }],
});
recorder.command(
  { kind: "participant", participantId: "colony-a" },
  { kind: "set-rate", value: 2 },
);
recorder.step();
const record = recorder.build();
```

The recorder is the mutation gateway: it validates and applies a mode command,
then records its authoritative tick, source, and sequence among other commands
at that tick. Server-backed modes record only commands the authority accepted,
not raw or rejected transport messages.

A research channel is a stable semantic view, not a dump of the runtime. Its
parser canonicalizes untrusted files and its independent version changes when
the observation's shape or meaning changes. Sampling interval and capacity are
recorded in the file; a capped channel reports `truncated: true`. The recorder
also takes per-run interval, capacity, or channel-disable overrides.

`parseModeRunRecord` resolves the exact mode version through a
`ModeRecordingRegistry`. `modeRunRecordToTrace` recovers a standard
`ModeTrace`, so research records use the same replay and divergence checks.
`modeRunCommandsToNdjson` and `modeRunChannelToNdjson` provide stream-friendly
analysis exports.

War is the first complete example in `src/modes/war/war-recording.ts`. Its
`metrics@1`, `agents@1`, and `fields@1` channels separately expose lightweight
colony measures, individual ant state, and full-precision pheromone layers.
See [`Research run records`](research-run-records.md) for the file contract,
privacy boundary, and researcher workflow.

## Own wire and persistence boundaries

Network and persisted values are untrusted even when TypeScript types describe
them. A mode boundary should expose pure encoders and parsers; the host should
only frame the resulting values and perform I/O.

- Infinite: `packages/sim-core/src/infinite-boundary.ts`
- War: `src/modes/war/war-boundary.ts`

Persistence parsers must accept every deployed valid version, reject newer
unknown versions, and fully validate before mutating a runtime. When a legacy
shape is still deployed, keep its migration beside the current codec and test
both paths. Do not replace a stored format in place without a versioned
migration.

Wire encoders must not mutate authoritative precision. War's tests, for
example, prove that rounding a snapshot leaves its dense field unchanged.

## Versioning

There are separate version levers because they answer different questions:

| Version | Meaning | Change it when |
| --- | --- | --- |
| `mode.version` | One mode's simulation behavior | The same config and commands intentionally produce different state |
| `MODE_TRACE_VERSION` | Generic mode-trace envelope | A reader must understand a new required envelope shape |
| `MODE_RUN_RECORD_VERSION` | Generic research-record envelope | Participants, provenance, channels, or outcomes require a different outer shape |
| Research channel version | One named observation schema | That channel's shape or semantic meaning changes |
| `TRACE_VERSION` | Legacy Maze trace envelope | The legacy file format makes an incompatible change |
| `SIM_VERSION` | Existing shared simulation behavior marker | A deliberate core behavior change invalidates old expectations |
| Persistence version | One deployed stored-state shape | Stored state needs a migration |

Moving code, renaming private helpers, or adding an optional adapter does not
justify a behavior-version bump. A refactor that changes a golden replay or a
differential oracle is a bug unless behavior change was explicitly authorized.

## Existing modes

| Mode | Definition | Trace adapter | Boundary | Compatibility guard |
| --- | --- | --- | --- | --- |
| `maze@1` | `packages/sim-core/src/maze-mode.ts` | `mazeTraceMode` in `packages/sim-trace/src/mode-trace.ts` | Browser-local | Golden replay and legacy-trace upgrade tests |
| `war@1` | `src/modes/war/war-mode.ts` | `src/modes/war/war-trace.ts` | `src/modes/war/war-boundary.ts` | Full legacy-vs-SDK differential and trace round-trip |
| `infinite@1` | `packages/sim-core/src/infinite-mode.ts` | Not yet trace-enabled | `packages/sim-core/src/infinite-boundary.ts` | 1,200-tick frozen-engine differential, persistence and WebSocket tests |

`infinite@1` deliberately retains the deployed server's dynamic
`Math.random()` stream and `Math.pow` selection. Seeded construction is useful
for differential testing, but the mode is not promised to replay identically
across JavaScript engines. Changing those operations requires a new Infinite
behavior version rather than silently changing version 1.

## Required checks

Every new or migrated mode should have:

1. parser tests for valid canonicalization, cloning, bounds and malformed data;
2. exact-version registry construction coverage;
3. same-seed deterministic tests where determinism is promised;
4. a full differential oracle when replacing an existing engine;
5. trace JSON round-trip and replay tests when trace-enabled;
6. wire-shape and non-mutation tests for networked modes;
7. current and legacy persistence round-trips for deployed modes.

Before committing a behavior-preserving SDK change, run:

```bash
pnpm typecheck
pnpm build
pnpm test
```

The golden fixture must remain byte-for-byte unchanged. Never regenerate it to
make a consolidation pass.
