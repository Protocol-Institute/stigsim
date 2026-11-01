import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseRound, parseStrategy } from '../src/modes/strategy-lab/contract';
import { runRound, standings } from '../src/modes/strategy-lab/engine';

const [directory, manifestFile, outputFile] = process.argv.slice(2);
if (!directory || !manifestFile || !outputFile || process.argv.length !== 5) {
  throw new Error('Usage: pnpm strategy-round <entries-directory> <round.json> <results.json>');
}
async function readJson(path: string, maxBytes: number) {
  const data = await readFile(path);
  if (data.length > maxBytes) throw new Error(`File too large: ${path}`);
  return JSON.parse(data.toString('utf8')) as unknown;
}
const paths = (await readdir(directory)).filter(p => p.endsWith('.json')).sort();
if (paths.length < 1 || paths.length > 20) throw new Error('Provide 1–20 strategy JSON files.');
const entries = [];
for (const path of paths) entries.push(parseStrategy(await readJson(resolve(directory, path), 100_000)));
const round = parseRound(await readJson(manifestFile, 100_000));
console.log(`Running ${entries.length} entries × ${round.seeds.length} mazes × ${round.replicates} replicates…`);
const report = await runRound(entries, round);
// Do not overwrite an existing official result accidentally.
await writeFile(outputFile, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.table(standings(report).map(e => ({ name: e.strategy.name, id: e.id, meanFood: e.mean, eligible: e.eligible })));
console.log(`Saved reproducible manifest, sources, outcomes and traces to ${outputFile}`);
