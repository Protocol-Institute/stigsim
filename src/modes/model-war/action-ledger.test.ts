import test from 'node:test';
import assert from 'node:assert/strict';
import { cloneDoctrine, DEFAULT_DOCTRINE } from '@stigsim/sim-core';
import { WarActionLedger, doctrineChanges } from '../../../shared/war-action-ledger';
import { WarSimulation } from '../war/war-simulation';
import { createLocalWarRecorder, localWarPlayerSource } from '../war/local-war-recording';
import type { WarPublicSnapshot } from '../../../shared/model-war';
function snapshot(war:WarSimulation,game=1):WarPublicSnapshot {
  return {game,tick:war.tick,colonies:[0,1].map(colony=>({colony,player:(colony+game-1)%2,metrics:war.getMetrics(colony),doctrine:war.simulation.colonies[colony].doctrine}))};
}
test('unchanged numeric doctrine stays a no-op even if model prose claims an intervention',()=>{
  const ledger=new WarActionLedger(),war=new WarSimulation({masterSeed:'ledger-no-op'});
  const entry=ledger.accept({snapshot:snapshot(war),player:0,requested:DEFAULT_DOCTRINE,accepted:DEFAULT_DOCTRINE,origin:'decision'});
  assert.deepEqual(entry.changes,[]);
  assert.equal(entry.status,'queued');
  ledger.confirm(1,0,[DEFAULT_DOCTRINE,DEFAULT_DOCTRINE]);assert.equal(entry.status,'queued');
  war.step();ledger.confirm(1,war.tick,war.simulation.colonies.map(c=>c.doctrine));
  assert.equal(entry.status,'applied');assert.equal(entry.confirmedAtTick,1);
  assert.equal(ledger.forPlayer(0).recentCommands[0].noNumericChange,true);
});
test('accepted numeric changes are runtime-confirmed and outcomes use observed metrics, never causation',()=>{
  const war=new WarSimulation({masterSeed:'ledger-change'}),recorder=createLocalWarRecorder(war.settings,[DEFAULT_DOCTRINE,DEFAULT_DOCTRINE]),ledger=new WarActionLedger();
  const doctrine=cloneDoctrine(DEFAULT_DOCTRINE);doctrine.evapRate=.02;
  const baseline=structuredClone(snapshot(recorder.runtime));
  recorder.command(localWarPlayerSource(0),{kind:'set-doctrine',colonyId:0,doctrine});
  const entry=ledger.accept({snapshot:baseline,player:0,requested:doctrine,accepted:doctrine,origin:'decision'});
  recorder.step();ledger.confirm(1,1,recorder.runtime.simulation.colonies.map(c=>c.doctrine));
  assert.equal(entry.status,'applied');assert.deepEqual(entry.changes,[{parameter:'evapRate',before:.005,after:.02}]);
  for(let i=1;i<500;i++)recorder.step();
  const after=snapshot(recorder.runtime);ledger.observe(after);
  assert.equal(entry.observedAfter?.actorMetricDeltas.foodCollected,after.colonies[0].metrics.foodCollected);
  assert.equal(entry.observedAfter?.elapsedTicks,500);
  assert.equal(entry.observedAfter?.causalAttribution,'not-established');
  ledger.observe({...after,tick:1000});assert.equal(entry.observedAfter?.toTick,500,'freeze the first subsequent outcome window');
  assert.equal(ledger.forPlayer(1).recentCommands[0].perspective,'opponent');
});
test('superseded opening commands are not credited; review proposals are not actions until accepted',()=>{
  const war=new WarSimulation({masterSeed:'ledger-opening'}),ledger=new WarActionLedger(),base=snapshot(war,2);
  const proposed=cloneDoctrine(DEFAULT_DOCTRINE);proposed.evapRate=.03;
  assert.equal(ledger.entries.length,0);
  const opening=ledger.accept({snapshot:base,player:1,requested:proposed,accepted:proposed,origin:'review-opening'});
  const final=cloneDoctrine(proposed);final.evapRate=.01;
  const next=ledger.accept({snapshot:base,player:1,requested:final,accepted:final,origin:'decision'});
  assert.equal(opening.status,'superseded-at-same-tick');
  ledger.confirm(2,1,[final,DEFAULT_DOCTRINE]);
  assert.equal(next.status,'applied');assert.equal(next.colonyId,0);
  assert.deepEqual(next.changes,[{parameter:'evapRate',before:.005,after:.01}]);
  const summary=ledger.forPlayer(1).gameSummaries[0].players[1];
  assert.equal(summary.confirmedCommands,1);assert.equal(summary.changedParameters[0].maximum,.01);
  assert.equal(opening.observedAfter,null);
  ledger.observe({...base,game:3,tick:500});assert.equal(next.observedAfter,null,'do not compare different games');
});
test('topology conformance and a runtime mismatch remain visible',()=>{
  const war=new WarSimulation({masterSeed:'ledger-conform'}),ledger=new WarActionLedger();
  const requested=cloneDoctrine(DEFAULT_DOCTRINE);requested.mimicRate=.8;
  const accepted=cloneDoctrine(requested);accepted.mimicRate=.5;
  const entry=ledger.accept({snapshot:snapshot(war),player:0,requested,accepted,origin:'decision'});
  assert.deepEqual(entry.topologyAdjustments,[{parameter:'mimicRate',before:.8,after:.5}]);
  ledger.confirm(1,1,[DEFAULT_DOCTRINE,DEFAULT_DOCTRINE]);
  assert.equal(entry.status,'unconfirmed');
  assert.equal(ledger.forPlayer(0).gameSummaries[0].players[0].confirmedCommands,0);
  assert.deepEqual(doctrineChanges(DEFAULT_DOCTRINE,DEFAULT_DOCTRINE),[]);
});
