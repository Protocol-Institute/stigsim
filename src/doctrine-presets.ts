import { DEFAULT_DOCTRINE, cloneDoctrine } from "@stigsim/sim-core";
import type { Doctrine, Topology } from "@stigsim/sim-core";

/**
 * A named doctrine with a one-line intent. The engine never sees a preset;
 * picking one emits setDoctrine with its doctrine.
 */
export interface DoctrinePreset {
  name: string;
  intent: string;
  doctrine: Doctrine;
  /** Whether the preset's nonzero atoms mean anything under this topology. */
  available: (topology: Topology) => boolean;
}

/** Today's single trail-bias slider set both steering exponents; presets do the same. */
export function withExponent(base: Doctrine, p: number): Doctrine {
  const d = cloneDoctrine(base);
  d.forager.follow.searching.food.own = p;
  d.forager.follow.returning.home.own = p;
  return d;
}

const always = () => true;

const scout = withExponent(DEFAULT_DOCTRINE, 2);
scout.evapRate = 0.01;

const volatile = cloneDoctrine(DEFAULT_DOCTRINE);
volatile.evapRate = 0.02;

const saboteur = cloneDoctrine(DEFAULT_DOCTRINE);
saboteur.spoilerFraction = 0.2;
saboteur.mimicRate = 0.5;

const poacher = cloneDoctrine(DEFAULT_DOCTRINE);
poacher.forager.follow.searching.food.enemy = 3;

export const PRESETS: readonly DoctrinePreset[] = [
  { name: "Default", intent: "the Deneubourg model as shipped", doctrine: cloneDoctrine(DEFAULT_DOCTRINE), available: always },
  { name: "Highway", intent: "exploit the best route hard", doctrine: withExponent(DEFAULT_DOCTRINE, 8), available: always },
  { name: "Scout", intent: "explore widely, forget quickly", doctrine: scout, available: always },
  { name: "Volatile", intent: "resist fakes and escape mills, at the cost of memory", doctrine: volatile, available: always },
  { name: "Saboteur", intent: "send a fifth of the colony to lay false trail", doctrine: saboteur, available: t => t.mimicEnemy },
  { name: "Poacher", intent: "follow the other colony's food trail", doctrine: poacher, available: t => t.read === "separable" },
];
