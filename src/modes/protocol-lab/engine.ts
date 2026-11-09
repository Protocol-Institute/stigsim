import { createMaze } from '../model-ant/maze';
import { EXIT_X,EXIT_Y } from '../../../shared/model-ant';
import type {Protocol,SignalMode,Frame,Replay,Evaluation,Score} from '../../../shared/protocol-lab';
const offsets=[[0,-1],[1,0],[0,1],[-1,0]];
const relative={right:1,straight:0,left:3,reverse:2};
export function simulate(protocol:Protocol,seed:string,mode:SignalMode,record=false){
 const cells=createMaze(seed,.1).cells;const agents=protocol.agents.map(a=>({x:1,y:1,heading:a.heading,state:a.initial}));
 const fields=[new Map<string,{value:number;by:number}>(),new Map<string,{value:number;by:number}>()];
 const visited=[new Set(['1,1']),new Set(['1,1'])];let rounds=0,moves=0,writes=0,foreignReads=0,winner:number|null=null;
 const frames:Frame[]=record?[{round:0,agents:structuredClone(agents),writes:[],decisions:[],winner:null}]:[];
 for(let round=1;round<=400&&winner===null;round++){
  rounds=round;const changes:Frame['writes']=[],decisions:string[]=[];
  for(const index of round%2?[0,1]:[1,0]){
   const agent=agents[index],controller=protocol.agents[index],field=fields[mode==='shared'?0:index];
   const read=(x:number,y:number)=>{if(mode==='off')return 0;const entry=field.get(`${x},${y}`);if(entry&&entry.value!==0&&entry.by!==index)foreignReads++;return entry?.value??0;};
   const here=read(agent.x,agent.y);
   // Each direction's visible label is read once, not once per matching attempt.
   const local=offsets.map(([dx,dy],heading)=>({heading,x:agent.x+dx,y:agent.y+dy,open:!!cells[agent.y+dy]?.[agent.x+dx],label:read(agent.x+dx,agent.y+dy)}));
   let acted=false;
   for(let ri=0;ri<controller.rules.length;ri++){
    const rule=controller.rules[ri];if(rule.state!==null&&rule.state!==agent.state||rule.here!==null&&rule.here!==here)continue;
    const candidate=rule.order.map(d=>local[(agent.heading+relative[d])%4]).find(n=>n.open&&(rule.neighbor===null||rule.neighbor.includes(n.label)));
    if(!candidate)continue;
    if(rule.write!==null&&mode!=='off'){field.set(`${agent.x},${agent.y}`,{value:rule.write,by:index});writes++;changes.push({x:agent.x,y:agent.y,value:rule.write,by:index});}
    decisions.push(`${index===0?'A':'B'}: rule ${ri+1}, state ${agent.state}, here ${here}; moves ${['north','east','south','west'][candidate.heading]}, writes ${mode==='off'?'disabled':rule.write??'nothing'}, state → ${rule.next}.`);
    agent.state=rule.next;agent.heading=candidate.heading;agent.x=candidate.x;agent.y=candidate.y;moves++;visited[index].add(`${agent.x},${agent.y}`);acted=true;
    if(agent.x===EXIT_X&&agent.y===EXIT_Y)winner=index;
    break;
   }
   if(!acted)decisions.push(`${index===0?'A':'B'}: no matching eligible rule; stays.`);
   if(winner!==null)break;
  }
  if(record)frames.push({round,agents:structuredClone(agents),writes:changes,decisions,winner});
 }
 return {rounds,moves,success:winner!==null,writes,foreignReads,overlap:[...visited[0]].filter(k=>visited[1].has(k)).length,replay:{cells,frames,seed,mode} as Replay};
}
export function evaluate(protocol:Protocol,seeds:string[]):Evaluation {
 let replay:Replay|undefined;
 const scores:Score[]=(['shared','private','off'] as SignalMode[]).map(mode=>{
  const runs=seeds.map((seed,i)=>simulate(protocol,seed,mode,mode==='shared'&&i===0));if(mode==='shared')replay=runs[0].replay;
  const avg=(key:'rounds'|'moves'|'overlap'|'writes'|'foreignReads')=>runs.reduce((n,r)=>n+r[key],0)/runs.length;
  return {mode,runs:runs.length,successes:runs.filter(r=>r.success).length,meanRounds:avg('rounds'),meanMoves:avg('moves'),meanOverlap:avg('overlap'),meanWrites:avg('writes'),meanForeignReads:avg('foreignReads')};
 });return {scores,replay:replay!};
}
