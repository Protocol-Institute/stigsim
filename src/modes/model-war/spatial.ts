import { CELL } from '@stigsim/sim-core';
import type { WarSimulation } from '../war/war-simulation';

export interface SpatialAnt { id: number; x: number; y: number; carrying: boolean; phase: string }
export interface SpatialFrame { tick: number; colonies: { foodCollected: number; ants: SpatialAnt[] }[] }
type Point = [number, number];
interface Delivery { tick: number; colony: number; path: Point[] }
const WINDOW = 500;
const SAMPLE = 25;
const cell = (ant: SpatialAnt): Point => [Math.floor(ant.x), Math.floor(ant.y)];
const same = (a: Point, b: Point) => a[0] === b[0] && a[1] === b[1];
const round = (v: number) => Math.round(v * 1000) / 1000;

/** A possible circulation signal, not a diagnosis: substantial non-carrying travel with low net progress. */
export function circulationEvidence(points: SpatialAnt[]) {
  if (points.length < 6 || points.some(p => p.carrying || p.phase !== 'searching')) return null;
  let travel = 0;
  for (let i = 1; i < points.length; i++) travel += Math.abs(points[i].x-points[i-1].x)+Math.abs(points[i].y-points[i-1].y);
  const first = points[0], last = points.at(-1)!;
  const displacement = Math.abs(last.x-first.x)+Math.abs(last.y-first.y);
  if (travel < 10 || displacement / travel > .25) return null;
  return { sampledTravelCells: round(travel), netDisplacementCells: round(displacement), sampleCount: points.length,
    revisitedSampleFraction: round(1-new Set(points.map(p=>cell(p).join(','))).size/points.length), location: cell(last) };
}

/** Bounded observer only. It never changes simulation state or chooses doctrines. */
export class WarSpatialObserver {
  private samples: SpatialFrame[] = [];
  private deliveries: Delivery[] = [];
  private carrying = new Map<string, Point[]>();
  private previous: SpatialFrame | null = null;

  capture(frame: SpatialFrame) {
    if (this.previous && frame.tick <= this.previous.tick) return;
    for (const [colony, data] of frame.colonies.entries()) {
      const live = new Set(data.ants.map(a=>`${colony}:${a.id}`));
      for (const key of this.carrying.keys()) if (key.startsWith(`${colony}:`)&&!live.has(key)) this.carrying.delete(key);
      const oldAnts = new Map(this.previous?.colonies[colony].ants.map(a=>[a.id,a])??[]);
      for (const ant of data.ants) {
        const key = `${colony}:${ant.id}`, position = cell(ant);
        if (ant.carrying) {
          const path = this.carrying.get(key)??[];
          if (!path.length || !same(path.at(-1)!,position)) {
            // Loop erasure yields a contiguous delivered route, not an occupancy cloud.
            const visited = path.findIndex(p=>same(p,position));
            if (visited>=0) path.splice(visited+1); else path.push(position);
          }
          this.carrying.set(key,path);
        } else if (oldAnts.get(ant.id)?.carrying) {
          const path = this.carrying.get(key);
          // Only a surviving carrier becoming a searcher counts as a completed return.
          if (path?.length && ant.phase === 'searching' && data.foodCollected > (this.previous?.colonies[colony].foodCollected??data.foodCollected)) {
            if (!same(path.at(-1)!,position)) path.push(position);
            this.deliveries.push({tick:frame.tick,colony,path:path.map(p=>[...p] as Point)});
          }
          this.carrying.delete(key);
        }
      }
    }
    if (!this.samples.length || frame.tick%SAMPLE===0) this.samples.push(structuredClone(frame));
    this.samples = this.samples.filter(s=>s.tick>=frame.tick-WINDOW);
    this.deliveries = this.deliveries.filter(d=>d.tick>=frame.tick-WINDOW);
    this.previous = frame;
  }

  observe(frame: SpatialFrame) {
    const samples = this.samples.at(-1)?.tick===frame.tick?this.samples:[...this.samples,frame];
    const elapsed = frame.tick-(samples[0]?.tick??frame.tick);
    return {
      window: {fromTick:samples[0]?.tick??frame.tick,toTick:frame.tick,elapsedTicks:elapsed,sampleEveryTicks:SAMPLE,sampleCount:samples.length,warmingUp:elapsed<250},
      colonies: frame.colonies.map((colony,id)=>{
        const traffic = new Map<string,{cell:Point;antSamples:number;carryingSamples:number}>();
        for (const sample of samples) for (const ant of sample.colonies[id].ants) {
          const position=cell(ant),key=position.join(',');
          const entry=traffic.get(key)??{cell:position,antSamples:0,carryingSamples:0};
          entry.antSamples++;if(ant.carrying)entry.carryingSamples++;traffic.set(key,entry);
        }
        const allTraffic=[...traffic.values()],total=allTraffic.reduce((sum,t)=>sum+t.antSamples,0);
        const top=allTraffic.sort((a,b)=>b.antSamples-a.antSamples).slice(0,8);
        const routes=new Map<string,{deliveries:number;path:Point[]}>();
        for(const delivery of this.deliveries.filter(d=>d.colony===id)) {
          const key=JSON.stringify(delivery.path),entry=routes.get(key)??{deliveries:0,path:delivery.path};entry.deliveries++;routes.set(key,entry);
        }
        const completed=[...routes.values()].sort((a,b)=>b.deliveries-a.deliveries);
        const routeReturns=completed.reduce((sum,r)=>sum+r.deliveries,0);
        const mills=colony.ants.flatMap(ant=>{
          const points=samples.flatMap(s=>{const a=s.colonies[id].ants.find(a=>a.id===ant.id);return a?[a]:[];});
          const evidence=circulationEvidence(points);return evidence?[{antId:ant.id,...evidence}]:[];
        });
        const foodDelivered=colony.foodCollected-(samples[0]?.colonies[id].foodCollected??colony.foodCollected);
        return {colonyId:id,foodDeliveredInWindow:foodDelivered,deliveryRatePer100Ticks:elapsed?round(foodDelivered*100/elapsed):0,
          traffic:{topCells:top,topEightCellShare:total?round(top.reduce((sum,t)=>sum+t.antSamples,0)/total):0,totalAntSamples:total},
          deliveredRoutes:{trackedReturns:routeReturns,distinctRoutes:completed.length,dominantRouteShare:routeReturns?round((completed[0]?.deliveries??0)/routeReturns):0,trackedFractionOfDeliveries:foodDelivered?round(routeReturns/foodDelivered):0,topRoutes:completed.slice(0,3).map(r=>({deliveries:r.deliveries,routeCellCount:r.path.length,path:r.path.slice(0,64),pathTruncated:r.path.length>64})),
            possibleHighway:elapsed>=250&&foodDelivered>=3&&routeReturns>=foodDelivered*.5&&(completed[0]?.deliveries??0)>=Math.max(3,routeReturns*.5),
            interpretation:'Repeated identical loop-erased food-to-nest returns support a productive route. This is not proof of a sustained colony-wide highway or a shortest route.'},
          possibleCirculation:{antCount:mills.length,population:colony.ants.length,fraction:colony.ants.length?round(mills.length/colony.ants.length):0,examples:mills.slice(0,3),
            interpretation:'Low net progress after sampled searching travel. Can also reflect exploration or backtracking; sampled movement can miss loops. Not a confirmed mill.'},
        };
      }),
    };
  }
}

export function warSpatialFrame(war: WarSimulation): SpatialFrame {
  return {tick:war.tick,colonies:war.simulation.colonies.map(colony=>({foodCollected:colony.foodCollected,ants:colony.ants.map(ant=>({
    id:war.getAntSnapshot(ant)!.id,x:ant.x/CELL,y:ant.y/CELL,carrying:ant.hasFood,phase:war.getAntSnapshot(ant)!.phase,
  }))}))};
}

export function observeWarField(war: WarSimulation, observer: WarSpatialObserver) {
  const sim=war.simulation,{cols,rows}=sim.bounds;
  const map=Array.from({length:rows},(_,y)=>Array.from({length:cols},(_,x)=>sim.occupancy.isOpen(x,y)?'.':'#').join(''));
  const distance=(nestX:number,nestY:number)=>{
    const dist=new Map<string,number>([[`${nestX},${nestY}`,0]]),queue:Point[]=[[nestX,nestY]];
    for(let i=0;i<queue.length;i++){const [x,y]=queue[i];for(const [nx,ny] of [[x+1,y],[x-1,y],[x,y+1],[x,y-1]])if(nx>=0&&ny>=0&&nx<cols&&ny<rows&&sim.occupancy.isOpen(nx,ny)&&!dist.has(`${nx},${ny}`)){dist.set(`${nx},${ny}`,dist.get(`${x},${y}`)!+1);queue.push([nx,ny]);}}
    return dist;
  };
  const measured=observer.observe(warSpatialFrame(war));
  return {...measured,coordinates:'Zero-based maze cells [x,y], origin top-left. Map rows use # wall and . passage.',map,
    colonies:measured.colonies.map(c=>{
      const colony=sim.colonies[c.colonyId],dist=distance(colony.nestX,colony.nestY);
      const foodFields:{cell:Point;strength:number}[]=[];let total=0,nearDepleted=0;
      for(let y=0;y<rows;y++)for(let x=0;x<cols;x++){
        const strength=colony.field.get('food',x,y);if(strength<=0)continue;
        total+=strength;if(sim.foodSources.some(f=>f.remaining===0&&Math.abs(f.x-x)+Math.abs(f.y-y)<=4))nearDepleted+=strength;
        foodFields.push({cell:[x,y],strength:round(strength)});
      }
      return {...c,nest:[colony.nestX,colony.nestY],sources:sim.foodSources.map(f=>({cell:[f.x,f.y],remaining:f.remaining,shortestNestDistanceCells:dist.get(`${f.x},${f.y}`)??null,
        searchingAntsWithinFourCells:colony.ants.filter(a=>war.getAntSnapshot(a)?.phase==='searching'&&Math.abs(a.x/CELL-f.x-.5)+Math.abs(a.y/CELL-f.y-.5)<=4).length})),
        pheromone:{foodHotspots:foodFields.sort((a,b)=>b.strength-a.strength).slice(0,8),foodSignalMassNearDepletedSourcesFraction:total?round(nearDepleted/total):0,
          interpretation:'Food field sampled now; proximity is Manhattan distance <=4, not maze path distance. Signal near depleted sources may be stale or shared with an active route. Does not attribute signal to spoilers.'}};
    }),
  };
}

export type WarFieldObservation = ReturnType<typeof observeWarField>;
