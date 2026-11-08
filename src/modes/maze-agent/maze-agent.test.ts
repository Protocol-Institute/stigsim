import assert from 'node:assert/strict';
import test from 'node:test';
import { BUDGET, DIRECTIONS, PRACTICE_SEEDS, RULES, entryId, parseEntry, parseDecision, parseManifest } from './contract';
import { evaluate, makeWorld, mazeAgentMode, replay, summarize } from './engine';
import { choose, type Usage } from './policy';
import { STARTERS } from './starters';
import { brief } from './brief';
const usage = (): Usage => ({ calls: 0, fuel: 0, observationBytes: 0, peakStateBytes: 0 });
const config = (source = STARTERS[0].source, seed = PRACTICE_SEEDS[0]) => ({ entry: { ...STARTERS[0], source }, seed });

test('untrusted entries, decisions and evaluation manifests have bounded canonical formats', async () => {
  assert.throws(() => parseEntry({ ...STARTERS[0], source: 'a'.repeat(BUDGET.sourceBytes + 1) }));
  assert.throws(() => parseEntry({ ...STARTERS[0], parent: 'bad' }));
  assert.throws(() => parseDecision({ move: 'teleport' }));
  assert.throws(() => parseDecision({ move: 'N', state: 'x'.repeat(BUDGET.stateBytes) }));
  const manifest = { format: 'stigsim-maze-agent-round@1', name: 'Evaluation', seeds: Array.from({ length: 100 }, (_, i) => `fresh:${i}`) };
  assert.equal(parseManifest(manifest).seeds.length, 100);
  assert.throws(() => parseManifest({ ...manifest, seeds: manifest.seeds.slice(0, 99) }));
  assert.throws(() => parseManifest({ ...manifest, seeds: manifest.seeds.map(() => 'duplicate') }));
  assert.throws(() => parseManifest({ ...manifest, seeds: [PRACTICE_SEEDS[0], ...manifest.seeds.slice(1)] }));
  assert.equal(await entryId(STARTERS[0]), await entryId(JSON.parse(JSON.stringify(STARTERS[0]))));
  assert.notEqual(await entryId(STARTERS[0]), await entryId({ ...STARTERS[0], source: STARTERS[0].source + '\n// change' }));
});

test('seeded terrain has a reachable unpredictable exit and a reproducible shortest distance', () => {
  const a = makeWorld('world-a');
  assert.deepEqual(a, makeWorld('world-a'));
  assert.notDeepEqual(a, makeWorld('world-b'));
  assert.equal(a.grid[a.goal.y][a.goal.x], 1);
  assert.ok(a.shortest >= 12);
  assert.equal(a.grid.length, 31);
});

test('only local evidence crosses the VM boundary; mutating it cannot move the host', async () => {
  const trial = mazeAgentMode.create(config(`function step(o,s) {
    const keys = Object.keys(o).sort().join(',');
    if (keys !== 'atGoal,exits,lastMove,position,step,stepLimit') throw Error('unexpected evidence');
    if (typeof process !== 'undefined' || typeof fetch !== 'undefined' || typeof require !== 'undefined' || typeof Date !== 'undefined') throw Error('host leak');
    o.position.x = 29; o.exits.N = true;
    return { move:'N', state:{seen:o.position} };
  }`));
  const before = trial.observation();
  assert.equal(Object.keys(before.exits).length, 4);
  assert.equal(JSON.stringify(before).includes(PRACTICE_SEEDS[0]), false);
  assert.equal('goal' in before, false);
  assert.equal('grid' in before, false);
  assert.equal('shortest' in before, false);
  assert.equal(trial.view().goal, null);
  assert.equal(trial.view().cells.length, 5);
  await trial.step();
  assert.deepEqual(trial.position, { x: 1, y: 1 });
  assert.equal(trial.tick, 1);
  assert.deepEqual(trial.observation().lastMove, { direction: 'N', moved: false });
  assert.equal(trial.outcome().illegalMoves, 1);
});

test('memory is explicit, hidden globals reset, and each maze starts with null state', async () => {
  const source = `function step(o,s){
    globalThis.hidden = (globalThis.hidden||0)+1;
    if (globalThis.hidden !== 1) throw Error('persisted global');
    return {move:'N',state:(s||0)+1};
  }`;
  const a = mazeAgentMode.create(config(source)), b = mazeAgentMode.create(config(source));
  await a.advance(2); await b.advance(1);
  assert.equal(a.state, 2); assert.equal(b.state, 1);
  assert.equal(a.error, undefined);
});

test('runaway, async, host-random and oversized policies terminate with resource errors', async () => {
  const o = mazeAgentMode.create(config()).observation();
  const a = usage(), b = usage();
  await assert.rejects(choose('function step(){while(true){}}', o, null, a));
  await assert.rejects(choose('function step(){while(true){}}', o, null, b));
  assert.deepEqual(a, b); assert.equal(a.fuel, BUDGET.fuelPerCall + 1);
  await assert.rejects(choose('function step(){return {move:"N",state:new Array(10000000).fill(0)}}', o, null, usage()));
  await assert.rejects(choose('async function step(){return {move:"N"}}', o, null, usage()));
  await assert.rejects(choose('function step(){return {move:"N",state:Math.random()}}', o, null, usage()));
  await assert.rejects(choose('function step(){return {move:"N",state:"x".repeat(150000)}}', o, null, usage()));
  await assert.rejects(choose(STARTERS[0].source, o, null, { ...usage(), fuel: BUDGET.fuelPerMaze }));
  await assert.rejects(choose(STARTERS[0].source, o, null, { ...usage(), observationBytes: BUDGET.observationBytes }));
});

test('systematic local explorer solves all 20 practice mazes; logged actions replay without guest code', async () => {
  for (const seed of PRACTICE_SEEDS) {
    const trial = mazeAgentMode.create(config(undefined, seed));
    while (!trial.done) await trial.advance(1000);
    const result = trial.outcome();
    assert.equal(result.error, undefined, seed);
    assert.equal(result.solved, true, seed);
    assert.equal(result.illegalMoves, 0);
    assert.ok(result.steps >= result.shortest && result.steps <= RULES.stepLimit);
    const played = replay({ ...STARTERS[0], source: 'function step(){while(true){}}' }, seed, result);
    assert.deepEqual(played.position, trial.position);
    assert.equal(played.tick, trial.tick);
    const corrupt = structuredClone(result); corrupt.moves[0].x += 1;
    assert.throws(() => replay(STARTERS[0], seed, corrupt), /diverged/);
  }
});

test('blocked movement times out and failures cannot improve scores by being omitted', async () => {
  const trial = mazeAgentMode.create(config('function step(){return {move:"N",state:null}}'));
  while (!trial.done) await trial.advance(1000);
  const fail = trial.outcome();
  assert.equal(fail.steps, 4000); assert.equal(fail.solved, false); assert.equal(fail.efficiency, 0); assert.equal(fail.illegalMoves, 4000);
  const success = { ...fail, solved: true, steps: 20, shortest: 10, efficiency: .5, illegalMoves: 0 };
  const summary = summarize([success, fail]);
  assert.equal(summary.score, 25); assert.equal(summary.completion, .5); assert.equal(summary.standardError, 25);
  assert.equal(summary.meanSteps, 20);
});

test('100-maze evaluation freezes inputs, streams all outcomes and is independent of advance cadence', async () => {
  const seeds = Array.from({ length: 100 }, (_, i) => `held-out-test:${i}`);
  let count = 0;
  const entry = structuredClone(STARTERS[0]);
  const promise = evaluate([entry], { format: 'stigsim-maze-agent-round@1', name: 'Held out', seeds }, (_i, _o, n) => { assert.equal(n, ++count); });
  entry.source = 'function step(){return {move:"N"}}';
  const report = await promise;
  assert.equal(count, 100); assert.equal(report.entries[0].outcomes.length, 100);
  assert.equal(summarize(report.entries[0].outcomes).completion, 1);
  assert.equal(report.entries[0].entry.source, STARTERS[0].source);
  const trial = mazeAgentMode.create(config(undefined, seeds[0]));
  await trial.advance(1); await trial.advance(7);
  while (!trial.done) await trial.advance(16);
  assert.deepEqual(trial.outcome(), report.entries[0].outcomes[0]);
});

test('AI brief contains the current code, local-only contract, practice corpus and scoring', () => {
  const text = brief(STARTERS[0]);
  assert.ok(text.includes(STARTERS[0].source.replaceAll('\n', '\\n')));
  assert.ok(text.includes('shortestPathLength / movementAttempts'));
  assert.ok(text.includes(PRACTICE_SEEDS[19]));
  assert.ok(text.includes('No goal bearing, global walls'));
  assert.ok(DIRECTIONS.every(d => text.includes(d)));
});
