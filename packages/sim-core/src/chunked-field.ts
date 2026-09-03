import type { Channel, FieldSet } from "./types";

/** A chunk holds all three channels, so one lookup serves any of them. */
interface Chunk {
  home: Float32Array;
  food: Float32Array;
  caut: Float32Array;
}

export interface ChunkedFieldOptions {
  /** Cells per chunk edge. Defaults to 32, matching the Infinite Mode wire. */
  chunkSize?: number;
  /**
   * Drop a chunk once no cell of any evictChannels channel exceeds this.
   * Zero disables eviction, which is what the dense-equivalence test needs:
   * dropping a chunk is lossy, so an evicting backing cannot agree with a
   * dense one cell for cell.
   */
  evictBelow?: number;
  /**
   * Channels that keep a chunk alive. Defaults to home and food, which is the
   * rule the Infinite Mode server has always applied: a chunk holding only
   * caution pheromone is dropped. Caution is a local deterrent that ants
   * regenerate from traffic, and keeping chunks resident for it would roughly
   * double the working set of a cautionary colony.
   */
  evictChannels?: readonly Channel[];
}

const DEFAULT_CHUNK_SIZE = 32;
const DEFAULT_EVICT_BELOW = 0.05;
const DEFAULT_EVICT_CHANNELS: readonly Channel[] = ["home", "food"];

/**
 * An unbounded field held as a sparse map of square chunks.
 *
 * Chunks are created on first write and dropped once they hold nothing worth
 * keeping. The key format is load-bearing beyond this class: the Infinite Mode
 * server forwards drainEvicted() straight into the `cleared` list of its phero
 * message, and clients erase by that key.
 */
export class ChunkedField implements FieldSet {
  readonly chunkSize: number;
  readonly evictBelow: number;
  private readonly evictChannels: readonly Channel[];
  private readonly chunks = new Map<string, Chunk>();
  private evicted: string[] = [];

  constructor(options: ChunkedFieldOptions = {}) {
    this.chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
    this.evictBelow = options.evictBelow ?? DEFAULT_EVICT_BELOW;
    this.evictChannels = options.evictChannels ?? DEFAULT_EVICT_CHANNELS;
  }

  private chunkCoord(v: number): number {
    return Math.floor(v / this.chunkSize);
  }

  private localIndex(cx: number, cy: number): number {
    const size = this.chunkSize;
    const lx = ((cx % size) + size) % size;
    const ly = ((cy % size) + size) % size;
    return ly * size + lx;
  }

  private keyFor(cx: number, cy: number): string {
    return `${this.chunkCoord(cx)},${this.chunkCoord(cy)}`;
  }

  private getOrCreate(cx: number, cy: number): Chunk {
    const key = this.keyFor(cx, cy);
    let chunk = this.chunks.get(key);
    if (!chunk) {
      const n = this.chunkSize * this.chunkSize;
      chunk = { home: new Float32Array(n), food: new Float32Array(n), caut: new Float32Array(n) };
      this.chunks.set(key, chunk);
    }
    return chunk;
  }

  /** Live chunks. Exposed for tests and for the server's broadcast encoder. */
  get size(): number {
    return this.chunks.size;
  }

  get(ch: Channel, cx: number, cy: number): number {
    // A missing chunk reads as zero without allocating, so merely looking at
    // empty space does not grow the map.
    const chunk = this.chunks.get(this.keyFor(cx, cy));
    return chunk === undefined ? 0 : chunk[ch][this.localIndex(cx, cy)];
  }

  add(ch: Channel, cx: number, cy: number, amount: number): void {
    this.getOrCreate(cx, cy)[ch][this.localIndex(cx, cy)] += amount;
  }

  set(ch: Channel, cx: number, cy: number, value: number): void {
    this.getOrCreate(cx, cy)[ch][this.localIndex(cx, cy)] = value;
  }

  max(ch: Channel, cx: number, cy: number, value: number): void {
    const chunk = this.getOrCreate(cx, cy);
    const i = this.localIndex(cx, cy);
    if (value > chunk[ch][i]) chunk[ch][i] = value;
  }

  decay(factor: number): void {
    // A non-positive threshold means never evict. Without this a chunk decayed
    // to all zeros would fail a `> 0` test and be dropped, which is the
    // opposite of what switching eviction off should do.
    const evicting = this.evictBelow > 0;
    const drop: string[] = [];

    for (const [key, chunk] of this.chunks) {
      let significant = false;
      for (let i = 0; i < chunk.home.length; i++) {
        chunk.home[i] *= factor;
        chunk.food[i] *= factor;
        chunk.caut[i] *= factor;
        if (evicting && !significant) {
          for (const ch of this.evictChannels) {
            if (chunk[ch][i] > this.evictBelow) { significant = true; break; }
          }
        }
      }
      if (evicting && !significant) drop.push(key);
    }
    // Deleting inside decay rather than in drainEvicted is deliberate: a read
    // between the two would otherwise see values the field has already given up.
    for (const key of drop) {
      this.chunks.delete(key);
      this.evicted.push(key);
    }
  }

  drainEvicted(): readonly string[] {
    if (this.evicted.length === 0) return [];
    const keys = this.evicted;
    this.evicted = [];
    return keys;
  }

  /**
   * Every stored word, chunk keys in sorted order and channels in home, food,
   * caut order within each chunk.
   *
   * Canonical for this backing, and deliberately not comparable to a dense
   * field: an evicted chunk contributes nothing where a dense field would
   * contribute a run of zeros. Two backings are compared by trajectory, not by
   * fingerprint.
   */
  layers(): readonly Float32Array[] {
    const out: Float32Array[] = [];
    for (const key of [...this.chunks.keys()].sort()) {
      const chunk = this.chunks.get(key)!;
      out.push(chunk.home, chunk.food, chunk.caut);
    }
    return out;
  }
}
