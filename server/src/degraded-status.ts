export class ThrottledFailureReporter {
  private failing = false;
  private lastWarningAt = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly warningIntervalMs: number,
    private readonly warn: (error: unknown) => void,
    private readonly recovered: () => void,
  ) {}

  reportFailure(error: unknown, nowMs = Date.now()) {
    if (!this.failing || nowMs - this.lastWarningAt >= this.warningIntervalMs) {
      this.warn(error);
      this.lastWarningAt = nowMs;
    }
    this.failing = true;
  }

  reportSuccess() {
    if (!this.failing) return;
    this.failing = false;
    this.recovered();
  }
}
