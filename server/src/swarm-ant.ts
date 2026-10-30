import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { directions, pebbleActions, EXIT_X, EXIT_Y, isDecisionModel, type AgentUsage } from '../../shared/model-ant';
import { swarmRules, MAX_NOTEBOOK_CHARACTERS, type SwarmAction, type SwarmConfig, type SwarmSnapshot, type SwarmObservation } from '../../shared/swarm-ant';
import { createMaze, offsets } from '../../src/modes/model-ant/maze';
import { previewAccess, previewEnabled } from './model-ant-preview-access';
export function createSwarm(config:SwarmConfig):SwarmSnapshot {
 const maze=createMaze(config.seed,config.loopRate);
 const agents=config.models.map((model,i)=>({id:`ant-${i+1}`,model,x:1,y:1,moves:0,lastResult:'Starting at the nest.',visited:['1,1'],notebook:'',notebookRevision:0}));
 return {id:randomUUID(),config,cells:maze.cells,agents,pebbles:agents.flatMap(agent=>Array.from({length:12},(_,i)=>({id:`${agent.id}-pebble-${i+1}`,x:null,y:null,carrier:agent.id,messages:[]}))),entries:[],nextAgent:agents[0].id,winner:null,done:false,failures:[]};
}
export function swarmObservation(state:SwarmSnapshot):SwarmObservation {
 const agent=state.agents.find(a=>a.id===state.nextAgent)!;
 const at=(x:number,y:number)=>state.pebbles.filter(p=>!p.carrier&&p.x===x&&p.y===y);
 const neighbors=Object.fromEntries(directions.map(d=>{const [dx,dy]=offsets[d];const x=agent.x+dx,y=agent.y+dy;return [d,!state.cells[y]?.[x]?'wall':x===EXIT_X&&y===EXIT_Y?'exit':'passage'];})) as SwarmObservation['neighbors'];
 const observation:SwarmObservation = structuredClone({agentId:agent.id,team:state.agents.map(a=>a.id),turn:agent.moves,sharedTurn:state.entries.length,position:{x:agent.x,y:agent.y},neighbors,lastResult:agent.lastResult,
 pebbles:{carried:state.pebbles.filter(p=>p.carrier===agent.id),here:at(agent.x,agent.y),neighbors:Object.fromEntries(directions.map(d=>{const [dx,dy]=offsets[d];return[d,at(agent.x+dx,agent.y+dy)];})) as SwarmObservation['pebbles']['neighbors']},
 nearbyAgents:state.agents.filter(a=>a.id!==agent.id&&Math.abs(a.x-agent.x)+Math.abs(a.y-agent.y)<=1).map(a=>({id:a.id,x:a.x,y:a.y}))});
 if(state.config.privateNotebooks) observation.privateNotebook={text:agent.notebook??'',revision:agent.notebookRevision??0};
 if(state.config.mechanicsFeedback) observation.writablePebbles={carriedCount:observation.pebbles.carried.length,withoutTransfer:observation.pebbles.here.map(p=>p.id),withDrop:observation.pebbles.carried.map(p=>p.id),withPick:observation.pebbles.here.map(p=>p.id)};
 if(!state.config.inscriptionOrigins) for(const p of [...observation.pebbles.carried,...observation.pebbles.here,...Object.values(observation.pebbles.neighbors).flat()])for(const message of p.messages)delete message.origin;
 return observation;
}
export function applySwarmAction(state:SwarmSnapshot, action:SwarmAction, timestamp=new Date().toISOString()):string {
 const agent=state.agents.find(a=>a.id===state.nextAgent)!;
 const candidates=state.pebbles.filter(p=>action.pebbleAction==='drop'?p.carrier===agent.id:!p.carrier&&p.x===agent.x&&p.y===agent.y);
 const pebble=action.pebbleId?candidates.find(p=>p.id===action.pebbleId):candidates[0];
 const results:string[]=[];
 if(state.config.privateNotebooks && typeof action.notebook==='string' && action.notebook!==agent.notebook){agent.notebook=action.notebook;agent.notebookRevision=(agent.notebookRevision??0)+1;}
 if(action.pebbleAction!=='none') {
  if(!pebble) results.push(`${action.pebbleAction} failed: no eligible pebble.`);
  else if(action.pebbleAction==='drop'){pebble.carrier=null;pebble.x=agent.x;pebble.y=agent.y;results.push(`Dropped ${pebble.id}.`);}
  else {pebble.carrier=agent.id;pebble.x=null;pebble.y=null;results.push(`Picked up ${pebble.id}.`);}
 }
 if(action.message){if(pebble){pebble.messages.push({author:agent.id,model:agent.model,timestamp,turn:state.entries.length+1,text:action.message,origin:{x:agent.x,y:agent.y}});results.push(`Inscribed ${pebble.id}.`);}else results.push('Inscription failed: no eligible pebble.');}
 const [dx,dy]=offsets[action.direction];
 if(state.cells[agent.y+dy]?.[agent.x+dx]){agent.x+=dx;agent.y+=dy;results.push(`Moved ${action.direction}.`);}else results.push('Blocked by a wall.');
 agent.moves++;agent.visited=[...new Set([...agent.visited,`${agent.x},${agent.y}`])];agent.lastResult=results.join(' ');
 if(agent.x===EXIT_X&&agent.y===EXIT_Y){state.winner=agent.id;state.done=true;}
 if(state.entries.length+1>=state.config.moveLimit)state.done=true;
 return agent.lastResult;
}
const tool={type:'function',function:{name:'act',description:'Move and optionally transfer or inscribe a shared pebble.',parameters:{type:'object',additionalProperties:false,properties:{direction:{type:'string',enum:directions},pebbleAction:{type:'string',enum:pebbleActions},pebbleId:{type:['string','null']},message:{type:'string',maxLength:300}},required:['direction','pebbleAction','pebbleId','message']}}};
export function swarmAntRouter(env=process.env,request:typeof fetch=fetch){
 const router=Router();const shared=previewEnabled(env);if(env.NODE_ENV==='production'&&shared)router.use(previewAccess(env.MODEL_ANT_PREVIEW_PASSWORD!));
 const base=env.ANT_MODEL_BASE_URL||(env.NEON_AI_GATEWAY_BASE_URL?`${env.NEON_AI_GATEWAY_BASE_URL.replace(/\/$/,'')}/v1`:'');const token=env.ANT_MODEL_API_KEY||env.NEON_AI_GATEWAY_TOKEN;
 const models=[...new Set([env.ANT_MODEL,...(env.ANT_ALLOWED_MODELS?.split(',').map(s=>s.trim())??(env.NEON_AI_GATEWAY_BASE_URL?['gpt-5-mini','claude-sonnet-4-6']:[]))].filter((id):id is string=>!!id&&!isDecisionModel(id)))];
 const ready=!!base&&models.length>0&&(env.NODE_ENV!=='production'||shared);
 const sessions=new Map<string,{state:SwarmSnapshot;touched:number;busy:boolean}>();let active=0;
 router.get('/status',(_req,res)=>res.json({ready,models}));
 router.post('/runs',(req,res)=>{if(!ready){res.status(503).json({error:'Configure a text-generating model service.'});return;}
 const c=req.body as SwarmConfig;
 if(!c||['privateNotebooks','inscriptionOrigins','mechanicsFeedback'].some(key=>(c as any)[key]!==undefined&&typeof (c as any)[key]!=='boolean')||typeof c.seed!=='string'||!c.seed.trim()||c.seed.length>128||!Number.isFinite(c.loopRate)||c.loopRate<0||c.loopRate>.5||!Array.isArray(c.models)||c.models.length<2||c.models.length>4||c.models.some(m=>!models.includes(m))||!Number.isInteger(c.moveLimit)||c.moveLimit<20||c.moveLimit>800){res.status(400).json({error:'Invalid team or maze settings.'});return;}
 for(const[id,s]of sessions)if(!s.busy&&Date.now()-s.touched>3600000)sessions.delete(id);
 if(sessions.size>=16){res.status(429).json({error:'Too many active experiments.'});return;}
 const state=createSwarm({seed:c.seed.trim(),loopRate:c.loopRate,models:[...c.models],moveLimit:c.moveLimit,privateNotebooks:c.privateNotebooks??false,inscriptionOrigins:c.inscriptionOrigins??false,mechanicsFeedback:c.mechanicsFeedback??false});sessions.set(state.id,{state,touched:Date.now(),busy:false});res.json(state);});
 router.delete('/runs/:id',(req,res)=>{const s=sessions.get(req.params.id);if(s?.busy){res.status(409).json({error:'Wait for the current move to finish.'});return;}sessions.delete(req.params.id);res.sendStatus(204);});
 router.get('/runs/:id',(req,res)=>{const s=sessions.get(req.params.id);if(!s){res.status(404).json({error:'Experiment expired.'});return;}s.touched=Date.now();res.json(s.state);});
 router.post('/runs/:id/step',async(req,res)=>{
 const s=sessions.get(req.params.id);if(!ready||!s){res.status(404).json({error:'Experiment unavailable or expired.'});return;}
 // Turn is an idempotency key: a retry after a lost response returns the committed snapshot.
 const turn=req.body?.turn;if(!Number.isInteger(turn)||turn<0||turn>s.state.entries.length){res.status(409).json({error:'Invalid team turn.'});return;}
 if(turn<s.state.entries.length||s.state.done){res.json(s.state);return;}
 if(s.busy||active>=2){res.status(429).json({error:'A model request is already in progress. Retry shortly.'});return;}
 s.busy=true;active++;s.touched=Date.now();const start=Date.now();const state=s.state,agent=state.agents.find(a=>a.id===state.nextAgent)!;const observation=swarmObservation(state);
 const usage:AgentUsage={requests:1,inputTokens:null,outputTokens:null,totalTokens:null};
 try{
  const history=state.entries.filter(e=>e.agentId===agent.id).map(e=>({observation:e.observation,action:e.action,outcome:e.outcome}));
  const actTool=state.config.privateNotebooks ? {...tool,function:{...tool.function,parameters:{...tool.function.parameters,properties:{...tool.function.parameters.properties,notebook:{type:['string','null'],maxLength:MAX_NOTEBOOK_CHARACTERS,description:'Replace your private notebook; null keeps it and empty text clears it.'}}}}} : tool;
  const response=await request(`${base.replace(/\/$/,'')}/chat/completions`,{method:'POST',signal:AbortSignal.timeout(60000),headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify({model:agent.model,max_tokens:1600,tools:[actTool],tool_choice:{type:'function',function:{name:'act'}},...(agent.model.startsWith('claude-')?{}:{parallel_tool_calls:false}),messages:[{role:'system',content:swarmRules(state.config)},{role:'user',content:JSON.stringify({history,observation})}]})});
  if(!response.ok)throw new Error(`Model service returned HTTP ${response.status}. No move applied; retry this turn.`);
  const data=await response.json() as any;
  const count=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0?v:null;
  usage.inputTokens=count(data.usage?.prompt_tokens);usage.outputTokens=count(data.usage?.completion_tokens);usage.totalTokens=count(data.usage?.total_tokens)??(usage.inputTokens!==null&&usage.outputTokens!==null?usage.inputTokens+usage.outputTokens:null);
  const calls=data.choices?.[0]?.message?.tool_calls;if(data.choices?.[0]?.finish_reason==='length'||!Array.isArray(calls)||calls.length!==1||calls[0].function?.name!=='act')throw new Error('Model returned no single complete action.');
  const action=JSON.parse(calls[0].function.arguments) as SwarmAction;
  if(!action||!directions.includes(action.direction)||!pebbleActions.includes(action.pebbleAction)||(action.pebbleId!==null&&(typeof action.pebbleId!=='string'||action.pebbleId.length>80))||typeof action.message!=='string'||action.message.length>300)throw new Error('Model returned an invalid action or inscription.');
  if(action.notebook!==undefined && (!state.config.privateNotebooks || (action.notebook!==null && (typeof action.notebook!=='string'||action.notebook.length>MAX_NOTEBOOK_CHARACTERS))))throw new Error('Model returned an invalid private notebook. No move applied.');
  const timestamp=new Date().toISOString();const outcome=applySwarmAction(state,action,timestamp);state.entries.push({turn:turn+1,agentId:agent.id,model:agent.model,observation,action,outcome,usage,elapsedMs:Date.now()-start,timestamp});state.nextAgent=state.agents[(state.agents.indexOf(agent)+1)%state.agents.length].id;s.touched=Date.now();res.json(state);
 }catch(error){const message=error instanceof Error?error.message:'Model request failed.';state.failures.push({agentId:agent.id,error:message,timestamp:new Date().toISOString(),usage});res.status(502).json({error:message,usage,agentId:agent.id});}finally{s.busy=false;active--;}
 });return router;
}
