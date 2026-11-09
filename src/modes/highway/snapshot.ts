import { CELL, type Simulation } from '@stigsim/sim-core';
export function snapshot(sim: Simulation) {
  const { cols, rows } = sim.bounds;
  const colony = sim.colonies[0];
  return {
    cols, rows, tick: sim.tick, deliveries: colony.foodCollected,
    nest: [colony.nestX, colony.nestY], food: [sim.foodSources[0].x, sim.foodSources[0].y],
    cells: Array.from({ length: cols * rows }, (_, i) => {
      const x = i % cols, y = Math.floor(i / cols);
      return { open: sim.occupancy.isOpen(x, y), trail: colony.field.get('food', x, y) };
    }),
    ants: colony.ants.map(a => ({ x: a.x / CELL, y: a.y / CELL, carrying: a.hasFood })),
  };
}
export type HighwaySnapshot = ReturnType<typeof snapshot>;
