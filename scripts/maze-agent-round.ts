import { open, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseEntry, parseManifest } from '../src/modes/maze-agent/contract';
import { evaluate, summarize } from '../src/modes/maze-agent/engine';
const [directory, manifestFile, outputFile] = process.argv.slice(2);
if (!directory || !manifestFile || !outputFile || process.argv.length !== 5) throw new Error('Usage: pnpm maze-agent-round <entries-directory> <manifest.json> <results.json>');
async function readJson(path: string) {
  const handle = await open(path, 'r');
  try {
    if ((await handle.stat()).size > 100000) throw new Error(`File exceeds 100 KB: ${path}`);
    const buffer = Buffer.alloc(100001), { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > 100000) throw new Error(`File exceeds 100 KB: ${path}`);
    return JSON.parse(buffer.subarray(0, bytesRead).toString('utf8')) as unknown;
  } finally { await handle.close(); }
}
const paths = (await readdir(directory)).filter(p => p.endsWith('.json')).sort();
if (!paths.length || paths.length > 20) throw new Error('Provide 1–20 frozen entry JSON files.');
const entries = [];
for (const path of paths) entries.push(parseEntry(await readJson(resolve(directory, path))));
const manifest = parseManifest(await readJson(manifestFile));
const report = await evaluate(entries, manifest, (_i, _o, count) => {
  if (count % 10 === 0) console.log(`${count}/${100 * entries.length} trials complete`);
});
await writeFile(outputFile, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.table(report.entries.map(e => ({ name: e.entry.name, id: e.id, ...summarize(e.outcomes) })));
