import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { MemoryRun } from "./maze-memory-run";
import { providerConfig, ready } from "./maze-memory-provider";
const [
  strategyFile,
  manifestFile,
  output,
  requestLimit = "1000",
  moves = "4000",
] = process.argv.slice(2);
if (!strategyFile || !manifestFile || !output)
  throw Error(
    "Usage: pnpm maze-memory:round strategy.json manifest.json results.json [request-budget=1000] [moves/maze=4000]",
  );
if (existsSync(output))
  throw Error(
    "Output already exists. Preserve the earlier result and choose a new filename.",
  );
const config = providerConfig();
if (!ready(config)) throw Error("Configure the model endpoint before running.");
const run = new MemoryRun(
  JSON.parse(readFileSync(strategyFile, "utf8")),
  { movesPerMaze: Number(moves), requests: Number(requestLimit) },
  JSON.parse(readFileSync(manifestFile, "utf8")),
  "evaluation",
  config,
);
const save = () => writeFileSync(output, JSON.stringify(run.record, null, 2));
save();
process.on("SIGINT", () => {
  run.cancel();
  save();
});
while (run.record.status === "running") {
  await run.step(run.record.currentMaze, run.trial.tick);
  save();
  if (run.trial.tick % 100 === 0)
    console.log(
      `Maze ${run.record.currentMaze + 1}: ${run.trial.tick} moves, ${run.record.attempts.length} requests`,
    );
}
console.log(JSON.stringify(run.snapshot().metrics));
console.log(`Status: ${run.record.status}; saved ${output}`);
