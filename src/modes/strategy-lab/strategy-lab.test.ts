import test from 'node:test';
import assert from 'node:assert/strict';
import { fingerprint } from '@stigsim/sim-core';
import { Replayer } from '@stigsim/sim-trace';
import { BASELINE, CHALLENGE, LIMITS, parseDecision, parseRound, parseStrategy, strategyId } from './contract';
import { createTrial, observe, paired, runRound, runTrial, standings } from './engine';
import { decide } from './sandbox';
import { STARTERS } from './starters';
const usage = () => ({ calls: 0, observationBytes: 0, interrupts: 0 });

test('contract rejects invalid settings, scheduling, lineage and rounds', async () => {
  assert.throws(() => parseStrategy({ ...STARTERS[0], initial: { ...BASELINE, trailBias: 1.1 } }));
  assert.throws(() => parseStrategy({ ...STARTERS[0], parent: 'invalid' }));
  assert.throws(() => parseDecision({ nextTick: 10 }, 10));
  assert.throws(() => parseDecision({ nextTick: 3002 }, 10));
  assert.throws(() => parseDecision({ nextTick: 11, state: 'x'.repeat(LIMITS.stateBytes) }, 10));
  assert.throws(() => parseRound({ format: 'stigsim-strategy-round@1', name: 'bad', seeds: ['same', 'same'], replicates: 1 }));
  assert.equal(await strategyId(STARTERS[0]), await strategyId(JSON.parse(JSON.stringify(STARTERS[0]))));
  assert.notEqual(await strategyId(STARTERS[0]), await strategyId({ ...STARTERS[0], name: 'different' }));
});
test('VM exposes no host IO, wall clock, or randomness; only returned state persists', async () => {
  const source = `function step(o,s) {
    if (typeof process !== 'undefined' || typeof fetch !== 'undefined' || typeof require !== 'undefined' || typeof Date !== 'undefined') throw Error('host leak');
    globalThis.hidden = (globalThis.hidden || 0) + 1;
    if (globalThis.hidden !== 1) throw Error('hidden persistence');
    return { nextTick: o.tick + 7, state: (s || 0) + 1 };
  }`;
  const first = await decide(source, { tick: 0 }, null, 0, usage());
  const second = await decide(source, { tick: 7 }, first.state, 7, usage());
  assert.deepEqual(first, { nextTick: 7, state: 1 });
  assert.deepEqual(second, { nextTick: 14, state: 2 });
  await assert.rejects(decide('function step(){ return { nextTick: 1, state: Math.random() }; }', {}, null, 0, usage()));
  await assert.rejects(decide('async function step(){ return {nextTick:1}; }', {}, null, 0, usage()));
});
test('runaway and oversized controllers stop at deterministic resource limits', async () => {
  const first = usage(), second = usage();
  await assert.rejects(decide('function step(){while(true){}}', {}, null, 0, first));
  await assert.rejects(decide('function step(){while(true){}}', {}, null, 0, second));
  assert.deepEqual(first, second);
  assert.equal(first.interrupts, LIMITS.interruptsPerCall + 1);
  await assert.rejects(decide('function step(){let x=[]; while(true) x.push(new Array(10000).fill(1));}', {}, null, 0, usage()));
  const exhausted = { ...usage(), observationBytes: LIMITS.observationBytes };
  await assert.rejects(decide(STARTERS[0].source, { tick: 0 }, null, 0, exhausted), /Observation-byte/);
});
test('observation contains raw present state, no seed or shared mutable engine object', () => {
  const sim = createTrial('secret-seed', 0, BASELINE);
  const o = observe(sim, BASELINE);
  assert.equal(o.ants.length, CHALLENGE.ants);
  assert.equal(o.open.length, o.cols * o.rows);
  assert.equal(o.food.reduce((s, f) => s + f.remaining, 0), 600);
  assert.equal(JSON.stringify(o).includes('secret-seed'), false);
  o.ants[0].x = -100; o.food[0].remaining = -1; o.settings.trailBias = 0;
  const fresh = observe(sim, BASELINE);
  assert.notEqual(fresh.ants[0].x, -100);
  assert.equal(fresh.food[0].remaining, 200);
  assert.equal(fresh.settings.trailBias, 7);
});
test('controller chooses irregular observation ticks; accepted actions replay exactly', async () => {
  const strategy = { ...STARTERS[0], source: `function step(o,s){
    const n = (s || 0) + 1;
    return { nextTick: n===1 ? 137 : n===2 ? 892 : 3001, state:n,
      settings:{evaporation:0.002,trailBias:n===2?0:7,foodDeposition:2} };
  }` };
  const a = await runTrial(strategy, 'paired-test', 0);
  const b = await runTrial(strategy, 'paired-test', 0);
  assert.deepEqual(a, b);
  assert.equal(a.error, undefined); assert.equal(a.endTick, 3000); assert.equal(a.usage.calls, 3);
  assert.deepEqual(a.actions.map(c => c.effectiveTick), [138, 893]);
  const doctrines = a.trace!.commands.flatMap(c => c.cmd.kind === 'setDoctrine' ? [[c.t, c.cmd.doctrine.forager.follow.searching.food.own]] : []);
  assert.deepEqual(doctrines, [[1, 7], [138, 0], [893, 7]]);
  const replay = new Replayer(a.trace!); replay.seek(CHALLENGE.ticks);
  assert.equal(replay.divergedAt, null); assert.equal(fingerprint(replay.sim), a.fingerprint);
});
test('all starter entries fit budgets and paired scores use maze averages', async () => {
  const report = await runRound(STARTERS, { format: 'stigsim-strategy-round@1', name: 'Test', seeds: ['test-a', 'test-b'], replicates: 1 });
  assert.equal(report.trials.length, 6);
  for (const t of report.trials) assert.equal(t.error, undefined, JSON.stringify(t));
  assert.ok(standings(report).every(e => e.eligible));
  const comparison = paired(report, report.entries[1].id, report.entries[0].id)!;
  assert.equal(comparison.wins + comparison.ties + comparison.losses, 2);
  report.trials.find(t => t.entry === report.entries[1].id)!.error = 'failed';
  assert.equal(standings(report).find(e => e.id === report.entries[1].id)!.mean, null);
  assert.equal(paired(report, report.entries[1].id, report.entries[0].id), null);
});

test('round scoring averages replicates by maze, and any failed trial disqualifies', async () => {
  const report = await runRound([STARTERS[0], { ...STARTERS[0], name: 'Other fixed' }],
    { format: 'stigsim-strategy-round@1', name: 'Replicates', seeds: ['rep-a', 'rep-b'], replicates: 2 });
  assert.equal(report.trials.length, 8);
  report.trials.forEach(t => { t.food = t.entry === report.entries[0].id ? 10 : (t.maze === 0 ? 14 : 8) + t.replicate * 2; });
  assert.equal(standings(report)[0].mean, 12);
  assert.deepEqual(paired(report, report.entries[1].id, report.entries[0].id), { mean: 2, standardError: 3, wins: 1, ties: 0, losses: 1, mazes: 2 });
  assert.equal(paired(report, 'unknown', report.entries[0].id), null);
  report.trials[1].endTick = 2999;
  assert.equal(standings(report).find(e => e.id === report.trials[1].entry)!.eligible, false);
});
test('setting-change and total compute limits disqualify without a fallback', async () => {
  const strategy = { ...STARTERS[0], source: `function step(o){return { nextTick:o.tick+1,
    settings:{evaporation:0.002,trailBias:o.tick%2?0:7,foodDeposition:2} };}` };
  const trial = await runTrial(strategy, 'too-many-changes', 0);
  assert.match(trial.error!, /Setting-change budget/);
  assert.equal(trial.actions.length, LIMITS.actionsPerTrial);
  assert.ok(trial.endTick < CHALLENGE.ticks);
  const cumulative = { ...usage(), interrupts: LIMITS.interruptsPerTrial };
  await assert.rejects(decide(STARTERS[0].source, {}, null, 0, cumulative));
});
