import test from 'node:test';
import assert from 'node:assert/strict';
import { WarSpatialObserver, circulationEvidence, observeWarField, warSpatialFrame, type SpatialFrame } from './spatial';
import { WarSimulation } from '../war/war-simulation';
import { buildWarObservation } from '../../../shared/model-war';
const ant = (x:number,y:number,carrying=false) => ({id:1,x,y,carrying,phase:'searching'});
const frame = (tick:number,foodCollected:number,ants=[ant(0,0)]):SpatialFrame => ({tick,colonies:[{foodCollected,ants}]});

test('circulation needs substantial unproductive travel; outward movement, stationary and carrying paths do not qualify',()=>{
  const loop=[[0,0],[4,0],[4,4],[0,4],[0,0],[4,0],[4,4],[0,4],[0,0]].map(([x,y])=>ant(x,y));
  assert.ok(circulationEvidence(loop));
  assert.equal(circulationEvidence(Array.from({length:10},(_,x)=>ant(x*3,0))),null);
  assert.equal(circulationEvidence(Array.from({length:10},()=>ant(0,0))),null);
  assert.equal(circulationEvidence(loop.map(a=>({...a,carrying:true}))),null);
  assert.equal(circulationEvidence(loop.slice(0,4)),null);
});

test('highway evidence requires repeated delivered contiguous routes, not just traffic; old evidence expires',()=>{
  const observer=new WarSpatialObserver();
  observer.capture(frame(0,0));
  for(let tick=1;tick<=300;tick++) {
    const phase=tick%100;
    const delivered=Math.floor((tick+95)/100);
    observer.capture(frame(tick,delivered,[ant(phase>=1&&phase<=4?phase:4,0,phase>=1&&phase<=4)]));
  }
  const evidence=observer.observe(frame(300,3,[ant(4,0)]));
  assert.equal(evidence.colonies[0].deliveredRoutes.trackedReturns,3);
  assert.equal(evidence.colonies[0].deliveredRoutes.possibleHighway,true);
  assert.deepEqual(evidence.colonies[0].deliveredRoutes.topRoutes[0].path,[[1,0],[2,0],[3,0],[4,0]]);
  assert.equal(evidence.colonies[0].foodDeliveredInWindow,3);
  observer.capture(frame(900,3));
  assert.equal(observer.observe(frame(900,3)).colonies[0].deliveredRoutes.possibleHighway,false);
  const stationary=new WarSpatialObserver();
  for(let tick=0;tick<=500;tick++)stationary.capture(frame(tick,0));
  const stalled=stationary.observe(frame(500,0)).colonies[0];
  assert.equal(stalled.traffic.topEightCellShare,1);
  assert.equal(stalled.deliveredRoutes.possibleHighway,false);
  assert.equal(stalled.possibleCirculation.antCount,0);
});

test('dead carriers and interrupted food carrying never count as a delivered route',()=>{
  const observer=new WarSpatialObserver();observer.capture(frame(0,0,[ant(0,0,true)]));
  observer.capture(frame(1,0,[]));observer.capture(frame(25,1,[{...ant(1,0),id:2}]));
  assert.equal(observer.observe(frame(25,1,[ant(1,0)])).colonies[0].deliveredRoutes.trackedReturns,0);
});

test('field observer measures real maze and trails without changing deterministic state; perspectives stay explicit',()=>{
  const war=new WarSimulation({masterSeed:'spatial-observer'}),control=new WarSimulation({masterSeed:'spatial-observer'}),observer=new WarSpatialObserver();
  observer.capture(warSpatialFrame(war));
  for(let tick=0;tick<600;tick++){war.step();control.step();observer.capture(warSpatialFrame(war));}
  assert.equal(war.fingerprint(),control.fingerprint());
  const before=war.fingerprint(),spatial=observeWarField(war,observer);
  assert.equal(war.fingerprint(),before);
  assert.equal(spatial.map.length,31);assert.equal(spatial.map[0].length,31);
  assert.equal(spatial.window.elapsedTicks,500);assert.equal(spatial.window.warmingUp,false);
  assert.ok(spatial.colonies.every(c=>c.sources.every(s=>s.shortestNestDistanceCells!==null)));
  assert.ok(spatial.colonies.every(c=>c.pheromone.foodHotspots.length<=8));
  const observation=buildWarObservation({snapshot:{game:2,tick:war.tick,colonies:[0,1].map(colony=>({colony,player:1-colony,metrics:war.getMetrics(colony),doctrine:war.simulation.colonies[colony].doctrine}))},player:0,models:['a','b'],results:[0],terminal:false,winner:'draw',previous:null,settings:war.settings,rules:war.rules,remainingFood:war.simulation.foodSources,spatialEvidence:spatial});
  assert.equal(observation.spatialEvidence?.colonies[1].perspective,'you');
  assert.equal(observation.spatialEvidence?.colonies[0].perspective,'opponent');
  assert.ok(JSON.stringify(observation).length<48000,'model input must fit the endpoint limit');
  assert.equal(observation.observationVersion,4);
});
