/**
 * Two colonies, one running a preset against the default, under each
 * topology option, over several seeds, both ways round so nest position is
 * controlled for. Prints deliveries, first-delivery tick, and mimic mass
 * received. Run with:
 *   pnpm matchup [ticks] [seeds] [preset]
 * e.g. pnpm matchup 6000 5 Saboteur
 */
import {
  Simulation, DEFAULT_PARAMS, DEFAULT_DOCTRINE, cloneDoctrine, makeSeeds, mimicMassReceived,
} from "@stigsim/sim-core";
import type { Doctrine, Topology } from "@stigsim/sim-core";
import { PRESETS } from "../src/doctrine-presets";
import { TOPOLOGY_CHOICES } from "../src/topology-choices";

const ticks = Number(process.argv[2] ?? 6000);
const seedCount = Number(process.argv[3] ?? 5);
const presetName = process.argv[4] ?? "Saboteur";
const preset = PRESETS.find(p => p.name === presetName);
if (!preset) throw new Error(`no preset named ${presetName}; have ${PRESETS.map(p => p.name).join(", ")}`);

interface Row {
  topology: string; seed: string; challenger: string;
  challengerFood: number; defaultFood: number;
  challengerFirst: number | null; defaultFirst: number | null;
  mimicOnDefault: number;
}

function firstDelivery(sim: Simulation, colony: number, seen: (number | null)[]) {
  if (seen[colony] === null && sim.colonies[colony].foodCollected > 0) seen[colony] = sim.tick;
}

function run(topology: Topology, seed: string, challenger: Doctrine, challengerIs: 0 | 1): Row {
  // Mirrored, as War matches are: a doctrine comparison on a map that
  // favoured one nest would measure the map, not the doctrine.
  const sim = new Simulation({
    seeds: makeSeeds(seed), numAnts: 40, params: DEFAULT_PARAMS,
    loopRate: 0.12, numColonies: 2, numFoodSources: 3, foodPerSource: 500, layout: "mirrored",
  });
  sim.enqueue({ kind: "setAdoption", mode: "instant" });
  sim.enqueue({ kind: "setTopology", topology });
  sim.enqueue({ kind: "setDoctrine", colony: challengerIs, doctrine: challenger });
  sim.enqueue({ kind: "setDoctrine", colony: 1 - challengerIs, doctrine: cloneDoctrine(DEFAULT_DOCTRINE) });
  sim.flushPending();
  const first: (number | null)[] = [null, null];
  for (let i = 0; i < ticks; i++) {
    sim.step();
    firstDelivery(sim, 0, first);
    firstDelivery(sim, 1, first);
  }
  const d = 1 - challengerIs;
  return {
    topology: topology.read + (topology.mimicEnemy ? "+mimic" : ""),
    seed,
    challenger: `${preset!.name} as colony ${challengerIs + 1}`,
    challengerFood: sim.colonies[challengerIs].foodCollected,
    defaultFood: sim.colonies[d].foodCollected,
    challengerFirst: first[challengerIs],
    defaultFirst: first[d],
    mimicOnDefault: Math.round(mimicMassReceived(sim.colonies[d])),
  };
}

const rows: Row[] = [];
for (const choice of TOPOLOGY_CHOICES) {
  if (!preset.available(choice.topology) && choice.name !== "private") continue;
  for (let s = 1; s <= seedCount; s++) {
    const seed = `matchup-${s}`;
    rows.push(run(choice.topology, seed, preset.doctrine, 0));
    rows.push(run(choice.topology, seed, preset.doctrine, 1));
  }
}
console.table(rows);

const byTopology = new Map<string, { c: number; d: number; n: number }>();
for (const r of rows) {
  const agg = byTopology.get(r.topology) ?? { c: 0, d: 0, n: 0 };
  agg.c += r.challengerFood; agg.d += r.defaultFood; agg.n += 1;
  byTopology.set(r.topology, agg);
}
for (const [t, agg] of byTopology) {
  console.log(`${t}: ${preset.name} averaged ${(agg.c / agg.n).toFixed(1)} food, default ${(agg.d / agg.n).toFixed(1)}, over ${agg.n} runs`);
}
