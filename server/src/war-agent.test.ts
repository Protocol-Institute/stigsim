import assert from "node:assert/strict";
import test from "node:test";
import type { WarAgentPresetName } from "../../shared/war-agent-contract";
import { isPossibleMillTrajectory, scoreWarAgentDecision, type WarAgentObservation } from "./war-agent";

const presets: WarAgentPresetName[] = ["Default", "Highway", "Scout", "Volatile", "Saboteur", "Poacher"];

function observation(overrides: Partial<WarAgentObservation> = {}): WarAgentObservation {
  return {
    tick: 1_000,
    deliveryRate: 0.01,
    deliveryTrend: 0,
    reservePerAnt: 5,
    lowEnergyFraction: 0,
    populationLead: 0,
    staleTrailFraction: 0,
    staleTrafficFraction: 0,
    possibleMillFraction: 0,
    activeFoodSources: 5,
    depletedFoodSources: 0,
    ...overrides,
  };
}

test("the OODA scorer exploits a healthy delivery route with Highway", () => {
  const choice = scoreWarAgentDecision(observation({ deliveryRate: 0.03 }), "Default", presets);
  assert.equal(choice.situation, "exploiting");
  assert.equal(choice.selected, "Highway");
  assert.match(choice.candidates[0].reasons[0], /delivery/i);
});

test("stale trail and traffic select Volatile with auditable evidence", () => {
  const choice = scoreWarAgentDecision(observation({
    staleTrailFraction: 0.35,
    staleTrafficFraction: 0.2,
  }), "Highway", presets);
  assert.equal(choice.situation, "stale-highway");
  assert.equal(choice.selected, "Volatile");
  assert.ok(choice.evidence.some(item => item.signal === "stale-trail-share" && item.severity === "warning"));
});

test("a broad circular route is identified as a possible mill", () => {
  const positions = [
    [0, 0], [4, 0], [7, 2], [8, 6], [6, 9], [2, 10], [-2, 8], [-4, 4], [-3, 1], [0, 0],
  ].map(([x, y], id) => ({ id, x, y, hasFood: false }));
  assert.equal(isPossibleMillTrajectory(positions), true);
});

test("productive outward travel is not identified as a mill", () => {
  const positions = Array.from({ length: 10 }, (_, id) => ({ id, x: id * 2, y: id, hasFood: false }));
  assert.equal(isPossibleMillTrajectory(positions), false);
});

test("mill evidence overrides Default inertia and selects Volatile", () => {
  const choice = scoreWarAgentDecision(observation({
    deliveryRate: 0.03,
    possibleMillFraction: 0.2,
  }), "Default", presets);
  assert.equal(choice.situation, "possible-mill");
  assert.equal(choice.selected, "Volatile");
  assert.match(choice.candidates[0].reasons[0], /closed|loop/i);
});

test("energy pressure returns a sabotaging colony to Default", () => {
  const choice = scoreWarAgentDecision(observation({
    reservePerAnt: 2,
    lowEnergyFraction: 0.4,
    populationLead: 0.5,
  }), "Saboteur", presets);
  assert.equal(choice.situation, "under-pressure");
  assert.equal(choice.selected, "Default");
  assert.ok(choice.candidates.find(candidate => candidate.preset === "Saboteur")!.score < 0.2);
});

test("healthy economic headroom makes Saboteur a legal opportunity", () => {
  const choice = scoreWarAgentDecision(observation({
    deliveryRate: 0.008,
    populationLead: 0.5,
    reservePerAnt: 7,
  }), "Default", presets);
  assert.equal(choice.situation, "interference-opportunity");
  assert.equal(choice.selected, "Saboteur");
});

test("the scorer never proposes presets unavailable under the topology", () => {
  const choice = scoreWarAgentDecision(observation({ deliveryRate: 0 }), "Default", ["Default", "Highway", "Scout", "Volatile"]);
  assert.equal(choice.candidates.some(candidate => candidate.preset === "Saboteur" || candidate.preset === "Poacher"), false);
});
