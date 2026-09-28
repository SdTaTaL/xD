/**
 * Per-frame timing information.
 *
 * The loop reuses a single instance across frames: read it during the call,
 * never keep a reference to it.
 */
export interface FrameContext {
  /** Monotonic frame counter. */
  readonly index: number;
  /** Seconds since the previous frame, clamped to the loop's max frame delta. */
  readonly deltaSeconds: number;
  /** Sum of all `deltaSeconds` since the loop started. */
  readonly elapsedSeconds: number;
  /**
   * Progress in [0, 1) from the latest simulation tick towards the next one.
   * Only meaningful from `update` onwards; used to interpolate rendered state.
   */
  readonly alpha: number;
}

/** Fixed-rate simulation tick information. Reused across ticks, like FrameContext. */
export interface TickContext {
  /** Simulation tick index. */
  readonly tick: number;
  /** Fixed duration of a tick, in seconds. */
  readonly deltaSeconds: number;
}

/**
 * A unit of client behaviour driven by the game loop.
 *
 * Every hook is optional. Within a frame they run in this order, and within a
 * phase systems run in registration order:
 *
 * 1. `beginFrame`  once   — sample external state (input, network) before simulating.
 * 2. `fixedUpdate` 0..n   — deterministic simulation at the fixed tick rate.
 * 3. `update`      once   — variable-rate presentation (interpolation, camera, UI).
 * 4. `render`      once   — submit the frame to the GPU.
 * 5. `endFrame`    once   — diagnostics and bookkeeping after rendering.
 */
export interface GameSystem {
  /** Unique, human readable identifier (diagnostics). */
  readonly name: string;
  beginFrame?(frame: FrameContext): void;
  fixedUpdate?(tick: TickContext): void;
  update?(frame: FrameContext): void;
  render?(frame: FrameContext): void;
  endFrame?(frame: FrameContext): void;
  /** Releases resources. Called once, in reverse registration order. */
  dispose?(): void;
}
