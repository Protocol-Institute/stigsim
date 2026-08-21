export interface FixedStepResult {
  steps: number;
  remainderMs: number;
}

export function calculateFixedSteps(
  remainderMs: number,
  elapsedMs: number,
  stepDurationMs: number,
  maximumCatchUpSteps: number,
): FixedStepResult {
  if (stepDurationMs <= 0 || maximumCatchUpSteps <= 0) {
    throw new Error("Fixed-step duration and catch-up limit must be positive");
  }

  const accumulatedMs = Math.max(0, remainderMs) + Math.max(0, elapsedMs);
  const availableSteps = Math.floor(accumulatedMs / stepDurationMs);
  const steps = Math.min(availableSteps, maximumCatchUpSteps);

  return {
    steps,
    // If the server was paused for a long time, discard excess whole steps
    // rather than entering a catch-up spiral. Keep only the fractional step.
    remainderMs: availableSteps > maximumCatchUpSteps
      ? accumulatedMs % stepDurationMs
      : accumulatedMs - steps * stepDurationMs,
  };
}
