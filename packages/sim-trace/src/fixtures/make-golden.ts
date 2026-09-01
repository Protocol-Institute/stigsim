/**
 * Regenerates the golden trace fixture. Run with:
 *   pnpm golden
 * Only regenerate when SIM_VERSION has been deliberately bumped, because the
 * point of the fixture is to fail when simulation behaviour changes.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Simulation, DEFAULT_PARAMS, makeSeeds } from "@stigsim/sim-core";
import { MetricsRecorder, buildTrace, serializeTrace } from "../index";

const sim = new Simulation({
  seeds: makeSeeds("golden-fixture"),
  numAnts: 25,
  params: DEFAULT_PARAMS,
  loopRate: 0.12,
  numColonies: 2,
  numFoodSources: 3,
  foodPerSource: 400,
});
const rec = new MetricsRecorder();

const advance = (n: number) => { for (let i = 0; i < n; i++) { sim.step(); rec.maybeSample(sim); } };

advance(600);
sim.enqueue({ kind: "setWall", x: 15, y: 15, open: false });
advance(400);
sim.enqueue({ kind: "setParam", key: "trailPower", value: 7 });
sim.enqueue({ kind: "setCautionary", value: true });
advance(400);
// A paused edit: flushPending applies immediately instead of waiting for the
// next step(), exercising the tick+1 recording path a live pause uses. Every
// other edit here goes through enqueue, which never touched this path — the
// exact gap that let the C1 replay-off-by-one bug through seven reviews.
sim.enqueue({ kind: "setParam", key: "evapRate", value: 0.01 });
sim.flushPending();
advance(200);
sim.enqueue({ kind: "setAntCount", n: 40 });
advance(600);

const trace = buildTrace(sim, rec, "2026-08-27T00:00:00.000Z");
const out = join(dirname(fileURLToPath(import.meta.url)), "golden.trace.json");
writeFileSync(out, serializeTrace(trace));
console.log(`wrote ${out}: ${trace.endTick} ticks, ${trace.commands.length} commands, ${trace.fingerprints.length} fingerprints`);
