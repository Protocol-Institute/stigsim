import { runRound } from './engine';
import { type Round, type Strategy } from './contract';
self.onmessage = async (event: MessageEvent<{ strategies: Strategy[]; round: Round }>) => {
  try {
    const report = await runRound(event.data.strategies, event.data.round,
      progress => self.postMessage({ kind: 'progress', progress }));
    self.postMessage({ kind: 'result', report });
  } catch (e) { self.postMessage({ kind: 'error', error: e instanceof Error ? e.message : 'Run failed.' }); }
};
