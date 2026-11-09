import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { mazeMemoryPreviewRouter } from './maze-memory-preview';
import { STARTER } from '../../src/modes/maze-memory/starter';

const password = 'preview-test-password-only';
const authorization = `Basic ${Buffer.from(`preview:${password}`).toString('base64')}`;
const env = { NODE_ENV: 'production', MODEL_ANT_PREVIEW_ENABLED: 'true', MODEL_ANT_PREVIEW_PASSWORD: password,
  MAZE_MEMORY_MODEL: 'typesafeai-test', ANT_DECISION_BASE_URL: 'https://provider.test/typesafe/v1', ANT_MODEL_API_KEY: 'private-provider-token' };

test('memory preview requires enabled password access, rejects foreign origins, and preserves actual model decisions and idempotency', async () => {
  let calls = 0;
  const request: typeof fetch = async (_url, init) => {
    calls++;
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer private-provider-token');
    return Response.json({ answers: { action: { type: 'choice', choice: 'E' } }, usage: { input_tokens: 10, output_tokens: 2 } });
  };
  const app = express();
  app.use('/memory', mazeMemoryPreviewRouter(env, request));
  app.use('/disabled', mazeMemoryPreviewRouter({ ...env, MODEL_ANT_PREVIEW_ENABLED: 'false' }, request));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(r => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const headers = { Authorization: authorization, 'Content-Type': 'application/json', Origin: base };
  const post = (path: string, body: unknown) => fetch(base + '/memory' + path, { method: 'POST', headers, body: JSON.stringify(body) });
  try {
    assert.equal((await fetch(base + '/memory/status')).status, 401);
    assert.equal((await fetch(base + '/disabled/status', { headers })).status, 403);
    assert.equal((await fetch(base + '/memory/status', { headers: { ...headers, Origin: 'https://foreign.example' } })).status, 403);
    const status: any = await (await fetch(base + '/memory/status', { headers })).json();
    assert.equal(status.ready, true);
    assert.equal(status.model, 'typesafeai-test');
    assert.equal(JSON.stringify(status).includes(env.ANT_MODEL_API_KEY), false);
    const created = await post('/runs', { strategy: STARTER, limits: { requests: 2, movesPerMaze: 20 }, mode: 'practice', index: 0 });
    assert.equal(created.status, 201);
    const run: any = await created.json();
    assert.equal(calls, 0);
    const step = { maze: 0, step: 0, revision: 0 };
    assert.equal((await post(`/runs/${run.runId}/step`, step)).status, 200);
    assert.equal((await post(`/runs/${run.runId}/step`, step)).status, 200);
    assert.equal(calls, 1);
    const record: any = await (await fetch(base + `/memory/runs/${run.runId}/export`, { headers })).json();
    assert.equal(record.attempts[0].answer.move, 'E');
    assert.equal(record.attempts[0].applied, true);
    assert.equal(JSON.stringify(record).includes(env.ANT_MODEL_API_KEY), false);
    assert.equal((await fetch(base + `/memory/runs/${run.runId}`, { method: 'DELETE', headers })).status, 200);
    assert.equal((await fetch(base + `/memory/runs/${run.runId}`, { headers })).status, 404);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(r => server.close(() => r()));
  }
});
