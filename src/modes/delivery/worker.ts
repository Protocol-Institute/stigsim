import { runDeliverySearch,runSwitchComparison,type DeliveryConfig,type DeliveryReport,type DeliveryTrial } from './benchmark';
import { snapshot } from '../highway/snapshot';
import { CELL,type Simulation } from '@stigsim/sim-core';
export function deliverySnapshot(sim:Simulation) {return {...snapshot(sim),foods:sim.foodSources.map(f=>({x:f.x,y:f.y,remaining:f.remaining})),ants:sim.colonies[0].ants.map(a=>({x:a.x/CELL,y:a.y/CELL,carrying:a.hasFood}))};}
export type DeliverySnapshot=ReturnType<typeof deliverySnapshot>;
export type DeliveryEvent={kind:'progress';row:DeliveryTrial;stage:string}|{kind:'view';view:DeliverySnapshot}|{kind:'done';report:DeliveryReport}|{kind:'adapted';result:ReturnType<typeof runSwitchComparison>}|{kind:'error';message:string};
self.addEventListener('message',(event:MessageEvent<{kind:'search';config:DeliveryConfig}|{kind:'adapt';report:DeliveryReport}>)=>{
  const send=(message:DeliveryEvent)=>postMessage(message);let last=-Infinity;let latest:Simulation|undefined;
  const observe=(sim:Simulation)=>{latest=sim;if(performance.now()-last>=150){last=performance.now();send({kind:'view',view:deliverySnapshot(sim)});}};
  const progress=(row:DeliveryTrial,stage:string)=>{if(latest)send({kind:'view',view:deliverySnapshot(latest)});send({kind:'progress',row,stage});};
  try{const d=event.data;if(d.kind==='search')send({kind:'done',report:runDeliverySearch(d.config,progress,observe)});else send({kind:'adapted',result:runSwitchComparison(d.report,progress,observe)});}
  catch(e){send({kind:'error',message:e instanceof Error?e.message:String(e)});}
});
