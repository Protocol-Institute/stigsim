import { BUDGET, PRACTICE_SEEDS, RULES, type Entry } from './contract';
export function brief(entry: Entry, currentId: string | null = null) {
  return `Help me design an executable system for Stigsim's individual-agent maze benchmark ${RULES.id}.

Goal: find an unknown exit in unfamiliar ${RULES.cols}×${RULES.rows} mazes generated with loop rate ${RULES.loopRate}. Start at (1,1). Each evaluation maze has a reachable exit chosen uniformly among cells at least 12 path steps from the start. Its coordinates are hidden until reached. Up to ${RULES.stepLimit} movement attempts. One agent, no pheromones or other agents.

You may invent your own memory, learned-map representation, exploration/planning algorithm and rule-following system. Code may choose every move. Runtime model/network calls are not available in this version; use your AI during development to produce the executable JavaScript.

Implement synchronous function step(o, state), returning { move: 'N'|'E'|'S'|'W', state: JSON_VALUE }.
Only inputs: o.position={x,y} (reliable absolute cell coordinates; east increases x, south increases y), o.exits={N,E,S,W} booleans (immediate neighboring passages), o.step, o.stepLimit, o.atGoal, o.lastMove=null or {direction,moved}. A blocked move counts as a step, leaves position unchanged, and increments illegal-move count. The host stops automatically at the goal. No goal bearing, global walls, shortest-path distance, maze seed, evaluation index or other agent data is available. Use past observations to build your own map.

state starts null on EVERY maze. Only returned JSON persists between decisions; a fresh isolated QuickJS VM runs each decision. No hidden globals, modules, host callbacks, network, filesystem, timers, Date or Math.random. Implement any PRNG in explicit state. Shared limits: source ${BUDGET.sourceBytes} UTF-8 bytes; JSON state ${BUDGET.stateBytes} bytes; ${BUDGET.memoryBytes} VM bytes, ${BUDGET.stackBytes} stack bytes; ${BUDGET.fuelPerCall} interrupt callbacks per decision and ${BUDGET.fuelPerMaze} per maze; ${BUDGET.observationBytes} observation bytes per maze. Invalid decisions or budget errors end that maze with zero score.

Practice corpus (20 mazes, repeated debugging runs allowed): ${JSON.stringify(PRACTICE_SEEDS)}.
Freeze code before evaluating on 100 fresh mazes. No cross-evaluation-maze memory or revisions. The primary score is 100 * mean(solved ? shortestPathLength / movementAttempts : 0), including ALL mazes. Also report completion rate, successful-run steps, illegal moves, failures and compute. Shortest paths are host-only scoring data after each trial. Do not claim improvement from one practice maze or reuse local test feedback as held-out evidence.

Current entry content ID (use as parent when remixing): ${currentId ?? "not supplied; use null"}
Current entry:
${JSON.stringify(entry, null, 2)}

First explain your hypothesis and what local evidence/memory it needs. Return a complete importable JSON file with format='stigsim-maze-agent@1', name, description, parent (the current entry content ID above, or null if not supplied), and source containing step(o,state). Explain how to inspect the behavior during practice. Do not invent results.\n`;
}
