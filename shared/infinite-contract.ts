// ─────────────────────────────────────────────────────────────────────────────
// Infinite-mode wire contract
//
// This module is imported by BOTH the frontend (src/components/InfiniteSim.tsx)
// and the server (server/src/*). The constants below must stay identical on
// both sides — clients render exactly what the server simulates.
// ─────────────────────────────────────────────────────────────────────────────

/** Size of one world cell in pixels (world space). */
export const CELL = 16;
/** Pheromone chunks are CHUNK_SIZE × CHUNK_SIZE cells. */
export const CHUNK_SIZE = 32;
/** Simulation steps per second on the server. */
export const TICKS_PER_SEC = 50;

/** Colony color palette — colorIdx indexes into this on both sides. */
export const COLONY_COLORS = [
  { primary: "#4b9eff", homeRGB: "80,158,255", foodRGB: "80,220,200" },
  { primary: "#ff6b6b", homeRGB: "255,107,107", foodRGB: "255,200,80" },
  { primary: "#4bde80", homeRGB: "75,222,128", foodRGB: "200,255,80" },
  { primary: "#c084fc", homeRGB: "192,132,252", foodRGB: "252,132,200" },
  { primary: "#fb923c", homeRGB: "251,146,60", foodRGB: "251,220,100" },
  { primary: "#38bdf8", homeRGB: "56,189,248", foodRGB: "100,220,255" },
  { primary: "#f472b6", homeRGB: "244,114,182", foodRGB: "255,180,220" },
  { primary: "#a3e635", homeRGB: "163,230,53", foodRGB: "200,255,100" },
];

// ─── Domain types ────────────────────────────────────────────────────────────

export interface ColonyParams {
  numAnts: number;
  evapRate: number;
  trailPower: number;
  tankMax: number;
  cautionary: boolean;
  colorIdx: number;
  name: string;
}

export const DEFAULT_COLONY_PARAMS: ColonyParams = {
  numAnts: 20,
  evapRate: 0.005,
  trailPower: 5,
  tankMax: 6400,
  cautionary: false,
  colorIdx: 0,
  name: "Colony",
};

export interface ColonyInfo {
  id: number;
  nestX: number;
  nestY: number;
  params: ColonyParams;
  foodCollected: number;
}

/** Food source as serialized in `init` / `foodUpsert` messages. */
export interface FoodSourceWire {
  x: number;
  y: number;
  remaining: number;
  total: number;
}

/** Compact food source as serialized in `tick` messages. */
export interface FoodSourceTick {
  x: number;
  y: number;
  r: number; // remaining
  t: number; // total
}

/** Compact ant as serialized in `tick` messages. */
export interface AntWire {
  cid: number; // colony id
  wx: number;  // world-space pixel x
  wy: number;  // world-space pixel y
  f: number;   // 1 if carrying food
}

/** One pheromone chunk: key is "cx,cy"; arrays are CHUNK_SIZE² bytes 0–255. */
export interface PheroChunkWire {
  key: string;
  home: number[];
  food: number[];
}

export interface LeaderboardEntry {
  name: string;
  lifespanTicks: number;
  alive: boolean;
}

// ─── WebSocket messages: client → server ────────────────────────────────────

export type ClientMessage =
  | { type: "toggleWall"; x: number; y: number }
  | { type: "placeFood"; x: number; y: number; units?: number }
  | { type: "removeFood"; x: number; y: number }
  | { type: "placeColony"; x: number; y: number; params?: Partial<ColonyParams> }
  | { type: "removeColony"; id: number };

// ─── WebSocket messages: server → client ────────────────────────────────────

export type ServerMessage =
  | { type: "init"; walls: string[]; colonies: ColonyInfo[]; foodSources: FoodSourceWire[] }
  | { type: "tick"; ants: AntWire[]; foodSources: FoodSourceTick[]; fc: { id: number; n: number; ageTicks: number }[] }
  | { type: "phero"; colonies: { id: number; chunks: PheroChunkWire[]; cleared: string[] }[] }
  | { type: "wallUpdate"; x: number; y: number; v: number } // v: 1 = now open, 0 = now wall
  | { type: "foodUpsert"; foodSource: FoodSourceWire }
  | { type: "foodRemoved"; x: number; y: number }
  | { type: "colonyAdded"; colony: ColonyInfo }
  | { type: "colonyAssigned"; colony: ColonyInfo }
  | { type: "colonyRemoved"; id: number }
  | { type: "colonyDied"; colonyId: number; name: string; lifespanTicks: number };
