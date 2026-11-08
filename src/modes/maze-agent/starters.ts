import type { Entry } from './contract';
export const STARTERS: Entry[] = [
  { format: 'stigsim-maze-agent@1', name: 'Depth-first explorer', parent: null,
    description: 'Build a visited-cell memory and backtrack through known passages. A working baseline to improve.',
    source: `function step(o, state) {
  const s = state || { seen: {}, backtrack: [] };
  const key = o.position.x + ',' + o.position.y;
  s.seen[key] = true;
  const delta = { N: [0,-1], E: [1,0], S: [0,1], W: [-1,0] };
  const opposite = { N: 'S', E: 'W', S: 'N', W: 'E' };
  for (const move of ['N','E','S','W']) {
    const [dx,dy] = delta[move];
    const next = (o.position.x+dx) + ',' + (o.position.y+dy);
    if (o.exits[move] && !s.seen[next]) {
      s.backtrack.push(opposite[move]);
      return { move, state: s };
    }
  }
  return { move: s.backtrack.pop() || 'N', state: s };
}` },
  { format: 'stigsim-maze-agent@1', name: 'Right-hand rule', parent: null,
    description: 'Follow the right-hand wall. Small memory, but loops may trap it. Compare with systematic exploration.',
    source: `function step(o, state) {
  const directions = ['N','E','S','W'];
  const facing = state?.facing ?? 1;
  for (const turn of [1,0,3,2]) {
    const index = (facing + turn) % 4;
    if (o.exits[directions[index]])
      return { move: directions[index], state: { facing: index } };
  }
  return { move: 'N', state: { facing } };
}` },
];
