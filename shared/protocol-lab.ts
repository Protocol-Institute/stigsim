export const RELATIVE = ['right','straight','left','reverse'] as const;
export type Relative = typeof RELATIVE[number];
export interface ControllerRule { state:number|null; here:number|null; neighbor:number[]|null; order:Relative[]; write:number|null; next:number }
export interface Controller { heading:number; initial:number; rules:ControllerRule[] }
export interface Protocol { name:string; explanation:string; labels:string[]; agents:[Controller,Controller] }
export type SignalMode='shared'|'private'|'off';
export interface Score { mode:SignalMode; runs:number; successes:number; meanRounds:number; meanMoves:number; meanOverlap:number; meanWrites:number; meanForeignReads:number }
export interface Frame { round:number; agents:{x:number;y:number;state:number;heading:number}[]; writes:{x:number;y:number;value:number;by:number}[]; decisions:string[]; winner:number|null }
export interface Replay { cells:boolean[][]; frames:Frame[]; seed:string; mode:SignalMode }
export interface Evaluation { scores:Score[]; replay:Replay }
export const CONTROLLER_CONTRACT = `Design two deterministic finite-state ant controllers for cooperative exploration. Team goal: ANY ant reaches the unknown exit as early as possible. Both start at (1,1). Local terrain only; no hidden maze, global map, coordinates, visited set, or teammate position is available to the controller. Each ant has heading (0 north,1 east,2 south,3 west), internal state 0..15, and one persistent marker label 0..15 per cell (0 blank). You choose the meanings of labels 1..15; no meaning is prescribed. A controller has initial heading/state and an ordered rules array (1..24 rules). Every rule must include all seven fields. state, here, and write are single integers 0..15 or JSON null, NEVER arrays, strings, ranges, -1, or wildcard symbols. To match multiple current labels, create separate rules. Use next=0 if no internal state is needed. Each rule: state (null matches any), here (null matches any current marker), neighbor (null matches any destination marker or an array of allowed labels), order (a permutation of right,straight,left,reverse), write (null leaves current marker unchanged, otherwise writes 0..15 BEFORE movement), next (new internal state 0..15). First rule matching state/here AND with a passable eligible direction wins. Try directions in its order. Wall directions are never eligible. Heading changes to movement direction. If no rule matches, stay in place without writing or changing state; the turn is consumed. Rules see marker labels only; authors and logs are observer-only. Each round gives each ant one turn, alternating first mover per round; later turns see earlier writes. Markers have unlimited fixed-location storage, no text, no decay. There is no direct agent chat. Two ants may share a cell. Maze is 31x31 from the current generator at 10% loops. Per-maze budget is 400 rounds, failed solves count as 400 in mean rounds. Each ant gets 400 turns at most. Tests use the same frozen controllers with shared markers, private per-agent marker fields, and all markers disabled (reads zero/writes ignored). Improve shared-marker performance over private markers, not just over the off condition, and prioritize success. Return a concise name, explanation, 15 label descriptions, and exactly two controllers. Explanation should describe the protocol, not a reasoning trace. You may revise using practice results. No held-out feedback is available until the design is frozen.`;
export function validateProtocol(value:unknown):Protocol {
 const p=value as Protocol;
 const integer=(v:unknown)=>Number.isInteger(v)&&Number(v)>=0&&Number(v)<=15;
 if(!p||typeof p.name!=='string'||p.name.length>80||typeof p.explanation!=='string'||p.explanation.length>2000||!Array.isArray(p.labels)||p.labels.length!==15||p.labels.some(s=>typeof s!=='string'||s.length>120)||!Array.isArray(p.agents)||p.agents.length!==2)throw new Error('Invalid protocol description.');
 for(const [agentIndex,agent] of p.agents.entries()){
 const where=`Agent ${agentIndex+1}`;
 if(!agent||!Number.isInteger(agent.heading)||agent.heading<0||agent.heading>3||!integer(agent.initial)||!Array.isArray(agent.rules)||!agent.rules.length||agent.rules.length>24)throw new Error(`${where}: heading must be 0–3, initial state 0–15, and rules must contain 1–24 entries.`);
 for(const [ruleIndex,r] of agent.rules.entries()){
 const fail=(detail:string):never=>{throw new Error(`${where}, rule ${ruleIndex+1}: ${detail} No controller was accepted.`);};
 if(!r)fail('rule must be an object.');
 for(const key of ['state','here','write'] as const)if(r[key]!==null&&!integer(r[key]))fail(`${key} must be null or an integer from 0 to 15.`);
 if(!integer(r.next))fail('next must be an integer from 0 to 15.');
 if(!Array.isArray(r.order)||r.order.length!==4||new Set(r.order).size!==4||r.order.some(d=>!RELATIVE.includes(d)))fail('order must contain right, straight, left, reverse exactly once each.');
 if(r.neighbor!==null&&(!Array.isArray(r.neighbor)||r.neighbor.length>16||r.neighbor.some(n=>!integer(n))))fail('neighbor must be null or an array of up to 16 integers from 0 to 15.');
 }}
 return structuredClone(p);
}
export const WALL_BASELINE:Protocol={name:'Right / left wall baseline',explanation:'Opposite wall followers. No marker use.',labels:Array.from({length:15},()=> 'Unused'),agents:[{heading:2,initial:0,rules:[{state:null,here:null,neighbor:null,order:['right','straight','left','reverse'],write:null,next:0}]},{heading:2,initial:0,rules:[{state:null,here:null,neighbor:null,order:['left','straight','right','reverse'],write:null,next:0}]}]};
