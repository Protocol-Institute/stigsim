import { COLS, ROWS } from "./constants";
import type { Simulation } from "./sim";

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

/** An exact hash of everything that determines how the run continues. */
export function fingerprint(sim: Simulation): string {
  let h = FNV_OFFSET;

  h = mixU32(h, sim.tick);
  h = mixU32(h, sim.numAnts);
  h = mixU32(h, sim.colonies.length);
  h = mixU32(h, sim.foodSources.length);
  h = mixU32(h, sim.manualAntIndex === null ? 0xffffffff : sim.manualAntIndex);

  h = mixF64(h, sim.params.evapRate);
  h = mixF64(h, sim.params.trailPower);
  h = mixF64(h, sim.params.tankMax);
  h = mixU32(h, sim.params.cautionary ? 1 : 0);

  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) h = mixU32(h, sim.grid[y][x]);
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
    h = mixLayer(h, colony.homePhero);
    h = mixLayer(h, colony.foodPhero);
    h = mixLayer(h, colony.cautPhero);
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
    }
  }

  return (h >>> 0).toString(16).padStart(8, "0");
}
