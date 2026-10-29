import test from 'node:test';
import assert from 'node:assert/strict';
import { buildObservedMap, type AgentObservation } from '../../../shared/model-ant';
const observation = (turn: number, x = 1, y = 1): AgentObservation => ({ turn, position: { x, y },
  neighbors: { north: 'wall', east: 'passage', south: 'passage', west: 'wall' },
  pebbles: { carried: 12, here: 0, neighbors: { north: 0, east: 0, south: 0, west: 0 } }, lastResult: '' });
test('observed map exposes only observed cells and distinguishes entry from sight and blocked attempts', () => {
  const first = observation(0);
  const blocked = observation(1);
  const east = observation(2, 2, 1); east.neighbors.west = 'passage'; east.neighbors.east = 'exit';
  const back = observation(3);
  const cells = buildObservedMap([first, blocked, east, back]);
  assert.deepEqual(cells.find(c => c.x === 1 && c.y === 1), { x: 1, y: 1, cell: 'passage', visits: 2 });
  assert.equal(cells.find(c => c.x === 2 && c.y === 1)?.visits, 1);
  assert.deepEqual(cells.find(c => c.x === 3 && c.y === 1), { x: 3, y: 1, cell: 'exit', visits: 0 });
  assert.equal(cells.find(c => c.x === 1 && c.y === 2)?.visits, 0);
  assert.equal(cells.find(c => c.x === 29 && c.y === 29), undefined);
  assert.equal(new Set(cells.map(c => `${c.x},${c.y}`)).size, cells.length);
});
