import { BASELINE, type Strategy } from './contract';
const entry = (name: string, description: string, source: string): Strategy => ({
  format: 'stigsim-strategy@1', name, description, parent: null, initial: { ...BASELINE }, source,
});
export const STARTERS = [
  entry('Fixed reference', 'A strong fixed setting from earlier experiments. A reference to beat, not a claim of a global optimum.',
`function step(o, state) {
  return { nextTick: o.tickLimit + 1, state: null };
}`),
  entry('Detect, explore, restore', 'Example hypothesis: when many ants move but make little progress, remove trail bias for 100 ticks. This detector is part of the editable strategy, not a built-in truth about mills.',
`function step(o, state) {
  const s = state || { samples: [], until: 0, previous: 0 };
  if (s.until > 0) {
    if (o.tick < s.until) return { nextTick: s.until, state: s };
    s.until = 0;
    s.samples = [];
    return { nextTick: o.tick + 10, state: s,
      settings: { evaporation: 0.002, trailBias: 7, foodDeposition: 2 } };
  }
  s.samples.push({ tick: o.tick, ants: o.ants });
  s.samples = s.samples.filter(p => p.tick >= o.tick - 200);
  if (o.tick % 50 === 0 && s.samples.length >= 21) {
    let suspects = 0;
    for (let i = 0; i < o.ants.length; i++) {
      const path = s.samples.map(p => p.ants[i]);
      let distance = 0;
      for (let j = 1; j < path.length; j++)
        distance += Math.hypot(path[j].x-path[j-1].x, path[j].y-path[j-1].y);
      const first = path[0], last = path[path.length-1];
      const displacement = Math.hypot(last.x-first.x, last.y-first.y);
      if (distance >= 8 && displacement / distance < 0.2) suspects++;
    }
    const high = suspects / o.ants.length >= 0.4;
    if (high && s.previous) {
      s.until = Math.min(o.tickLimit, o.tick + 100);
      s.previous = 0;
      return { nextTick: s.until, state: s,
        settings: { evaporation: 0.002, trailBias: 0, foodDeposition: 2 } };
    }
    s.previous = high ? 1 : 0;
  }
  return { nextTick: Math.min(o.tickLimit + 1, o.tick + 10), state: s };
}`),
  entry('Periodic exploration', 'An intentionally simple alternative: ignore trails for 100 ticks every 500 ticks. Compare it before drawing conclusions.',
`function step(o, state) {
  const exploring = o.tick > 0 && o.tick % 500 === 0;
  return {
    nextTick: Math.min(o.tickLimit + 1, exploring ? o.tick + 100 : (Math.floor(o.tick / 500) + 1) * 500),
    state: null,
    settings: { evaporation: 0.002, trailBias: exploring ? 0 : 7, foodDeposition: 2 }
  };
}`),
];
