# War agents

Online War can run a transparent, server-authoritative opponent. The first
implementation is `deterministic-ooda-v1`: it observes bounded match facts,
scores the existing doctrine presets, records a display-safe OODA decision
trace, and submits doctrine changes through the same recorder command path as a
human player.

## Boundaries

The feature keeps four responsibilities separate:

1. The simulation owns authoritative state and time.
2. The analyzer derives evidence such as delivery rate, energy pressure,
   stale trail traffic, and possible ant mills.
3. The agent interprets that evidence and proposes an action.
4. The host validates and records the action before the simulation applies it.

Shared, versioned wire types live in `shared/war-agent-contract.ts`. Strategy
and observation history live in `server/src/war-agent.ts`; Online War lifecycle
orchestration remains in `server/src/war.ts`. The browser only presents the
decision trace returned by the server.

## Decision trace

Every review contains:

- **Observe:** bounded facts with values, descriptions, and severity.
- **Orient:** a named situation and concise assessment.
- **Decide:** every available preset, its score, and supporting evidence.
- **Act:** the applied preset or an explicit decision to hold.
- **Expected:** a falsifiable outcome for the next review window.

This is an auditable decision artifact, not a request for a model's hidden
reasoning. Deterministic, model-backed, and remote agents should all emit the
same contract.

## Extending the MVP

New agents should consume the versioned observation contract and return the
versioned decision contract rather than mutating the simulation. Preserve these
properties when adding an LLM or remote gateway:

- Agent work must never block the simulation clock.
- The server constructs the permitted observation for the agent's perspective.
- Invalid, late, or unavailable decisions leave the doctrine unchanged.
- Replays use recorded doctrine commands and never invoke the agent again.
- Provider credentials and model configuration remain server-side.
- Detector and agent versions are stored with durable decision journals.

The current journal is kept in active-match memory and broadcast in snapshots.
Persisting it as a bounded research-record channel is the next format change.
