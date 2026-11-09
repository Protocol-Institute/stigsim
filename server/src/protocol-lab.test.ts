import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type {AddressInfo} from 'node:net';
import {protocolLabRouter} from './protocol-lab';
import {WALL_BASELINE} from '../../shared/protocol-lab';
test('designer sees practice scores only; freezing blocks revision and other held-out versions',async()=>{
 const payloads:any[]=[];const mock:typeof fetch=async(_url,options)=>{payloads.push(JSON.parse(String(options?.body)));return Response.json({usage:{prompt_tokens:10,completion_tokens:20,total_tokens:30},choices:[{message:{tool_calls:[{function:{name:'submit_protocol',arguments:JSON.stringify(WALL_BASELINE)}}]}}]});};
 const app=express();app.use(express.json());const env={ANT_MODEL:'gpt-5-mini',ANT_MODEL_BASE_URL:'http://test/v1'};app.use('/local',protocolLabRouter(env,mock));app.use('/prod',protocolLabRouter({...env,NODE_ENV:'production'},mock));
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
 const post=(path:string,body:unknown={})=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 try{
  assert.equal((await fetch(base+'/prod/status')).status,404);
  assert.equal((await post('/local/sessions',{model:'unapproved'})).status,400);
  const {id}=await(await post('/local/sessions',{model:'gpt-5-mini'})).json() as any;
  const first=await(await post(`/local/sessions/${id}/design`)).json() as any;assert.equal(first.usage.totalTokens,30);assert.equal(first.practice.scores[0].runs,6);
  await post(`/local/sessions/${id}/design`);
  const revision=JSON.parse(payloads[1].messages[1].content);assert.deepEqual(revision.previous,WALL_BASELINE);assert.equal(revision.practice.length,3);assert.equal(revision.heldOutSeeds,undefined);assert.equal(revision.replay,undefined);
  const frozen=await(await post(`/local/sessions/${id}/evaluate`,{index:0})).json() as any;assert.equal(frozen.evaluation.scores[0].runs,12);assert.equal(frozen.heldOutSeeds.length,12);
  assert.equal((await post(`/local/sessions/${id}/design`)).status,409);
  assert.equal((await post(`/local/sessions/${id}/evaluate`,{index:1})).status,409);
  assert.equal(payloads.length,2);assert.equal(payloads[0].tools[0].function.strict,true);
 }finally{await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
});

test('failed submissions retain reported usage and cannot exceed the three-request budget',async()=>{
 let calls=0;const payloads:any[]=[];const mock:typeof fetch=async(_url,options)=>{payloads.push(JSON.parse(String(options?.body)));calls++;return Response.json({usage:{prompt_tokens:10,completion_tokens:20,total_tokens:30},choices:[{message:{tool_calls:[{function:{name:'submit_protocol',arguments:'{}'}}]}}]});};
 const app=express();app.use(express.json());app.use(protocolLabRouter({ANT_MODEL:'gpt-5-mini',ANT_MODEL_BASE_URL:'http://test/v1'},mock));const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
 const post=(path:string,body:unknown={})=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 try{const{id}=await(await post('/sessions',{model:'gpt-5-mini'})).json() as any;for(let i=1;i<=3;i++){const r=await post(`/sessions/${id}/design`);assert.equal(r.status,502);const d=await r.json() as any;assert.equal(d.attempts,i);assert.equal(d.usage.totalTokens,30);}assert.equal((await post(`/sessions/${id}/design`)).status,409);assert.equal(calls,3);const retry=JSON.parse(payloads[1].messages[1].content);assert.equal(retry.repair.submission,'{}');assert.match(retry.repair.error,/Invalid protocol description/);assert.equal(retry.heldOutSeeds,undefined);}finally{await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
});
