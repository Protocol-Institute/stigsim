import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type {AddressInfo} from 'node:net';
import {DEFAULT_DOCTRINE} from '@stigsim/sim-core';
import { WarSimulation } from '../../src/modes/war/war-simulation';
import {modelWarRouter} from './model-war';
import {buildWarObservation,seriesFinished,validateWarDecision} from '../../shared/model-war';

test('series ends on three wins or five games, including draws',()=>{
  assert.equal(seriesFinished([0,1,0,1]),false);
  assert.equal(seriesFinished([1,1,1]),true);
  assert.equal(seriesFinished(['draw','draw','draw','draw','draw']),true);
  assert.equal(seriesFinished([0,0,'draw',1]),false);
  assert.throws(()=>validateWarDecision({doctrine:{...DEFAULT_DOCTRINE,evapRate:Infinity},analysis:'',memory:''}));
});
test('model decisions enforce catalog, validate doctrines and carry only supplied private memory',async()=>{
  const payloads:any[]=[];let invalid=false;
  const mock:typeof fetch=async(_url,options)=>{payloads.push(JSON.parse(String(options?.body)));return Response.json({model:'served',usage:{total_tokens:30},choices:[{message:{tool_calls:[{function:{name:'submit_strategy',arguments:JSON.stringify({doctrineJson:JSON.stringify(invalid?{...DEFAULT_DOCTRINE,spoilerFraction:2}:DEFAULT_DOCTRINE),analysis:'Conserve trails.',memory:'Prior game had starvation.'})}}]}}]});};
  const env={ANT_MODEL:'model-a',ANT_ALLOWED_MODELS:'model-a, model-b',ANT_MODEL_BASE_URL:'http://test/v1'};
  const app=express();app.use(express.json());app.use('/local',modelWarRouter(env,mock));app.use('/prod',modelWarRouter({...env,NODE_ENV:'production'},mock));
  const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post=(path:string,body:unknown)=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  try {
    const status=await(await fetch(base+'/local/status')).json() as any;assert.deepEqual(status.models,['model-a','model-b']);assert.equal(status.ready,true);
    assert.equal((await post('/local/decide',{model:'unapproved',state:{}})).status,400);
    assert.equal((await post('/prod/decide',{model:'model-a',state:{}})).status,503);
    const response=await post('/local/decide',{model:'model-b',state:{phase:'review',result:1},memory:'private-b'});assert.equal(response.status,200);
    const reply=await response.json() as any;assert.deepEqual(reply.doctrine,DEFAULT_DOCTRINE);assert.equal(reply.usage.total_tokens,30);
    assert.deepEqual(JSON.parse(payloads[0].messages[1].content),{state:{phase:'review',result:1},memory:'private-b'});
    invalid=true;assert.equal((await post('/local/decide',{model:'model-a',state:{}})).status,502);
    assert.equal(payloads.length,2);
  } finally {await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
});


test('review names the actual winner and counts the reviewed game once for both players', () => {
  const war = new WarSimulation({masterSeed:'observation-review'});
  const snapshot = {game:1,tick:8825,colonies:[0,1].map(colony=>({colony,player:colony,metrics:war.getMetrics(colony),doctrine:DEFAULT_DOCTRINE}))};
  const base = {snapshot,models:['gpt','claude'],results:[],terminal:true,winner:0,previous:null,settings:war.settings,rules:war.rules,remainingFood:[]};
  const winner = buildWarObservation({...base,player:0});
  const loser = buildWarObservation({...base,player:1});
  assert.equal(winner.gameOutcome.yourOutcome,'won');
  assert.equal(loser.gameOutcome.yourOutcome,'lost');
  assert.match(winner.gameOutcome.explanation,/last colony standing/);
  assert.equal(winner.series.completedGameCount,1);
  assert.equal(loser.series.yourLosses,1);
  assert.equal(loser.series.yourWins,0);
  assert.equal(loser.series.gamesRemaining,4);
  assert.equal(loser.series.nextGameNumber,2);
  assert.equal(loser.series.completedGames[0].winnerModel,'gpt');
});

test('alternating seats preserve own/opponent identity and compute deltas by player', () => {
  const war = new WarSimulation({masterSeed:'observation-seats'});
  const previous = {game:2,tick:500,colonies:[0,1].map(colony=>({colony,player:1-colony,metrics:{...war.getMetrics(colony),foodCollected:colony===0?118:88},doctrine:DEFAULT_DOCTRINE}))};
  const snapshot = {game:2,tick:1000,colonies:previous.colonies.map(c=>({...c,metrics:{...c.metrics,foodCollected:c.player===0?201:206}}))};
  const input = {snapshot,models:['gpt','claude'],results:[0],terminal:false,winner:'draw' as const,previous,settings:war.settings,rules:war.rules,remainingFood:[]};
  const observation = buildWarObservation({...input,player:0});
  assert.equal(observation.you.colonyId,1);
  assert.equal(observation.you.model,'gpt');
  assert.equal(observation.you.metrics.foodCollected,201);
  assert.equal(observation.opponent.metrics.foodCollected,206);
  assert.equal(observation.changesSincePreviousObservation?.yourMetricDeltas?.foodCollected,113);
  assert.equal(observation.changesSincePreviousObservation?.opponentMetricDeltas?.foodCollected,88);
  assert.equal(observation.gameOutcome.yourOutcome,'in-progress');
  assert.equal(observation.series.completedGameCount,1);
  assert.equal(observation.series.yourWins,1);
  snapshot.colonies[1].metrics.foodCollected=999;
  assert.equal(observation.you.metrics.foodCollected,201,'request snapshot must not change with runtime');
  const nextGame = buildWarObservation({...input,player:1,snapshot:{...snapshot,game:3}});
  assert.equal(nextGame.changesSincePreviousObservation,null,'never compare different maps/games');
});

test('final review counts draws and marks a completed series without inventing a next game', () => {
  const war = new WarSimulation({masterSeed:'observation-final'});
  const observation = buildWarObservation({snapshot:{game:5,tick:30000,colonies:[0,1].map(colony=>({colony,player:colony,metrics:war.getMetrics(colony),doctrine:DEFAULT_DOCTRINE}))},player:1,models:['gpt','claude'],results:[0,1,'draw',0],terminal:true,winner:'draw',previous:null,settings:war.settings,rules:war.rules,remainingFood:[]});
  assert.equal(observation.gameOutcome.yourOutcome,'draw');
  assert.equal(observation.series.draws,2);
  assert.equal(observation.series.yourLosses,2);
  assert.equal(observation.series.yourWins,1);
  assert.equal(observation.series.finished,true);
  assert.equal(observation.series.gamesRemaining,0);
  assert.equal(observation.series.nextGameNumber,null);
});
