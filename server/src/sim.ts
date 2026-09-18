/**
 * Server compatibility surface for Infinite Mode.
 *
 * The authoritative implementation lives in sim-core as infinite@1. Keeping
 * these aliases avoids coupling persistence, transport, and tests to the
 * package's longer neutral type names during the migration.
 */
export {
  InfiniteSimulation,
  INFINITE_ENERGY_MAX as ENERGY_MAX,
} from "@stigsim/sim-core";

export type {
  InfiniteDeadColony as DeadColony,
  InfiniteFoodSource as FoodSource,
  InfinitePersistedColony as PersistedColony,
  InfinitePersistedWorld as PersistedWorld,
} from "@stigsim/sim-core";
