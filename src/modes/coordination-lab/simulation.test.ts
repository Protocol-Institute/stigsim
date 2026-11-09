import test from 'node:test';
import assert from 'node:assert/strict';
import {createTeam,advanceRound,localView,teamStats} from './simulation';
const finish=(seed:string,coordinated:boolean)=>{let team=createTeam(seed,.1,coordinated);while(!team.done)team=advanceRound(team);return team;};
test('both teams reach the exit across seeded cyclic mazes without using a hidden-map planner',()=>{
 for(const seed of ['0','1','3','10','42','66','84','99'])for(const coordinated of [true,false]){const team=finish(seed,coordinated);assert.ok(team.winner,`${seed} ${coordinated}`);assert.equal(team.limited,false);assert.ok(team.round<4000);assert.strictEqual(advanceRound(team),team);}
});
test('curated illustration improves first-exit time, with deterministic repeatability',()=>{
 const shared=finish('84',true),independent=finish('84',false);
 assert.ok(shared.round<independent.round);assert.deepEqual(finish('84',true),shared);
 assert.equal(shared.round,140);assert.equal(independent.round,248);
 assert.ok(teamStats(shared).moves<teamStats(independent).moves);
});
test('local observations exclude distant markers and independent controllers ignore all shared markers',()=>{
 const base=createTeam('42',.1,false),changed=structuredClone(base);
 changed.markers['1,2']={closed:true,visitors:['other'],branches:{south:{owners:['other'],returnedBy:[]}}};
 changed.markers['29,29']={closed:true,visitors:['secret'],branches:{}};
 assert.doesNotMatch(JSON.stringify(localView(changed,changed.agents[0])),/secret/);
 let a=base,b=changed;for(let i=0;i<20;i++){a=advanceRound(a);b=advanceRound(b);assert.deepEqual(a.agents,b.agents);}
});
test('claims allow shared bottleneck traversal and are released on backtracking',()=>{
 let team=createTeam('42',.1,true);team.cells=team.cells.map(row=>row.map(()=>false));team.cells[1][1]=true;team.cells[2][1]=true;
 team=advanceRound(team);assert.deepEqual(team.agents.map(a=>[a.x,a.y]),[[1,2],[1,2]]);assert.deepEqual(team.markers['1,1'].branches.south?.owners,['A','B']);
 team=advanceRound(team);assert.deepEqual(team.markers['1,1'].branches.south?.owners,[]);assert.deepEqual(new Set(team.markers['1,1'].branches.south?.returnedBy),new Set(['A','B']));assert.equal(team.markers['1,2'].closed,true);
});
