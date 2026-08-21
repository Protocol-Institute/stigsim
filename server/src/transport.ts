import type { FoodSourceWire, ServerMessage } from "../../shared/infinite-contract";
import type { InfiniteSimulation } from "./sim";

export function shouldSendVolatileFrame(
  bufferedAmount: number,
  maximumBufferedBytes: number,
): boolean {
  return bufferedAmount <= maximumBufferedBytes;
}

export function makeIdempotentCleanup(cleanup: () => void): () => void {
  let cleanedUp = false;
  return () => {
    if (cleanedUp) return;
    cleanedUp = true;
    cleanup();
  };
}

export class TokenBucket {
  private tokens: number;
  private lastRefillMs: number;

  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
    nowMs = Date.now(),
  ) {
    this.tokens = capacity;
    this.lastRefillMs = nowMs;
  }

  tryTake(nowMs = Date.now()): boolean {
    const elapsedMs = Math.max(0, nowMs - this.lastRefillMs);
    this.lastRefillMs = nowMs;
    this.tokens = Math.min(
      this.capacity,
      this.tokens + elapsedMs * this.refillPerSecond / 1_000,
    );
    if (this.tokens < 1) return false;
    this.tokens--;
    return true;
  }
}

export function foodUpsertMessage(foodSource: FoodSourceWire): ServerMessage {
  return { type: "foodUpsert", foodSource };
}

export function foodRemovedMessage(x: number, y: number): ServerMessage {
  return { type: "foodRemoved", x, y };
}

export function removeFoodAndCreateMessage(
  sim: Pick<InfiniteSimulation, "removeFood">,
  x: number,
  y: number,
): ServerMessage | null {
  return sim.removeFood(x, y) ? foodRemovedMessage(x, y) : null;
}
