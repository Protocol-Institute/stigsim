import type { CellType, Occupancy } from "./types";

/**
 * True when (x, y) lies inside an occupancy's iteration bounds, and always true
 * for an unbounded world.
 *
 * A free function rather than a fourth interface method: callers that guard a
 * coordinate before acting on it need this, but a backing has nothing to
 * contribute beyond the bounds it already reports.
 */
export function inBounds(occ: Occupancy, x: number, y: number): boolean {
  const b = occ.bounds;
  return b === null || (x >= 0 && x < b.cols && y >= 0 && y < b.rows);
}

/**
 * Occupancy over a fixed grid of open and closed cells.
 *
 * Wraps the maze's CellType[][] by reference — generateMaze still produces one
 * and the renderer still walks it — and reports everything outside the grid as
 * closed, which folds the bounds tests that used to sit at each call site into
 * the lookup itself.
 */
export class DenseGrid implements Occupancy {
  readonly cells: CellType[][];
  readonly bounds: { cols: number; rows: number };

  constructor(cells: CellType[][]) {
    this.cells = cells;
    this.bounds = { cols: cells[0]?.length ?? 0, rows: cells.length };
  }

  isOpen(cx: number, cy: number): boolean {
    if (!inBounds(this, cx, cy)) return false;
    return this.cells[cy][cx] === 1;
  }

  setOpen(cx: number, cy: number, open: boolean): void {
    if (!inBounds(this, cx, cy)) return;
    this.cells[cy][cx] = open ? 1 : 0;
  }
}
