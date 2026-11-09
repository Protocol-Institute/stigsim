# Deterministic Coordination Lab (local only)

Open `/coordination-lab` on the development server, or choose Coordination Lab
on the local landing page. The route and card are unavailable in production.
No model service, API call, tokens, database or inference credits are used.
These changes are local working-tree changes; they have not been pushed.

The side-by-side experiment runs the same two private depth-first-search
controllers on identical generated mazes. Agent A breaks ties north/east/south/
west; B reverses that order in both conditions. Each simulated round gives both
agents one movement opportunity; first-action priority alternates by round.
Either agent reaching the exit wins for its team. The team stops immediately;
the other condition continues until it also finishes. Animation speed affects
only presentation. Elapsed search is reported as simulated rounds, not browser
wall time. Controls support stepping, pause, seed and loop rate.

The independent team reads no shared markers. Its visible cell shading is
observer bookkeeping. The coordinated team reads only the current cell and
four adjacent cells' markers. Each controller retains its own visited set and
backtracking stack; neither receives the hidden grid or exit location as
planning input. Environment code applies moves and detects exit arrival.

Coordination prefers an adjacent privately unvisited cell that no teammate has
visited, then an unclaimed connection, then another privately unvisited
connection. The fallback lets both agents traverse a shared corridor rather
than parking the second ant before the first junction. Directional claims are
written at departure and released upon returning from that DFS edge. A cell
with all adjacent open cells visited may be marked locally covered when an
agent backtracks; teammates skip fresh exploration into those cells. This is
not a claim that all remote branches have finished. Other agents may still be
working there. Private visited sets prevent cyclic re-exploration.

Click any cell to inspect visitors, active claims and recorded returns. Events
explain decisions and backtracking. Unlimited, fixed-location digital markers
are an explicit simplification: this is not the 12 movable-pebble environment.
No failures, expiration or lost markers are modeled. A 4,000-round safety limit
bounds execution; seeded tests cover cyclic maze completion and bottlenecks.

Default seed 84 at 10% loops is curated to make the contrast visible: the
coordinated team finds the exit in 140 rounds / 279 moves, versus 248 rounds /
496 moves independently. It is not an average-performance result. In an
exploratory local check of seeds 0–99 at 10% loops, this protocol won 3, lost 13
and tied 84 comparisons. Thus its illustrative gain is not evidence of a better
average solver; the lab deliberately exposes that distinction. Change seeds to
explore cases where communication makes no difference or redirects search
unhelpfully.
