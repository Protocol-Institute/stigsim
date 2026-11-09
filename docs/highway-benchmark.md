# Maze highway benchmark

Run `pnpm highway [config.json] [output.json]` to compare Maze ant settings
headlessly, using the existing simulation physics. No server or model calls.
`pnpm test:highway` tests the observer and paired trial contract.

A highway means a sustained concentration of ants on **one contiguous simple
nest–food route**, with repeated deliveries. Pheromone brightness alone and a
first delivery do not qualify. Version 1 uses these adjustable defaults:

- A candidate route is a loop-erased return journey actually completed by an
  ant, at most 1.1 times the BFS shortest path length.
- At least 95% of all ants must be on that route and targeting a cell along
  one of its edges (waiting at a route cell also counts).
- At least three deliveries must have occurred in the trailing 1,000 ticks.
- Both conditions must hold at every 20-tick sample for 1,000 ticks, on the
  same route. A failed sample resets that route's timer.

The result includes onset and confirmation ticks; ranking uses **confirmation**
so a brief apparent highway never wins. Sampling can miss shorter excursions
between observations. This operational definition approximates the visual
highway; it is not a claim that every ant always follows an optimal path.
Set `minShare` to 1 to require all ants at each observation. A route may be
traversed in either direction. Up to 50 inactive candidate routes are retained;
already qualifying routes are preserved. Discovery and first delivery are
reported separately. A trial stops at confirmation or the tick limit, so final
delivery totals are diagnostics, not equal-duration throughput comparisons.

## Controlled comparison

Each trial has one colony and one randomly placed food source, private trails,
and the standard 31 × 31 random Maze generator. Colony size, gland capacity,
loop rate, evaluation horizon and detection thresholds are fixed across the
sweep. The grid varies the two Maze behavior controls: evaporation rate and
trail power (the same exponent for searching/food and returning/home). Other
doctrine entries remain at Maze defaults.

Every candidate gets identical maze and food seeds, and identical ant seeds
within each replicate. Replicates change only the ant stream. Food capacity is
`numAnts * maxTicks + 1`: since each ant can pick up at most once per tick,
food provably cannot run out during evaluation. This implements infinite food
for the finite experiment without changing the engine or replenishing a source.

Results rank by the mean of `min(confirmation time, maxTicks)` across **all**
trials (restricted mean time to confirmation). Unconfirmed trials are censored
at the horizon; success rate and successful-run median are also shown. Never
interpret the successful-run median without the success rate. A fully censored
comparison establishes no winner. Maze replicates are related observations,
not independent additional mazes. The summary is descriptive, without a
statistical significance claim.

## Configuration and output

Configuration JSON overrides any built-in defaults; unknown keys are errors.
For a quick smoke run:

```json
{
  "mazeCount": 2,
  "replicates": 1,
  "maxTicks": 2000,
  "holdTicks": 200,
  "deliveryWindow": 200,
  "evapRates": [0.005],
  "trailPowers": [3, 5]
}
```

The default sweep uses 10 mazes × 3 ant seeds × 12 settings, up to 20,000 ticks
per trial. The other defaults are `seedPrefix: "highway-v1"`, `numAnts: 20`,
`tankMax: 6400`, `loopRate: 0.1`, `sampleEvery: 20`, `holdTicks: 1000`,
`deliveryWindow: 1000`, `minDeliveries: 3`, `minShare: 0.95`,
`maxStretch: 1.1`, `evapRates: [0.001, 0.005, 0.01]`, and
`trailPowers: [1, 3, 5, 7]`. Powers must be nonnegative half steps up to 32.
Use a different seed prefix for a held-out evaluation after selecting settings;
keep the thresholds fixed rather than adjusting them to favor a candidate.

The output (default `highway-results.json`) contains the full configuration,
per-trial seeds, shortest distance, food position, route, timings, deliveries,
final fingerprint, engine version, Git revision and dirty-checkout flag.
It checkpoints after each setting with `complete: false`; the final write sets
`complete: true`. Reproduction requires the same source revision **and local
changes** when dirty; archive the source alongside research results. This is a
benchmark report, not a Maze trace, and cannot be loaded by the replay UI.

## Browser interface

Open `/highway-lab` (also linked from the simulation index) to configure and run
this same benchmark in your browser. Quick comparison starts with three mazes,
one ant seed each and powers 3 and 5 at evaporation 0.005; Full sweep restores
the command-line defaults. The background worker shows the current trial's maze,
ants and food trail as it runs. Stop interrupts the worker and retains only
completed trials; a new experiment clears the previous results.

Rankings stay provisional until the complete sweep finishes. Download results
exports the configuration and completed trials in the same benchmark format,
with `source: "browser"` instead of CLI Git provenance. Keep the app's source
version with browser exports for reproduction. After a run, inspect final maze
snapshots for the most recent 30 completed trials; all completed trial metrics
remain in the download. Confirmed routes are highlighted on these snapshots.
