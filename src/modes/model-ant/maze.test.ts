import test from 'node:test';
import assert from 'node:assert/strict';
import { createMaze, observe, move, solved, offsets } from './maze';
import { generateMaze, makeRng, makeSeeds, mazeMode, DEFAULT_PARAMS } from '@stigsim/sim-core';
import { EXIT_X, EXIT_Y, MAZE_WIDTH, MAZE_HEIGHT, directions, isObservation, parseDecision } from '../../../shared/model-ant';
test('shared seeded mazes are reproducible and the exit remains reachable', () => {
  for (const seed of [0, 1, 42, 4294967295]) {
    const maze = createMaze(seed);
    assert.deepEqual(maze, createMaze(seed));
    const seen = new Set(['1,1']); const queue = [[1, 1]];
    for (let i = 0; i < queue.length; i++) {
      const [x, y] = queue[i];
      for (const [dx, dy] of Object.values(offsets)) {
        const nx = x + dx, ny = y + dy, key = `${nx},${ny}`;
        if (maze.cells[ny]?.[nx] && !seen.has(key)) { seen.add(key); queue.push([nx, ny]); }
      }
    }
    assert.ok(seen.has(`${EXIT_X},${EXIT_Y}`));
    // Shared loop punching may create isolated open pockets; preserve its terrain exactly.
    assert.ok(seen.size > 1);
  }
});
test('observation contains only local cells and explicit memory, never the maze or seed', () => {
  const maze = createMaze(42), before = observe(maze);
  assert.deepEqual(Object.keys(before).sort(), ['lastResult','memory','neighbors','notebook','pebbles','position','turn']);
  maze.cells[EXIT_Y][EXIT_X] = false;
  assert.deepEqual(observe(maze), before);
  assert.equal(isObservation(before), true);
  assert.equal(isObservation({ ...before, memory: 'x'.repeat(2001) }), false);
});
test('model choices govern movement; wall attempts count, and terminal states freeze', () => {
  const maze = createMaze(42);
  const blocked = move(maze, { direction: 'north', pebbleAction: 'none', reason: '', memory: 'remember' });
  assert.equal(blocked.x, 1); assert.equal(blocked.y, 1); assert.equal(blocked.turn, 1);
  assert.equal(blocked.memory, 'remember');
  const direction = directions.find(d => observe(maze).neighbors[d] !== 'wall')!;
  const next = move(maze, { direction, pebbleAction: 'none', reason: '', memory: '' });
  assert.notDeepEqual([next.x, next.y], [1, 1]);
  const end = { ...maze, x: EXIT_X, y: EXIT_Y }; assert.ok(solved(end));
  assert.equal(move(end, { direction, pebbleAction: 'none', reason: '', memory: '' }), end);
  const capped = { ...maze, turn: 200 }; assert.equal(move(capped, { direction, pebbleAction: 'none', reason: '', memory: '' }), capped);
  assert.throws(() => parseDecision({ direction: 'teleport', memory: '', pebbleAction: 'none', reason: '' }));
});

test('invalid model fields report the exact problem without silently changing memory', () => {
  const valid = { direction: 'east' as const, pebbleAction: 'none' as const, reason: 'explore', memory: 'start' };
  assert.throws(() => parseDecision({ ...valid, direction: 'E' }), /invalid direction/);
  assert.throws(() => parseDecision({ ...valid, pebbleAction: 'none', reason: {} }), /explanation must be text/);
  assert.throws(() => parseDecision({ ...valid, pebbleAction: 'none', reason: 'a'.repeat(301) }), /explanation exceeded 300/);
  assert.throws(() => parseDecision({ ...valid, memory: {} }), /memory must be text/);
  assert.throws(() => parseDecision({ ...valid, memory: 'a'.repeat(2001) }), /memory exceeded 2000/);
  assert.deepEqual(parseDecision(valid), valid);
});

test('notebook records only sensed cells and counts entries, not wall attempts', () => {
  const start = createMaze(42);
  assert.equal(start.notebook.length, 5);
  assert.ok(!start.notebook.some(n => n.x === EXIT_X && n.y === EXIT_Y));
  const east = move(start, { direction: 'south', pebbleAction: 'none', reason: '', memory: '' });
  assert.equal(east.notebook.find(n => n.x === 1 && n.y === 2)?.visits, 1);
  const back = move(east, { direction: 'north', pebbleAction: 'none', reason: '', memory: '' });
  assert.equal(back.notebook.find(n => n.x === 1 && n.y === 1)?.visits, 2);
  const wall = move(back, { direction: 'west', pebbleAction: 'none', reason: '', memory: '' });
  assert.deepEqual(wall.notebook, back.notebook);
  assert.equal(start.notebook.find(n => n.x === 1 && n.y === 1)?.visits, 1);
  const observation = observe(back);
  observation.notebook[0].visits = 99;
  assert.equal(back.notebook[0].visits, 2);
  assert.equal(isObservation({ ...observe(back), notebook: [...back.notebook, back.notebook[0]] }), false);
  assert.equal(isObservation({ ...observe(back), notebook: [{ x: 99, y: 0, cell: 'passage', visits: 0 }] }), false);
});

test('pebbles persist in the environment, obey inventory, and are sensed only locally', () => {
  let maze = createMaze(42);
  const action = { direction: 'south' as const, pebbleAction: 'drop' as const, reason: 'mark start', memory: '' };
  const marked = move(maze, action);
  assert.equal(marked.pebbles['1,1'], 1);
  assert.equal(marked.carried, 11);
  assert.equal(observe(marked).pebbles.neighbors.north, 1);
  assert.equal(maze.carried, 12);
  maze = move(marked, { ...action, direction: 'north', pebbleAction: 'none' });
  assert.equal(observe(maze).pebbles.here, 1);
  maze = move(maze, { ...action, pebbleAction: 'pick' });
  assert.equal(maze.carried, 12);
  assert.equal(maze.pebbles['1,1'], undefined);
  maze = move(maze, { ...action, pebbleAction: 'pick' });
  assert.match(maze.lastResult, /Pick failed/);
  assert.equal(maze.carried, 12);
  assert.equal(isObservation(observe(maze)), true);
  const far = { ...maze, pebbles: { [`${EXIT_X},${EXIT_Y}`]: 12 }, carried: 0 };
  assert.deepEqual(observe(far).pebbles, { carried: 0, here: 0, neighbors: { north: 0, east: 0, south: 0, west: 0 } });
  assert.equal(isObservation({ ...observe(maze), pebbles: { ...observe(maze).pebbles, carried: 13 } }), false);
  assert.throws(() => parseDecision({ ...action, pebbleAction: 'paint' }), /invalid pebble action/);
});

test('stacking, empty inventory and wall attempts conserve pebbles', () => {
  let maze = createMaze(42);
  const drop = { direction: 'north' as const, pebbleAction: 'drop' as const, reason: '', memory: '' };
  for (let i = 0; i < 12; i++) maze = move(maze, drop);
  assert.equal(maze.pebbles['1,1'], 12);
  assert.equal(maze.carried, 0);
  const exhausted = move(maze, drop);
  assert.match(exhausted.lastResult, /Drop failed/);
  assert.equal(exhausted.pebbles['1,1'], 12);
  assert.equal(exhausted.carried + Object.values(exhausted.pebbles).reduce((a, b) => a + b, 0), 12);
  assert.equal(isObservation(observe(exhausted)), true);
  const reset = createMaze(42);
  assert.equal(reset.carried, 12);
  assert.deepEqual(reset.pebbles, {});
});

test('Model Ant matches the browser-only simulator terrain for the same master seed and loop rate', () => {
  for (const seed of ['42', 'quiet-ember-1000']) {
    for (const loopRate of [0, 0.1, 0.5]) {
      const maze = createMaze(seed, loopRate);
      const expected = generateMaze(loopRate, makeRng(makeSeeds(seed).maze), 'random');
      assert.equal(maze.cells.length, MAZE_HEIGHT);
      assert.equal(maze.cells[0].length, MAZE_WIDTH);
      assert.deepEqual(maze.cells, expected.map(row => row.map(cell => cell === 1)));
      const browser = mazeMode.create({ seeds: makeSeeds(seed), numAnts: 1, params: { ...DEFAULT_PARAMS },
        loopRate, numColonies: 1, numFoodSources: 1, foodPerSource: 500 });
      for (let y = 0; y < MAZE_HEIGHT; y++) for (let x = 0; x < MAZE_WIDTH; x++) {
        assert.equal(maze.cells[y][x], browser.occupancy.isOpen(x, y));
      }
    }
  }
  assert.deepEqual(createMaze(' 42 '), createMaze(42));
  assert.notDeepEqual(createMaze('42', 0).cells, createMaze('42', 0.5).cells);
  assert.throws(() => createMaze(''), /seed/);
  assert.throws(() => createMaze('42', -0.1), /Loop rate/);
  assert.throws(() => createMaze('42', Number.NaN), /Loop rate/);
});

test('larger-maze coordinates validate and the exit is observed only when adjacent', () => {
  const maze = createMaze(42);
  assert.equal(isObservation(observe({ ...maze, x: EXIT_X, y: EXIT_Y - 1 })), true);
  assert.equal(observe({ ...maze, x: EXIT_X, y: EXIT_Y - 1 }).neighbors.south, 'exit');
  assert.equal(observe(maze).neighbors.south, 'passage');
  assert.equal(isObservation({ ...observe(maze), position: { x: MAZE_WIDTH, y: 1 } }), false);
});
