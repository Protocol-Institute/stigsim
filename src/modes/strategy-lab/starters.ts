import { BASELINE, type Strategy } from './contract';
import { composeSource } from './authoring';

const fixed = {
  observer: `function observe(o, state) {
  return { signals: {}, state: null, nextTick: o.tickLimit + 1 };
}`,
  controller: `function control(signals, state, context) {
  // No intervention: keep the initial ant settings.
  return { state: null };
}`,
};
const pulse = {
  observer: `function observe(o, state) {
  const s = state || { samples: [] };
  s.samples.push({ tick: o.tick, ants: o.ants });
  s.samples = s.samples.filter(p => p.tick >= o.tick - 200);
  let suspects = 0;
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
  controller: `function control(signals, state, context) {
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
  { name: 'Detect, explore, restore', description: 'An editable circulation detector and a temporary trail-bias pulse. A hypothesis to test, not a proven winner.', editors: pulse },
  { name: 'Periodic exploration', description: 'Ignore trails for 100 ticks every 500 ticks.', editors: {
    observer: `function observe(o, state) {
  return { signals: { phase: o.tick % 500 }, state: null,
    nextTick: Math.min(o.tickLimit + 1, o.tick + 100) };
}`,
    controller: `function control(signals, state, context) {
  return { state: null,
    settings: { ...context.initial, trailBias: context.tick > 0 && signals.phase === 0 ? 0 : context.initial.trailBias } };
}`,
  } },
].map(s => ({ format: 'stigsim-strategy@1', name: s.name, description: s.description,
  parent: null, initial: { ...BASELINE }, source: composeSource(s.editors) }));
