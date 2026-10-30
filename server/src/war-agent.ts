import { cloneDoctrine, type Doctrine } from "@stigsim/sim-core";
import { PRESETS, activePresetName } from "../../src/doctrine-presets";
import type { WarSnapshot } from "../../shared/war-contract";
import {
  WAR_AGENT_PROTOCOL,
  WAR_AGENT_PROTOCOL_VERSION,
  type WarAgentCandidate,
  type WarAgentDecision,
  type WarAgentEvidence,
  type WarAgentPresetName,
  type WarAgentSituation,
  type WarAgentState,
} from "../../shared/war-agent-contract";

const SAMPLE_INTERVAL = 25;
const DECISION_INTERVAL = 300;
const HISTORY_TICKS = 500;
const MAX_DECISIONS = 10;

interface HistoryAnt {
  id: number;
  x: number;
  y: number;
  hasFood: boolean;
}

interface HistorySample {
  tick: number;
  foodCollected: number;
  ants: HistoryAnt[];
}

export interface WarAgentObservation {
  tick: number;
  deliveryRate: number;
  deliveryTrend: number;
  reservePerAnt: number;
  lowEnergyFraction: number;
  populationLead: number;
  staleTrailFraction: number;
  staleTrafficFraction: number;
  possibleMillFraction: number;
  activeFoodSources: number;
  depletedFoodSources: number;
}

export interface WarAgentChoice {
  situation: WarAgentSituation;
  summary: string;
  evidence: WarAgentEvidence[];
  candidates: WarAgentCandidate[];
  selected: WarAgentPresetName;
  confidence: number;
  expected: string;
}

export interface WarAgentStep {
  decision: WarAgentDecision;
  doctrine: Doctrine | null;
}

/** Host-facing seam; a future remote/LLM driver can queue work and return completed decisions without blocking ticks. */
export interface WarAgentController {
  readonly colonyId: number;
  advance(snapshot: WarSnapshot): WarAgentStep | null;
  state(): WarAgentState;
}

const round = (value: number, digits = 2) => Number(value.toFixed(digits));
const ratio = (value: number, total: number) => total > 0 ? value / total : 0;
const clampScore = (value: number) => Math.max(0, Math.min(1, value));

function preset(name: WarAgentPresetName, snapshot: WarSnapshot) {
  const found = PRESETS.find(candidate => candidate.name === name && candidate.available(snapshot.settings.topology));
  if (!found) throw new Error(`Agent preset ${name} is unavailable for this match topology`);
  return found;
}

/**
 * A mill is productive-looking motion without progress: an ant travels a
 * substantial distance, repeatedly turns back across its own route, and ends
 * near where the observation window began.  Do not require a tiny set of
 * unique cells; a wide circular mill can visit a new cell at every sample.
 */
export function isPossibleMillTrajectory(positions: HistoryAnt[]): boolean {
  if (positions.length < 6 || positions.some(point => point.hasFood)) return false;
  let pathLength = 0;
  let reversals = 0;
  let previousDx = 0;
  let previousDy = 0;
  for (let index = 1; index < positions.length; index++) {
    const dx = positions[index].x - positions[index - 1].x;
    const dy = positions[index].y - positions[index - 1].y;
    pathLength += Math.abs(dx) + Math.abs(dy);
    if (index > 1 && dx * previousDx + dy * previousDy < 0) reversals++;
    if (dx !== 0 || dy !== 0) {
      previousDx = dx;
      previousDy = dy;
    }
  }
  const first = positions[0];
  const last = positions.at(-1)!;
  const netDisplacement = Math.abs(last.x - first.x) + Math.abs(last.y - first.y);
  const progressRatio = ratio(netDisplacement, pathLength);
  const roundedCells = positions.map(point => `${Math.round(point.x)},${Math.round(point.y)}`);
  const revisitRatio = 1 - new Set(roundedCells).size / roundedCells.length;

  // Covers both tight mills (many revisits) and broad loops (low net progress
  // after substantial travel). Reversals keep ordinary slow exploration from
  // being mislabeled when sampling happens to catch it near its start.
  return pathLength >= 10
    && progressRatio <= 0.35
    && (revisitRatio >= 0.2 || reversals >= 2 || netDisplacement <= 3);
}

function millFraction(history: HistorySample[], current: HistorySample): number {
  if (history.length < 5 || current.ants.length === 0) return 0;
  const samples = [...history, current];
  let milling = 0;
  for (const ant of current.ants) {
    const positions = samples.flatMap(sample => {
      const point = sample.ants.find(candidate => candidate.id === ant.id);
      return point ? [point] : [];
    });
    if (isPossibleMillTrajectory(positions)) milling++;
  }
  return ratio(milling, current.ants.length);
}

export function observeWarAgent(snapshot: WarSnapshot, history: HistorySample[], colonyId: number): WarAgentObservation {
  const colony = snapshot.colonies[colonyId];
  const opponent = snapshot.colonies[colonyId === 0 ? 1 : 0];
  const earliest = history[0];
  const recent = history.length > 1 ? history[Math.floor(history.length / 2)] : earliest;
  const elapsed = earliest ? Math.max(1, snapshot.tick - earliest.tick) : 1;
  const recentElapsed = recent ? Math.max(1, snapshot.tick - recent.tick) : 1;
  const deliveryRate = earliest ? (colony.metrics.foodCollected - earliest.foodCollected) / elapsed : 0;
  const recentRate = recent ? (colony.metrics.foodCollected - recent.foodCollected) / recentElapsed : deliveryRate;
  const earlierRate = earliest && recent && recent.tick > earliest.tick
    ? (recent.foodCollected - earliest.foodCollected) / (recent.tick - earliest.tick)
    : deliveryRate;
  const active = snapshot.foodSources.filter(source => source.remaining > 0);
  const depleted = snapshot.foodSources.filter(source => source.remaining <= 0);
  const cols = snapshot.grid[0]?.length ?? 0;
  let totalTrail = 0;
  let staleTrail = 0;
  for (let index = 0; index < colony.foodPhero.length; index++) {
    const strength = colony.foodPhero[index];
    totalTrail += strength;
    if (depleted.some(source => Math.abs(index % cols - source.x) + Math.abs(Math.floor(index / cols) - source.y) <= 4)) {
      staleTrail += strength;
    }
  }
  const searching = colony.ants.filter(ant => ant.phase === "searching");
  const staleTraffic = searching.filter(ant => depleted.some(source =>
    Math.abs(Math.round(ant.x) - source.x) + Math.abs(Math.round(ant.y) - source.y) <= 4)).length;
  const current: HistorySample = {
    tick: snapshot.tick,
    foodCollected: colony.metrics.foodCollected,
    ants: colony.ants.map(ant => ({ id: ant.id, x: ant.x, y: ant.y, hasFood: ant.hasFood })),
  };
  return {
    tick: snapshot.tick,
    deliveryRate,
    deliveryTrend: recentRate - earlierRate,
    reservePerAnt: ratio(colony.metrics.reserve, colony.metrics.population),
    lowEnergyFraction: ratio(colony.metrics.lowEnergy, colony.metrics.population),
    populationLead: ratio(colony.metrics.population - opponent.metrics.population, Math.max(1, opponent.metrics.population)),
    staleTrailFraction: ratio(staleTrail, totalTrail),
    staleTrafficFraction: ratio(staleTraffic, searching.length),
    possibleMillFraction: millFraction(history, current),
    activeFoodSources: active.length,
    depletedFoodSources: depleted.length,
  };
}

export function scoreWarAgentDecision(
  observation: WarAgentObservation,
  currentPreset: WarAgentPresetName,
  availablePresets: WarAgentPresetName[],
): WarAgentChoice {
  const scores = new Map<WarAgentPresetName, number>();
  const reasons = new Map<WarAgentPresetName, string[]>();
  const start = (name: WarAgentPresetName, score: number) => {
    if (!availablePresets.includes(name)) return;
    scores.set(name, score);
    reasons.set(name, []);
  };
  start("Default", 0.4);
  start("Highway", 0.4);
  start("Scout", 0.35);
  start("Volatile", 0.35);
  start("Saboteur", 0.3);
  start("Poacher", 0.25);
  const add = (name: WarAgentPresetName, amount: number, reason: string) => {
    if (!scores.has(name)) return;
    scores.set(name, scores.get(name)! + amount);
    reasons.get(name)!.push(reason);
  };

  if (observation.deliveryRate > 0.01 && observation.deliveryTrend >= -0.002) {
    add("Highway", 0.35, "Food delivery is established and stable enough to exploit.");
  }
  if (observation.deliveryRate <= 0.005 && observation.tick >= 600 && observation.activeFoodSources > 0) {
    add("Scout", 0.4, "Food remains, but recent delivery is weak.");
  }
  if (observation.staleTrailFraction > 0.2 && observation.staleTrafficFraction > 0.12) {
    add("Volatile", 0.45, "A meaningful share of trail and traffic remains near depleted food.");
  }
  if (observation.possibleMillFraction > 0.1) {
    add("Volatile", 0.7, "Several ants are moving in closed, unproductive loops.");
    add("Default", -0.2, "Default trail memory can preserve an established mill.");
    add("Highway", -0.3, "Stronger trail commitment can reinforce an established mill.");
  }
  if (observation.populationLead > 0.2 && observation.reservePerAnt > 5 && observation.lowEnergyFraction < 0.1) {
    add("Saboteur", 0.4, "The colony has enough population and reserve to fund interference.");
  }
  if (observation.reservePerAnt < 4 || observation.lowEnergyFraction > 0.25) {
    add("Default", 0.4, "Energy pressure favors dependable foraging over specialization.");
    add("Saboteur", -0.5, "Energy pressure makes interference too expensive.");
  }
  if (observation.deliveryRate <= 0.005 && observation.activeFoodSources > 0) {
    add("Poacher", 0.12, "Enemy trails may reveal food while our delivery is weak.");
  }
  add(currentPreset, 0.15, "Doctrine inertia avoids switching without a material advantage.");

  const candidates = [...scores].map(([name, score]) => ({
    preset: name,
    score: round(clampScore(score)),
    reasons: reasons.get(name)!.length ? reasons.get(name)! : ["No strong supporting signal."],
  })).sort((a, b) => b.score - a.score || a.preset.localeCompare(b.preset));
  const selected = candidates[0]?.preset ?? currentPreset;
  const confidence = candidates.length > 1 ? clampScore(0.5 + (candidates[0].score - candidates[1].score)) : 1;

  let situation: WarAgentSituation = "exploring";
  let summary = "The colony is still establishing useful routes.";
  let expected = "Increase useful food discovery before the next review.";
  if (observation.reservePerAnt < 4 || observation.lowEnergyFraction > 0.25) {
    situation = "under-pressure";
    summary = "Energy and reserve pressure make reliable foraging the priority.";
    expected = "Stabilize reserve per ant and reduce the low-energy share.";
  } else if (observation.possibleMillFraction > 0.1) {
    situation = "possible-mill";
    summary = "Repeated low-displacement movement suggests some ants may be milling.";
    expected = "Reduce repeated movement and return more ants to productive search.";
  } else if (observation.staleTrailFraction > 0.2 && observation.staleTrafficFraction > 0.12) {
    situation = "stale-highway";
    summary = "A formerly useful route appears to be drawing ants toward depleted food.";
    expected = "Reduce stale-route traffic before the next review.";
  } else if (observation.populationLead > 0.2 && observation.reservePerAnt > 5) {
    situation = "interference-opportunity";
    summary = "The colony has enough economic headroom to pressure its opponent.";
    expected = "Preserve the economic lead while increasing opponent disruption.";
  } else if (observation.deliveryRate > 0.01) {
    situation = "exploiting";
    summary = "Food is arriving through an established trail network.";
    expected = "Maintain or improve the current delivery rate.";
  }

  const evidence: WarAgentEvidence[] = [
    { signal: "delivery-rate", value: round(observation.deliveryRate * 100, 1), description: "Food delivered per 100 ticks over the observation window.", severity: observation.deliveryRate <= 0.005 ? "warning" : "info" },
    { signal: "reserve-per-ant", value: round(observation.reservePerAnt, 1), description: "Current reserve divided by living population.", severity: observation.reservePerAnt < 4 ? "critical" : "info" },
    { signal: "low-energy-share", value: `${round(observation.lowEnergyFraction * 100, 0)}%`, description: "Share of the colony currently low on energy.", severity: observation.lowEnergyFraction > 0.25 ? "critical" : "info" },
    { signal: "stale-trail-share", value: `${round(observation.staleTrailFraction * 100, 0)}%`, description: "Own food-trail mass near depleted sources.", severity: observation.staleTrailFraction > 0.2 ? "warning" : "info" },
    { signal: "stale-traffic-share", value: `${round(observation.staleTrafficFraction * 100, 0)}%`, description: "Searching ants near depleted sources.", severity: observation.staleTrafficFraction > 0.12 ? "warning" : "info" },
    { signal: "possible-mill-share", value: `${round(observation.possibleMillFraction * 100, 0)}%`, description: "Ants showing repeated low-displacement movement without carrying food.", severity: observation.possibleMillFraction > 0.1 ? "warning" : "info" },
  ];
  return { situation, summary, evidence, candidates, selected, confidence: round(confidence), expected };
}

export class DeterministicOodaWarAgent implements WarAgentController {
  private history: HistorySample[] = [];
  private decisions: WarAgentDecision[] = [];
  private nextReviewTick = DECISION_INTERVAL;
  private currentPreset: WarAgentPresetName = "Default";

  constructor(readonly colonyId: number) {}

  advance(snapshot: WarSnapshot): WarAgentStep | null {
    if (snapshot.tick % SAMPLE_INTERVAL !== 0) return null;
    const colony = snapshot.colonies[this.colonyId];
    this.history.push({
      tick: snapshot.tick,
      foodCollected: colony.metrics.foodCollected,
      ants: colony.ants.map(ant => ({ id: ant.id, x: ant.x, y: ant.y, hasFood: ant.hasFood })),
    });
    this.history = this.history.filter(sample => sample.tick >= snapshot.tick - HISTORY_TICKS);
    if (snapshot.tick < this.nextReviewTick) return null;

    const observation = observeWarAgent(snapshot, this.history.slice(0, -1), this.colonyId);
    const active = activePresetName(colony.doctrine, snapshot.settings.topology);
    if (active && PRESETS.some(candidate => candidate.name === active)) this.currentPreset = active as WarAgentPresetName;
    const available = PRESETS.filter(candidate => candidate.available(snapshot.settings.topology))
      .map(candidate => candidate.name as WarAgentPresetName);
    const choice = scoreWarAgentDecision(observation, this.currentPreset, available);
    const currentCandidate = choice.candidates.find(candidate => candidate.preset === this.currentPreset);
    const selectedCandidate = choice.candidates.find(candidate => candidate.preset === choice.selected)!;
    const changed = choice.selected !== this.currentPreset
      && selectedCandidate.score >= (currentCandidate?.score ?? 0) + 0.15;
    const previousPreset = this.currentPreset;
    if (changed) this.currentPreset = choice.selected;
    this.nextReviewTick = snapshot.tick + DECISION_INTERVAL;
    const decision: WarAgentDecision = {
      protocol: WAR_AGENT_PROTOCOL,
      version: WAR_AGENT_PROTOCOL_VERSION,
      id: `${this.colonyId}-${snapshot.tick}`,
      tick: snapshot.tick,
      colonyId: this.colonyId,
      observe: choice.evidence,
      orient: { situation: choice.situation, summary: choice.summary },
      decide: { candidates: choice.candidates, selected: choice.selected, confidence: choice.confidence },
      act: {
        previousPreset,
        nextPreset: changed ? choice.selected : previousPreset,
        changed,
        reviewAtTick: this.nextReviewTick,
      },
      expected: choice.expected,
    };
    this.decisions.push(decision);
    this.decisions = this.decisions.slice(-MAX_DECISIONS);
    return {
      decision,
      doctrine: changed ? cloneDoctrine(preset(choice.selected, snapshot).doctrine) : null,
    };
  }

  state(): WarAgentState {
    const latest = this.decisions.at(-1);
    return {
      protocol: WAR_AGENT_PROTOCOL,
      version: WAR_AGENT_PROTOCOL_VERSION,
      agentId: "deterministic-ooda-v1",
      colonyId: this.colonyId,
      currentSituation: latest?.orient.situation ?? "exploring",
      currentPreset: this.currentPreset,
      nextReviewTick: this.nextReviewTick,
      decisions: this.decisions.map(decision => ({
        ...decision,
        observe: decision.observe.map(evidence => ({ ...evidence })),
        orient: { ...decision.orient },
        decide: { ...decision.decide, candidates: decision.decide.candidates.map(candidate => ({ ...candidate, reasons: [...candidate.reasons] })) },
        act: { ...decision.act },
      })),
    };
  }
}
