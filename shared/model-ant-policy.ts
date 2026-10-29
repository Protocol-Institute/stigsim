import { directions, type Direction, type NotebookCell } from './model-ant';
export const EXPLORATION_POLICY = 'Take an adjacent unvisited passage when one exists. Otherwise, follow the shortest known route to a visited cell with an unexplored passage. Break ties north, east, south, west. Unvisited means a known non-wall cell with zero visits; unknown cells are not traversable in the known map. For equal-length routes, choose the route whose sequence of directions comes first in north, east, south, west order. If no unexplored passage is reachable, any passable move is allowed. Pebble use is up to you.';
export interface PolicyCheck { expectedDirection: Direction | null; actualDirection: Direction; compliant: boolean | null; basis: string }
export function checkExplorationPolicy(cells: NotebookCell[], position: { x: number; y: number }, actualDirection: Direction): PolicyCheck {
  const map = new Map(cells.map(c => [`${c.x},${c.y}`, c]));
  const offsets: Record<Direction, [number, number]> = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] };
  const adjacent = (p: { x: number; y: number }) => directions.map(direction => {
    const [dx, dy] = offsets[direction]; return { direction, cell: map.get(`${p.x + dx},${p.y + dy}`) };
  }).filter((item): item is { direction: Direction; cell: NotebookCell } => !!item.cell && item.cell.cell !== 'wall');
  const result = (expectedDirection: Direction | null, basis: string): PolicyCheck => ({ expectedDirection, actualDirection, compliant: expectedDirection === null ? null : actualDirection === expectedDirection, basis });
  const immediate = adjacent(position).find(n => n.cell.visits === 0);
  if (immediate) return result(immediate.direction, 'Adjacent unvisited passage');
  const seen = new Set([`${position.x},${position.y}`]);
  const queue: { cell: { x: number; y: number }; first?: Direction }[] = [{ cell: position }];
  for (let i = 0; i < queue.length; i++) {
    const current = queue[i];
    if (current.first && adjacent(current.cell).some(n => n.cell.visits === 0)) return result(current.first, 'Shortest known route to an unexplored passage');
    for (const next of adjacent(current.cell)) {
      const key = `${next.cell.x},${next.cell.y}`;
      if (next.cell.visits === 0 || seen.has(key)) continue;
      seen.add(key); queue.push({ cell: next.cell, first: current.first ?? next.direction });
    }
  }
  return result(null, 'No reachable unexplored passage; no prescribed direction');
}

export const POLICY_ACTION_QUESTION = 'Which action follows the supplied policy? Treat its movement rules and tie-breaks as mandatory, taking priority over the general speed and cost objective. Pebble use remains up to you.';

export function checkRightHand(neighbors: import('./model-ant').AgentObservation['neighbors'], heading: Direction, actualDirection: Direction): PolicyCheck {
  const index = directions.indexOf(heading);
  const expectedDirection = [1, 0, 3, 2].map(offset => directions[(index + offset) % 4]).find(direction => neighbors[direction] !== 'wall') ?? null;
  return { expectedDirection, actualDirection, compliant: expectedDirection === null ? null : actualDirection === expectedDirection, basis: `Right-hand wall following; heading ${heading}` };
}
