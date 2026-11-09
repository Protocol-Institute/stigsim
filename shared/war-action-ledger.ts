import type { Doctrine } from '@stigsim/sim-core';
import type { WarPublicSnapshot } from './model-war';
import type { WarFieldObservation } from '../src/modes/model-war/spatial';
export interface NumericChange { parameter: string; before: number; after: number }
export function doctrineChanges(before: Doctrine, after: Doctrine): NumericChange[] {
  const changes: NumericChange[]=[];
  const walk=(a:unknown,b:unknown,path:string)=>{
    if(typeof a==='number'&&typeof b==='number') {if(a!==b)changes.push({parameter:path,before:a,after:b});return;}
    if(a&&b&&typeof a==='object'&&typeof b==='object')for(const key of Object.keys(a))walk((a as any)[key],(b as any)[key],path?`${path}.${key}`:key);
  };
  walk(before,after,'');return changes;
}
function metricsDelta(before: Record<string,unknown>, after: Record<string,unknown>) {
  return Object.fromEntries(Object.entries(after).flatMap(([key,value])=>typeof value==='number'&&typeof before[key]==='number'?[[key,value-(before[key] as number)]]:[]));
}
function spatialSummary(field:WarFieldObservation|undefined,colony:number) {
  const c=field?.colonies.find(c=>c.colonyId===colony);
  return c?{windowFromTick:field!.window.fromTick,windowToTick:field!.window.toTick,delivered:c.foodDeliveredInWindow,possibleCirculationFraction:c.possibleCirculation.fraction,dominantRouteShare:c.deliveredRoutes.dominantRouteShare}:null;
}
export interface WarActionEntry {
  id:number; gameNumber:number; playerId:number; colonyId:number;
  origin:'decision'|'review-opening'; acceptedAtTick:number; scheduledForTick:number;
  status:'queued'|'applied'|'superseded-at-same-tick'|'unconfirmed';
  confirmedAtTick:number|null; changes:NumericChange[]; topologyAdjustments:NumericChange[];
  acceptedDoctrine:Doctrine;
  baseline:WarPublicSnapshot;
  spatialBefore:ReturnType<typeof spatialSummary>;
  observedAfter:null|{fromTick:number;toTick:number;elapsedTicks:number;actorMetricDeltas:Record<string,number>;otherPlayerMetricDeltas:Record<string,number>;spatialBefore:ReturnType<typeof spatialSummary>;spatialAfter:ReturnType<typeof spatialSummary>;causalAttribution:'not-established'};
}

/** Facts from accepted command data and runtime checks; model prose is never parsed as an action. */
export class WarActionLedger {
  entries:WarActionEntry[]=[];
  accept(input:{snapshot:WarPublicSnapshot;player:number;requested:Doctrine;accepted:Doctrine;origin:WarActionEntry['origin'];spatial?:WarFieldObservation}) {
    const own=input.snapshot.colonies.find(c=>c.player===input.player)!;
    const queued=this.entries.slice().reverse().find(e=>e.gameNumber===input.snapshot.game&&e.playerId===input.player&&e.status==='queued'&&e.scheduledForTick===input.snapshot.tick+1);
    if(queued)queued.status='superseded-at-same-tick';
    const entry:WarActionEntry={id:this.entries.length+1,gameNumber:input.snapshot.game,playerId:input.player,colonyId:own.colony,origin:input.origin,
      acceptedAtTick:input.snapshot.tick,scheduledForTick:input.snapshot.tick+1,status:'queued',confirmedAtTick:null,
      changes:doctrineChanges(queued?.baseline.colonies.find(c=>c.player===input.player)?.doctrine??own.doctrine,input.accepted),topologyAdjustments:doctrineChanges(input.requested,input.accepted),
      acceptedDoctrine:structuredClone(input.accepted),baseline:structuredClone(queued?.baseline??input.snapshot),spatialBefore:spatialSummary(input.spatial,own.colony),observedAfter:null};
    this.entries.push(entry);return entry;
  }
  confirm(game:number,tick:number,doctrines:readonly Doctrine[]) {
    for(const entry of this.entries)if(entry.gameNumber===game&&entry.status==='queued'&&entry.scheduledForTick<=tick){
      entry.status=doctrineChanges(entry.acceptedDoctrine,doctrines[entry.colonyId]).length===0?'applied':'unconfirmed';entry.confirmedAtTick=tick;
    }
  }
  observe(snapshot:WarPublicSnapshot,spatial?:WarFieldObservation) {
    for(const e of this.entries)if(e.gameNumber===snapshot.game&&e.status==='applied'&&!e.observedAfter&&snapshot.tick>e.acceptedAtTick){
      const own=snapshot.colonies.find(c=>c.player===e.playerId)!,opponent=snapshot.colonies.find(c=>c.player!==e.playerId)!;
      const before=e.baseline.colonies.find(c=>c.player===e.playerId)!,other=e.baseline.colonies.find(c=>c.player!==e.playerId)!;
      e.observedAfter={fromTick:e.acceptedAtTick,toTick:snapshot.tick,elapsedTicks:snapshot.tick-e.acceptedAtTick,
        actorMetricDeltas:metricsDelta({...before.metrics},{...own.metrics}),otherPlayerMetricDeltas:metricsDelta({...other.metrics},{...opponent.metrics}),
        spatialBefore:e.spatialBefore,spatialAfter:spatialSummary(spatial,e.colonyId),causalAttribution:'not-established'};
    }
  }
  forPlayer(player:number) {
    const describe=(e:WarActionEntry)=>({id:e.id,gameNumber:e.gameNumber,playerId:e.playerId,perspective:e.playerId===player?'you':'opponent',colonyId:e.colonyId,
      origin:e.origin,acceptedAtTick:e.acceptedAtTick,scheduledForTick:e.scheduledForTick,status:e.status,confirmedAtTick:e.confirmedAtTick,
      changes:e.changes,noNumericChange:e.changes.length===0,topologyAdjustments:e.topologyAdjustments,observedAfter:e.observedAfter});
    const summaries=[...new Set(this.entries.map(e=>e.gameNumber))].map(gameNumber=>({gameNumber,players:[0,1].map(playerId=>{
      const applied=this.entries.filter(e=>e.gameNumber===gameNumber&&e.playerId===playerId&&e.status==='applied');
      const parameters=new Map<string,{parameter:string;firstBefore:number;lastAfter:number;minimum:number;maximum:number;changes:number}>();
      for(const e of applied)for(const c of e.changes){const p=parameters.get(c.parameter)??{parameter:c.parameter,firstBefore:c.before,lastAfter:c.before,minimum:c.before,maximum:c.before,changes:0};p.lastAfter=c.after;p.minimum=Math.min(p.minimum,c.after);p.maximum=Math.max(p.maximum,c.after);p.changes++;parameters.set(c.parameter,p);}
      return {playerId,perspective:playerId===player?'you':'opponent',confirmedCommands:applied.length,changedParameters:[...parameters.values()].sort((a,b)=>b.changes-a.changes).slice(0,12),omittedParameterCount:Math.max(0,parameters.size-12)};
    })}));
    return structuredClone({
      interpretation:'Only command data is an action. Prose and private memory are proposals, not evidence of execution. Queued commands are not yet confirmed. Superseded commands have no separately measurable effect. ObservedAfter is an uncontrolled before/after comparison: both players, resource depletion and chance may affect results. Spatial windows may overlap. No causal benefit is established.',
      totalAcceptedCommands:this.entries.length,recentCommands:this.entries.slice(-4).map(describe),recentCommandsTruncated:this.entries.length>4,gameSummaries:summaries,
    });
  }
}
