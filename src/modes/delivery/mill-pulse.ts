import { CELL, fingerprint, cloneDoctrine, type Doctrine, type Simulation } from '@stigsim/sim-core';
import { circulationEvidence } from '../model-war/spatial';
import { createDeliverySimulation, settingDoctrine, type AntSettings, type DeliveryConfig, type DeliveryTrial } from './benchmark';
export interface PulsePolicy {evapRate:number;trailPower:number;duration:number;circulationFraction:number}
export interface MillSample {tick:number;circulationFraction:number;foodDeliveredInWindow:number;foodRemaining:number;qualifies:boolean}
/** Two consecutive 50-tick checks: repeated non-carrying motion, stalled deliveries, food remaining. */
export class MillPulseDetector {
  private samples:{tick:number;food:number;ants:{id:number;x:number;y:number;carrying:boolean;phase:string}[]}[]=[];
  private consecutive=0;
  observe(sim:Simulation,threshold:number):MillSample|null {
    if(sim.tick%10!==0)return null;
    const colony=sim.colonies[0];
    this.samples.push({tick:sim.tick,food:colony.foodCollected,ants:colony.ants.map((a,id)=>({id,x:a.x/CELL,y:a.y/CELL,carrying:a.hasFood,phase:'searching'}))});
    this.samples=this.samples.filter(s=>s.tick>=sim.tick-200);
    if(sim.tick%50!==0||sim.tick-this.samples[0].tick<200)return null;
    const circulating=colony.ants.filter((_,id)=>{const e=circulationEvidence(this.samples.map(s=>s.ants[id]));return e&&e.revisitedSampleFraction>=.3;}).length;
    const foodDeliveredInWindow=colony.foodCollected-this.samples[0].food;
    const foodRemaining=sim.foodSources.reduce((s,f)=>s+f.remaining,0),circulationFraction=circulating/colony.ants.length;
    const qualifies=foodRemaining>0&&foodDeliveredInWindow===0&&circulationFraction>=threshold;
    this.consecutive=qualifies?this.consecutive+1:0;
    return {tick:sim.tick,circulationFraction,foodDeliveredInWindow,foodRemaining,qualifies:this.consecutive>=2};
  }
}
export type PulseArm='baseline'|'triggered'|'scheduled'|'evaporation-only'|'bias-only';
export interface PulseTrial extends DeliveryTrial {arm:PulseArm;triggerTick:number|null;pulseStart:number|null;restoredAt:number|null;detection:MillSample|null;postPulse:MillSample|null}
export function pulseTreatment(baseline:AntSettings,p:PulsePolicy,arm:PulseArm):AntSettings {
  return {...baseline,id:`pulse-e${p.evapRate}-p${p.trailPower}`,evapRate:arm==='bias-only'?baseline.evapRate:p.evapRate,trailPower:arm==='evaporation-only'?baseline.trailPower:p.trailPower};
}
export function runPulseTrial(c:DeliveryConfig,split:'train'|'test',maze:number,replicate:number,baseline:AntSettings,p:PulsePolicy,arm:PulseArm,inspectFinal?:(doctrine:Doctrine)=>void):PulseTrial {
  const sim=createDeliverySimulation(c,split,maze,replicate,baseline),detector=new MillPulseDetector();
  const treatment=pulseTreatment(baseline,p,arm);
  let triggerTick:number|null=null,pulseStart:number|null=null,restoredAt:number|null=null,detection:MillSample|null=null,postPulse:MillSample|null=null,targetTick:number|null=null,area=0;
  const interventions:DeliveryTrial['interventions']=[];
  for(let tick=1;tick<=c.maxTicks;tick++) {
    const evidence=detector.observe(sim,p.circulationFraction);
    if(triggerTick===null&&evidence?.qualifies&&sim.tick+p.duration+200<=c.maxTicks){triggerTick=sim.tick;detection=evidence;}
    const measurementStart=arm==='baseline'?triggerTick:pulseStart;
    if(evidence&&measurementStart!==null&&sim.tick>=measurementStart+p.duration+200&&postPulse===null)postPulse=evidence;
    const start=arm==='scheduled'?sim.tick===Math.floor(c.maxTicks/2):triggerTick!==null&&sim.tick===triggerTick;
    if(arm!=='baseline'&&pulseStart===null&&start){sim.enqueue({kind:'setDoctrine',colony:0,doctrine:settingDoctrine(treatment)});pulseStart=sim.tick;interventions.push({tick,before:baseline,after:treatment});}
    if(pulseStart!==null&&restoredAt===null&&sim.tick===pulseStart+p.duration){sim.enqueue({kind:'setDoctrine',colony:0,doctrine:settingDoctrine(baseline)});restoredAt=tick;interventions.push({tick,before:treatment,after:baseline});}
    sim.step();area+=sim.colonies[0].foodCollected;if(targetTick===null&&sim.colonies[0].foodCollected>=c.targetFood)targetTick=tick;
  }
  if(pulseStart!==null&&restoredAt===null)throw new Error('Pulse must restore baseline before trial ends.');
  inspectFinal?.(cloneDoctrine(sim.colonies[0].doctrine));
  return {split,maze,replicate,candidate:arm,seeds:sim.config.seeds,foodDelivered:sim.colonies[0].foodCollected,targetTick,cappedTargetTick:targetTick??c.maxTicks+1,meanFoodOverTime:area/c.maxTicks,endTick:sim.tick,fingerprint:fingerprint(sim),interventions,arm,triggerTick,pulseStart,restoredAt,detection,postPulse};
}
