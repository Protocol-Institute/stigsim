import { Simulation, DEFAULT_PARAMS, DEFAULT_DOCTRINE, cloneDoctrine, makeSeeds, TOPOLOGY_PRIVATE, isHalfStep, fingerprint, type Doctrine } from '@stigsim/sim-core';
export interface DeliveryConfig {
  seedPrefix:string; trainMazes:number; testMazes:number; replicates:number;
  numAnts:number; tankMax:number; loopRate:number; foodSources:number; foodPerSource:number; maxTicks:number; targetFood:number;
  evapRates:number[]; trailPowers:number[]; foodLayGains:number[];
}
export const DELIVERY_DEFAULTS:DeliveryConfig={seedPrefix:'food-delivery-v1',trainMazes:12,testMazes:8,replicates:2,numAnts:20,tankMax:DEFAULT_PARAMS.tankMax,loopRate:.1,foodSources:3,foodPerSource:200,maxTicks:5000,targetFood:100,evapRates:[.002,.005,.01],trailPowers:[3,5,7],foodLayGains:[1,2]};
export const DELIVERY_QUICK:DeliveryConfig={...DELIVERY_DEFAULTS,trainMazes:6,testMazes:4,replicates:1,maxTicks:3000,evapRates:[.002,.01],trailPowers:[3,7],foodLayGains:[1,2]};
export interface AntSettings { id:string; evapRate:number; trailPower:number; foodLayGain:number }
export interface SwitchPolicy { target:AntSettings; atTick:number; condition:'always'|'no-recent-deliveries' }
export interface DeliveryTrial {
  split:'train'|'test'; maze:number; replicate:number; candidate:string; seeds:ReturnType<typeof makeSeeds>;
  foodDelivered:number; targetTick:number|null; cappedTargetTick:number; meanFoodOverTime:number; endTick:number; fingerprint:string;
  interventions:{tick:number;before:AntSettings;after:AntSettings}[];
}
export function candidates(c:DeliveryConfig):AntSettings[] {
  return c.evapRates.flatMap(evapRate=>c.trailPowers.flatMap(trailPower=>c.foodLayGains.map(foodLayGain=>({id:`e${evapRate}-p${trailPower}-l${foodLayGain}`,evapRate,trailPower,foodLayGain}))));
}
export function validateDelivery(c:DeliveryConfig) {
  if(!c||typeof c!=='object')throw new Error('Expected a configuration object.');
  for(const [key,min,max] of [['trainMazes',2,200],['testMazes',2,200],['replicates',1,10],['numAnts',1,100],['tankMax',1,16000],['foodSources',1,12],['foodPerSource',1,10000],['maxTicks',100,50000],['targetFood',1,c.foodSources*c.foodPerSource]] as const){const n=c[key];if(!Number.isSafeInteger(n)||n<min||n>max)throw new Error(`${key} must be an integer from ${min} to ${max}.`);}
  if(typeof c.seedPrefix!=='string'||!c.seedPrefix.trim()||c.seedPrefix.length>100)throw new Error('Choose a seed prefix of 1–100 characters.');
  if(!Number.isFinite(c.loopRate)||c.loopRate<0||c.loopRate>.5)throw new Error('Maze loops must be 0–0.5.');
  for(const [values,min,max,valid]of [[c.evapRates,0,1,(n:number)=>Number.isFinite(n)],[c.trailPowers,0,32,isHalfStep],[c.foodLayGains,0,3,Number.isInteger]] as const)
    if(!Array.isArray(values)||!values.length||values.length>30||new Set(values).size!==values.length||values.some(n=>!Number.isFinite(n)||n<min||n>max||!valid(n)))throw new Error('Invalid or duplicate ant-setting grid. Trail powers need half steps; deposition must be integer 0–3.');
  if(candidates(c).length>60)throw new Error('Limit the search grid to 60 candidates.');
  if(candidates(c).length*c.trainMazes*c.replicates*c.maxTicks>50_000_000)throw new Error('Reduce the trial count or tick budget (maximum 50 million ticks per search).');
}
export function settingDoctrine(s:AntSettings):Doctrine {
  const d=cloneDoctrine(DEFAULT_DOCTRINE);d.evapRate=s.evapRate;d.forager.follow.searching.food.own=s.trailPower;d.forager.follow.returning.home.own=s.trailPower;d.forager.lay.returning.food.own=s.foodLayGain;return d;
}
export function createDeliverySimulation(c:DeliveryConfig,split:'train'|'test',maze:number,replicate:number,s:AntSettings) {
  const seeds=makeSeeds(`${c.seedPrefix}:${split}:maze:${maze}`);seeds.master=null;seeds.ants=`${c.seedPrefix}:${split}:maze:${maze}:ants:${replicate}`;
  return new Simulation({seeds,numAnts:c.numAnts,params:{tankMax:c.tankMax},loopRate:c.loopRate,numColonies:1,numFoodSources:c.foodSources,foodPerSource:c.foodPerSource,layout:'random'}, {doctrines:[settingDoctrine(s)],topology:TOPOLOGY_PRIVATE,adoption:'instant'});
}
export function policyId(p:SwitchPolicy) {return `switch-${p.condition}-${p.atTick}-${p.target.id}`;}
export function runDeliveryTrial(c:DeliveryConfig,split:'train'|'test',maze:number,replicate:number,start:AntSettings,policy?:SwitchPolicy,observe?:(sim:Simulation)=>void):DeliveryTrial {
  const sim=createDeliverySimulation(c,split,maze,replicate,start),colony=sim.colonies[0];
  let area=0,targetTick:number|null=null,windowStartFood=0;const interventions:DeliveryTrial['interventions']=[];
  const recentStart=policy?Math.max(0,policy.atTick-Math.floor(c.maxTicks/4)):0;
  for(let tick=1;tick<=c.maxTicks;tick++) {
    if(policy&&sim.tick===recentStart)windowStartFood=colony.foodCollected;
    if(policy&&sim.tick===policy.atTick&&(policy.condition==='always'||colony.foodCollected===windowStartFood)) {
      const accepted=sim.enqueue({kind:'setDoctrine',colony:0,doctrine:settingDoctrine(policy.target)});
      if(!accepted)throw new Error('Intervention rejected by the command bus.');
      interventions.push({tick,before:start,after:policy.target});
    }
    sim.step();area+=colony.foodCollected;if(targetTick===null&&colony.foodCollected>=c.targetFood)targetTick=tick;
    if(tick%100===0)observe?.(sim);
  }
  observe?.(sim);
  return {split,maze,replicate,candidate:policy?policyId(policy):start.id,seeds:sim.config.seeds,foodDelivered:colony.foodCollected,targetTick,cappedTargetTick:targetTick??c.maxTicks+1,meanFoodOverTime:area/c.maxTicks,endTick:sim.tick,fingerprint:fingerprint(sim),interventions};
}
export function rankDelivery(rows:DeliveryTrial[]) {
  const groups=new Map<string,DeliveryTrial[]>();for(const r of rows)groups.set(r.candidate,[...groups.get(r.candidate)??[],r]);
  return [...groups.entries()].map(([candidate,rr])=>({candidate,trials:rr.length,meanFood:rr.reduce((s,r)=>s+r.foodDelivered,0)/rr.length,meanFoodOverTime:rr.reduce((s,r)=>s+r.meanFoodOverTime,0)/rr.length,meanCappedTargetTick:rr.reduce((s,r)=>s+r.cappedTargetTick,0)/rr.length,targetSuccesses:rr.filter(r=>r.targetTick!==null).length})).sort((a,b)=>b.meanFood-a.meanFood||b.meanFoodOverTime-a.meanFoodOverTime||a.candidate.localeCompare(b.candidate));
}
/** Pair by maze and ant seed, then average replicates within maze before estimating uncertainty. */
export function pairedFood(candidate:DeliveryTrial[],baseline:DeliveryTrial[]) {
  const base=new Map(baseline.map(r=>[`${r.split}:${r.maze}:${r.replicate}`,r]));const pairs=new Map<number,number[]>();
  for(const r of candidate){const b=base.get(`${r.split}:${r.maze}:${r.replicate}`);if(!b)throw new Error('Unpaired comparison.');pairs.set(r.maze,[...pairs.get(r.maze)??[],r.foodDelivered-b.foodDelivered]);}
  const differences=[...pairs.values()].map(d=>d.reduce((s,n)=>s+n,0)/d.length),n=differences.length;
  const mean=n?differences.reduce((s,d)=>s+d,0)/n:0;
  const variance=n>1?differences.reduce((s,d)=>s+(d-mean)**2,0)/(n-1):0;
  const critical=[0,12.706,4.303,3.182,2.776,2.571,2.447,2.365,2.306,2.262,2.228,2.201,2.179,2.16,2.145,2.131,2.12,2.11,2.101,2.093,2.086,2.08,2.074,2.069,2.064,2.06,2.056,2.052,2.048,2.045,2.042][Math.min(30,n-1)];
  const margin=n>1?critical*Math.sqrt(variance/n):null;
  return {mazePairs:n,meanFoodDifference:mean,approximate95CI:margin===null?null:[mean-margin,mean+margin],wins:differences.filter(d=>d>0).length,ties:differences.filter(d=>d===0).length,losses:differences.filter(d=>d<0).length,mazeDifferences:differences};
}
export interface DeliveryReport {format:'stigsim-food-delivery@1';config:DeliveryConfig;baseline:AntSettings;finalists:AntSettings[];train:DeliveryTrial[];test:DeliveryTrial[]}
export type TrialProgress=(row:DeliveryTrial,stage:string)=>void;
export function runDeliverySearch(c:DeliveryConfig,progress?:TrialProgress,observe?:(sim:Simulation)=>void):DeliveryReport {
  validateDelivery(c);const grid=candidates(c),train:DeliveryTrial[]=[],test:DeliveryTrial[]=[];
  for(const s of grid)for(let maze=0;maze<c.trainMazes;maze++)for(let rep=0;rep<c.replicates;rep++){const r=runDeliveryTrial(c,'train',maze,rep,s,undefined,observe);train.push(r);progress?.(r,'Search');}
  const ranking=rankDelivery(train),finalists=ranking.slice(0,3).map(r=>grid.find(s=>s.id===r.candidate)!);
  // Freeze the baseline and finalists before touching any held-out maze.
  const baseline=structuredClone(finalists[0]);
  for(const s of finalists)for(let maze=0;maze<c.testMazes;maze++)for(let rep=0;rep<c.replicates;rep++){const r=runDeliveryTrial(c,'test',maze,rep,s,undefined,observe);test.push(r);progress?.(r,'Unseen-maze validation');}
  return {format:'stigsim-food-delivery@1',config:structuredClone(c),baseline,finalists,train,test};
}
export function runSwitchComparison(report:DeliveryReport,progress?:TrialProgress,observe?:(sim:Simulation)=>void) {
  const c=report.config;validateDelivery(c);
  const policies=candidates(c).filter(s=>s.id!==report.baseline.id).flatMap(target=>(['always','no-recent-deliveries'] as const).map(condition=>({target,atTick:Math.floor(c.maxTicks/2),condition})));
  if(!policies.length)throw new Error('Choose at least two candidates to compare mid-run changes.');
  const train:DeliveryTrial[]=[],test:DeliveryTrial[]=[];
  for(const p of policies)for(let maze=0;maze<c.trainMazes;maze++)for(let rep=0;rep<c.replicates;rep++){const r=runDeliveryTrial(c,'train',maze,rep,report.baseline,p,observe);train.push(r);progress?.(r,'Selecting switch policy on training mazes');}
  const best=rankDelivery(train)[0],policy=policies.find(p=>policyId(p)===best.candidate)!;
  for(let maze=0;maze<c.testMazes;maze++)for(let rep=0;rep<c.replicates;rep++){const r=runDeliveryTrial(c,'test',maze,rep,report.baseline,policy,observe);test.push(r);progress?.(r,'Frozen switch policy on unseen mazes');}
  return {policy,train,test,comparison:pairedFood(test,report.test.filter(r=>r.candidate===report.baseline.id)),interpretation:'Exploratory paired comparison. A policy is chosen only from training data. Held-out seeds are the same as the baseline validation; repeated manual tuning after seeing these results requires a fresh seed prefix. One scheduled or stall-triggered switch is not a general adaptive-controller test.'};
}
