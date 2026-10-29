import { generateMaze, makeRng, makeSeeds } from '@stigsim/sim-core';
import { PEBBLE_BUDGET, MAZE_WIDTH, MAZE_HEIGHT, EXIT_X, EXIT_Y, directions, type Decision, type Observation, type NotebookCell } from '../../../shared/model-ant';
export const offsets = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] } as const;
export interface Maze { pebbles: Record<string, number>; carried: number; notebook: NotebookCell[]; seed: string; loopRate: number; cells: boolean[][]; x: number; y: number; turn: number; memory: string; lastResult: string; visited: string[] }
export function createMaze(seed: string | number, loopRate = 0.1): Maze {
  const master = String(seed).trim();
  if (!master || master.length > 128) throw new Error('Maze seed must contain 1–128 characters.');
  if (!Number.isFinite(loopRate) || loopRate < 0 || loopRate > 0.5) throw new Error('Loop rate must be between 0 and 0.5.');
  // Match the browser-only Maze Simulator's stream, layout, dimensions and carver exactly.
  const cells = generateMaze(loopRate, makeRng(makeSeeds(master).maze), 'random').map(row => row.map(cell => cell === 1));
  return recordSight({ pebbles: {}, carried: PEBBLE_BUDGET, notebook: [], seed: master, loopRate, cells,
    x: 1, y: 1, turn: 0, memory: '', lastResult: 'Starting at the nest.', visited: ['1,1'] }, true);
}
function recordSight(maze: Maze, entered: boolean): Maze {
  const known = new Map(maze.notebook.map(n => [`${n.x},${n.y}`, { ...n }]));
  for (const [dx, dy] of [[0, 0], ...Object.values(offsets)]) {
    const x = maze.x + dx, y = maze.y + dy;
    if (x < 0 || x >= MAZE_WIDTH || y < 0 || y >= MAZE_HEIGHT) continue;
    const key = `${x},${y}`;
    const cell = !maze.cells[y][x] ? 'wall' : x === EXIT_X && y === EXIT_Y ? 'exit' : 'passage';
    const visits = (known.get(key)?.visits ?? 0) + (entered && dx === 0 && dy === 0 ? 1 : 0);
    known.set(key, { x, y, cell, visits });
  }
  return { ...maze, notebook: [...known.values()] };
}
export function observe(maze: Maze): Observation {
  const neighbors = {} as Observation['neighbors'];
  for (const d of directions) {
    const [dx, dy] = offsets[d], x = maze.x + dx, y = maze.y + dy;
    neighbors[d] = !maze.cells[y]?.[x] ? 'wall' : x === EXIT_X && y === EXIT_Y ? 'exit' : 'passage';
  }
  return { pebbles: { carried: maze.carried, here: maze.pebbles[`${maze.x},${maze.y}`] ?? 0,
    neighbors: Object.fromEntries(directions.map(d => { const [dx, dy] = offsets[d]; return [d, maze.pebbles[`${maze.x + dx},${maze.y + dy}`] ?? 0]; })) as Record<typeof directions[number], number> }, notebook: maze.notebook.map(n => ({ ...n })), turn: maze.turn, position: { x: maze.x, y: maze.y }, neighbors, memory: maze.memory, lastResult: maze.lastResult };
}
export const solved = (maze: Maze) => maze.x === EXIT_X && maze.y === EXIT_Y;
export function move(maze: Maze, decision: Decision): Maze {
  if (solved(maze) || maze.turn >= 200) return maze;
  const pebbles = { ...maze.pebbles };
  const key = `${maze.x},${maze.y}`;
  let carried = maze.carried;
  let pebbleResult = 'Pebbles unchanged.';
  if (decision.pebbleAction === 'drop') {
    if (carried > 0) { pebbles[key] = (pebbles[key] ?? 0) + 1; carried--; pebbleResult = 'Dropped one pebble before moving.'; }
    else pebbleResult = 'Drop failed: no pebbles carried.';
  } else if (decision.pebbleAction === 'pick') {
    if ((pebbles[key] ?? 0) > 0) { pebbles[key]--; carried++; if (pebbles[key] === 0) delete pebbles[key]; pebbleResult = 'Picked up one pebble before moving.'; }
    else pebbleResult = 'Pick failed: no pebble here.';
  }
  const [dx, dy] = offsets[decision.direction];
  const blocked = observe(maze).neighbors[decision.direction] === 'wall';
  const x = maze.x + (blocked ? 0 : dx), y = maze.y + (blocked ? 0 : dy);
  return recordSight({ ...maze, pebbles, carried, x, y, turn: maze.turn + 1, memory: decision.memory,
    lastResult: `${pebbleResult} ${blocked ? 'Blocked by a wall. Stayed in place.' : `Moved ${decision.direction}.`}`,
    visited: [...new Set([...maze.visited, `${x},${y}`])] }, !blocked);
}
