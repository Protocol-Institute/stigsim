import { Simulation, DEFAULT_PARAMS, DEFAULT_DOCTRINE, cloneDoctrine, makeSeeds, makeRng, COLS } from '@stigsim/sim-core';
import { appendCell } from '../highway/benchmark';
export type Level = 1 | 2;
export const ONBOARDING_SEED = "rustic-ember-1253";
export const ONBOARDING_FOOD = [{x:22,y:13}, {x:15,y:18}] as const;
export function settings(sim: Simulation, evaporation: number, bias: number) {
  const d=cloneDoctrine(sim.colonies[0].doctrine);
  d.evapRate=evaporation;
  d.forager.follow.searching.food.own=bias;
  d.forager.follow.returning.home.own=bias;
  if(!sim.enqueue({kind:'setDoctrine',colony:0,doctrine:d}))throw Error('Invalid ant settings');
  sim.flushPending();
}
export class ForagerLesson {
  readonly sim: Simulation;
  readonly antIndex: number;
  pickedUp=false;
  delivered=false;
  constructor(seed=ONBOARDING_SEED){
    this.sim=new Simulation({seeds:makeSeeds(seed),numAnts:100,params:{...DEFAULT_PARAMS},loopRate:.1,numColonies:1,numFoodSources:seed===ONBOARDING_SEED?2:3,foodPerSource:250},{doctrines:[cloneDoctrine(DEFAULT_DOCTRINE)]});
    if(seed===ONBOARDING_SEED){
      // Keep the marked source; put the alternative on a distinct, slightly longer branch.
      for(const f of [...this.sim.foodSources])this.sim.enqueue({kind:'setFood',x:f.x,y:f.y,amount:0});
      for(const f of ONBOARDING_FOOD)this.sim.enqueue({kind:'setFood',x:f.x,y:f.y,amount:250});
      this.sim.flushPending();
    }
    this.antIndex=Math.floor(makeRng(seed+':player')()*this.sim.allAnts.length);
    this.sim.enqueue({kind:'setManualAnt',index:this.antIndex});this.sim.flushPending();
  }
  step(){
    const ant=this.sim.allAnts[this.antIndex],carrying=ant.hasFood,food=this.sim.colonies[0].foodCollected;
    this.sim.step();this.pickedUp ||= ant.hasFood;
    const c=this.sim.colonies[0];
    if(carrying&&!ant.hasFood&&ant.cx===c.nestX&&ant.cy===c.nestY&&c.foodCollected>food)this.delivered=true;
  }
}
const edge=(a:number,b:number)=>a<b?a+':'+b:b+':'+a;
interface Route { cells:number[]; edges:Set<string>; returns:number[]; since:number|null }
export class ColonyLesson {
  readonly sim:Simulation;
  readonly startingFood:number;
  readonly startingTick:number;
  phase:'highway'|'complete'='highway';
  highwayShare=0;
  routeReturns=0;
  confirmedAt:number|null=null;
  readonly highways:{route:string;tick:number;share:number}[]=[];
  private confirmedRoutes=new Set<string>();
  private paths:number[][];
  private routes=new Map<string,Route>();
  constructor(sim:Simulation){
    this.sim=sim;this.startingFood=sim.colonies[0].foodCollected;this.startingTick=sim.tick;
    this.paths=sim.allAnts.map(()=>[]);
    // Release the same player ant. No world, ant, food, trail or clock is rebuilt.
    sim.enqueue({kind:'setManualAnt',index:null});sim.flushPending();
  }
  step(){
    const before=this.sim.allAnts.map(a=>a.hasFood);this.sim.step();
    this.sim.allAnts.forEach((a,i)=>{
      if(a.hasFood&&!before[i])this.paths[i]=[a.cy*COLS+a.cx];
      if(before[i]||a.hasFood)appendCell(this.paths[i],a.cy*COLS+a.cx);
      if(before[i]&&!a.hasFood){
        const cells=this.paths[i],source=this.sim.foodSources.some(f=>f.y*COLS+f.x===cells[0]);
        if(source&&cells.length>1){
          const key=cells.join(','),r=this.routes.get(key)??{cells:[...cells],edges:new Set(cells.slice(1).map((c,j)=>edge(cells[j],c))),returns:[],since:null};
          r.returns.push(this.sim.tick);this.routes.set(key,r);
          if(this.routes.size>100)this.routes.delete(this.routes.keys().next().value!);
        }
        this.paths[i]=[];
      }
    });
    if(this.sim.tick%10!==0)return;
    this.highwayShare=0;this.routeReturns=0;
    for(const r of this.routes.values()){
      r.returns=r.returns.filter(t=>t>this.sim.tick-1500);
      const cells=new Set(r.cells);
      const share=this.sim.allAnts.filter(a=>{
        const here=a.cy*COLS+a.cx,target=a.ty*COLS+a.tx;
        return cells.has(here)&&(here===target||r.edges.has(edge(here,target)));
      }).length/this.sim.allAnts.length;
      if(r.returns.length>this.routeReturns){this.routeReturns=r.returns.length;this.highwayShare=share;}
      const qualifies=r.returns.length>=6&&share>=.35;
      r.since=qualifies?(r.since??this.sim.tick):null;
      if(r.since!==null&&this.sim.tick-r.since>=200){
        this.phase='complete';this.confirmedAt??=this.sim.tick;this.highwayShare=share;this.routeReturns=r.returns.length;
        const route=r.cells.join(',');
        if(!this.confirmedRoutes.has(route)){this.confirmedRoutes.add(route);this.highways.push({route,tick:this.sim.tick,share});}
        // A highway is a milestone, not a terminal condition. Keep observing other routes.
      }
    }
  }
}
