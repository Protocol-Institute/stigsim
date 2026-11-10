import { BASELINE, type Strategy } from './contract';
import { composeSource } from './authoring';

const fixed = {
  observer: `// OBSERVER: Look once at the start, then stop observing.
// We need no signals or memory because this strategy never changes settings.
function observe(o, state) {
  return { signals: {}, state: null, nextTick: o.tickLimit + 1 };
}`,
  controller: `// CONTROLLER: Keep the initial evaporation, trail bias and food deposition
// for the entire run. This is the fixed-settings comparison strategy.
function control(signals, state, context) {
  // Returning no settings means "leave them unchanged".
  return { state: null };
}`,
};
const pulse = {
  observer: `// OBSERVER: Every 10 ticks, remember ant positions from the last 200 ticks.
// Count ants that traveled at least 8 cells but ended less than 20% of that
// distance from where they started. Report their fraction as a signal.
// This suggests repeated or wandering motion; it does not prove an ant mill.
function observe(o, state) {
  const s = state || { samples: [] };
  s.samples.push({ tick: o.tick, ants: o.ants });
  s.samples = s.samples.filter(p => p.tick >= o.tick - 200);
  let suspects = 0;
  // Wait for a full 200-tick history (21 samples, including both ends).
  if (s.samples.length >= 21) {
    for (let i = 0; i < o.ants.length; i++) {
      const path = s.samples.map(p => p.ants[i]);
      let distance = 0;
      for (let j = 1; j < path.length; j++)
        distance += Math.hypot(path[j].x - path[j-1].x, path[j].y - path[j-1].y);
      const first = path[0], last = path[path.length-1];
      const displacement = Math.hypot(last.x-first.x, last.y-first.y);
      if (distance >= 8 && displacement / distance < 0.2) suspects++;
    }
  }
  // This signal and its definition are yours to change.
  return { signals: { suspectedMillFraction: suspects / o.ants.length },
    state: s, nextTick: Math.min(o.tickLimit + 1, o.tick + 10) };
}`,
  controller: `// CONTROLLER: Check the observer's signal every 50 ticks. If at least
// 40% of ants are flagged on two consecutive checks, set trail bias to zero
// for 100 ticks so ants explore. Then restore all initial settings.
// Evaporation and food deposition stay at their initial values during a pulse.
// This is a hypothesis to test, not a guarantee that food collection improves.
function control(signals, state, context) {
  const s = state || { until: 0, previous: false };
  if (s.until) {
    if (context.tick < s.until) return { state: s };
    s.until = 0;
    s.previous = false;
    return { state: s, settings: context.initial };
  }
  if (context.tick % 50 !== 0) return { state: s };
  const high = signals.suspectedMillFraction >= 0.4;
  if (high && s.previous) {
    s.until = context.tick + 100;
    s.previous = false;
    return { state: s, settings: { ...context.initial, trailBias: 0 } };
  }
  s.previous = high;
  return { state: s };
}`,
};
export const STARTERS: Strategy[] = [
  { name: 'Fixed settings', description: 'Hold the initial settings for the whole run.', editors: fixed },
  { name: 'Detect, explore, restore', description: 'If we quickly dissolve ant mills and then restore the best fixed settings, the colony will collect more food than with those settings held constant throughout.', editors: pulse },
  { name: 'Periodic exploration', description: 'Ignore trails for 100 ticks every 500 ticks.', editors: {
    observer: `// OBSERVER: Wake up every 100 ticks and report where we are in a
// repeating 500-tick cycle. This strategy uses a clock, not ant behavior.
// It keeps no history and does not try to detect a mill.
function observe(o, state) {
  return { signals: { phase: o.tick % 500 }, state: null,
    nextTick: Math.min(o.tickLimit + 1, o.tick + 100) };
}`,
    controller: `// CONTROLLER: At ticks 500, 1000, 1500, and so on, ignore trails by
// setting trail bias to zero. At the next observation, 100 ticks later,
// restore the initial trail bias. Keep evaporation and deposition unchanged.
// Tick zero starts normally; there is no opening exploration pulse.
function control(signals, state, context) {
  return { state: null,
    settings: { ...context.initial, trailBias: context.tick > 0 && signals.phase === 0 ? 0 : context.initial.trailBias } };
}`,
  } },
].map(s => ({ format: 'stigsim-strategy@1', name: s.name, description: s.description,
  parent: null, initial: { ...BASELINE }, source: composeSource(s.editors) }));
