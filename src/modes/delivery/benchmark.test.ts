import test from 'node:test';
import assert from 'node:assert/strict';
import {DELIVERY_QUICK,candidates,createDeliverySimulation,runDeliveryTrial,runDeliverySearch,runSwitchComparison,pairedFood,validateDelivery,type DeliveryTrial} from './benchmark';
const config={...DELIVERY_QUICK,trainMazes:2,testMazes:2,replicates:1,maxTicks:300,evapRates:[.002,.01],trailPowers:[3],foodLayGains:[1]};
test('candidates share maze, food and ant random seeds while training and test worlds are disjoint',()=>{
 const [a,b]=candidates(config),first=createDeliverySimulation(config,'train',0,0,a),other=createDeliverySimulation(config,'train',0,0,b),held=createDeliverySimulation(config,'test',0,0,a);
 assert.deepEqual(first.config.seeds,other.config.seeds);assert.notEqual(first.config.seeds.maze,held.config.seeds.maze);
 assert.deepEqual(first.foodSources,other.foodSources);assert.equal(first.foodSources.length,config.foodSources);
 for(let y=0;y<31;y++)for(let x=0;x<31;x++)assert.equal(first.occupancy.isOpen(x,y),other.occupancy.isOpen(x,y));
 assert.notEqual(first.colonies[0].doctrine.evapRate,other.colonies[0].doctrine.evapRate);
});
test('delivery trials repeat, retain timeouts, and run for the full horizon',()=>{
 const candidate=candidates(config)[0],a=runDeliveryTrial(config,'train',0,0,candidate),b=runDeliveryTrial(config,'train',0,0,candidate);
 assert.deepEqual(a,b);assert.equal(a.endTick,config.maxTicks);
 const impossible={...config,targetFood:600};const timeout=runDeliveryTrial(impossible,'train',0,0,candidate);
 assert.equal(timeout.targetTick,null);assert.equal(timeout.cappedTargetTick,config.maxTicks+1);
});
test('a timed intervention preserves the identical initial world and records its accepted command tick',()=>{
 const [a,b]=candidates(config),fixed=runDeliveryTrial(config,'train',0,0,a),noop=runDeliveryTrial(config,'train',0,0,a,{target:a,atTick:150,condition:'always'}),changed=runDeliveryTrial(config,'train',0,0,a,{target:b,atTick:150,condition:'always'});
 assert.equal(fixed.foodDelivered,noop.foodDelivered);assert.deepEqual(fixed.seeds,changed.seeds);assert.equal(changed.interventions[0].tick,151);assert.equal(changed.interventions[0].after.id,b.id);
 const early=runDeliveryTrial(config,'train',0,0,a,{target:b,atTick:150,condition:'no-recent-deliveries'});assert.ok(early.interventions.length<=1);
});
test('paired uncertainty averages replicates within maze rather than counting them as independent mazes',()=>{
 const rows=(values:number[]):DeliveryTrial[]=>values.map((foodDelivered,i)=>({split:'test',maze:Math.floor(i/2),replicate:i%2,foodDelivered} as DeliveryTrial));
 const p=pairedFood(rows([11,13,7,9]),rows([10,10,10,10]));assert.equal(p.mazePairs,2);assert.deepEqual(p.mazeDifferences,[2,-2]);assert.equal(p.meanFoodDifference,0);assert.equal(p.wins,1);assert.equal(p.losses,1);assert.ok(p.approximate95CI![0]<0&&p.approximate95CI![1]>0);
 assert.throws(()=>pairedFood(rows([1,2]),[]),/Unpaired/);
});
test('baseline is frozen from training, and intervention selection does not depend on held-out scores',()=>{
 const report=runDeliverySearch(config),best=report.baseline.id;
 assert.equal(report.train.length,4);assert.equal(report.test.length,4);assert.equal(report.baseline.id,best);
 const first=runSwitchComparison(report);
 const poisoned={...report,test:report.test.map(r=>({...r,foodDelivered:99999-r.foodDelivered}))};
 const second=runSwitchComparison(poisoned);assert.deepEqual(first.policy,second.policy);assert.deepEqual(first.test,second.test);assert.deepEqual(first.train,second.train);
 assert.ok(report.train.every(r=>r.split==='train'));assert.ok(report.test.every(r=>r.split==='test'));
});
test('rejects invalid grids and workloads before creating simulations',()=>{
 assert.throws(()=>validateDelivery({...config,trailPowers:[1.1]}));assert.throws(()=>validateDelivery({...config,foodLayGains:[1.5]}));assert.throws(()=>validateDelivery({...config,evapRates:[.01,.01]}));assert.throws(()=>validateDelivery({...config,targetFood:1000}));assert.throws(()=>validateDelivery({...config,maxTicks:NaN}));
});
