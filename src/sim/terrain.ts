// ─────────────────────────────────────────────────────────────────────────────
// Ground.
//
// Terrain is a sparse overlay: a cell absent from it is plain ground and
// behaves exactly as it did before terrain existed. Deleting the overlay
// returns the model to a world of open floor and rock, which is what keeps this
// removable rather than load-bearing.
//
// The interesting axis is not what ground costs to cross — it is how well it
// holds a trace. Hardpan remembers so well that the first route found becomes
// unbeatable whether or not it was good; sand forgets so fast that a colony
// must keep re-laying and so keeps rediscovering; mire takes no mark at all, so
// it carries bodies but not signals and colonies route around it even when
// straight through is shorter. That last one is the point of the whole feature.
// ─────────────────────────────────────────────────────────────────────────────

export enum Terrain {
  Plain = 0,
  Hardpan = 1,
  Sand = 2,
  Mire = 3,
  Undergrowth = 4,
  Loam = 5,
}

export interface TerrainProps {
  readonly name: string;
  /** Multiplier on travel speed. */
  readonly speed: number;
  /** Multiplier on how fast pheromone evaporates here. */
  readonly evap: number;
  /**
   * How much of a deposit this ground accepts, 0–1. Mire is near zero: it is
   * passable but will not hold a mark, so no trail can be built across it.
   */
  readonly adhesion: number;
  /** Multiplier on energy spent crossing. Reserved for colony mortality. */
  readonly cost: number;
  /** Whether food may grow here. */
  readonly fertile: boolean;
  /** Base fill colour. Kept dark and low-chroma so trails read over it. */
  readonly fill: string;
  /** Texture speckle colour, or null for smooth ground. */
  readonly speckle: string | null;
  readonly blurb: string;
}

export const TERRAIN: Record<Terrain, TerrainProps> = {
  [Terrain.Plain]: {
    name: "Plain",
    speed: 1, evap: 1, adhesion: 1, cost: 1, fertile: false,
    fill: "#2a1e0e", speckle: null,
    blurb: "Ordinary floor.",
  },
  [Terrain.Hardpan]: {
    name: "Hardpan",
    speed: 1.15, evap: 0.35, adhesion: 1, cost: 1, fertile: false,
    fill: "#4c4534", speckle: "#615943",
    blurb: "Fast, and it remembers. Trails here set hard — including the wrong ones.",
  },
  [Terrain.Sand]: {
    name: "Sand",
    speed: 1, evap: 2.5, adhesion: 1, cost: 1.15, fertile: false,
    fill: "#5c4a24", speckle: "#7a6234",
    blurb: "Forgets quickly. Colonies must keep re-laying, and so keep rediscovering.",
  },
  [Terrain.Mire]: {
    name: "Mire",
    speed: 0.4, evap: 4, adhesion: 0.02, cost: 2.5, fertile: false,
    fill: "#16302b", speckle: "#28544a",
    blurb: "Crossable, but takes no scent. Carries bodies, not signals.",
  },
  [Terrain.Undergrowth]: {
    name: "Undergrowth",
    speed: 0.5, evap: 0.5, adhesion: 1, cost: 1.4, fertile: false,
    fill: "#25391a", speckle: "#3d5c28",
    blurb: "Slow and costly to cross, but sheltered. Hard-won routes last.",
  },
  [Terrain.Loam]: {
    name: "Loam",
    speed: 0.9, evap: 1, adhesion: 1, cost: 1, fertile: true,
    fill: "#452510", speckle: "#63381a",
    blurb: "Unremarkable to walk on. Food grows here, so trails to it stay worth keeping.",
  },
};

/** The surfaces offered as a brush, in the order they appear. */
export const TERRAIN_BRUSHES: Terrain[] = [
  Terrain.Plain,
  Terrain.Hardpan,
  Terrain.Sand,
  Terrain.Mire,
  Terrain.Undergrowth,
  Terrain.Loam,
];

/**
 * A sparse terrain layer over a fixed grid.
 *
 * Backed by a flat Uint8Array rather than a map: at 31x31 the array is smaller
 * than the map's overhead, and lookups happen several times per ant per step.
 * "Sparse" here means semantic — zero is Plain and costs nothing to store.
 */
export class TerrainLayer {
  private readonly cells: Uint8Array;

  constructor(readonly cols: number, readonly rows: number) {
    this.cells = new Uint8Array(cols * rows);
  }

  at(cx: number, cy: number): Terrain {
    if (cx < 0 || cx >= this.cols || cy < 0 || cy >= this.rows) return Terrain.Plain;
    return this.cells[cy * this.cols + cx] as Terrain;
  }

  props(cx: number, cy: number): TerrainProps {
    return TERRAIN[this.at(cx, cy)];
  }

  set(cx: number, cy: number, terrain: Terrain) {
    if (cx < 0 || cx >= this.cols || cy < 0 || cy >= this.rows) return;
    this.cells[cy * this.cols + cx] = terrain;
  }

  /** True when nothing has been painted — the model can then skip terrain work. */
  get isEmpty(): boolean {
    return !this.cells.some(v => v !== Terrain.Plain);
  }

  clear() {
    this.cells.fill(Terrain.Plain);
  }
}
