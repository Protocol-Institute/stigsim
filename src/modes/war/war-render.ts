import { render } from "../../render";
import type { WarSimulation } from "./war-simulation";

/** Draw the authoritative War runtime for local matches and verified replays. */
export function drawWar(ctx: CanvasRenderingContext2D, war: WarSimulation): void {
  render(ctx, war.simulation, "all", 0, "none", null, ant => {
    const state = war.getAntSnapshot(ant);
    return state ? 0.3 + 0.7 * Math.max(0, Math.min(1, state.energy / war.rules.maxEnergy)) : 1;
  });
  for (const colony of war.simulation.colonies) {
    for (const ant of colony.ants) {
      const state = war.getAntSnapshot(ant);
      if (!state || state.energy > war.rules.retreatEnergy) continue;
      ctx.beginPath();
      ctx.arc(ant.x, ant.y, 5.5, 0, Math.PI * 2);
      ctx.strokeStyle = "#ef4444";
      ctx.lineWidth = 1.25;
      ctx.stroke();
    }
  }
}
