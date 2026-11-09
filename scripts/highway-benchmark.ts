import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { DEFAULT_CONFIG, validateConfig, runTrial, summarize, type Trial } from './highway/benchmark';
import { SIM_VERSION } from '../packages/sim-trace/src/trace';

const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('pnpm highway [config.json] [output.json]\nNo config: built-in 12-setting grid, 10 mazes × 3 ant seeds, 20,000 ticks.\nSee docs/highway-benchmark.md.');
  process.exit(0);
}
if (args.length > 2) throw new Error('Expected optional config path and output path');
const supplied = args[0] ? JSON.parse(readFileSync(args[0], 'utf8')) : {};
if (!supplied || typeof supplied !== 'object' || Array.isArray(supplied)) throw new Error('Expected a configuration object');
for (const key of Object.keys(supplied)) if (!(key in DEFAULT_CONFIG)) throw new Error(`Unknown configuration key: ${key}`);
const config = { ...DEFAULT_CONFIG, ...supplied };
validateConfig(config);
let revision = 'unknown';
try { revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { /* outside checkout */ }
let dirty = true;
try { dirty = !!execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim(); } catch { /* unknown */ }
const rows: Trial[] = [];
const total = config.evapRates.length * config.trailPowers.length * config.mazeCount * config.replicates;
const output = args[1] ?? 'highway-results.json';
const save = (complete: boolean) => writeFileSync(output, JSON.stringify({
  format: 'stigsim-highway-benchmark', version: 1, simVersion: SIM_VERSION,
  revision, dirty, complete, config, summary: summarize(rows, config.maxTicks), rows,
}, null, 2) + '\n');
for (const evap of config.evapRates) for (const power of config.trailPowers) {
  for (let maze = 0; maze < config.mazeCount; maze++) for (let rep = 0; rep < config.replicates; rep++) {
    rows.push(runTrial(config, maze, rep, evap, power));
    process.stderr.write(`\rHighway trials ${rows.length}/${total}`);
  }
  save(false);
}
save(true);
process.stderr.write('\n');
console.table(summarize(rows, config.maxTicks));
console.log(`Saved ${output}`);
