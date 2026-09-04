import type { Channel, FieldSet } from "./types";

/** Nothing was dropped. Shared, so a backing that never evicts allocates nothing. */
export const NO_EVICTIONS: readonly string[] = Object.freeze([]);

/**
 * A bounded field held as one flat Float32Array per channel.
 *
 * This is the maze's storage unchanged: three arrays of cols*rows, indexed
 * y * cols + x. Nothing is ever dropped, so drainEvicted is always empty.
 */
export class DenseField implements FieldSet {
  readonly cols: number;
  readonly rows: number;
  private readonly home: Float32Array;
  private readonly food: Float32Array;
  private readonly caut: Float32Array;

  constructor(cols: number, rows: number) {
    this.cols = cols;
    this.rows = rows;
    // Three separate arrays rather than one buffer with subarray views: the
    // fingerprint reinterprets each as Uint32Array, and a shared buffer would
    // make that depend on byte offsets for no gain.
    this.home = new Float32Array(cols * rows);
    this.food = new Float32Array(cols * rows);
    this.caut = new Float32Array(cols * rows);
  }

  /**
   * The raw array backing one channel.
   *
   * The renderer's escape hatch. It reads every cell of every channel each
   * frame, and routing that through get() would put a megamorphic call site in
   * the hottest loop in the app as soon as a second backing exists.
   */
  layer(ch: Channel): Float32Array {
    switch (ch) {
      case "home": return this.home;
      case "food": return this.food;
      case "caut": return this.caut;
    }
  }

  /**
   * Flat index, or -1 outside the grid.
   *
   * The bounds test is not redundant with a plain array lookup. A negative x
   * folds into the previous row under y * cols + x — (-1, 5) on a 31-wide grid
   * is index 154, a real cell four rows up — so an unguarded read would return
   * a plausible wrong number rather than nothing.
   */
  private index(cx: number, cy: number): number {
    if (cx < 0 || cx >= this.cols || cy < 0 || cy >= this.rows) return -1;
    return cy * this.cols + cx;
  }

  get(ch: Channel, cx: number, cy: number): number {
    const i = this.index(cx, cy);
    return i < 0 ? 0 : this.layer(ch)[i];
  }

  add(ch: Channel, cx: number, cy: number, amount: number): void {
    const i = this.index(cx, cy);
    if (i >= 0) this.layer(ch)[i] += amount;
  }

  set(ch: Channel, cx: number, cy: number, value: number): void {
    const i = this.index(cx, cy);
    if (i >= 0) this.layer(ch)[i] = value;
  }

  max(ch: Channel, cx: number, cy: number, value: number): void {
    const i = this.index(cx, cy);
    if (i < 0) return;
    const arr = this.layer(ch);
    if (value > arr[i]) arr[i] = value;
  }

  decay(factor: number): void {
    // One fused pass over all three channels, matching what the maze did before
    // the field was extracted. Each cell depends only on itself, so fusing is a
    // locality choice rather than a numeric one.
    for (let i = 0; i < this.home.length; i++) {
      this.home[i] *= factor;
      this.food[i] *= factor;
      this.caut[i] *= factor;
    }
  }

  drainEvicted(): readonly string[] {
    return NO_EVICTIONS;
  }

  layers(): readonly Float32Array[] {
    return [this.home, this.food, this.caut];
  }
}
