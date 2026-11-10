import assert from 'node:assert/strict';
import test from 'node:test';
import { pathDistances } from '@stigsim/sim-core';
import { ColonyLesson, ForagerLesson, ONBOARDING_SEED, settings } from './scenarios';
test('fresh generated maze starts at tick zero with empty trails and one seeded random player',()=>{
  const g=new ForagerLesson(),s=g.sim;
  assert.equal(s.config.seeds.master,ONBOARDING_SEED);
  assert.equal(s.numColonies,1);assert.equal(s.foodSources.length,2);
  assert.ok(s.foodSources.every(f=>f.remaining===250&&f.total===250));
  assert.equal(s.tick,0);assert.equal(s.colonies[0].foodCollected,0);
  assert.ok(s.colonies[0].field.layers().every(layer=>layer.every(x=>x===0)));
  assert.equal(s.allAnts.length,100);assert.equal(s.manualAntIndex,g.antIndex);
  assert.equal(new ForagerLesson().antIndex,g.antIndex);
  assert.ok(new Set(Array.from({length:8},(_,i)=>new ForagerLesson('random:'+i).antIndex)).size>1);
  for(let i=0;i<1500;i++)g.step();
  assert.ok(s.colonies[0].field.layers().some(layer=>layer.some(x=>x>0)));
  assert.equal(g.delivered,false);
});
test('personal delivery unlocks a continuous colony view without rebuilding any state',()=>{
  const g=new ForagerLesson(),s=g.sim,a=s.allAnts[g.antIndex];
  function route(goal:(x:number,y:number)=>boolean){
    const queue:[[number,number],number[]][]=[[[a.cx,a.cy],[]]],seen=new Set<string>();
    for(let i=0;i<queue.length;i++){
      const [[x,y],path]=queue[i],key=x+','+y;if(seen.has(key))continue;seen.add(key);
      if(goal(x,y))return path;
      [[1,0],[-1,0],[0,1],[0,-1]].forEach(([dx,dy],d)=>{if(s.occupancy.isOpen(x+dx,y+dy))queue.push([[x+dx,y+dy],[...path,d]]);});
    }throw Error('Unreachable');
  }
  function moveToward(goal:(x:number,y:number)=>boolean){
    const d=route(goal)[0],[dx,dy]=[[1,0],[-1,0],[0,1],[0,-1]][d];
    s.enqueue({kind:'moveManualAnt',dx,dy});s.flushPending();for(let i=0;i<16;i++)g.step();
  }
  for(let i=0;i<200&&!a.hasFood;i++)moveToward((x,y)=>s.foodSources.some(f=>f.remaining>0&&f.x===x&&f.y===y));
  assert.equal(a.hasFood,true);assert.equal(g.delivered,false);
  for(let i=0;i<200&&!g.delivered;i++)moveToward((x,y)=>x===1&&y===1);
  assert.equal(g.delivered,true);
  const tick=s.tick,food=structuredClone(s.foodSources),collected=s.colonies[0].foodCollected;
  const positions=s.allAnts.map(a=>[a.x,a.y,a.cx,a.cy,a.tx,a.ty]);
  const fields=s.colonies[0].field.layers().map(l=>Array.from(l)),occupancy=s.occupancy;
  const c=new ColonyLesson(s);
  assert.equal(c.sim,s);assert.equal(c.sim.occupancy,occupancy);assert.equal(c.sim.tick,tick);
  assert.deepEqual(c.sim.foodSources,food);assert.equal(c.sim.colonies[0].foodCollected,collected);
  assert.deepEqual(c.sim.allAnts.map(a=>[a.x,a.y,a.cx,a.cy,a.tx,a.ty]),positions);
  assert.deepEqual(c.sim.colonies[0].field.layers().map(l=>Array.from(l)),fields);
  assert.equal(s.manualAntIndex,null);
  settings(s,.002,3);
  for(let i=0;i<12000&&c.confirmedAt===null;i++)c.step();
  assert.equal(c.phase,'complete');assert.ok(c.routeReturns>=6);assert.ok(c.highwayShare>=.35);
  assert.ok(c.confirmedAt!>tick);
  assert.ok(c.highways.length>=1);
  const milestone=c.confirmedAt,afterHighway=s.tick;
  settings(s,.08,0);
  for(let i=0;i<300;i++)c.step();
  assert.equal(s.tick,afterHighway+300);
  assert.equal(c.confirmedAt,milestone);
  assert.equal(s.colonies[0].doctrine.evapRate,.08);
  assert.equal(s.colonies[0].doctrine.forager.follow.searching.food.own,0);
  assert.equal(new Set(c.highways.map(h=>h.route)).size,c.highways.length);
});

test('food alternatives preserve the marked source and take distinct routes at comparable distances',()=>{
  const s=new ForagerLesson().sim,d=pathDistances(s.occupancy,1,1);
  assert.deepEqual(s.foodSources.map(({x,y})=>({x,y})),[{x:22,y:13},{x:15,y:18}]);
  const first=d[13*31+22],second=d[18*31+15],apart=pathDistances(s.occupancy,22,13)[18*31+15];
  assert.equal(first,61);assert.equal(second,73);assert.equal(apart,36);
  assert.ok(second<first+apart,'new source is not reached by continuing through the first');
});
