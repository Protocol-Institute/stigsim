import test from 'node:test';
import assert from 'node:assert/strict';
import type {Simulation} from '@stigsim/sim-core';
import {DELIVERY_QUICK,candidates,runDeliveryTrial,settingDoctrine} from './benchmark';
import {MillPulseDetector,runPulseTrial,pulseTreatment} from './mill-pulse';
const config={...DELIVERY_QUICK,maxTicks:1000,numAnts:5};
const baseline=candidates(config)[0],policy={evapRate:.05,trailPower:0,duration:100,circulationFraction:.2};
test('scheduled treatment records temporary changes and exact restoration through the command bus',()=>{
 let verified=false;
 const row=runPulseTrial(config,'test',0,0,baseline,policy,'scheduled',doctrine=>{assert.deepEqual(doctrine,settingDoctrine(baseline));verified=true;});
 assert.equal(verified,true);
 assert.equal(row.interventions.length,2);assert.equal(row.interventions[0].tick,501);assert.equal(row.interventions[1].tick,601);
 assert.equal(row.interventions[0].after.evapRate,.05);assert.equal(row.interventions[0].after.trailPower,0);
 assert.deepEqual(row.interventions[1].after,baseline);assert.equal(row.restoredAt,601);
});
test('baseline observer does not alter simulation outcomes or random streams',()=>{
 const row=runPulseTrial(config,'test',1,0,baseline,policy,'baseline'),fixed=runDeliveryTrial(config,'test',1,0,baseline);
 assert.equal(row.fingerprint,fixed.fingerprint);assert.equal(row.foodDelivered,fixed.foodDelivered);assert.equal(row.interventions.length,0);
});
test('runs shorter than the observation and restoration horizon never intervene',()=>{
 const short={...config,maxTicks:200};
 const row=runPulseTrial(short,'test',0,0,baseline,policy,'triggered');
 assert.equal(row.interventions.length,0);assert.equal(row.fingerprint,runDeliveryTrial(short,'test',0,0,baseline).fingerprint);
});
test('single-component controls leave the other parameter unchanged',()=>{
 const evap=pulseTreatment(baseline,policy,'evaporation-only'),bias=pulseTreatment(baseline,policy,'bias-only'),both=pulseTreatment(baseline,policy,'triggered');
 assert.equal(evap.trailPower,baseline.trailPower);assert.equal(evap.evapRate,.05);
 assert.equal(bias.evapRate,baseline.evapRate);assert.equal(bias.trailPower,0);
 assert.equal(both.evapRate,.05);assert.equal(both.trailPower,0);assert.equal(both.foodLayGain,baseline.foodLayGain);
});
test('trigger requires persistent revisiting, stalled delivery and food remaining',()=>{
 const detector=new MillPulseDetector(),empty=new MillPulseDetector();let detected=false;
 const loop=[[1,1],[3,1],[3,3],[1,3]];
 for(let tick=0;tick<=300;tick+=10){const [x,y]=loop[(tick/10)%4];
 const sim={tick,colonies:[{foodCollected:0,ants:[{x:x*16,y:y*16,hasFood:false}]}],foodSources:[{remaining:10}]} as unknown as Simulation;
 const evidence=detector.observe(sim,.4);if(evidence?.qualifies){assert.ok(tick>=250);detected=true;}
 const noFood=empty.observe({...sim,foodSources:[{remaining:0}]} as unknown as Simulation,.4);assert.ok(!noFood?.qualifies);
 }
 assert.equal(detected,true);
});
