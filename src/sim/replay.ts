import { Simulation } from "./sim";
import { fingerprint } from "./fingerprint";
import { traceToRunConfig, type Trace } from "./trace";

/**
 * Drives a Simulation from a recorded trace and checks it against the
 * fingerprints the trace carries. The simulation itself does not know it is
 * replaying; commands arrive through the same apply path a live run uses.
 */
export class Replayer {
  readonly trace: Trace;
  sim: Simulation;
  divergedAt: number | null = null;

  private expected: Map<number, string>;
  private checking = true;

  constructor(trace: Trace) {
    this.trace = trace;
    this.expected = new Map(trace.fingerprints.map(f => [f.t, f.h]));
    this.sim = this.build();
  }

  private build(): Simulation {
    const sim = new Simulation(traceToRunConfig(this.trace));
    sim.loadSchedule(this.trace.commands);
    return sim;
  }

  get tick(): number { return this.sim.tick; }
  get endTick(): number { return this.trace.endTick; }
  get atEnd(): boolean { return this.sim.tick >= this.trace.endTick; }

  reset() {
    this.sim = this.build();
    this.divergedAt = null;
  }

  /** Advances one tick. Returns false at the end or on divergence. */
  step(): boolean {
    if (this.divergedAt !== null) return false;
    if (this.atEnd) return false;

    this.sim.step();

    if (this.checking) {
      const want = this.expected.get(this.sim.tick);
      if (want !== undefined && fingerprint(this.sim) !== want) {
        this.divergedAt = this.sim.tick;
        return false;
      }
    }
    return true;
  }

  /** Rebuilds and re-runs when the target is behind the current tick. */
  seek(target: number) {
    const t = Math.max(0, Math.min(target, this.trace.endTick));
    if (t < this.sim.tick || this.divergedAt !== null) this.reset();
    while (this.sim.tick < t && this.step());
  }

  /** Stops checking fingerprints so a diverged replay can still be watched. */
  continueAfterDivergence() {
    this.divergedAt = null;
    this.checking = false;
  }
}
