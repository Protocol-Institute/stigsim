import { COLS, ROWS } from '@stigsim/sim-core';
export const MAZE_WIDTH = COLS;
export const MAZE_HEIGHT = ROWS;
export const EXIT_X = COLS - 2;
export const EXIT_Y = ROWS - 2;
export const directions = ['north', 'east', 'south', 'west'] as const;
export type Direction = typeof directions[number];
export const PEBBLE_BUDGET = 12;
export const pebbleActions = ['none', 'drop', 'pick'] as const;
export type PebbleAction = typeof pebbleActions[number];
export type Cell = 'wall' | 'passage' | 'exit';
export interface NotebookCell { x: number; y: number; cell: Cell; visits: number }
export interface Observation {
  pebbles: { carried: number; here: number; neighbors: Record<Direction, number> };
  notebook: NotebookCell[];
  turn: number;
  position: { x: number; y: number };
  neighbors: Record<Direction, Cell>;
  memory: string;
  lastResult: string;
}
export interface Decision { pebbleAction: PebbleAction; direction: Direction; reason: string; memory: string }
export const ANT_PROMPT = `You are one ant trying to find an exit in an unknown maze. You see only your current coordinates and the four adjacent cells. North decreases y; east increases x. You have no full map, exit coordinates, or hidden information. Your notebook automatically records only cells you have personally seen and how often you entered each cell. A passage with zero visits has been seen but not entered. Missing coordinates are unknown. Use this evidence to distinguish unexplored branches from revisits; backtrack when necessary. Choose one adjacent non-wall direction. You start carrying 12 identical reusable pebbles. Each turn choose pebbleAction: none, drop (place ONE carried pebble on your CURRENT cell BEFORE moving), or pick (take ONE pebble from your CURRENT cell BEFORE moving). You can stack pebbles; they persist until picked up. You sense exact counts only here and in the four adjacent cells, plus how many you carry. A drop with no carried pebbles or a pick from an empty cell fails but your move still happens. Invent and use your own pebble strategy to help find the exit; pebble counts have no built-in meaning. Explain your marking choices briefly in reason. In addition to the notebook, your private working memory is the memory string you return (maximum 2000 characters). Use it to remember explored paths and backtrack. Return ONLY a JSON object with pebbleAction (none/drop/pick), direction (north/east/south/west), reason (a brief action explanation, maximum 300 characters), and memory. Do not use markdown.`;
export function isObservation(value: unknown): value is Observation {
  if (!value || typeof value !== 'object') return false;
  const v = value as Observation;
  return Number.isInteger(v.turn) && v.turn >= 0 && v.turn < 200 &&
    !!v.position && Number.isInteger(v.position.x) && Number.isInteger(v.position.y) &&
    v.position.x >= 0 && v.position.x < MAZE_WIDTH && v.position.y >= 0 && v.position.y < MAZE_HEIGHT &&
    !!v.pebbles && Number.isInteger(v.pebbles.carried) && v.pebbles.carried >= 0 && v.pebbles.carried <= PEBBLE_BUDGET &&
    Number.isInteger(v.pebbles.here) && v.pebbles.here >= 0 && v.pebbles.here <= PEBBLE_BUDGET &&
    !!v.pebbles.neighbors && directions.every(d => Number.isInteger(v.pebbles.neighbors[d]) && v.pebbles.neighbors[d] >= 0 && v.pebbles.neighbors[d] <= PEBBLE_BUDGET) &&
    v.pebbles.carried + v.pebbles.here + directions.reduce((sum, d) => sum + v.pebbles.neighbors[d], 0) <= PEBBLE_BUDGET &&
    typeof v.memory === 'string' && v.memory.length <= 2000 &&
    typeof v.lastResult === 'string' && v.lastResult.length <= 100 &&
    Array.isArray(v.notebook) && v.notebook.length > 0 && v.notebook.length <= MAZE_WIDTH * MAZE_HEIGHT &&
    v.notebook.every(n => n && Number.isInteger(n.x) && n.x >= 0 && n.x < MAZE_WIDTH &&
      Number.isInteger(n.y) && n.y >= 0 && n.y < MAZE_HEIGHT && ['wall', 'passage', 'exit'].includes(n.cell) &&
      Number.isInteger(n.visits) && n.visits >= 0 && n.visits <= 201 && (n.cell !== 'wall' || n.visits === 0)) &&
    new Set(v.notebook.map(n => `${n.x},${n.y}`)).size === v.notebook.length &&
    !!v.neighbors && directions.every(d => ['wall', 'passage', 'exit'].includes(v.neighbors[d]));
}
export function parseDecision(value: unknown): Decision {
  if (!value || typeof value !== 'object') throw new Error('Model must return a JSON decision.');
  const v = value as Decision;
  if (!directions.includes(v.direction)) throw new Error('Model returned an invalid direction. Expected north, east, south, or west. No move was applied.');
  if (typeof v.reason !== 'string') throw new Error('Model explanation must be text. No move was applied.');
  if (v.reason.length > 300) throw new Error(`Model explanation exceeded 300 characters (${v.reason.length}). No move was applied.`);
  if (typeof v.memory !== 'string') throw new Error('Model memory must be text. No move was applied.');
  if (v.memory.length > 2000) throw new Error(`Model memory exceeded 2000 characters (${v.memory.length}). No move was applied.`);
  if (!pebbleActions.includes(v.pebbleAction)) throw new Error('Model returned an invalid pebble action. Expected none, drop, or pick. No action was applied.');
  return { pebbleAction: v.pebbleAction, direction: v.direction, reason: v.reason, memory: v.memory };
}

export const DECISION_RESPONSE_FORMAT = {
  type: 'json_schema',
  json_schema: {
    name: 'ant_decision', strict: true,
    schema: {
      type: 'object', additionalProperties: false,
      properties: {
        pebbleAction: { type: 'string', enum: [...pebbleActions] },
        direction: { type: 'string', enum: [...directions] },
        reason: { type: 'string', maxLength: 300 },
        memory: { type: 'string', maxLength: 2000 },
      },
      required: ['pebbleAction', 'direction', 'reason', 'memory'],
    },
  },
};

// Agent experiment v3: local sensing only; history belongs to the conversation.
export type AgentObservation = Pick<Observation, 'turn' | 'position' | 'neighbors' | 'pebbles' | 'lastResult'>;
export function agentObservation(observation: Observation): AgentObservation {
  const { turn, position, neighbors, pebbles, lastResult } = observation;
  return { turn, position: { ...position }, neighbors: { ...neighbors },
    pebbles: { carried: pebbles.carried, here: pebbles.here, neighbors: { ...pebbles.neighbors } }, lastResult };
}
export function isAgentObservation(value: unknown): value is AgentObservation {
  if (!value || typeof value !== 'object') return false;
  const v = value as AgentObservation;
  return isObservation({ ...v, memory: '', notebook: [{ ...v.position, cell: 'passage', visits: 1 }] });
}
export const AGENT_PROMPT = `Solve the maze as fast and cheaply as possible: minimize elapsed time, movement and model usage. How you use your conversation context and pebbles is up to you.`;
export const AGENT_RULES = `You control one ant in an unknown ${MAZE_WIDTH} by ${MAZE_HEIGHT} maze. Find and enter the exit. You receive only your coordinates, adjacent cells, nearby pebble counts and the last action result. North decreases y, east increases x. You do not know the exit coordinates. You carry 12 identical reusable pebbles. Use act to move one cell and optionally drop or pick up ONE pebble on your CURRENT cell BEFORE moving. Pebbles persist and can stack. Failed transfers still allow movement; walls block movement. Counts are visible only here and in adjacent cells. Your conversation is retained. You also have a separate persistent policy document, initially blank. You may write, replace or clear it with update_policy; its structure and contents are entirely up to you. The current policy is supplied on every model request and survives context compaction. It guides your own choices; it does not execute actions. You may replace older context with a brief factual summary using compact_context. You may provide a brief public explanation when useful, but no explanation or journal is required. The interface pauses after each act for observation. The run ends at the exit or 200 movement attempts.`;
export const MAX_POLICY_CHARACTERS = 8000;
export const AGENT_TOOLS = [
  { type: 'function', function: { name: 'act', description: 'Move one cell and optionally transfer one pebble on the departure cell.', strict: true,
    parameters: { type: 'object', additionalProperties: false, properties: {
      direction: { type: 'string', enum: [...directions] },
      pebbleAction: { type: 'string', enum: [...pebbleActions] },
    }, required: ['direction', 'pebbleAction'] } } },
  { type: 'function', function: { name: 'update_policy', description: 'Replace your persistent free-form policy document. You choose its contents and when to revise it. Empty text clears it. It survives context compaction. This is a public strategy artifact, not a reasoning trace.', strict: true,
    parameters: { type: 'object', additionalProperties: false, properties: {
      policy: { type: 'string', maxLength: MAX_POLICY_CHARACTERS },
    }, required: ['policy'] } } },
  { type: 'function', function: { name: 'compact_context', description: 'Replace older conversation with your brief factual continuation summary to reduce future context cost. Current observation is retained. Do not include a reasoning trace.', strict: true,
    parameters: { type: 'object', additionalProperties: false, properties: {
      summary: { type: 'string', maxLength: 12000 },
    }, required: ['summary'] } } },
];
export interface AgentUsage { requests: number; inputTokens: number | null; outputTokens: number | null; totalTokens: number | null }
export interface AgentEvent { type: 'explanation' | 'compaction' | 'action' | 'policy'; text: string; revision?: number; previousPolicy?: string }
export interface AgentStep {
  actionQuestion?: string;
  suppliedPolicy?: string;
  policyCheck?: import('./model-ant-policy').PolicyCheck;
  observationSupport?: 'raw-history' | 'observed-map';
  observedMap?: NotebookCell[];
  selection?: { action: string; confidence: number | null; probabilities: Record<string, number> | null };
  servedModel?: string;
  policy: string;
  policyRevision: number;
  decision: Decision;
  events: AgentEvent[];
  usage: AgentUsage;
  contextMessages: number;
  compactions: number;
  summary: string;
  model: string;
  elapsedMs: number;
}

export const SELECTION_MODELS = ['typesafeai-jev-1-14-0', 'openjev-qwen35-4b'] as const;
export function isDecisionModel(model: string): boolean { return (SELECTION_MODELS as readonly string[]).includes(model); }
export const ACTION_OPTIONS = directions.flatMap(direction => pebbleActions.map(pebbleAction => ({
  id: `${direction}_${pebbleAction}`,
  direction, pebbleAction,
  description: `Move one cell ${direction}; ${pebbleAction === 'none' ? 'leave pebbles unchanged' : pebbleAction === 'drop' ? 'drop one carried pebble on the CURRENT cell before moving' : 'pick up one pebble from the CURRENT cell before moving'}.`,
})));
export const SELECTION_RULES = `You control one ant in an unknown ${MAZE_WIDTH} by ${MAZE_HEIGHT} maze. Find and enter the exit. You see only your coordinates, adjacent cells, local pebble counts and the last action result. North decreases y; east increases x. You carry 12 reusable identical pebbles. Drop or pick transfers ONE pebble on the current cell BEFORE movement; markers persist and stack. Invalid transfers fail but movement proceeds; walls block movement. Your full history of observations and actions is supplied. Choose one of the 12 listed actions. No policy-writing, context-compaction tools, automatic map or visit counts are supplied. The run ends at the exit or 200 movement attempts.`;
export const ACTION_QUESTION = 'Which action should the ant take next to solve the maze as fast and cheaply as possible, minimizing elapsed time, movement and model usage?';
export const SELECT_ACTION_TOOL = { type: 'function', function: { name: 'select_action', description: ACTION_QUESTION, strict: true,
  parameters: { type: 'object', additionalProperties: false, properties: {
    action: { type: 'string', enum: ACTION_OPTIONS.map(option => option.id) },
  }, required: ['action'] } } };

// Factual aid derived exclusively from observations, never from the maze grid.
export function buildObservedMap(observations: AgentObservation[]): NotebookCell[] {
  const cells = new Map<string, NotebookCell>();
  const offsets = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] };
  let previous: { x: number; y: number } | undefined;
  for (const observation of observations) {
    const { x, y } = observation.position;
    const key = `${x},${y}`;
    const current = cells.get(key) ?? { x, y, cell: 'passage', visits: 0 };
    // A blocked attempt or repeated observation is not another entry into a cell.
    if (!previous || previous.x !== x || previous.y !== y) current.visits++;
    cells.set(key, current);
    for (const direction of directions) {
      const [dx, dy] = offsets[direction];
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= MAZE_WIDTH || ny >= MAZE_HEIGHT) continue;
      const neighborKey = `${nx},${ny}`;
      cells.set(neighborKey, { x: nx, y: ny, cell: observation.neighbors[direction], visits: cells.get(neighborKey)?.visits ?? 0 });
    }
    previous = observation.position;
  }
  return [...cells.values()].sort((a, b) => a.y - b.y || a.x - b.x);
}
export const OBSERVED_MAP_RULES = SELECTION_RULES.replace('No policy-writing, context-compaction tools, automatic map or visit counts are supplied.',
  'An observedMap is supplied automatically alongside your full history. It records only cells you have observed: cell type and number of entries (visits). Zero visits means observed but never entered; missing cells are unknown. Blocked attempts do not increase visits. This is factual bookkeeping, not a navigation policy. No policy-writing or context-compaction tools are supplied.');
