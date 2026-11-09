import { createMaze,offsets } from '../model-ant/maze';
import { directions,EXIT_X,EXIT_Y,type Direction } from '../../../shared/model-ant';
export interface Point {x:number;y:number}
export interface Branch { owners:string[]; returnedBy:string[] }
export interface Marker { closed?:boolean; visitors:string[]; branches:Partial<Record<Direction,Branch>> }
export interface Agent {id:string;x:number;y:number;path:Point[];visited:string[];moves:number;finished:boolean}
export interface Team { coordinated:boolean;cells:boolean[][];agents:Agent[];markers:Record<string,Marker>;round:number;winner:string|null;events:string[];done:boolean;limited:boolean }
const key=(p:Point)=>`${p.x},${p.y}`;
const opposite:Record<Direction,Direction>={north:'south',east:'west',south:'north',west:'east'};
function marker(team:Team,p:Point):Marker {return team.markers[key(p)]??=( {visitors:[],branches:{}} );}
export function createTeam(seed:string,loops:number,coordinated:boolean):Team {
 const maze=createMaze(seed,loops);
 return {coordinated,cells:maze.cells,agents:['A','B'].map(id=>({id,x:1,y:1,path:[{x:1,y:1}],visited:['1,1'],moves:0,finished:false})),markers:{'1,1':{visitors:['A','B'],branches:{}}},round:0,winner:null,events:[],done:false,limited:false};
}
// Controller input is restricted to local terrain/markers plus this agent's own DFS memory.
export function localView(team:Team,agent:Agent){return directions.map(direction=>{const[dx,dy]=offsets[direction];const point={x:agent.x+dx,y:agent.y+dy};return {direction,point,open:!!team.cells[point.y]?.[point.x],visitedByTeam:!!team.markers[key(point)]?.visitors.length,closed:!!team.markers[key(point)]?.closed,branch:team.markers[key(agent)]?.branches[direction]};});}
export function advanceRound(previous:Team):Team {
 if(previous.done)return previous;
 const team=structuredClone(previous);team.round++;const events:string[]=[];
 const order=team.round%2?team.agents:[...team.agents].reverse();
 for(const agent of order){
  if(agent.finished||team.winner)continue;
  const priorities=agent.id==='A'?directions:[...directions].reverse();
  const candidates=localView(team,agent).filter(n=>n.open&&!agent.visited.includes(key(n.point))&&(!team.coordinated||!n.closed)).sort((a,b)=>priorities.indexOf(a.direction)-priorities.indexOf(b.direction));
  let next=candidates[0];let reason='explores a privately unvisited passage';
  if(team.coordinated&&candidates.length){
   const fresh=candidates.find(n=>!n.visitedByTeam);const unclaimed=candidates.find(n=>!n.branch?.owners.length&&!n.branch?.returnedBy.length);
   next=fresh??unclaimed??candidates[0];reason=fresh?'takes a fresh branch':unclaimed?'takes an unclaimed connection':'follows a claimed corridor to reach new junctions';
   if(candidates.some(n=>n.visitedByTeam)&&fresh)reason+=' instead of duplicating a marked route';
  }
  const from={x:agent.x,y:agent.y};
  if(next){
   if(team.coordinated){const record=marker(team,from);const branch=record.branches[next.direction]??={owners:[],returnedBy:[]};if(!branch.owners.includes(agent.id))branch.owners.push(agent.id);}
   agent.x=next.point.x;agent.y=next.point.y;agent.path.push(next.point);agent.visited.push(key(next.point));agent.moves++;
   const arrived=marker(team,next.point);if(!arrived.visitors.includes(agent.id))arrived.visitors.push(agent.id);
   events.push(`${agent.id} ${reason}: ${next.direction} from (${from.x},${from.y}).`);
  }else if(agent.path.length>1){
   if(team.coordinated&&localView(team,agent).filter(n=>n.open).every(n=>n.visitedByTeam))marker(team,agent).closed=true;
   agent.path.pop();const parent=agent.path.at(-1)!;const direction=directions.find(d=>{const[dx,dy]=offsets[d];return from.x+dx===parent.x&&from.y+dy===parent.y;})!;
   agent.x=parent.x;agent.y=parent.y;agent.moves++;
   if(team.coordinated){const branch=marker(team,parent).branches[opposite[direction]];if(branch){branch.owners=branch.owners.filter(id=>id!==agent.id);if(!branch.returnedBy.includes(agent.id))branch.returnedBy.push(agent.id);}}
   events.push(`${agent.id} backtracks ${direction}; its local DFS branch is exhausted.`);
  }else{agent.finished=true;events.push(`${agent.id} has exhausted its search and parks at the nest.`);}
  if(agent.x===EXIT_X&&agent.y===EXIT_Y){team.winner=agent.id;team.done=true;events.push(`${agent.id} reaches the exit. Team wins at round ${team.round}.`);}
 }
 if(team.agents.every(a=>a.finished))team.done=true;
 if(team.round>=4000&&!team.done){team.done=true;team.limited=true;events.push('Safety limit reached.');}
 team.events=[...events.map(event=>`Round ${team.round}: ${event}`),...team.events].slice(0,100);return team;
}
export function teamStats(team:Team){const visits=team.agents.flatMap(a=>a.visited);const unique=new Set(visits);return {moves:team.agents.reduce((n,a)=>n+a.moves,0),cells:unique.size,overlap:team.agents[0].visited.filter(p=>team.agents[1].visited.includes(p)).length,repeatedMoves:Math.max(0,team.agents.reduce((n,a)=>n+a.moves,0)-(unique.size-1))};}
