import { NEST_HALO, ODOR_LEVEL } from "./constants";
import { DOCTRINE_CHANNELS, type DoctrineChannel, type RoleTable } from "./doctrine";
import { deterministicPow, type Rng } from "./rng";
import type { Topology } from "./topology";
import type { AntState, Colony, FoodSource } from "./types";

/** What a read needs to know about the world. Simulation satisfies this. */
export interface ReadContext {
  readonly colonies: readonly Colony[];
  readonly foodSources: readonly FoodSource[];
  readonly topology: Topology;
}

/** The channel a state steers by: searching ants follow food, returning ants follow home. */
export const STATE_CHANNEL: Record<AntState, DoctrineChannel> = { searching: "food", returning: "home" };

/**
 * The (own, enemy) pair an ant of `colony` reads on one channel at one cell.
 * Under `private` the enemy is zero; under `shared` every layer is summed
 * into own and the origin axis collapses; under `separable` the others' sum
 * is reported apart. An invisible channel is private under every mode.
 */
export function readPair(
  ctx: ReadContext, colony: Colony, ch: DoctrineChannel, cx: number, cy: number,
): [number, number] {
  const own = colony.field.get(ch, cx, cy);
  const { read, visible } = ctx.topology;
  if (read === "private" || !visible[ch]) return [own, 0];
  let others = 0;
  for (const other of ctx.colonies) {
    if (other !== colony) others += other.field.get(ch, cx, cy);
  }
  return read === "shared" ? [own + others, 0] : [own, others];
}

/**
 * Nest and food as smells rather than stored pheromone: a pure function of
 * world state, private to the colony by construction for the nest, and not
 * something any ant can lay or any evaporation can erase.
 */
export function odor(
  colony: Colony, foodSources: readonly FoodSource[], state: AntState, cx: number, cy: number,
): number {
  if (state === "returning") {
    const d = Math.abs(cx - colony.nestX) + Math.abs(cy - colony.nestY);
    if (d === 0) return ODOR_LEVEL;
    if (d === 1) return ODOR_LEVEL * NEST_HALO;
    return 0;
  }
  for (const src of foodSources) {
    if (src.x === cx && src.y === cy && src.remaining > 0) return ODOR_LEVEL;
  }
  return 0;
}

/**
 * Product over (channel, origin) of (read + 1) ^ follow. A zero exponent is
 * skipped rather than computed, so the default doctrine costs one
 * deterministicPow per candidate, as the single exponent did. Odor is added
 * inside the read of the steering channel: outside the power it would lose to
 * any strong trail, and the beacon it replaces never did.
 */
export function scoreCell(
  ctx: ReadContext, colony: Colony, table: RoleTable, state: AntState, cx: number, cy: number,
): number {
  let score = 1;
  const row = table.follow[state];
  const steer = STATE_CHANNEL[state];
  for (const ch of DOCTRINE_CHANNELS) {
    const w = row[ch];
    if (w.own === 0 && w.enemy === 0) continue;
    const pair = readPair(ctx, colony, ch, cx, cy);
    const own = ch === steer ? pair[0] + odor(colony, ctx.foodSources, state, cx, cy) : pair[0];
    if (w.own !== 0) score *= deterministicPow(own + 1, w.own);
    if (w.enemy !== 0) score *= deterministicPow(pair[1] + 1, w.enemy);
  }
  return score;
}

/** The roulette wheel, unchanged: one draw, weighted by score. */
export function chooseNext(
  ctx: ReadContext, colony: Colony, table: RoleTable, state: AntState,
  cells: [number, number][], rng: Rng,
): [number, number] {
  const scores = cells.map(([cx, cy]) => scoreCell(ctx, colony, table, state, cx, cy));
  const total = scores.reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (let i = 0; i < cells.length; i++) { r -= scores[i]; if (r <= 0) return cells[i]; }
  return cells[cells.length - 1];
}
