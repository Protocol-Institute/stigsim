import { runTrial, createTrialSimulation, validateConfig, type HighwayConfig, type Trial } from './benchmark';
import { snapshot, type HighwaySnapshot } from './snapshot';
export type BenchmarkEvent =
  | { kind: 'progress'; maze: number; replicate: number; evapRate: number; trailPower: number; snapshot: HighwaySnapshot }
  | { kind: 'trial'; trial: Trial; snapshot: HighwaySnapshot }
  | { kind: 'done' }
  | { kind: 'error'; message: string };
const send = (event: BenchmarkEvent) => postMessage(event);
self.addEventListener('message', (event: MessageEvent<HighwayConfig>) => {
  try {
    const c = event.data;
    validateConfig(c);
    for (const evapRate of c.evapRates) for (const trailPower of c.trailPowers) {
      for (let maze = 0; maze < c.mazeCount; maze++) for (let replicate = 0; replicate < c.replicates; replicate++) {
        let last = -Infinity;
        let latestSim: ReturnType<typeof createTrialSimulation> | undefined;
        const trial = runTrial(c, maze, replicate, evapRate, trailPower, sim => {
          latestSim = sim;
          if (performance.now() - last < 100) return;
          last = performance.now();
          send({ kind: 'progress', maze, replicate, evapRate, trailPower, snapshot: snapshot(sim) });
        });
        // Reuse the final observer state without rerunning the simulation.
        send({ kind: 'trial', trial, snapshot: snapshot(latestSim!) });
      }
    }
    send({ kind: 'done' });
  } catch (error) {
    send({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
  }
});
