# Food Delivery Lab

Open `/delivery-lab` for a background-worker benchmark with live maze previews,
or run `pnpm delivery [config.json] [output.json] [--adapt]`. No server, model
endpoint, inference charges or database is required. The existing Highway Lab
keeps its route-formation objective; this experiment measures food delivered.

## Fixed environment and searched settings

The simulator uses a 31 × 31 random maze, a single colony with fixed ant count,
finite seeded food sources, private trails, and instant doctrine adoption.
Loop rate, food count/amount, ant population, gland capacity and tick budget are
held fixed across candidates. Maze and food positions vary by maze seed;
ant motion varies by replicate seed. There is no War energy, starvation,
reproduction, second colony or spoiler experiment.

The grid varies evaporation, symmetric own-food/searching and own-home/returning
follow weights, and returning ants' own-food deposition gain. Gain 1 is the
normal food trail, 2 doubles the deposited amount subject to gland limits, and
0 disables that deposit. Every other doctrine field stays at the core default.
Candidate IDs encode evaporation (`e`), following (`p`) and food laying (`l`).

## Selection and validation

1. Every candidate runs on identical training maze/food/ant seed pairs.
2. Rank by mean food delivered at the fixed tick horizon. Break delivery ties
   with the mean cumulative food total over all ticks, favoring earlier delivery.
3. Freeze the winning training candidate as the baseline and the top three
   candidates as finalists before generating any held-out trials.
4. Evaluate those frozen candidates on disjoint `test` seeds. A different test
   winner does not silently replace the training-selected baseline.

The target-food metric is secondary. Unreached targets have null targetTick
and a capped score of maxTicks+1; success counts remain visible. All trials run
the full horizon, including slow runs and runs with depleted food. Raw rows
include all seed streams, settings IDs, target timing, cumulative delivery,
final state fingerprints and accepted interventions.

Comparisons subtract outcomes within the same maze and ant seed, then average
replicates within each maze. An approximate two-sided 95% Student-t interval
uses maze means as the independent units, avoiding pseudoreplication across
ants or random-stream replicates. For 31+ mazes it conservatively uses the
30-degree-of-freedom critical value. Maze win/tie/loss counts use those means.
These intervals are exploratory, not simultaneous multiple-comparison bounds.
The strongest point estimate is not proof of a unique or global optimum.

## Phase 2: one intervention

After completing phase 1, select **Test mid-run changes**, or pass `--adapt` to
the CLI. Every policy starts from the exact same frozen baseline. On training
mazes, compare one switch to each other candidate halfway through the horizon:

- Switch unconditionally, or
- Switch only if no food was delivered during the preceding quarter-budget.

Choose the best switch policy by training delivery/early-delivery ranking,
freeze it, and evaluate it on the same unseen maze/ant pairs as the baseline.
A switch after tick 1500 is enqueued through the core command bus and applies
on tick 1501. Both arms retain their initial paired random streams; their later
random choices naturally diverge when behavior differs.

This deliberately narrow comparison tests whether one scheduled or stall-triggered
change can help. It does not establish that an LLM or a general adaptive
controller helps. A negative or inconclusive result is retained. Existing
validation scores never enter policy selection. After manual tuning using those
scores, use a fresh seedPrefix before treating new outcomes as confirmation.

## Configurations and exports

The Pilot preset searches eight candidates on six training and four held-out
mazes with one ant seed each, for a fast UI check. The larger preset searches
18 candidates on 12 training and eight held-out mazes with two ant seeds each.
Both are starting points, not claims of sufficient statistical power. The UI
exposes the environment and candidate grids, plus a raw JSON editor. Changes to
configuration affect a new search; a phase-2 run uses its completed report's
frozen configuration.

A complete browser or CLI export is `stigsim-food-delivery-experiment@1`, carrying
the simulation version, full phase-1 report and optional phase-2 report. Interrupted
runs are marked partial in the UI and cannot be downloaded as complete results.
No state survives browser refresh unless downloaded. The CLI writes only after
completion, so it cannot overwrite a result with a misleading partial report.

The initial executed experiment lives in `artifacts/food-delivery/`: the pilot
used 20 training and 20 test mazes, two ant seeds each, eight candidates, 20 ants,
three sources × 200 food, 10% loops, and a 3000-tick horizon. Confirmation uses
40 additional maze seeds with the baseline, finalists and switch policy frozen
from the pilot. Treat these as evidence under one environment and limited grid.
