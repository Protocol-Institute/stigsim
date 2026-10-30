import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { createSwarm,swarmObservation,applySwarmAction,swarmAntRouter } from './swarm-ant';
import { EXIT_X,EXIT_Y } from '../../shared/model-ant';
const config={seed:'42',loopRate:.1,models:['gpt-5-mini','claude-sonnet-4-6'],moveLimit:200};
test('inscribed pebbles are shared locally and retain author, timestamp and messages when carried',()=>{
 const state=createSwarm(config);const time='2026-10-29T20:00:00Z';
 applySwarmAction(state,{direction:'south',pebbleAction:'drop',pebbleId:null,message:'I explored south.'},time);
 const pebble=state.pebbles.find(p=>p.carrier===null)!;assert.equal(pebble.x,1);assert.equal(pebble.y,1);assert.equal(pebble.messages[0].author,'ant-1');assert.equal(pebble.messages[0].timestamp,time);
 state.nextAgent='ant-2';const obs=swarmObservation(state);assert.equal(obs.pebbles.here[0].messages[0].text,'I explored south.');
 obs.pebbles.here[0].messages[0].text='tampered';assert.equal(pebble.messages[0].text,'I explored south.');
 applySwarmAction(state,{direction:'south',pebbleAction:'pick',pebbleId:pebble.id,message:'Acknowledged.'},time);
 assert.equal(pebble.carrier,'ant-2');assert.equal(pebble.x,null);assert.equal(pebble.messages.length,2);assert.equal(state.pebbles.length,24);
 state.nextAgent='ant-1';assert.equal(swarmObservation(state).pebbles.here.length,0);
});
test('distant messages and agents are absent from local observations, and invalid inscription creates nothing',()=>{
 const state=createSwarm(config);state.agents[1].x=15;state.agents[1].y=15;
 const p=state.pebbles[0];p.carrier=null;p.x=15;p.y=15;p.messages.push({author:'ant-2',model:'other',timestamp:'now',turn:1,text:'distant secret'});
 assert.doesNotMatch(JSON.stringify(swarmObservation(state)),/distant secret/);assert.equal(swarmObservation(state).nearbyAgents.length,0);
 const result=applySwarmAction(state,{direction:'north',pebbleAction:'none',pebbleId:p.id,message:'write remotely'});
 assert.match(result,/Inscription failed/);assert.equal(p.messages.length,1);assert.equal(state.agents[0].x,1);assert.equal(state.agents[0].y,1);assert.equal(state.agents[0].moves,1);
});
test('any teammate reaching the exit wins and team limit stops exploration',()=>{
 const state=createSwarm(config);const agent=state.agents[0];agent.x=EXIT_X-1;agent.y=EXIT_Y;state.cells[EXIT_Y][EXIT_X]=true;
 applySwarmAction(state,{direction:'east',pebbleAction:'none',pebbleId:null,message:''});assert.equal(state.winner,'ant-1');assert.equal(state.done,true);
 const limited=createSwarm({...config,moveLimit:1});applySwarmAction(limited,{direction:'north',pebbleAction:'none',pebbleId:null,message:''});assert.equal(limited.done,true);assert.equal(limited.winner,null);
});
test('team API isolates each model history, rotates agents and caches duplicate turn requests',async()=>{
 const bodies:any[]=[];
 const mock:typeof fetch=async(_url,options)=>{bodies.push(JSON.parse(String(options?.body)));return Response.json({usage:{prompt_tokens:100,completion_tokens:20,total_tokens:120},choices:[{message:{tool_calls:[{function:{name:'act',arguments:JSON.stringify({direction:'south',pebbleAction:'drop',pebbleId:null,message:'South route'})}}]}}]});};
 const app=express();app.use(express.json());app.use(swarmAntRouter({ANT_MODEL:'gpt-5-mini',ANT_MODEL_BASE_URL:'http://test/v1',ANT_ALLOWED_MODELS:'gpt-5-mini,claude-sonnet-4-6'},mock));
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
 const post=async(path:string,body:unknown)=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 try{
  assert.equal((await post('/runs',{...config,models:['gpt-5-mini','unapproved']})).status,400);
  const created=await(await post('/runs',config)).json() as any;const path=`/runs/${created.id}/step`;
  const one=await(await post(path,{turn:0})).json() as any;assert.equal(one.entries.length,1);assert.equal(one.nextAgent,'ant-2');
  const cached=await(await post(path,{turn:0})).json() as any;assert.equal(cached.entries.length,1);assert.equal(bodies.length,1);
  const two=await(await post(path,{turn:1})).json() as any;assert.equal(two.entries.length,2);assert.equal(bodies[1].model,'claude-sonnet-4-6');
  const input=JSON.parse(bodies[1].messages[1].content);assert.equal(input.history.length,0);assert.equal(input.observation.pebbles.here[0].messages[0].text,'South route');assert.equal(input.observation.cells,undefined);
  await post(path,{turn:2});assert.equal(JSON.parse(bodies[2].messages[1].content).history.length,1);
 }finally{await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
});

test('notebooks stay private, edits persist, and origin metadata survives transport without changing baseline input',()=>{
 const state=createSwarm({...config,privateNotebooks:true,inscriptionOrigins:true,mechanicsFeedback:true});
 applySwarmAction(state,{direction:'south',pebbleAction:'drop',pebbleId:null,message:'Original nest marker',notebook:'PRIVATE A: explore east'});
 const pebble=state.pebbles.find(p=>p.carrier===null)!;
 assert.deepEqual(pebble.messages[0].origin,{x:1,y:1});
 state.nextAgent='ant-2';const other=swarmObservation(state);
 assert.equal(other.privateNotebook?.text,'');assert.doesNotMatch(JSON.stringify(other),/PRIVATE A/);
 assert.deepEqual(other.writablePebbles?.withoutTransfer,[pebble.id]);assert.equal(other.writablePebbles?.carriedCount,12);
 applySwarmAction(state,{direction:'south',pebbleAction:'pick',pebbleId:pebble.id,message:'Collected',notebook:'PRIVATE B'});
 applySwarmAction(state,{direction:'south',pebbleAction:'drop',pebbleId:pebble.id,message:'New site',notebook:null});
 assert.deepEqual(pebble.messages[0].origin,{x:1,y:1});assert.deepEqual(pebble.messages[2].origin,{x:1,y:2});
 assert.equal(pebble.y,2);assert.equal(state.agents[1].notebook,'PRIVATE B');assert.equal(state.agents[1].notebookRevision,1);
 state.nextAgent='ant-1';assert.equal(swarmObservation(state).privateNotebook?.text,'PRIVATE A: explore east');
 state.config.privateNotebooks=false;state.config.inscriptionOrigins=false;state.config.mechanicsFeedback=false;
 const baseline=swarmObservation(state);assert.equal(baseline.privateNotebook,undefined);assert.equal(baseline.writablePebbles,undefined);
 assert.equal(baseline.pebbles.here[0].messages[0].origin,undefined);assert.deepEqual(pebble.messages[0].origin,{x:1,y:1});
});

test('invalid notebook response is atomic and private notes never enter a teammate request',async()=>{
 const payloads:any[]=[];let calls=0;
 const mock:typeof fetch=async(_url,options)=>{const b=JSON.parse(String(options?.body));payloads.push(b);calls++;
 const notebook=calls===1?'x'.repeat(2001):calls===2?'SECRET agent one route':null;
 return Response.json({choices:[{message:{tool_calls:[{function:{name:'act',arguments:JSON.stringify({direction:'south',pebbleAction:'drop',pebbleId:null,message:'Marker',notebook})}}]}}]});};
 const app=express();app.use(express.json());app.use(swarmAntRouter({ANT_MODEL:'gpt-5-mini',ANT_MODEL_BASE_URL:'http://test/v1',ANT_ALLOWED_MODELS:'gpt-5-mini,claude-sonnet-4-6'},mock));
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
 const post=async(path:string,body:unknown)=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 try{
  assert.equal((await post('/runs',{...config,privateNotebooks:'yes'})).status,400);
  const state=await(await post('/runs',{...config,privateNotebooks:true,inscriptionOrigins:true,mechanicsFeedback:true})).json() as any;const path=`/runs/${state.id}/step`;
  assert.equal((await post(path,{turn:0})).status,502);
  const failed=await(await fetch(base+`/runs/${state.id}`)).json() as any;assert.equal(failed.entries.length,0);assert.equal(failed.agents[0].notebook,'');assert.equal(failed.pebbles.filter((p:any)=>p.carrier===null).length,0);
  const one=await(await post(path,{turn:0})).json() as any;assert.equal(one.agents[0].notebook,'SECRET agent one route');
  await post(path,{turn:1});assert.doesNotMatch(payloads[2].messages[1].content,/SECRET agent one route/);
  await post(path,{turn:2});const own=JSON.parse(payloads[3].messages[1].content);assert.equal(own.observation.privateNotebook.text,'SECRET agent one route');assert.ok(payloads[3].tools[0].function.parameters.properties.notebook);
 }finally{await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
});
