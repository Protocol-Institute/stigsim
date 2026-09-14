import type { Simulation } from "./sim";
import { doctrineNumbers } from "./doctrine";
import { READ_MODES } from "./topology";

export const FINGERPRINT_INTERVAL = 500;

const FNV_OFFSET = 2166136261;
const FNV_PRIME = 16777619;

function mixU32(h: number, v: number): number {
  h ^= v & 0xff;          h = Math.imul(h, FNV_PRIME);
  h ^= (v >>> 8) & 0xff;  h = Math.imul(h, FNV_PRIME);
  h ^= (v >>> 16) & 0xff; h = Math.imul(h, FNV_PRIME);
  h ^= (v >>> 24) & 0xff; h = Math.imul(h, FNV_PRIME);
  return h >>> 0;
}

const scratch = new Float64Array(1);
const scratchWords = new Uint32Array(scratch.buffer);

function mixF64(h: number, v: number): number {
  scratch[0] = v;
  return mixU32(mixU32(h, scratchWords[0]), scratchWords[1]);
}

function mixLayer(h: number, layer: Float32Array): number {
  const words = new Uint32Array(layer.buffer, layer.byteOffset, layer.length);
  for (let i = 0; i < words.length; i++) h = mixU32(h, words[i]);
  return h;
}

/**
 * An exact hash of everything that determines how the run continues: the
 * visible state, and the position of the ant random stream. The stream
 * position matters on its own. Two simulations can agree on every ant, cell,
 * and counter while standing at different points in the sequence, and from
 * there they draw different numbers and diverge for good. Leaving it out
 * would let a replay report a match for hundreds of ticks after it had
 * already stopped reproducing the recording. It also covers every doctrine a
 * colony's ants still hold, each ant's version and role, the adoption mode,
 * and the topology, so two runs that differ only in a doctrine atom diverge
 * at the next checkpoint rather than silently.
 */
export function fingerprint(sim: Simulation): string {
  let h = FNV_OFFSET;

  h = mixU32(h, sim.tick);
  h = mixU32(h, sim.antsDraws);
  h = mixU32(h, sim.numAnts);
  h = mixU32(h, sim.colonies.length);
  h = mixU32(h, sim.foodSources.length);
  h = mixU32(h, sim.manualAntIndex === null ? 0xffffffff : sim.manualAntIndex);

  h = mixF64(h, sim.params.tankMax);
  h = mixU32(h, sim.adoption === "instant" ? 0 : 1);
  h = mixU32(h, READ_MODES.indexOf(sim.topology.read));
  h = mixU32(h, sim.topology.mimicEnemy ? 1 : 0);
  h = mixU32(h, sim.topology.visible.home ? 1 : 0);
  h = mixU32(h, sim.topology.visible.food ? 1 : 0);
  h = mixF64(h, sim.topology.maxMimicRate);
  h = mixU32(h, sim.topology.provenance ? 1 : 0);

  const { cols, rows } = sim.bounds;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) h = mixU32(h, sim.occupancy.isOpen(x, y) ? 1 : 0);
  }

  for (const src of sim.foodSources) {
    h = mixU32(h, src.x);
    h = mixU32(h, src.y);
    h = mixF64(h, src.remaining);
    h = mixF64(h, src.total);
  }

  for (const colony of sim.colonies) {
    h = mixU32(h, colony.id);
    h = mixU32(h, colony.nestX);
    h = mixU32(h, colony.nestY);
    h = mixU32(h, colony.foodCollected);
    h = mixU32(h, colony.doctrineVersion);
    // Every version some ant still holds, in version order, as its numbers in
    // table order. Under nest adoption the pending doctrine is state the
    // run's future depends on even before any ant has adopted it.
    for (const v of [...colony.doctrines.keys()].sort((x, y) => x - y)) {
      h = mixU32(h, v);
      for (const n of doctrineNumbers(colony.doctrines.get(v)!)) h = mixF64(h, n);
    }
    // Canonical order for the backing, which for a dense field is home, food,
    // caut — the order this has always hashed.
    for (const layer of colony.field.layers()) h = mixLayer(h, layer);
    for (const idx of [...colony.discoveredSources].sort((a, b) => a - b)) {
      h = mixU32(h, idx);
    }
    for (const ant of colony.ants) {
      h = mixF64(h, ant.x);
      h = mixF64(h, ant.y);
      h = mixU32(h, ant.cx);
      h = mixU32(h, ant.cy);
      h = mixU32(h, ant.tx);
      h = mixU32(h, ant.ty);
      h = mixU32(h, ant.prevCx);
      h = mixU32(h, ant.prevCy);
      h = mixU32(h, ant.state === "searching" ? 0 : 1);
      h = mixU32(h, ant.hasFood ? 1 : 0);
      h = mixU32(h, ant.manual ? 1 : 0);
      h = mixF64(h, ant.tank);
      h = mixU32(h, ant.doctrineVersion);
      h = mixU32(h, ant.role === "spoiler" ? 1 : 0);
    }
  }

  return (h >>> 0).toString(16).padStart(8, "0");
}
