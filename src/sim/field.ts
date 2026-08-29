// ─────────────────────────────────────────────────────────────────────────────
// Reading and writing a pheromone field at a point.
//
// Continuous movement does not require a continuous field. The grid stays
// exactly as it is; what changes is how it is addressed. An ant that sits
// between cells reads a blend of the cells around it, and lays its deposit
// across those same cells in the same proportion, so a trail is smooth rather
// than quantised to cell boundaries.
//
// Storage lives with the caller — these functions take accessors rather than a
// grid, so they can be tested against a fake and later reused by the shared
// world, which stores its field in sparse chunks rather than a flat array.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The 2×2 cell neighbourhood surrounding a point, with each cell's share.
 *
 * Cell centres sit at (i + 0.5) * cell, so a point is converted to
 * centre-relative space before splitting. Shares always sum to 1.
 */
export interface BilinearWeights {
  x0: number;
  y0: number;
  w00: number;
  w10: number;
  w01: number;
  w11: number;
}

export function bilinearWeights(px: number, py: number, cell: number): BilinearWeights {
  const gx = px / cell - 0.5;
  const gy = py / cell - 0.5;
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const fx = gx - x0;
  const fy = gy - y0;

  return {
    x0,
    y0,
    w00: (1 - fx) * (1 - fy),
    w10: fx * (1 - fy),
    w01: (1 - fx) * fy,
    w11: fx * fy,
  };
}

/** Reads a cell's value. Cells outside the world, or solid, should read 0. */
export type ReadCell = (cx: number, cy: number) => number;

/** Adds to a cell. Calls are only made for cells the caller reported open. */
export type AddCell = (cx: number, cy: number, amount: number) => void;

/** Whether a cell can hold pheromone — open floor rather than rock or void. */
export type IsOpen = (cx: number, cy: number) => boolean;

/** The blended field value at a point. */
export function sampleField(px: number, py: number, cell: number, read: ReadCell): number {
  const { x0, y0, w00, w10, w01, w11 } = bilinearWeights(px, py, cell);
  return (
    read(x0, y0) * w00 +
    read(x0 + 1, y0) * w10 +
    read(x0, y0 + 1) * w01 +
    read(x0 + 1, y0 + 1) * w11
  );
}

/**
 * Lay `amount` across the cells around a point, in proportion to how close the
 * point is to each.
 *
 * Solid cells take no share, and what they would have taken is redistributed
 * across the open ones. Without that, an ant walking beside a wall would lay a
 * weaker trail than one walking down the middle of a corridor purely because
 * some of its deposit fell into rock — and the colony would slowly learn to
 * avoid walls for no reason connected to the route being good.
 */
export function splatDeposit(
  px: number,
  py: number,
  cell: number,
  amount: number,
  isOpen: IsOpen,
  add: AddCell,
): void {
  if (amount <= 0) return;
  const { x0, y0, w00, w10, w01, w11 } = bilinearWeights(px, py, cell);

  const cells: [number, number, number][] = [
    [x0, y0, w00],
    [x0 + 1, y0, w10],
    [x0, y0 + 1, w01],
    [x0 + 1, y0 + 1, w11],
  ];

  let openWeight = 0;
  for (const [cx, cy, w] of cells) if (w > 0 && isOpen(cx, cy)) openWeight += w;
  if (openWeight <= 0) return;

  const scale = amount / openWeight;
  for (const [cx, cy, w] of cells) {
    if (w > 0 && isOpen(cx, cy)) add(cx, cy, w * scale);
  }
}

/** Shortest signed turn from `from` to `to`, in radians, within ±π. */
export function angleDelta(from: number, to: number): number {
  let delta = (to - from) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

/** Wrap an angle into [0, 2π). */
export function normalizeAngle(angle: number): number {
  const wrapped = angle % (Math.PI * 2);
  return wrapped < 0 ? wrapped + Math.PI * 2 : wrapped;
}
