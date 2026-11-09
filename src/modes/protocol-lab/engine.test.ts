import test from 'node:test';
import assert from 'node:assert/strict';
import {WALL_BASELINE,validateProtocol} from '../../../shared/protocol-lab';
import {simulate,evaluate} from './engine';
test('fixed controllers replay identically, retain origins, and use no marker information when off',()=>{
 const protocol=structuredClone(WALL_BASELINE);protocol.agents[0].rules[0].write=3;protocol.agents[1].rules[0].write=4;
 const a=simulate(protocol,'protocol-test','shared',true),b=simulate(protocol,'protocol-test','shared',true);assert.deepEqual(a,b);
 assert.deepEqual(a.replay.frames[1].writes[0],{x:1,y:1,value:3,by:0});assert.ok(a.foreignReads>0);
 const privateRun=simulate(protocol,'protocol-test','private');assert.equal(privateRun.foreignReads,0);assert.ok(privateRun.writes>0);
 const off=simulate(protocol,'protocol-test','off');assert.equal(off.writes,0);assert.equal(off.foreignReads,0);
});
test('nonmatching rules remain bounded and failures count at the round cap',()=>{
 const protocol=structuredClone(WALL_BASELINE);for(const agent of protocol.agents)agent.rules[0].neighbor=[];
 const result=evaluate(protocol,['a','b']);for(const score of result.scores){assert.equal(score.successes,0);assert.equal(score.meanRounds,400);assert.equal(score.meanMoves,0);}
 assert.equal(result.replay.frames.length,401);
});
test('controller language rejects out of bounds or ambiguous rules instead of executing source code',()=>{
 assert.deepEqual(validateProtocol(WALL_BASELINE),WALL_BASELINE);
 const p=structuredClone(WALL_BASELINE);p.agents[0].rules[0].order=['right','right','right','right'];assert.throws(()=>validateProtocol(p),/Agent 1, rule 1: order must contain/);
 assert.throws(()=>validateProtocol('fetch("https://example.com")'));
 const q=structuredClone(WALL_BASELINE);q.agents[0].initial=16;assert.throws(()=>validateProtocol(q));
});
