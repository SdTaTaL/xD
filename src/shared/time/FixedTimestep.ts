export type FixedStepCallback = (tick: number, stepSeconds: number) => void;

/**
 * Fixed-timestep accumulator.
 *
 * Converts variable real-time deltas into a whole number of fixed-length
 * simulation ticks and exposes the leftover fraction for render
 * interpolation. It owns no clock: callers feed elapsed seconds, so the same
 * code can be driven by requestAnimationFrame on the client or by a timer on
 * a headless server.
 */
export class FixedTimestep {
  readonly tickRate: number;
  readonly stepSeconds: number;

  private readonly maxStepsPerAdvance: number;
  private accumulator = 0;
  private nextTick = 0;
  private droppedTicks = 0;

  /**
   * @param tickRate Ticks per second.
   * @param maxStepsPerAdvance Upper bound of ticks run by one `advance` call.
   *   Protects against the "spiral of death" after long stalls.
   */
  constructor(tickRate: number, maxStepsPerAdvance: number) {
    if (!Number.isFinite(tickRate) || tickRate <= 0) {
      throw new RangeError(`tickRate must be a positive number, got ${tickRate}`);
    }
    if (!Number.isInteger(maxStepsPerAdvance) || maxStepsPerAdvance < 1) {
      throw new RangeError(`maxStepsPerAdvance must be an integer >= 1, got ${maxStepsPerAdvance}`);
    }
    this.tickRate = tickRate;
    this.stepSeconds = 1 / tickRate;
    this.maxStepsPerAdvance = maxStepsPerAdvance;
  }

  /** Index of the next tick to be simulated (= number of ticks simulated so far). */
  get tick(): number {
    return this.nextTick;
  }

  /** Progress towards the next tick, in [0, 1). Used to interpolate rendered state. */
  get alpha(): number {
    return this.accumulator / this.stepSeconds;
  }

  /** Ticks discarded because the caller fell too far behind real time. */
  get dropped(): number {
    return this.droppedTicks;
  }

  /**
   * Accumulates `elapsedSeconds` and runs `step` once per whole tick.
   * Non-positive or non-finite input is ignored.
   *
   * @returns Number of ticks simulated by this call.
   */
  advance(elapsedSeconds: number, step: FixedStepCallback): number {
    if (!(elapsedSeconds > 0) || !Number.isFinite(elapsedSeconds)) {
      return 0;
    }

    this.accumulator += elapsedSeconds;

    let steps = 0;
    while (this.accumulator >= this.stepSeconds) {
      if (steps === this.maxStepsPerAdvance) {
        // Too far behind (long GC pause, breakpoint, background tab): drop the
        // backlog instead of trying to catch up, keeping the sub-tick remainder.
        const backlog = Math.floor(this.accumulator / this.stepSeconds);
        this.droppedTicks += backlog;
        this.accumulator -= backlog * this.stepSeconds;
        break;
      }

      step(this.nextTick, this.stepSeconds);
      this.nextTick++;
      this.accumulator -= this.stepSeconds;
      steps++;
    }

    return steps;
  }

  /** Clears accumulated time and counters. */
  reset(): void {
    this.accumulator = 0;
    this.nextTick = 0;
    this.droppedTicks = 0;
  }
}
