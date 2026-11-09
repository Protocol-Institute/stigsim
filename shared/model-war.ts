import { isDoctrine, type Doctrine } from '@stigsim/sim-core';
export const OBSERVATION_TICKS = 500;
export const GAME_TICK_LIMIT = 30000;
export interface WarDecision { doctrine: Doctrine; analysis: string; memory: string }
export function validateWarDecision(value: unknown): WarDecision {
  const v = value as WarDecision;
  if (!v || !isDoctrine(v.doctrine) || typeof v.analysis !== 'string' || v.analysis.length > 2000 || typeof v.memory !== 'string' || v.memory.length > 4000) throw new Error('Invalid model doctrine or strategy notes. No changes applied.');
  return structuredClone(v);
}
export function seriesFinished(results: readonly (number | 'draw')[]): boolean {
  return results.length >= 5 || [0, 1].some(id => results.filter(r => r === id).length >= 3);
}
export const WAR_MODEL_RULES = `You control one colony in a two-model War series, best of five games (first to three wins, maximum five games; draws consume a game). Last colony standing wins. At 30000 ticks an unfinished game is a draw. Both players observe the same frozen snapshot every 500 ticks and choose simultaneously. You see public colony metrics and doctrines, remaining food, bounded spatial measurements when available, and explicit metric deltas since the previous observation, not private opponent notes. Select a complete doctrine through submit_strategy. At review phases analyze the completed game and plan improvements for the next game. Your private memory is carried between decisions and games; other context is not retained. Doctrine v=1 contains forager and spoiler tables. Each has follow[state searching/returning][channel home/food][origin own/enemy] signed half-step weights (-32..32), with absolute row sum across both channels and origins <=32. Each has lay[state][channel]={own:integer 0..3,mimic:0 or 1}; forager mimic must be zero. spoilerFraction, mimicRate, evapRate are 0..1. Positive follow weights attract, negative repel; zero ignores a signal. Searching ants normally lay home and follow food, returning ants lay food and follow home. Spoilers can follow enemy signals and mimic their food trail. Energy, reserves, reproduction and starvation are automatic, not adjustable. Return concise strategic explanations, not a reasoning trace. Use only evidence supplied. The explicit you/opponent fields, gameOutcome and series history are authoritative over your private memory. On every turn correct mistaken identity, game number, score or outcome in your memory. In reviews name the actual outcome and compare metric changes before proposing improvements. Do not count the reviewed game twice or invent completed games. Use spatialEvidence when supplied: inspect route deliveries, circulation examples, depleted-source traffic, pheromone hotspots and maze distances. Respect the window warmingUp flag; avoid strong claims from short histories. Do not treat possibleHighway or possibleCirculation as a confirmed diagnosis. Distinguish observed facts from strategic hypotheses; do not claim a causal benefit from a single correlated change. Consult actionLedger before discussing previous actions. Only confirmed accepted doctrine changes were executed; prose is not execution. If changes is empty, you kept the doctrine. Correct any memory that claims an unexecuted change. In your analysis describe the exact numeric changes actually returned in submit_strategy, then separate the measured outcome from a causal hypothesis. Use gameSummaries to review the whole game rather than comparing only final doctrines. Review decisions are next-game proposals until accepted in that game. You may keep the current doctrine. Maps use fresh seeded mirrored layouts each game and colony seats alternate. All other match settings stay fixed.`;

export interface WarColonyObservation {
  colony: number;
  player: number;
  metrics: import('../src/modes/war/war-simulation').WarColonyMetrics;
  doctrine: Doctrine;
}
export interface WarPublicSnapshot {
  game: number;
  tick: number;
  colonies: WarColonyObservation[];
}

/** Give each player an explicit perspective, independent of its current colony seat. */
export function buildWarObservation(input: {
  snapshot: WarPublicSnapshot;
  player: number;
  models: readonly string[];
  results: readonly (number | 'draw')[];
  terminal: boolean;
  winner: number | 'draw';
  previous: WarPublicSnapshot | null;
  spatialEvidence?: import("../src/modes/model-war/spatial").WarFieldObservation;
  actionLedger?: ReturnType<import("./war-action-ledger").WarActionLedger["forPlayer"]>;
  settings: unknown;
  rules: unknown;
  remainingFood: unknown;
}) {
  const {snapshot, player, models, results, terminal, winner, previous} = input;
  const own = snapshot.colonies.find(c => c.player === player)!;
  const opponent = snapshot.colonies.find(c => c.player !== player)!;
  if (!own || !opponent) throw new Error('Both player identities are required.');
  const outcome = (result: number | 'draw') => result === 'draw' ? 'draw' as const : result === player ? 'won' as const : 'lost' as const;
  const completedResults = terminal ? [...results, winner] : [...results];
  const completedGames = completedResults.map((result, index) => ({
    gameNumber: index + 1,
    yourOutcome: outcome(result),
    winnerPlayerId: result === 'draw' ? null : result,
    winnerModel: result === 'draw' ? null : models[result],
  }));
  const wins = completedGames.filter(g => g.yourOutcome === 'won').length;
  const losses = completedGames.filter(g => g.yourOutcome === 'lost').length;
  const draws = completedGames.filter(g => g.yourOutcome === 'draw').length;
  const finished = seriesFinished(completedResults);
  const describe = (colony: WarColonyObservation) => ({
    playerId: colony.player, playerLabel: `Player ${colony.player + 1}`,
    model: models[colony.player], colonyId: colony.colony, colonyLabel: `Colony ${colony.colony + 1}`,
    metrics: colony.metrics, doctrine: colony.doctrine,
  });
  const delta = (colony: WarColonyObservation) => {
    const before = previous?.game === snapshot.game ? previous.colonies.find(c => c.player === colony.player) : undefined;
    if (!before) return null;
    return Object.fromEntries(Object.entries(colony.metrics).flatMap(([key, value]) => {
      const old = before.metrics[key as keyof typeof before.metrics];
      return typeof value === 'number' && typeof old === 'number' ? [[key, value - old]] : [];
    }));
  };
  return structuredClone({
    observationVersion: 4,
    actionLedger: input.actionLedger ?? null,
    authoritativeFacts: 'This observation is the source of truth. Correct any conflicting private memory. Player IDs stay fixed; colony seats alternate each game. Never infer identity from array order.',
    gameNumber: snapshot.game, tick: snapshot.tick, phase: terminal ? 'review' : 'play',
    you: describe(own), opponent: describe(opponent),
    gameOutcome: terminal ? {
      yourOutcome: outcome(winner), winnerPlayerId: winner === 'draw' ? null : winner,
      winnerModel: winner === 'draw' ? null : models[winner],
      explanation: winner === 'draw' ? 'Game drawn: both colonies eliminated or tick limit reached.' : `You ${outcome(winner)}. ${models[winner]} is the last colony standing. Food collected does not determine the winner.`,
    } : {yourOutcome: 'in-progress', explanation: 'This game has not ended. No winner has been declared.'},
    series: {
      completedGames, completedGameCount: completedGames.length,
      yourWins: wins, yourLosses: losses, draws,
      gamesRemaining: Math.max(0, 5 - completedGames.length), winsNeededForThree: Math.max(0, 3 - wins),
      finished, nextGameNumber: terminal && !finished ? snapshot.game + 1 : null,
      reviewIncludesCurrentGame: terminal,
    },
    changesSincePreviousObservation: previous?.game === snapshot.game ? {
      fromTick: previous.tick, toTick: snapshot.tick, elapsedTicks: snapshot.tick - previous.tick,
      yourMetricDeltas: delta(own), opponentMetricDeltas: delta(opponent),
    } : null,
    spatialEvidence: input.spatialEvidence ? {...input.spatialEvidence, colonies: input.spatialEvidence.colonies.map(c => ({...c, playerId:snapshot.colonies.find(colony=>colony.colony===c.colonyId)!.player, perspective:c.colonyId===own.colony?'you':'opponent'}))} : null,
    evidenceLimits: input.spatialEvidence ? 'Spatial measurements are bounded, sampled evidence. Possible highways and circulation are heuristics, not confirmed diagnoses. Use playerId/perspective to identify colonies. Maze distance does not establish that an ant can make a trip within its energy budget. No image is supplied. Correlation does not establish spoiler causation.' : 'You receive colony metrics, doctrines and food locations, not maze connectivity, ant trajectories or measured pheromone fields. Route efficiency, source accessibility and effects of spoilers are hypotheses unless directly supported by supplied evidence. Higher trail-follow weights change steering, not movement speed. A food or population lead does not guarantee survival.',
    settings: input.settings, rules: input.rules, remainingFood: input.remainingFood,
  });
}
