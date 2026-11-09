import test from 'node:test';
import assert from 'node:assert/strict';
import { agentObservation } from '../../../shared/model-ant';
import { createMaze,observe,move,solved } from './maze';
import { deterministicStep } from './deterministic';
import { summarizeUsage } from './usage';
test('right-hand controller uses heading and adjacent terrain, never coordinates or remembered information',()=>{
 const observation=agentObservation(observe(createMaze(42)));
 observation.neighbors={north:'passage',east:'passage',south:'passage',west:'passage'};
 assert.equal(deterministicStep(observation,'north').decision.direction,'east');
 const changed={...observation,position:{x:27,y:27},lastResult:'misleading trace',turn:180};
 assert.deepEqual(deterministicStep(changed,'north').decision,deterministicStep(observation,'north').decision);
 observation.neighbors.east='wall';assert.equal(deterministicStep(observation,'north').decision.direction,'north');
 observation.neighbors.north='wall';assert.equal(deterministicStep(observation,'north').decision.direction,'west');
 observation.neighbors.west='wall';assert.equal(deterministicStep(observation,'north').decision.direction,'south');
});
test('seeded runs repeat identically and make no model calls or pebble transfers',()=>{
 const run=()=>{let maze=createMaze(42),heading='south' as const;const steps=[];
  let direction:import('../../../shared/model-ant').Direction=heading;
  while(!solved(maze)&&maze.turn<200){const step=deterministicStep(agentObservation(observe(maze)),direction);steps.push(step);const next=move(maze,step.decision);if(next.x!==maze.x||next.y!==maze.y)direction=step.decision.direction;maze=next;}
  return {maze,steps};};
 const first=run(),second=run();assert.deepEqual(first,second);assert.equal(first.maze.carried,12);assert.deepEqual(first.maze.pebbles,{});
 assert.ok(first.steps.every(step=>step.usage.requests===0&&step.usage.totalTokens===0&&step.policyCheck?.compliant===true));
 const summary=summarizeUsage(first.steps.map(step=>({model:step.model,usage:step.usage})),{'deterministic-right-hand':{input:0,output:0}});
 assert.equal(summary.estimatedCostUsd,0);assert.equal(summary.costComplete,true);
});
