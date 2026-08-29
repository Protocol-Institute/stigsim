// ─────────────────────────────────────────────────────────────────────────────
// Food spawning policy.
//
// Imported by BOTH the browser simulator and the shared-world server. Pure:
// it decides *what* to place and leaves placing it to the caller, so it can be
// tested without a simulation and reused by two engines that store their worlds
// very differently.
//
// The world has a carrying capacity rather than a fixed larder. While standing
// food is under budget, new sources appear; as colonies eat, headroom reopens
// and more arrives. Colony populations should rise and fall against that
// ceiling, which is the intended behaviour and not a runaway.
// ─────────────────────────────────────────────────────────────────────────────

export interface FoodSpawnConfig {
  /** Total standing food units the world will sustain at once. */
  capacityUnits: number;
  /** Simulation steps between spawn attempts. */
  intervalTicks: number;
  /** Most new sources one attempt may create. */
  maxSourcesPerAttempt: number;
  /** Size range of a new source, in food units. */
  minUnits: number;
  maxUnits: number;
  /**
   * Chance a new source lands near somewhere food has been before, rather than
   * anywhere in the region.
   *
   * This is the setting that makes trails worth building. Under uniform
   * spawning there is no reason to maintain a route to anywhere, because the
   * place you just ate will not refill — so colonies that invest in
   * infrastructure do worse than colonies that wander. Clustering creates
   * persistent groves that repay the investment.
   */
  clusterChance: number;
  /** How far from a remembered site a clustered source may land, in cells. */
  clusterRadius: number;
  /** Placement attempts before giving up on one source. */
  placementAttempts: number;
}

export const DEFAULT_FOOD_SPAWN: FoodSpawnConfig = {
  capacityUnits: 4_000,
  intervalTicks: 250,
  maxSourcesPerAttempt: 3,
  minUnits: 120,
  maxUnits: 600,
  clusterChance: 0.7,
  clusterRadius: 6,
  placementAttempts: 24,
};

/** Inclusive cell bounds within which food may appear. */
export interface SpawnRegion {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface SpawnSite {
  x: number;
  y: number;
}

export interface SpawnWorld {
  /** Total food units currently standing in the world. */
  standingUnits: number;
  region: SpawnRegion;
  /** Places food has occupied recently. Empty is fine; spawning is then uniform. */
  memory: readonly SpawnSite[];
  /** Whether a source may be created on this cell. */
  canPlaceAt(x: number, y: number): boolean;
}

export interface PlannedSource extends SpawnSite {
  units: number;
}

/** Whether this tick is a spawn attempt. */
export function isSpawnTick(tick: number, config: FoodSpawnConfig): boolean {
  return config.intervalTicks > 0 && tick > 0 && tick % config.intervalTicks === 0;
}

function randomInt(random: () => number, min: number, max: number): number {
  return min + Math.floor(random() * (max - min + 1));
}

/**
 * Decide what food to add this attempt. Returns an empty array when the world
 * is at capacity or nowhere valid could be found.
 *
 * `random` is injected rather than called directly so the browser simulator can
 * pass its seeded stream and keep runs reproducible, while the shared world —
 * which is live and not replayed — passes Math.random.
 */
export function planFoodSpawn(
  world: SpawnWorld,
  config: FoodSpawnConfig,
  random: () => number,
): PlannedSource[] {
  let headroom = config.capacityUnits - world.standingUnits;
  if (headroom < config.minUnits) return [];

  const planned: PlannedSource[] = [];
  const claimed = new Set<string>();
  const attempts = randomInt(random, 1, Math.max(1, config.maxSourcesPerAttempt));

  for (let i = 0; i < attempts; i++) {
    if (headroom < config.minUnits) break;

    const units = Math.min(headroom, randomInt(random, config.minUnits, config.maxUnits));
    const site = choosePlacement(world, config, random, claimed);
    if (!site) break;

    claimed.add(`${site.x},${site.y}`);
    planned.push({ x: site.x, y: site.y, units });
    headroom -= units;
  }

  return planned;
}

function choosePlacement(
  world: SpawnWorld,
  config: FoodSpawnConfig,
  random: () => number,
  claimed: Set<string>,
): SpawnSite | null {
  const { region, memory } = world;
  const clustered = memory.length > 0 && random() < config.clusterChance;

  for (let attempt = 0; attempt < config.placementAttempts; attempt++) {
    let x: number;
    let y: number;

    if (clustered) {
      const anchor = memory[Math.floor(random() * memory.length)];
      const r = config.clusterRadius;
      x = anchor.x + randomInt(random, -r, r);
      y = anchor.y + randomInt(random, -r, r);
    } else {
      x = randomInt(random, region.minX, region.maxX);
      y = randomInt(random, region.minY, region.maxY);
    }

    if (x < region.minX || x > region.maxX || y < region.minY || y > region.maxY) continue;
    if (claimed.has(`${x},${y}`)) continue;
    if (!world.canPlaceAt(x, y)) continue;
    return { x, y };
  }

  return null;
}

/**
 * A bounded record of where food has been, used as the anchor set for clustered
 * spawning. Newest entries evict oldest, so groves drift slowly as the world is
 * reshaped rather than being pinned to wherever the world started.
 */
export class SiteMemory {
  private sites: SpawnSite[] = [];

  constructor(private readonly limit: number = 32) {}

  remember(x: number, y: number) {
    const existing = this.sites.findIndex(s => s.x === x && s.y === y);
    if (existing >= 0) this.sites.splice(existing, 1);
    this.sites.push({ x, y });
    if (this.sites.length > this.limit) this.sites.shift();
  }

  get entries(): readonly SpawnSite[] {
    return this.sites;
  }
}
