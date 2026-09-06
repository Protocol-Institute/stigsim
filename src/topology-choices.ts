import {
  DOCTRINE_CHANNELS, ROLES, STATES, TOPOLOGY_MIMICRY, TOPOLOGY_OPEN, TOPOLOGY_PRIVATE, TOPOLOGY_SENSING,
  cloneDoctrine,
} from "@stigsim/sim-core";
import type { Doctrine, Topology } from "@stigsim/sim-core";

export interface TopologyChoice {
  name: "private" | "sensing" | "mimicry" | "open";
  label: string;
  description: string;
  topology: Topology;
}

export const TOPOLOGY_CHOICES: readonly TopologyChoice[] = [
  { name: "private", label: "Private", description: "Each colony smells only its own trails. Colonies compete only for food.", topology: TOPOLOGY_PRIVATE },
  { name: "sensing", label: "Sensing", description: "Colonies can smell each other's trails and choose to follow or avoid them. Nobody can fake anything.", topology: TOPOLOGY_SENSING },
  { name: "mimicry", label: "Mimicry", description: "As Sensing, and spoilers can lay the other colony's chemical, which its ants cannot tell from their own.", topology: TOPOLOGY_MIMICRY },
  { name: "open", label: "Open", description: "One shared food trail for everyone. Nobody can tell whose trail is whose; home stays private.", topology: TOPOLOGY_OPEN },
];

/** The choice a running simulation's topology corresponds to, by read mode and mimic switch. */
export function choiceFor(t: Topology): TopologyChoice {
  return TOPOLOGY_CHOICES.find(c => c.topology.read === t.read && c.topology.mimicEnemy === t.mimicEnemy)
    ?? TOPOLOGY_CHOICES[0];
}

/**
 * Zero the atoms that mean nothing under a topology, so a doctrine carried
 * across a topology switch does not keep invisible spoilers or a poach weight
 * alive behind sliders the panel no longer shows. Also clamps the mimic rate
 * to the topology's cap.
 */
export function conformDoctrine(d: Doctrine, t: Topology): Doctrine {
  const out = cloneDoctrine(d);
  if (!t.mimicEnemy) {
    out.spoilerFraction = 0;
    out.mimicRate = 0;
  }
  out.mimicRate = Math.min(out.mimicRate, t.maxMimicRate);
  if (t.read !== "separable") {
    for (const r of ROLES) for (const s of STATES) for (const c of DOCTRINE_CHANNELS) out[r].follow[s][c].enemy = 0;
  }
  return out;
}
