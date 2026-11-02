import { runRound, TrialSession } from './engine';
import type { Round, Strategy } from './contract';
export type WorkerRequest =
  | { kind: 'init'; strategy: Strategy; seed: string }
  | { kind: 'advance'; ticks: number }
  | { kind: 'evaluate'; strategy: Strategy; round: Round };
let session: TrialSession | null = null;
let busy = false;
self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  if (busy) return;
  busy = true;
  try {
    const request = event.data;
    if (request.kind === 'init') {
      session = new TrialSession(request.strategy, request.seed);
      self.postMessage({ kind: 'snapshot', snapshot: session.snapshot() });
    } else if (request.kind === 'advance') {
      if (!session) throw new Error('Start a sandbox first.');
      await session.advance(request.ticks);
      self.postMessage({ kind: 'snapshot', snapshot: session.snapshot(), ...(session.done ? { trial: session.result() } : {}) });
    } else {
      const report = await runRound([request.strategy], request.round, undefined, undefined, {
        traces: 'first', onTrial: (trial, completed) => self.postMessage({ kind: 'trial', trial, completed }),
      });
      self.postMessage({ kind: 'result', report });
    }
  } catch (e) { self.postMessage({ kind: 'error', error: e instanceof Error ? e.message : 'Run failed.' }); }
  finally { busy = false; }
};
