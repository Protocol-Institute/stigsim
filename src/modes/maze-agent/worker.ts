import { evaluate, mazeAgentMode } from './engine';
import { PRACTICE_SEEDS, type Entry, type Manifest } from './contract';
export type Request = { kind: 'practice'; entry: Entry; index: number } | { kind: 'advance'; count: number } |
  { kind: 'evaluate'; entry: Entry; manifest: Manifest };
let session: ReturnType<typeof mazeAgentMode.create> | null = null, busy = false;
self.onmessage = async (event: MessageEvent<Request>) => {
  if (busy) return; busy = true;
  try {
    const r = event.data;
    if (r.kind === 'practice') {
      if (!Number.isInteger(r.index) || r.index < 0 || r.index >= PRACTICE_SEEDS.length) throw new Error('Select practice maze 1–20.');
      session = mazeAgentMode.create({ entry: r.entry, seed: PRACTICE_SEEDS[r.index] });
      self.postMessage({ kind: 'view', view: session.view() });
    } else if (r.kind === 'advance') {
      if (!session) throw new Error('Start a practice maze first.');
      await session.advance(r.count);
      self.postMessage({ kind: 'view', view: session.view(session.done), outcome: session.done ? session.outcome() : null });
    } else {
      const report = await evaluate([r.entry], r.manifest, (_entry, outcome, completed) => self.postMessage({ kind: 'trial', outcome, completed }));
      self.postMessage({ kind: 'result', report });
    }
  } catch (e) { self.postMessage({ kind: 'error', error: e instanceof Error ? e.message : 'Run failed.' }); }
  finally { busy = false; }
};
