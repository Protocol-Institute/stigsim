# Protocol Workshop — local research

Open `/protocol-lab` in the development app, or select Protocol Workshop on the
local landing page. This mode is local only; production routing and its API are
disabled. No preview push or deployment is part of this work.

## What is being tested

One text-generating model jointly designs two deterministic finite-state
controllers and their marker vocabulary. The designer can revise its latest
accepted version using server-computed practice results. This is explicit
protocol design and selection, not spontaneous negotiation between independent
agents and not proof that a useful protocol has emerged. The model never makes
individual movement decisions during evaluation.

Controllers have 16 internal states, a heading, and ordered decision tables
(up to 24 rules per ant). Cells can hold labels 0–15, with 0 meaning blank.
Other meanings are chosen by the designer. Each rule matches state, current
marker and eligible adjacent marker labels, chooses a passable direction in a
relative priority order, optionally writes a label before movement, and updates
its state. Unmatched turns stay still and consume budget. The interpreter
executes validated data; it never evaluates model-written JavaScript. No
controller receives a hidden map, global state, coordinates, a visited set,
teammate position or observer logs. Marker authors are observer metadata only.

## Practice, freezing, and ablations

Each workshop permits at most three paid design requests, including failed
requests. Accepted versions are evaluated on six fixed practice mazes. The
server forwards only the prior protocol and aggregate practice scores for
revision; client-supplied feedback is ignored. Controllers run without further
model calls. All tests use 31×31 mazes, 10% loops and a 400-round budget. Agents
have equal movement opportunities, with alternating first mover.

Freeze any accepted version to evaluate on twelve fresh server-generated seed
strings. Freezing blocks further design requests and selection of a different
held-out version within that workshop. The held-out seeds and results become
available only afterward, and are included in downloads for reproduction.
Starting a new workshop creates fresh held-out seeds.

Every evaluation uses three matched conditions:

- **Shared:** both ants read and write the same local marker field.
- **Private:** each ant gets its own marker field, preserving external memory
  while removing teammate communication.
- **Off:** marker reads return zero and writes are ignored, removing external
  memory as well as communication.

Compare success rate first, then capped mean rounds (failed mazes count as
400), moves, overlap and writing activity. Shared versus private is the more
relevant coordination contrast. Shared versus off conflates communication with
external memory. Foreign-marker reads and plausible label descriptions alone
do not establish beneficial coordination. Twelve held-out mazes are a small
initial sample; this setup does not establish an optimal protocol or results
across maze-generator families.

## Inspecting and recording

The replay shows the first maze in the displayed evaluation, marker labels,
agent positions, and exact rule-firing messages. Designer explanations are
claims; the decision tables are executable behavior. A right/left wall-following
baseline is also shown for that particular replay maze, not as a full-set score.

`stigsim-protocol-workshop@1` downloads include the contract, all accepted
protocol versions, practice results, usage, selected frozen version, held-out
results and seeds. Model-design costs are recorded separately from free
controller execution. Failed requests retain reported usage where available;
missing usage is marked partial. Sessions are in local-server memory and are
lost on restart; New workshop removes the previous session. No training or
held-out data is stored in the production world database.
