import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { modelAntRouter } from './model-ant';
import { AgentRequestError, createAgentSession, requestAgentStep } from './model-ant-agent';
import { createMaze, observe, move } from '../../src/modes/model-ant/maze';
import { agentObservation } from '../../shared/model-ant';
import type { AddressInfo } from 'node:net';
const config = { base: 'https://example.test/v1', model: 'test-model' };
const observation = () => agentObservation(observe(createMaze(42)));
function reply(name = 'act', args: unknown = { direction: 'east', pebbleAction: 'none' }, content: string | null = null) {
  return Response.json({ usage: { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 },
    choices: [{ finish_reason: 'tool_calls', message: { content, tool_calls: [{ id: 'call-1', type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }] });
}

test('endpoint forwards only local sensing, requires run identity, and disables production inference', async () => {
  let payload: any;
  const mock: typeof fetch = async (_url, options) => { payload = JSON.parse(String(options?.body)); return reply(); };
  const app = express(); app.use(express.json());
  app.use('/dev', modelAntRouter({ ANT_MODEL_BASE_URL: config.base, ANT_MODEL: config.model, NODE_ENV: 'development' }, mock));
  app.use('/prod', modelAntRouter({ ANT_MODEL_BASE_URL: config.base, ANT_MODEL: config.model, NODE_ENV: 'production' }, mock));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (path: string, body: unknown) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const body = { runId: 'test-run-001', observation: { ...observation(), notebook: ['secret'], memory: 'never forward', secretMap: 'hidden' } };
    const result = await post('/dev/step', body);
    assert.equal(result.status, 200);
    assert.equal(((await result.json()) as { decision: { direction: string } }).decision.direction, 'east');
    assert.deepEqual(JSON.parse(payload.messages[1].content), observation());
    assert.equal(payload.response_format, undefined);
    assert.equal(payload.tools[0].function.name, 'act');
    assert.deepEqual(payload.tools[0].function.parameters.required, ['direction', 'pebbleAction']);
    assert.equal((await post('/dev/step', {})).status, 400);
    assert.equal((await post('/prod/step', body)).status, 503);
    assert.equal((await post('/dev/step', { ...body, runId: 'unknown-run', observation: { ...observation(), turn: 1 } })).status, 409);
    assert.equal((await fetch(base + '/dev/sessions/test-run-001', { method: 'DELETE' })).status, 204);
    assert.equal((await post('/dev/step', { ...body, observation: { ...observation(), turn: 1 } })).status, 409);
  } finally { await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())); }
});

test('conversation retains actual prior actions and observations, isolates runs, and retries without another charge', async () => {
  const payloads: any[] = [];
  const mock: typeof fetch = async (_url, options) => { payloads.push(JSON.parse(String(options?.body))); return reply(); };
  const session = createAgentSession();
  const first = await requestAgentStep(session, observation(), config, mock);
  assert.equal(first.decision.reason, ''); assert.equal(first.decision.memory, '');
  assert.deepEqual(first.usage, { requests: 1, inputTokens: 50, outputTokens: 10, totalTokens: 60 });
  assert.equal(await requestAgentStep(session, observation(), config, mock), first);
  assert.equal(payloads.length, 1);
  const next = agentObservation(observe(move(createMaze(42), first.decision)));
  await requestAgentStep(session, next, config, mock);
  assert.equal(payloads[1].messages[2].role, 'assistant');
  assert.equal(payloads[1].messages[2].tool_calls[0].function.name, 'act');
  assert.equal(payloads[1].messages[3].role, 'tool');
  assert.deepEqual(JSON.parse(payloads[1].messages[3].content), { ...next, previousRequestUsage: first.usage });
  assert.equal(payloads[1].messages[1].content, JSON.stringify(observation()));
  await requestAgentStep(createAgentSession(), observation(), config, mock);
  assert.equal(payloads[2].messages.length, 2);
  await assert.rejects(() => requestAgentStep(session, { ...next, turn: 8 }, config, mock), /out of sync/);
});

test('model may speak or compact on its own; summaries replace history without becoming system instructions', async () => {
  const session = createAgentSession(), payloads: any[] = [];
  let count = 0;
  const mock: typeof fetch = async (_url, options) => {
    payloads.push(JSON.parse(String(options?.body)));
    count++;
    if (count === 1) return Response.json({ usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      choices: [{ message: { content: 'I will try the eastern passage.' } }] });
    if (count === 2) return reply('compact_context', { summary: 'At start. East open; all 12 pebbles carried.' });
    return reply('act', { direction: 'east', pebbleAction: 'drop' });
  };
  const step = await requestAgentStep(session, observation(), config, mock);
  assert.equal(step.compactions, 1);
  assert.equal(step.usage.requests, 3); assert.equal(step.usage.totalTokens, 135);
  assert.deepEqual(step.events.map(e => e.type), ['explanation', 'compaction', 'action']);
  assert.equal(payloads[2].messages[1].role, 'assistant');
  assert.match(payloads[2].messages[1].content, /At start/);
  assert.equal(payloads[2].messages[2].content, JSON.stringify(observation()));
  assert.ok(!JSON.stringify(payloads[2]).includes('I will try'));
  assert.equal(step.decision.pebbleAction, 'drop');
});

test('invalid or stalled model replies do not advance context and missing usage is never reported as zero', async () => {
  const session = createAgentSession();
  await assert.rejects(() => requestAgentStep(session, observation(), config, async () => reply('act', { direction: 'teleport', pebbleAction: 'drop' })), /invalid direction/);
  assert.equal(session.expectedTurn, 0); assert.equal(session.messages.length, 0);
  let calls = 0;
  await assert.rejects(() => requestAgentStep(session, observation(), config, async () => {
    calls++; return Response.json({ choices: [{ message: { content: 'Still here.' } }] });
  }), (error: unknown) => {
    assert.ok(error instanceof AgentRequestError);
    assert.equal(error.usage.totalTokens, null);
    assert.equal(error.usage.requests, 6);
    return true;
  });
  assert.equal(calls, 6); assert.equal(session.messages.length, 0);
  const step = await requestAgentStep(session, observation(), config, async () => {
    const response = await reply().json() as Record<string, unknown>; delete response.usage;
    return Response.json(response);
  });
  assert.equal(step.usage.totalTokens, null);
  assert.equal(step.events.some(e => e.type === 'explanation'), false);
});

test('model-authored policy persists across moves and compaction, records revisions, and may be cleared', async () => {
  const payloads: any[] = [];
  const responses = [
    () => reply('update_policy', { policy: 'My own marker convention: one pebble denotes a branch to revisit.' }),
    () => reply('act', { direction: 'south', pebbleAction: 'drop' }),
    () => reply('compact_context', { summary: 'At (1,2), north and south are passages.' }),
    () => reply('act', { direction: 'south', pebbleAction: 'none' }),
    () => reply('update_policy', { policy: 'Revised approach: retain a record of unexplored branches.' }),
    () => reply('act', { direction: 'east', pebbleAction: 'none' }),
    () => reply('update_policy', { policy: '' }),
    () => reply('act', { direction: 'east', pebbleAction: 'none' }),
  ];
  const mock: typeof fetch = async (_url, options) => {
    payloads.push(JSON.parse(String(options?.body)));
    return responses.shift()!();
  };
  const session = createAgentSession();
  assert.equal(session.policy, ''); assert.equal(session.policyRevision, 0);
  let maze = createMaze(42);
  const first = await requestAgentStep(session, agentObservation(observe(maze)), config, mock);
  assert.equal(first.policyRevision, 1);
  assert.equal(first.events[0].type, 'policy'); assert.equal(first.events[0].previousPolicy, '');
  assert.equal(payloads[1].messages[1].role, 'assistant');
  assert.match(payloads[1].messages[1].content, /My own marker convention/);
  assert.equal(payloads[1].messages[0].content.includes('My own marker convention'), false);
  const retry = await requestAgentStep(session, agentObservation(observe(maze)), config, mock);
  assert.equal(retry, first); assert.equal(session.policyRevision, 1); assert.equal(payloads.length, 2);
  maze = move(maze, first.decision);
  const compacted = await requestAgentStep(session, agentObservation(observe(maze)), config, mock);
  assert.equal(compacted.compactions, 1); assert.equal(compacted.policy, first.policy);
  assert.match(payloads[3].messages[1].content, /My own marker convention/);
  assert.equal(payloads[3].messages[2].role, 'assistant');
  assert.match(payloads[3].messages[2].content, /At \(1,2\)/);
  assert.equal(compacted.events.some(e => e.type === 'policy'), false);
  maze = move(maze, compacted.decision);
  const revised = await requestAgentStep(session, agentObservation(observe(maze)), config, mock);
  assert.equal(revised.policyRevision, 2);
  assert.equal(revised.events[0].previousPolicy, first.policy);
  assert.equal(revised.events[0].text, revised.policy);
  maze = move(maze, revised.decision);
  const cleared = await requestAgentStep(session, agentObservation(observe(maze)), config, mock);
  assert.equal(cleared.policy, ''); assert.equal(cleared.policyRevision, 3);
  assert.equal(cleared.events[0].previousPolicy, revised.policy);
  assert.match(payloads[7].messages[1].content, /revision 3.*\n\(blank\)/);
  assert.equal(createAgentSession().policy, '');
});

test('invalid policies and failed action sequences cannot overwrite the committed policy', async () => {
  const session = createAgentSession();
  session.policy = 'Existing policy'; session.policyRevision = 2;
  for (const invalid of [null, 12, 'x'.repeat(8001)]) {
    await assert.rejects(() => requestAgentStep(session, observation(), config, async () => reply('update_policy', { policy: invalid })), /invalid policy/);
    assert.equal(session.policy, 'Existing policy'); assert.equal(session.policyRevision, 2);
  }
  let calls = 0;
  await assert.rejects(() => requestAgentStep(session, observation(), config, async () => {
    calls++;
    return calls === 1 ? reply('update_policy', { policy: 'Proposed change' }) : reply('act', { direction: 'teleport', pebbleAction: 'none' });
  }), /invalid direction/);
  assert.equal(session.policy, 'Existing policy'); assert.equal(session.policyRevision, 2);
  assert.equal(session.messages.length, 0); assert.equal(session.expectedTurn, 0);
});

test('Claude gateway requests omit the unsupported parallel_tool_calls field', async () => {
  let payload: any;
  const mock: typeof fetch = async (_url, options) => { payload = JSON.parse(String(options?.body)); return reply(); };
  await requestAgentStep(createAgentSession(), observation(), { ...config, model: 'claude-sonnet-4-6' }, mock);
  assert.equal(Object.hasOwn(payload, 'parallel_tool_calls'), false);
  assert.equal(payload.tools.some((tool: any) => tool.function.name === 'update_policy'), true);
  await requestAgentStep(createAgentSession(), observation(), { ...config, model: 'gpt-5-mini' }, mock);
  assert.equal(payload.parallel_tool_calls, false);
});

test('Jev selects from all 12 options, reports probabilities, retains local history, and caches retries', async () => {
  const { requestSelectionStep } = await import('./model-ant-selection');
  const { ACTION_OPTIONS } = await import('../../shared/model-ant');
  const session = createAgentSession(); const payloads: any[] = []; const urls: string[] = [];
  const mock: typeof fetch = async (url, options) => {
    urls.push(String(url)); payloads.push(JSON.parse(String(options?.body)));
    return Response.json({ model: 'jev-1.14.0', answers: { action: { type: 'choice', choice: 'south_drop', confidence: 0.8,
      probabilities: Object.fromEntries(ACTION_OPTIONS.map(o => [o.id, o.id === 'south_drop' ? 0.8 : o.id === 'south_none' ? 0.2 : 0])) } },
      usage: { input_tokens: 100, output_tokens: 10 } });
  };
  const cfg = { ...config, decisionBase: 'https://example.test/typesafe/v1', model: 'typesafeai-jev-1-14-0' };
  const first = await requestSelectionStep(session, { ...observation(), secretMap: 'never forward' } as any, cfg, mock);
  assert.equal(urls[0], 'https://example.test/typesafe/v1/systemone');
  assert.equal(Object.keys(payloads[0].questions.action.criteria).length, 12);
  assert.ok(Object.hasOwn(payloads[0].questions.action.criteria, 'north_pick')); // No legality filtering.
  assert.equal(payloads[0].state.observation.secretMap, undefined);
  assert.deepEqual(payloads[0].state.observation, observation());
  assert.equal(first.decision.direction, 'south'); assert.equal(first.decision.pebbleAction, 'drop');
  assert.equal(first.selection?.confidence, 0.8); assert.equal(first.selection?.probabilities?.south_drop, 0.8);
  assert.equal(first.usage.inputTokens, 100); assert.equal(first.usage.totalTokens, 110);
  assert.equal(first.policy, ''); assert.equal(first.events.some(e => e.type === 'policy'), false);
  assert.equal(await requestSelectionStep(session, observation(), cfg, mock), first); assert.equal(payloads.length, 1);
  const next = agentObservation(observe(move(createMaze(42), first.decision)));
  await requestSelectionStep(session, next, cfg, mock);
  assert.deepEqual(payloads[1].state.history, [{ observation: observation(), action: 'south_drop' }]);
  assert.deepEqual(payloads[1].state.observation, next);
  assert.equal(session.selectionHistory?.length, 2);
  assert.equal(createAgentSession().selectionHistory, undefined);
});

test('chat comparison receives identical state and options through only the selection tool', async () => {
  const { requestSelectionStep, selectionState } = await import('./model-ant-selection');
  const { ACTION_OPTIONS } = await import('../../shared/model-ant');
  let payload: any;
  const mock: typeof fetch = async (_url, options) => {
    payload = JSON.parse(String(options?.body)); return reply('select_action', { action: 'north_pick' });
  };
  const step = await requestSelectionStep(createAgentSession(), observation(), { ...config, decisionBase: '', model: 'claude-sonnet-4-6' }, mock);
  const supplied = JSON.parse(payload.messages[1].content);
  assert.deepEqual(supplied.state, selectionState(createAgentSession(), observation()));
  assert.deepEqual(Object.keys(supplied.question.criteria), ACTION_OPTIONS.map(o => o.id));
  assert.deepEqual(payload.tools.map((t: any) => t.function.name), ['select_action']);
  assert.equal(Object.hasOwn(payload, 'parallel_tool_calls'), false);
  assert.equal(step.selection?.probabilities, null); assert.equal(step.selection?.confidence, null);
  const next = move(createMaze(42), step.decision);
  assert.match(next.lastResult, /Pick failed/); assert.match(next.lastResult, /Blocked/);
});

test('invalid choices/probabilities and provider errors never advance selection history', async () => {
  const { requestSelectionStep } = await import('./model-ant-selection');
  const cfg = { ...config, decisionBase: 'https://example.test/typesafe/v1', model: 'typesafeai-jev-1-14-0' };
  for (const action of [
    { type: 'choice', choice: 'teleport_none' },
    { type: 'choice', choice: 'south_none', confidence: 1.5 },
    { type: 'choice', choice: 'south_none', probabilities: { south_none: -1 } },
    { type: 'choice', choice: 'south_none', probabilities: { unknown: 1 } },
  ]) {
    const session = createAgentSession();
    await assert.rejects(() => requestSelectionStep(session, observation(), cfg, async () => Response.json({ answers: { action } })), /Model/);
    assert.equal(session.expectedTurn, 0); assert.equal(session.selectionHistory, undefined);
  }
  const session = createAgentSession();
  await assert.rejects(() => requestSelectionStep(session, observation(), cfg, async () => Response.json({ error: 'limited' }, { status: 429 })), /HTTP 429/);
  assert.equal(session.expectedTurn, 0);
  await assert.rejects(() => requestSelectionStep(session, { ...observation(), turn: 2 }, cfg), /out of sync/);
});

test('map assistance uses only session observations, is supplied to Jev, and is recorded for export', async () => {
  const { requestSelectionStep, selectionState } = await import('./model-ant-selection');
  const raw = createAgentSession();
  assert.equal('observedMap' in selectionState(raw, observation()), false);
  const assisted = createAgentSession(); assisted.observationSupport = 'observed-map';
  let supplied: any;
  const mock: typeof fetch = async (_url, options) => {
    supplied = JSON.parse(String(options?.body));
    return Response.json({ answers: { action: { type: 'choice', choice: 'south_none' } } });
  };
  const cfg = { base: 'http://chat/v1', decisionBase: 'http://decision/v1', model: 'typesafeai-jev-1-14-0' };
  const step = await requestSelectionStep(assisted, observation(), cfg, mock);
  assert.deepEqual(step.observedMap, supplied.state.observedMap);
  assert.equal(step.observationSupport, 'observed-map');
  assert.match(supplied.state.rules, /Zero visits/);
  assert.equal(supplied.state.history.length, 0);
  assert.equal(supplied.state.observedMap.length, 5);
  assert.equal(supplied.state.observedMap.filter((c: any) => c.visits > 0).length, 1);
  assert.equal(supplied.state.observedMap.some((c: any) => c.x === 29 && c.y === 29), false);
  assert.strictEqual(await requestSelectionStep(assisted, observation(), cfg, mock), step);
});

test('observation support cannot be changed inside a selection run, including a cached retry', async () => {
  let requests = 0;
  const mock: typeof fetch = async () => { requests++; return Response.json({ answers: { action: { type: 'choice', choice: 'south_none' } } }); };
  const app = express(); app.use(express.json());
  app.use(modelAntRouter({ ANT_MODEL: 'typesafeai-jev-1-14-0', ANT_DECISION_BASE_URL: 'http://decision/v1' }, mock));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (support: string) => fetch(base + '/step', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ runId: 'support-test-001', observation: observation(), observationSupport: support }) });
  try {
    assert.equal((await post('observed-map')).status, 200);
    assert.equal((await post('raw-history')).status, 409);
    assert.equal((await post('observed-map')).status, 200);
    assert.equal((await post('invented')).status, 400);
    assert.equal(requests, 1);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});

test('explicit policy is supplied to Jev but evaluation never changes its chosen action', async () => {
 const { requestSelectionStep } = await import('./model-ant-selection');
 const { EXPLORATION_POLICY, POLICY_ACTION_QUESTION } = await import('../../shared/model-ant-policy');
 const session = createAgentSession(); session.observationSupport = 'observed-map'; session.suppliedPolicy = 'exploration-v1';
 const step = await requestSelectionStep(session, observation(), { base:'http://chat/v1',decisionBase:'http://decision/v1',model:'typesafeai-jev-1-14-0' }, async (_url, options) => {
   const body = JSON.parse(String(options?.body)); assert.equal(body.state.policy, EXPLORATION_POLICY);
   assert.equal(body.questions.action.instructions, POLICY_ACTION_QUESTION);
   assert.equal(body.state.policyCheck, undefined);
   return Response.json({answers:{action:{type:'choice',choice:'north_none'}}});
 });
 assert.equal(step.decision.direction,'north'); assert.equal(step.policyCheck?.expectedDirection,'south');
 assert.equal(step.policyCheck?.compliant,false); assert.equal(step.suppliedPolicy,EXPLORATION_POLICY);
});


test('chat selection uses the mandatory policy question and records the exact instruction', async () => {
 const { requestSelectionStep } = await import('./model-ant-selection');
 const { POLICY_ACTION_QUESTION } = await import('../../shared/model-ant-policy');
 const session = createAgentSession(); session.observationSupport = 'observed-map'; session.suppliedPolicy = 'exploration-v1';
 const step = await requestSelectionStep(session, observation(), { base:'http://chat/v1', decisionBase:'', model:'gpt-5-mini' }, async (_url, options) => {
   const body = JSON.parse(String(options?.body));
   assert.equal(JSON.parse(body.messages[1].content).question.instructions, POLICY_ACTION_QUESTION);
   return reply('select_action', {action:'south_none'});
 });
 assert.equal(step.actionQuestion, POLICY_ACTION_QUESTION);
});

test('setup validates model allowlist and custom strategy and locks all settings per run', async () => {
 let served = ''; let policy = '';
 const mock: typeof fetch = async (_url, options) => { const body = JSON.parse(String(options?.body)); served = body.model; policy = JSON.parse(body.messages[1].content).state.policy; return reply('select_action',{action:'south_none'}); };
 const app = express(); app.use(express.json());
 app.use(modelAntRouter({ANT_MODEL:'test-model',ANT_MODEL_BASE_URL:config.base,ANT_ALLOWED_MODELS:'other-model'},mock));
 const server=app.listen(0,'127.0.0.1'); await new Promise<void>(resolve=>server.once('listening',resolve));
 const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
 const body={runId:'setup-run-001',observation:observation(),model:'other-model',experimentMode:'selection',suppliedPolicy:'custom',customPolicy:'Prefer south.',initialHeading:'east'};
 const post=(patch:object={})=>fetch(base+'/step',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,...patch})});
 try {
  assert.deepEqual(((await (await fetch(base+'/status')).json()) as {models:string[]}).models,['test-model','other-model']);
  assert.equal((await post({model:'unapproved'})).status,400);
  assert.equal((await post({customPolicy:' '})).status,400);
  const result=await post(); assert.equal(result.status,200); const step=await result.json() as {policyCheck?:unknown};
  assert.equal(served,'other-model');assert.equal(policy,'Prefer south.');assert.equal(step.policyCheck,undefined);
  assert.equal((await post({model:'test-model'})).status,409);
  assert.equal((await post({customPolicy:'Prefer north.'})).status,409);
  assert.equal((await post({initialHeading:'north'})).status,409);
 } finally { await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve())); }
});

test('right-hand heading follows actual movement and stays unchanged after a blocked attempt', async () => {
 const {selectionState}=await import('./model-ant-selection');
 const session=createAgentSession(); session.suppliedPolicy='right-hand'; session.initialHeading='east';
 const start=observation();
 session.selectionHistory=[{observation:start,action:'north_none'}];
 assert.equal(selectionState(session,{...start,turn:1}).heading,'east');
 session.selectionHistory.push({observation:{...start,turn:1},action:'south_none'});
 assert.equal(selectionState(session,{...start,turn:2,position:{x:1,y:2}}).heading,'south');
});

test('policy-authoring mode routes chat models to agent tools and rejects Jev authoring', async () => {
 let tools: string[]=[];
 const mock: typeof fetch=async (_url, options)=>{ tools=JSON.parse(String(options?.body)).tools.map((tool: any)=>tool.function.name); return reply(); };
 const app=express();app.use(express.json());app.use(modelAntRouter({ANT_MODEL:'typesafeai-jev-1-14-0',ANT_DECISION_BASE_URL:'http://decision/v1',ANT_MODEL_BASE_URL:config.base,ANT_ALLOWED_MODELS:'gpt-5-mini'},mock));
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
 const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
 const post=(patch:object)=>fetch(base+'/step',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({runId:'authoring-run-001',observation:observation(),experimentMode:'agent',...patch})});
 try {
  assert.equal((await post({model:'typesafeai-jev-1-14-0'})).status,400);
  assert.equal((await post({model:'gpt-5-mini',observationSupport:'observed-map'})).status,400);
  assert.equal((await post({model:'gpt-5-mini'})).status,200);
  assert.ok(tools.includes('update_policy'));assert.ok(tools.includes('compact_context'));assert.ok(tools.includes('act'));
  assert.equal((await post({model:'gpt-5-mini',experimentMode:'selection'})).status,409);
 } finally {await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
});

test('production preview requires explicit enablement and shared authentication before inference', async () => {
 let requests=0;
 const mock:typeof fetch=async()=>{requests++;return reply();};
 const app=express();app.use(express.json());
 const env={NODE_ENV:'production',ANT_MODEL:config.model,ANT_MODEL_BASE_URL:config.base,MODEL_ANT_PREVIEW_ENABLED:'true',MODEL_ANT_PREVIEW_PASSWORD:'test-preview-password-long'};
 app.use(modelAntRouter(env,mock));
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
 const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
 try {
  assert.equal((await fetch(base+'/status')).status,401);
  const auth='Basic '+Buffer.from('preview:'+env.MODEL_ANT_PREVIEW_PASSWORD).toString('base64');
  assert.equal((await fetch(base+'/status',{headers:{authorization:auth}})).status,200);
  const body=JSON.stringify({runId:'protected-run-001',observation:observation()});
  assert.equal((await fetch(base+'/step',{method:'POST',headers:{'Content-Type':'application/json'},body})).status,401);
  assert.equal(requests,0);
  assert.equal((await fetch(base+'/step',{method:'POST',headers:{'Content-Type':'application/json',authorization:auth},body})).status,200);
  assert.equal(requests,1);
 } finally {await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
});
