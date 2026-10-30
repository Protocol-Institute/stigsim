import test from 'node:test';
import assert from 'node:assert/strict';
import { modelErrorMessage } from './provider-error';
test('upstream server failures give retry guidance rather than a quota diagnosis', () => {
 for (const status of [500,502,503,504]) {
  const message=modelErrorMessage(`Model provider returned HTTP ${status}. Check server configuration or quota.`);
  assert.match(message,/No move was applied/); assert.match(message,/One step/); assert.doesNotMatch(message,/Check server configuration or quota/);
 }
 assert.match(modelErrorMessage('Model provider returned HTTP 429.'),/rate or quota limit/);
 assert.equal(modelErrorMessage('Model conversation expired.'),'Model conversation expired.');
});
