# Pheromone update API — doctrine, adoption, and topology

**Status:** proposed — design worked through with Patrick on 2026-09-05; for
team review at the 2026-09-11 SIGFPT call, where the topology option in
[Topology](#topology) is the decision that call has to make.
**Date:** 2026-09-05

## Why

The competitive modes need a mechanic through which colonies interact
stigmergically, beyond taking food out of a shared pool. Ergod's name for the
target is PvEvP: two players, each acting on the environment, each affected by
what the other laid down. The Sep 4 call put "pheromone update API" second on
the priority list, after "open channel", and asked for a proposal. This is it.

The current core does not support the mechanic, and the parts that would have
to change are entangled:

- There is one `SimParams` for the whole `Simulation`
  (`packages/sim-core/src/types.ts:1-6`). `Colony` has no parameters of its
  own, and `setParam` applies to every colony at once. Nothing per-colony
  exists in the core.
- The laying side is unparameterised. `DEPOSIT_RATE` is a constant, the channel
  an ant lays is fixed by its state, and an ant deposits three times into the
  cell it is leaving per cell transit (`sim.ts:379-387`; distances 16, 12, 8,
  then 4, which is under `ARRIVE_THRESH`). The only knobs today are on the
  response side.
- Nest and food are written into the field as pheromone: 1000 on the nest cell
  and 850 on its neighbours every tick, 1000 on every discovered source with
  food left (`sim.ts:139-148, 357-364`). That is seventeen times the strength
  of a cell transit, so any amplitude knob is dominated by a constant it can
  not touch, and under any shared field one colony's nest beacon would pull the
  other colony's returning ants.
- Fields are private per colony. No cross-colony read exists anywhere.
- PR #11's `setDoctrine` bypasses the command bus, so doctrine changes are
  absent from traces, and it averages `evapRate` across ants because one field
  can only decay at one rate.

The design goal, in Patrick's words: players can both easily and interestingly
change their colony's behaviour, by hand, in real time, in response to what the
other colony is doing.

## Scope

In scope: the vocabulary of colony behaviour (what a doctrine contains and how
it is targeted), the adoption semantics (when a change takes effect), the field
topology as a separate decision with its own setting, presets as data, and a
one-paragraph transport note.

Out of scope, each with the hook that keeps it possible:

- **Transition rules** — anything that changes a doctrine other than a human
  hand: a condition→action list over metrics, an FSM over doctrines, an
  evolutionary loop. Ergod's Aug 21 framing was that fixed configurations plus
  transition rules make a protocol rather than a procedure. For the workshop
  the player is the transition function. Every doctrine change is a recorded
  command, so an algorithmic trigger later emits the same command a human does.
- **Programmatic per-ant policies** and an **expression DSL**. The doctrine
  carries a descriptor kind tag (`v`) so a second descriptor type can be added
  without a trace format change.
- **Erase** (cancelling enemy marks, the `emerg-ant` shape). A field primitive
  that is not a deposit; not needed for the allocation mechanic.
- **A per-cell saturation cap**, **per-channel evaporation**, and
  **asymmetric per-colony `tankMax`**. Noted under
  [Extensions](#extensions-noted-not-designed).

## Decisions

| Question | Decision |
| --- | --- |
| **Scope** | Vocabulary plus an adoption opinion. Transition rules deferred; the command shape accommodates them. |
| **Topology** | The vocabulary is topology-neutral: it carries an origin axis on the follow side and a target axis on the lay side that are inert under options that do not use them. Topology is a separate `Topology` setting, decided on Sep 11. |
| **Disruption** | A fraction of a colony's ants, the spoilers, may lay the opponent's chemical (mimicry). Read-only sensing of enemy trails is the fallback. No erase. |
| **Cautionary pheromone** | Removed from the vocabulary. The `caut` array stays in storage, always zero, until the channel set becomes data. |
| **Beacons** | Replaced by odor: a value computed from world state at read time, private to the colony, impossible to mimic, non-evaporating. |
| **Evaporation** | A colony-level doctrine atom applied to the colony's own layer, effective at the tick boundary. |
| **Gland size** | `tankMax` is construction-only and symmetric. |
| **Adoption** | Every ant carries a doctrine version. Mode `instant` or `nest`, set by an initial command; both modes run one code path. |
| **Commands** | One whole-value `setDoctrine`. `setParam` and `setCautionary` are removed. Reject on invalid, never clamp. |
| **Versions** | `SIM_VERSION` 2→3 and `TRACE_VERSION` 1→2 in one PR, golden regenerated once. |

## The substrate

### Layers

The engine keeps one `FieldSet` per colony and treats it as that colony's
contribution layer. Everything colony A's ants lay goes into A's layer, except
mimic deposits, which go into the target colony's layer when the topology
honours them. Storage is unchanged from today.

### Channels

The vocabulary knows two channels, `home` and `food`. The `caut` array stays in
each `FieldSet`, always zero; nothing lays into it and nothing reads it. It is
deleted when the channel set becomes data, because today it is hard-coded in
`types.ts`, `field.ts`, `chunked-field.ts`, the fingerprint order, `metrics.ts`
and the CSV columns, and removing it now would widen this change for no
behavioural gain.

### Odor

Nest and food stop being written into the field. Instead, the read an ant
performs on the channel its state cares about is increased by a value computed
from world state:

- A **returning** ant's read of `(home, own)` is increased by `ODOR_LEVEL` on
  its own colony's nest cell and by `ODOR_LEVEL × NEST_HALO` on the nest's open
  orthogonal neighbours.
- A **searching** ant's read of `(food, own)` is increased by `ODOR_LEVEL` on
  any cell holding a source with food remaining. No halo, matching today's
  beacon, which is cell-only.

`ODOR_LEVEL` starts at 1000 (today's `NEST_SEED`) and `NEST_HALO` at 0.85, so
the pull onto nest and food is what the beacon produced. Odor sits inside the
read, and therefore inside the power, rather than as a separate multiplier,
because a multiplier outside the power loses to a strong trail (`301^5` beats
`1001 × 1^5`) and the beacon never did. The coupling this keeps is the one the
model has always had: an ant whose doctrine puts a zero exponent on its own home
channel cannot smell its nest.

Consequences: nest odor is private to the colony by construction under every
topology; food odor is world-visible, which is honest and at range zero is no
more of a leak than stepping onto the cell is today; the trail channels contain
only what ants laid, at ant scale, so a lay gain means what it says everywhere
on the map; a colony remembers a source only for as long as its trail persists;
and an ant adjacent to an undiscovered live source will now usually step onto
it, a small discovery boost relative to today. `_seedNest` and the re-seed loop
are deleted. `discoveredSources` stays, for metrics only.

### Reads

An ant of colony X reading channel `c` at a cell gets a pair `(own, enemy)`,
mediated by the topology's read mode:

| read mode | `own` | `enemy` |
| --- | --- | --- |
| `private` | X's layer | 0 |
| `shared` | sum over all colonies' layers | 0 (the origin axis collapses) |
| `separable` | X's layer | sum over the other colonies' layers |

A channel that the topology's `visible` flags do not mark as visible is treated
as `private` regardless of read mode. Odor is added to `own` after the mode is
applied, so it is never summed into another colony's read.

### Writes

Own-target deposits go to X's layer. Mimic deposits go to the target colony's
layer when `mimicEnemy` is true and read mode is `separable`; to X's own layer
under `shared` (there is one chemical, so mimicking it is laying it); and
nowhere under `private` or when `mimicEnemy` is false. With more than two
colonies, a mimic deposit is divided equally across the other colonies' layers.
In practice mimicry is a two-colony war-mode setting; the Infinite server runs
`private` and never honours it.

## The vocabulary

### Types

```ts
type Role    = "forager" | "spoiler";
type State   = "searching" | "returning";
type Channel = "home" | "food";
type Origin  = "own" | "enemy";

interface RoleTable {
  /** Signed half-step exponent, |w| <= MAX_TRAIL_POWER. 0 means ignore. */
  follow: Record<State, Record<Channel, Record<Origin, number>>>;
  /**
   * own:   integer gain 0..3, multiplying DEPOSIT_RATE.
   * mimic: 0 | 1 flag; a deposit of mimicRate * DEPOSIT_RATE of the
   *        opponent's chemical. Always 0 on the forager table.
   */
  lay: Record<State, Record<Channel, { own: number; mimic: number }>>;
}

interface Doctrine {
  /** Descriptor kind. A second kind can be added later without a format change. */
  v: 1;
  forager: RoleTable;
  spoiler: RoleTable;
  /** Fraction of the colony's ants roled as spoilers, [0, 1]. Colony-level. */
  spoilerFraction: number;
  /** Scale on mimic deposits, [0, 1]. Colony-level. */
  mimicRate: number;
  /** Decay applied to this colony's layer each tick, [0, MAX_EVAP_RATE]. Colony-level. */
  evapRate: number;
}
```

Sixteen follow atoms, eight own-lay atoms, four spoiler mimic flags, and three
scalars: thirty-one, most of them zero in any real doctrine. The architecture
holds the knobs; the surface hides them (see [Presets](#presets-surface-and-transport)).

### Validation

One predicate, `isDoctrine`, exported from `sim-core` and used by `isCommand`,
so the command bus and the trace loader cannot drift:

- exactly the keys above, `v === 1`;
- every follow entry finite, `isHalfStep`, and `|w| <= MAX_TRAIL_POWER`;
- for each `(role, state)`, the sum of `|follow|` over the four
  `(channel, origin)` entries is at most `MAX_TRAIL_POWER`. This preserves the
  overflow headroom the single exponent had: `MAX_TRAIL_POWER` was chosen so
  that `5000^32` stays finite, and the product of the four factors is bounded
  the same way;
- own lay gains are integers in `0..3`; mimic flags are `0` or `1`; every mimic
  flag on the forager table is `0`;
- `spoilerFraction`, `mimicRate` finite in `[0, 1]`; `evapRate` finite in
  `[0, MAX_EVAP_RATE]`.

`setDoctrine` additionally requires `colony` to be an integer below
`MAX_COLONIES`.

### The default doctrine

Today's model is a single point in this space, and it is four nonzero atoms:

| | `follow food/own` | `follow home/own` | `lay own` |
| --- | --- | --- | --- |
| forager, searching | 5 | 0 | home ×1 |
| forager, returning | 0 | 5 | food ×1 |

Everything else is zero; `spoilerFraction = 0`, `mimicRate = 0`,
`evapRate = 0.005`. Under `private` read mode the enemy-origin reads are zero,
so those factors are exactly 1 and the score is bit-for-bit what `powerChoice`
computes today for any cell without odor. `DEFAULT_DOCTRINE` is exported.

### The default spoiler table

Only consulted once `spoilerFraction` is raised. An explorer that drifts toward
the opponent and lays false food trail, and forages normally if it happens to
pick food up:

| | `follow food/own` | `follow home/enemy` | `follow home/own` | `lay` |
| --- | --- | --- | --- | --- |
| spoiler, searching | 1 | 2 | 0 | food mimic |
| spoiler, returning | 0 | 0 | 5 | food own ×1 |

with `mimicRate` supplied by whichever preset raises the fraction (Saboteur
uses 0.5). These numbers are a starting point for playtesting, not a finding.

### What left the doctrine

`tankMax` stays in the run config but leaves the live set. It is fixed at
construction and symmetric across colonies. Making it a per-colony asymmetric
trait needs a per-colony config block and a further `TRACE_VERSION` bump, and is
deferred. `SimParams` shrinks to `{ tankMax }`.

Nothing else leaves. `evapRate` was going to become a world setting on the
argument that evaporation is a property of the medium; it stays a colony atom
because the team's play evidence says cranking it is the fast, legible way out
of an ant mill, because Venkat's tournament proposal names it as a knob, and
because with one layer per colony it is representable under every read mode.
It is also a real trade-off rather than a free lever: a colony that runs
volatile pheromone is more resistant to mimicry (a mimic deposit in its layer
decays at its rate) and escapes mills faster, at the cost of its own trails
fading faster.

## Scoring, laying, and roles

This replaces `powerChoice` and the deposit block in `_moveAnt`. The candidate
list, the no-backtrack rule, the stay fallback, food pickup, nest arrival and
the manual ant are unchanged.

### Score

Every ant carries a `role` and a `doctrineVersion`, and looks up its adopted
doctrine's table for its role. For an ant in role `r` and state `s`, each
candidate cell scores as

```
score(cell) = Π over c in {home, food}, o in {own, enemy} of
              (read(c, o, cell) + 1) ^ follow[r][s][c][o]
```

with a zero exponent skipped rather than computed, one RNG draw, and the
roulette exactly as today. `read` is the mediated pair above, with odor added
to `own`. A negative exponent is repulsion; `deterministicPow` already returns
`1/r` for negative powers (`rng.ts:139`).

With the default doctrine each state has one nonzero exponent, so the number
of `deterministicPow` calls per decision is what it is today. A row with all
four entries set pays four per candidate. Under `separable`, each enemy read is
one extra field lookup per other colony.

### Laying

Laying happens where and when it does today: on each transit frame while
`dist > ARRIVE_THRESH`, into the cell being left, three times per cell. For the
ant's role and state, channels are handled in a fixed order — home then food,
own then mimic — so the tank drains deterministically:

- an own entry with gain `g > 0` deposits `min(tank, g × DEPOSIT_RATE)` into the
  ant's own layer and drains the tank by that amount;
- a mimic flag of `1` deposits `min(tank, min(mimicRate, maxMimicRate) ×
  DEPOSIT_RATE)` where the topology says (see [Writes](#writes)) and drains the
  tank the same way.

Mimicry therefore costs foraging deposition, both stop when the tank is empty,
and the tank refills at food and at the nest as today. An ant may lay more than
one channel per state if its table says so; today's model never does, and the
design allows it rather than preventing it.

### Roles

Roles are assigned at the nest event — at spawn, and at every
returning-to-searching transition on the nest cell — and, under `instant`
adoption, at every apply of `setDoctrine` (see [Adoption](#adoption)). Ant `i` in `colony.ants` is
a spoiler when `i < floor(spoilerFraction × colony.ants.length)`, otherwise a
forager. No RNG draw is spent; the same ants are always the spoilers, so they
can be coloured; raising or lowering the fraction re-roles each ant the next
time it leaves the nest. `setAntCount` gives new ants a role at spawn. `role` is
fingerprinted.

Two documented quirks. Under `nest` adoption, an ant out on a trip when the
fraction changes keeps its role until it next departs, so a colony that drops
`spoilerFraction` to zero still has its spoilers out until they come home. And `setAntCount` shrinking a
colony drops ants from the end of the array, which under the by-index rule
removes foragers before spoilers.

### The state machine

The state machine stays the engine's. Food pickup and nest arrival happen as
today. A spoiler that steps onto food becomes a returning ant and uses the
spoiler table's returning row, which by default forages home. War mode's extra
phases remain war mode's business, outside the doctrine; for table lookup it
maps retreating onto the returning row and waiting onto no move.

## Adoption

A colony holds its current doctrine and a monotonic `doctrineVersion`. Applying
`setDoctrine` replaces the current doctrine and increments the version at the
tick boundary, as every command does. From that point the colony-level atoms —
`evapRate`, `spoilerFraction`, `mimicRate` — are in effect: the layer decays at
the new rate on the next tick, the next departures are roled against the new
fraction, and spoilers already out mimic at the new rate. These describe the
field and the roster, not any one ant, and never wait.

The per-ant atoms, the follow and lay tables, are adopted on the ant's
schedule. Each ant carries a `doctrineVersion`, fingerprinted, and looks up its
tables through it. Adoption happens at the nest event, the same event that
assigns the role, so there is one place in `_moveAnt` where an ant is
re-stamped with its colony's current version and its role. The colony keeps the
doctrines its ants still reference in a small map from version to doctrine with
a reference count, dropping a version when its last ant adopts a newer one. In
the steady state that map holds one entry. Ants spawned by the constructor
hold version 0, which is `DEFAULT_DOCTRINE`, and the map starts with that
entry.

The adoption mode is a run setting with two values:

- `nest` — ants re-stamp only at the nest event, so a colony passes through a
  mixed regime as ants come home. This is what PR #11 built for war mode.
- `instant` — applying the command also re-stamps every ant of the colony at
  the same tick boundary, new version and role by index, whether or not the
  ant is at the nest. This is today's behaviour in the maze sandbox, and it is
  what lets a starting doctrine with a nonzero `spoilerFraction` field spoilers
  from tick 1 rather than after the first round trip.

Both run the same code path: `instant` is `nest` with a re-stamp loop added at
apply time. That is what makes the flip free and keeps the fingerprint the same
shape in both modes. The mode is set by a `setAdoption` command that each mode
issues as an initial command, so it lives in the trace as a command rather than
as a config field.

Defaults: the maze sandbox uses `instant`; war mode uses `nest`. The recorded
play report on nest-gating — that it made ant-mill recovery slow and the game
"a little more boring" (Sep 4 call) — is answered structurally here: the fix
that player reached for, cranking evaporation, is a colony-level atom and takes
effect immediately under `nest`. What waits for the nest is "stop reinforcing",
the lay gain. Whether that is enough to make war mode feel responsive is a
playtest question; if it is not, the mode flag is the lever.

The per-colony `adopted / population` metric from PR #11 is kept, since under
`nest` it is the honest picture of what the colony is running.

## Commands, traces, fingerprint, versions

### Commands

Added:

```ts
| { kind: "setDoctrine"; colony: number; doctrine: Doctrine }
| { kind: "setAdoption"; mode: "instant" | "nest" }
| { kind: "setTopology"; topology: Topology }
```

`setDoctrine` carries the whole value rather than a path and a number, so a
preset, a slider drag, a preregistered round, a replay, and a later LLM or
evolutionary emitter all produce the same object, and a doctrine change in the
log is self-describing. The UI debounces slider movement (trailing, on the
order of 100 ms) so a drag records one command. A doctrine is under a kilobyte.

`setAdoption` and `setTopology` are issued by each mode as initial commands.
They are ordinary recorded commands; nothing stops a trace from changing them
mid-run and nothing in the engine needs them not to.

Removed: `setParam` and `setCautionary`. `evapRate` and `trailPower` now live
in the doctrine, `cautionary` no longer exists, `tankMax` is construction-only.
`NumericParamKey` goes with them.

### Initial commands

A mode enqueues `setAdoption`, `setTopology`, and one `setDoctrine` per colony
before the first physics step, via `flushPending`, which applies them
immediately and records them at `t = 1`; on replay, `loadSchedule` applies them
at the top of tick 1, before that tick's physics. A colony that receives no
`setDoctrine` runs `DEFAULT_DOCTRINE`. Absent `setTopology`, the topology is
option 1; absent `setAdoption`, the mode is `instant`.

This is what lets `run.config` shed the old parameter block. It carries seeds,
`numAnts`, `numColonies`, `numFoodSources`, `foodPerSource`, `loopRate`, and
`tankMax`, and nothing else about behaviour.

### Versions

`run.config` changes shape, so `TRACE_VERSION` goes 1→2. Every existing run
evolves differently — odor replaces the beacons and the command set changed —
so `SIM_VERSION` goes 2→3. Both bumps land in the same PR with the golden
fixture regenerated once by `pnpm golden`. Traces from before are rejected by
version, which is the existing contract and is why deleting `setParam` costs
nothing. The by-hand cross-engine determinism check in `CONTRIBUTING.md` runs
on this change, since it touches the score path.

### Fingerprint

The fingerprint gains, in a fixed canonical order: per run, the adoption mode
and the topology; per colony, `doctrineVersion` and every doctrine in the live
version map, each hashed as its numbers in table order; per ant,
`doctrineVersion` and `role`. It replaces the hash of the four global params
with `tankMax` alone. Two runs that differ only in a doctrine atom, a role assignment, an
adoption mode or a topology setting diverge at the next checkpoint.

## Topology

This is the standalone decision for the Sep 11 call. Nothing above depends on
which option is chosen; the origin and target axes are inert under options
that do not use them.

```ts
interface Topology {
  read: "private" | "shared" | "separable";
  /** May spoilers' mimic deposits reach the other colony's chemical? */
  mimicEnemy: boolean;
  /** Which channels cross colony lines at all. An invisible channel is private under every read mode. */
  visible: { home: boolean; food: boolean };
  /** Match rule, [0, 1]; the engine clamps mimic deposits to min(doctrine.mimicRate, this). */
  maxMimicRate: number;
  /** Keep a spoiler-colony -> target sublayer for spectators and metrics. Ants never read it. */
  provenance: boolean;
}
```

`maxMimicRate` is a match rule rather than a doctrine bound so a tournament can
tighten it without touching the validator; the engine clamps at deposit time.
`provenance` costs one extra `FieldSet` per ordered colony pair, so it is a
two-colony war-mode setting.

### The options

**Option 1 — today.** `read: private, mimicEnemy: false`. Colonies interact
only through food depletion and walls. This is what the Infinite server keeps:
with up to a hundred colonies neither sharing nor mimicry is sensible there.

**Option 2 — read-only sensing.** `read: separable, mimicEnemy: false,
visible: { home: true, food: true }`. A colony can weight the opponent's trails,
positively to poach or negatively to avoid, and the opponent can do nothing
about it except lay less. Disruption is absent; competition is over information
and food. This is the `hive` and ICFP 2004 shape, and the fallback if the
freeze runs short, because it needs nothing beyond the enemy read.

**Option 3 — separable with mimicry.** `read: separable, mimicEnemy: true,
visible: { home: true, food: true }, provenance: true`. Everything in option 2,
plus spoilers can write the opponent's chemical, which the opponent's ants can
not tell from their own. Defences are structural: the victim's own `evapRate`,
since mimic deposits in its layer decay at its rate; a higher exploitation
exponent, so an established highway outcompetes weak fakes; and the fact that a
spoiler reinforces at one ant's rate against a whole colony's foragers.
`maxMimicRate` and the tank are the balance dials. Spectators see mimic
deposits in the spoiler colony's colour through the provenance sublayer; players see
their own chemical. This is Aswale et al.'s detractor model.

**Option 4 — open channel.** `read: shared, mimicEnemy: true` (which collapses
to own-layer laying, since there is one chemical), `visible: { home: false,
food: true }`. Ants see one summed food field and cannot attribute it. Every
colony poaches by construction, and any food deposit off a real source is a
fake. Home should stay invisible here: with odor, B's returning ants no longer
get pulled onto A's nest cell, but they would still follow A's home trails into
A's nest region and wander, a hazard with no upside. The literature says
indistinguishable spoofing is near-undefendable, and the remaining defence is
evaporation. The Sep 4 call leaned this way; the enemy weights in the
vocabulary are inert here.

### Cross-cutting notes

Evaporation is a colony atom on the colony's own layer under every option.
Under option 4 that means layers laid by different colonies fade at different
rates while ants see the sum. The fiction is that colonies emit different
formulations of one signal, which is true of real ants across species; the
spec says so rather than hiding it.

A per-cell saturation cap is a plausible sixth field: a one-line change to
`field.add` that blunts high-amplitude fakes. It also caps real highways and
needs its own analysis, so it is an extension, not a setting.

### Recommendation

Option 3 with `maxMimicRate` around 0.5, and option 2 as the fallback. Under
option 3, "am I reading their trails" is a player decision, mimicry is a named,
bounded, spectator-visible action, and the defences are things a knob player
can turn. A knob-driven spoiler cannot aim at dead ends, so the expected effect
is diffuse oversaturation of the victim's map with weak false trail rather than
targeted deception; the counter is a higher exponent or waiting for
evaporation, which is a watchable loop with knobs alone. Option 4's honest
advantage is that it is the simplest to explain in a workshop session, and
choosing it changes nothing in the vocabulary.

## Presets, surface, and transport

### Presets

Presets are data, shipped alongside the UI rather than in the engine: a list of
`{ name, intent, doctrine }` where `intent` is one line. The engine never sees
a preset; picking one emits `setDoctrine`. Starting points, all subject to
playtest:

| preset | change from default | intent |
| --- | --- | --- |
| Highway | exponents 8 | exploit the best route hard |
| Scout | exponents 2, `evapRate` 0.01 | explore widely, forget quickly |
| Volatile | `evapRate` 0.02 | resist fakes and escape mills, at the cost of memory |
| Saboteur | `spoilerFraction` 0.2, `mimicRate` 0.5, default spoiler table | send a fifth of the colony to lay false trail |
| Poacher | `follow.searching.food.enemy` 3 | follow the other colony's food trail |

Poacher means something only under `separable`; the UI hides presets whose
nonzero atoms are inert under the current topology. Exponent presets set
`searching.food.own` and `returning.home.own` together, since that pair is what
today's single slider was.

### Tournaments

A tournament is a named subset of two or three live atoms; everything else is
fixed by the preset. Venkat's two proposals (Aug 28) map directly: "explore
versus exploit" exposes one exponent slider bound to that pair; the PvEvP
tournament exposes `spoilerFraction` and the poach weight. The UI binds sliders
to atoms by path, so a tournament is also data. This is how thirty-one atoms
in the architecture become two on the screen, and it is the answer to the gap
between Venkat's two-or-three live knobs and the size of the vocabulary.

### Legibility affordances

All in the UI, none in the engine: a colony selector; the preset picker with the
atoms visible underneath it; the `adopted / population` meter next to the
controls under `nest` adoption; an event feed built from the command log
("tick 4120: Colony A → Saboteur"), which the trace already carries; spoilers
drawn in a distinct colour; the provenance sublayer rendered in the spoiler
colony's colour for spectators; and the tick at which a command took effect, since
commands apply at a tick boundary and the log records it. Counterfactual
replay — branching a trace at a doctrine change to show with-and-without side
by side — is an extension `sim-trace` can support without engine changes.

### Transport

Once the Infinite server is ported onto `sim-core` (issue #6 step 4), it gains
a client message `updateColony { colonyId, doctrine }`, checked against the
sender's owned colonies, validated with `isDoctrine`, rejected with a new
`error` server message rather than clamped, applied as a `setDoctrine` command
on the authoritative simulation, and answered with a
`colonyUpdated { colonyId, doctrineVersion, tick }` broadcast. The server's
topology is option 1. The existing 30-messages-per-second window is the rate
limit and the client debounces. Online war mode uses the same message with each
player owning one colony. Until the port lands, the war-mode prototype's
`set-doctrine` path should carry this `Doctrine` object so nothing changes
shape at port time. The server's placement-time clamping is a known divergence
from reject-on-invalid that the port should resolve in favour of rejecting.

## Error handling

Invalid input is rejected, never clamped, as `sim-core` does today. An invalid
`setDoctrine` is refused at `enqueue` (`isCommand` returns false) and the UI
reports it; `DEFAULT_DOCTRINE` and `isDoctrine` are exported so the UI can
validate before sending. An invalid command in a trace file rejects the whole
trace, which is the existing rule. A `setDoctrine` whose `colony` index passes
the `MAX_COLONIES` bound but exceeds the run's colony count is ignored at
apply, as an out-of-bounds wall edit is today. A `TRACE_VERSION` 1 file is rejected by
version. Mimic deposits under a topology that does not honour them are dropped
silently by design, not reported: the doctrine is valid, the world just does
not carry the chemical.

## Testing

In `sim-core`:

- `isDoctrine` accepts `DEFAULT_DOCTRINE` and every preset, and rejects each
  violation individually: a missing key, an extra key, a non-half-step
  exponent, a row whose `|follow|` sum exceeds `MAX_TRAIL_POWER`, a forager
  mimic flag, an out-of-range scalar.
- The score function with `DEFAULT_DOCTRINE`, read mode `private`, and a cell
  with no odor returns the same bits as the old `powerChoice` for the same
  field values. This is the test that shows the generalisation contains the old
  rule, since the golden can no longer show it directly.
- Laying: own gains scale deposits; the tank drains and stops both own and
  mimic deposits at zero; mimic deposits clamp to `maxMimicRate`; a mimic
  deposit lands in the target layer under option 3, in the own layer under
  option 4, and nowhere under options 1 and 2.
- Reads: each read mode returns the right `(own, enemy)` pair for each
  `visible` combination; nest odor never appears in another colony's read.
- Roles: assignment by index; re-roling on departure after a fraction change;
  `setAntCount` growing and shrinking.
- Adoption: under `nest`, ants out of the nest keep the old version and the
  version map holds two entries until the last one comes home; under `instant`,
  all ants re-stamp at the apply tick and the map holds one.
- Odor: the nest halo pulls only the owning colony's returning ants; a food
  cell pulls any searching ant only while it has food.

In `sim-trace`: the three new commands round-trip through `parseTrace`; an
invalid doctrine in a file rejects the trace; a `TRACE_VERSION` 1 file is
rejected; initial commands apply before the first physics step. Fingerprint:
two runs that differ in one doctrine atom, one role, the adoption mode, or the
topology diverge at the next checkpoint. The golden fixture is regenerated once
and the old one deleted. The by-hand cross-engine check runs on this change.

All of this clears the coverage gates (lines 95, branches 92, functions 97),
which in practice means every read-mode branch needs a test and no hook ships
without a caller.

Outside CI, one headless script under `scripts/`: run a two-colony match under
each topology option for a set of seeds and report deliveries, mimic mass laid,
and first-delivery tick per colony. That is the tool for tuning `ODOR_LEVEL`,
`NEST_HALO`, the preset numbers and `maxMimicRate`, and the seed of a
pre-workshop payoff-matrix sweep over presets.

## Sequencing

**PR 1, inside the freeze.** The `Doctrine` type and `isDoctrine`; the three
commands; per-colony doctrine storage with the version map; `role` and
`doctrineVersion` on the ant; odor replacing the beacons; the new score and
lay paths; the fingerprint additions; `SimParams` reduced to `tankMax`; both
version bumps and the golden regeneration; the UI's colony selector, sliders
bound by path, and presets. The `Topology` type and `setTopology` land here,
but the validator accepts only option 1 (`read: private`, `mimicEnemy: false`)
until PR 2 widens it, so a trace can never claim a read mode the engine does
not implement. Under option 1 the enemy read returns zero and mimic deposits
are dropped, so PR 1 is a complete, coherent stopping point that already
unblocks issue #6 step 5 and issue #9 WP3.

**PR 2, inside the freeze if time allows.** `shared` and `separable` reads,
the `visible` flags, mimic deposits reaching the target layer, the provenance
sublayer, and spectator rendering.

**PR 3, after the server port.** `updateColony`.

### Coordination

This design overlaps PR #11. That branch adds a constructor-time
`SimulationPolicy` hook with `paramsForAnt` and `evapRateForColony`, sets
doctrine outside the command bus, and averages evaporation. This design
replaces all three with data — `setDoctrine`, per-ant versions, a colony-level
`evapRate` — while keeping PR #11's war-mode phases, survival rules, and
adopted-fraction UI. PR #11's `sim-core` changes should be dropped and its
war-mode module rebased onto PR 1; that is a conversation with Dan before
anyone touches `_moveAnt`.

Ownership: issue #6 step 5 (Ergod) and issue #9 WP3 (Dan) both claim the
per-colony parameter command, and the Sep 4 call asked for someone to draft
the pheromone API proposal. This spec is that proposal. Suggested: Patrick owns
PR 1, Ergod reviews it against the core write-up he owes, Dan rebases #11 onto
it. A suggestion about people, to be taken as such.

Two small follow-ups that fall out of this but do not belong in it: the gland
label at `src/AntSim.tsx:599` computes four deposits per cell where the engine
makes three, and the `caut` array leaves storage when the channel set becomes
data.

## Risks

- **Playtest time.** The odor constants, the preset numbers and `maxMimicRate`
  are guesses until someone plays them, and no time is budgeted. The headless
  script is the mitigation; the numbers are all data and none is baked into
  the engine's shape.
- **PR #11 conflict.** If the rebase conversation slips, two `_moveAnt`
  rewrites collide. Mitigation: agree ownership before PR 1 starts.
- **Freeze slip.** PR 2 may not land. PR 1 alone is coherent, and option 2 is
  a strict subset of PR 2 that could land separately.
- **`nest` adoption may still feel slow** even with evaporation immediate. The
  mode flag is the lever and the maze sandbox does not use `nest`.
- **Determinism.** The score path is touched. The by-hand cross-engine check
  and the bit-equivalence test are the guards.
- **Thirty-one atoms.** More than any player will use. Deliberate: it is
  easier to put the knobs in the architecture and streamline later than to
  add an axis to a shipped vocabulary. Presets and tournaments are what the
  player sees.
- **Mimic balance is unmeasured.** Aswale's thresholds come from a continuous
  argmax world, not a walled roulette maze. `maxMimicRate` is the dial and the
  payoff-matrix sweep is the measurement.

## Open questions for the Sep 11 call

1. Which topology option, and what `maxMimicRate`.
2. Whether PR 2 is inside the freeze or after it.
3. Ownership of PR 1 and the PR #11 rebase.

## Extensions noted, not designed

- **Transition rules**: a colony-level condition→action list over metrics,
  firing `setDoctrine` with a cause tag. Low-code, replayable, and the object
  Venkat's "Holland-style" search would operate on.
- **Expression doctrines**: a bounded expression tree over the same feature
  vocabulary (the SugarLang shape), as `Doctrine.v = 2`.
- **Per-cell saturation cap** on `field.add`.
- **Per-channel `evapRate`**, and **terrain-dependent evaporation** (PR #4).
- **Asymmetric `tankMax`** as a per-colony construction trait.
- **Pheromone diffusion** as a field setting.
- **Counterfactual replay** in the UI.
- **Erase** as a field primitive.
