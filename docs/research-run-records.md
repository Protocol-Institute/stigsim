# Research run records

Stigsim research records are reproducible runs with explicitly versioned views
of simulation state. They are designed to answer two different questions:

1. Can this run be reproduced exactly?
2. Can a researcher inspect and analyse what happened without depending on
   private JavaScript object layouts?

The first question is answered by the embedded trace data: exact mode config,
canonical commands, periodic fingerprints, and the end tick. The second is
answered by participants, command provenance, research channels, and an
optional outcome.

## File identity

New files use `stigsim-run-record@1`. The generic format version is independent
of the simulation behavior version and each research channel's schema version.
A reader resolves the exact `mode.id@mode.version`; it never silently substitutes
a newer behavior implementation.

The canonical JSON shape is:

```text
format, version, simVersion, createdAt
mode: { id, version, config }
participants[]
commands[]: { t, sequence, source, cmd }
fingerprints[]
channels: { name: { version, interval, capacity, truncated, samples[] } }
outcome?: { version, data }
endTick
```

Commands are the replay source of truth. `t` is the authoritative application
tick and `sequence` is the zero-based order within that tick. A source is either
a recording-local participant or a named system component. Raw network
messages and rejected commands do not belong in this stream.

## Research channels

A mode owns its channel schemas. Every channel supplies:

- a schema version;
- default sampling interval and capacity;
- a pure capture function;
- an untrusted-data parser that bounds and canonicalizes every field.

Channels should describe stable concepts such as agents, resources, fields, or
colony metrics. They must not serialize a runtime instance or expose maps,
typed arrays, class identities, reconnect tokens, database keys, or other host
internals. Expensive state belongs in a separate, less frequently sampled
channel so a study can disable it or choose its own interval.

War currently defines:

| Channel | Default interval | Contents |
| --- | ---: | --- |
| `metrics@1` | 10 ticks | Result state, remaining food, and colony lifecycle metrics |
| `agents@1` | 25 ticks | Stable ant id, position, target, phase, energy, role, and doctrine version |
| `fields@1` | 100 ticks | Full-precision home, food, caution, and provenance pheromone layers |

The mode configuration contains the seed, settings, initial doctrines, and
rules. Later doctrine changes are canonical commands, so researchers can join
them to observations by tick without duplicating doctrine state into every
sample.

The authoritative Online War host uses a storage-bounded profile rather than
the browser-local defaults: `metrics@1` every 10 ticks (capacity 10,000),
`agents@1` every 50 ticks (capacity 2,000), and `fields@1` every 250 ticks
(capacity 400). Capacity truncation is explicit in each channel. Completed
records are fetched on demand from `/api/war/records/:recordId`; lobby messages
carry only the compact match summary and an availability flag.

## Replay and analysis

Load files with `parseModeRunRecord` and a `ModeRecordingRegistry`. The parser
checks the generic envelope, participant references, command ordering, exact
channel versions, sampling bounds, mode-owned sample parsers, and outcome.

Use `modeRunRecordToTrace` with `ModeTraceReplayer` for deterministic playback.
Fingerprints still cover continuation-relevant hidden state and RNG position;
research samples do not replace them.

For analysis, `modeRunCommandsToNdjson` and `modeRunChannelToNdjson` produce
newline-delimited JSON suitable for streaming into Python, R, DuckDB, Polars,
or similar tools. Nested agent and field observations intentionally remain
NDJSON. A later Parquet exporter can be added without changing the canonical
recording format.

## Privacy and provenance

Participant ids are local to one recording. Hosts should generate pseudonymous
ids and may include a display label only when the product has a reason and
permission to retain it. Never record authentication credentials, reconnect
tokens, IP addresses, user-agent strings, or transport metadata in a run
record.

Interface telemetry is not a simulation command. If a study needs rejected
attempts, cursor activity, latency, or other UI behavior, store it in a separate
consented dataset with its own retention and privacy policy.

## Infinite Mode

`infinite@1` is not promised to replay deterministically and has no recording
adapter. A future Infinite research format should use bounded world segments
with a starting state, accepted commands, sampled observations, an ending
state, and a link to the preceding segment. It must not claim verified replay
until nondeterministic choices are recorded or a deterministic behavior version
is introduced.
