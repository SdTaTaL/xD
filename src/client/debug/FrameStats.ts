export interface FrameStatsSample {
  /** Frames per second over the window. */
  readonly fps: number;
  /** Average interval between frames, in ms. */
  readonly frameTimeMs: number;
  /** Longest interval between two frames in the window, in ms. */
  readonly frameTimeMaxMs: number;
  /** Average main-thread time spent inside the frame, in ms. */
  readonly cpuTimeMs: number;
  /** Measured simulation ticks per second. */
  readonly tickRate: number;
}

/**
 * Aggregates frame timings over fixed-length windows. Pure bookkeeping: the
 * caller supplies every timestamp, which keeps it independent of the DOM.
 */
export class FrameStats {
  private readonly windowMs: number;
  private windowStart: number | null = null;
  private frames = 0;
  private frameTimeSum = 0;
  private frameTimeMax = 0;
  private cpuTimeSum = 0;
  private ticks = 0;

  constructor(windowMs: number) {
    this.windowMs = windowMs;
  }

  recordFrame(frameTimeMs: number, cpuTimeMs: number): void {
    this.frames++;
    this.frameTimeSum += frameTimeMs;
    this.frameTimeMax = Math.max(this.frameTimeMax, frameTimeMs);
    this.cpuTimeSum += cpuTimeMs;
  }

  recordTick(): void {
    this.ticks++;
  }

  /**
   * Closes the current window once it has lasted `windowMs`.
   * @returns The window's sample, or `null` while the window is still open.
   */
  flush(now: number): FrameStatsSample | null {
    if (this.windowStart === null) {
      this.windowStart = now;
      return null;
    }

    const elapsedMs = now - this.windowStart;
    if (elapsedMs < this.windowMs || this.frames === 0) return null;

    const sample: FrameStatsSample = {
      fps: (this.frames * 1000) / elapsedMs,
      frameTimeMs: this.frameTimeSum / this.frames,
      frameTimeMaxMs: this.frameTimeMax,
      cpuTimeMs: this.cpuTimeSum / this.frames,
      tickRate: (this.ticks * 1000) / elapsedMs,
    };

    this.windowStart = now;
    this.frames = 0;
    this.frameTimeSum = 0;
    this.frameTimeMax = 0;
    this.cpuTimeSum = 0;
    this.ticks = 0;
    return sample;
  }
}
