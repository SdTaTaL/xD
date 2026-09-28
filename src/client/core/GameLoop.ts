import { FixedTimestep } from '@shared/time/FixedTimestep';
import type { FrameContext, TickContext } from './GameSystem';
import type { SystemScheduler } from './SystemScheduler';

export interface GameLoopOptions {
  /** Simulation ticks per second. */
  readonly tickRate: number;
  /** Upper bound for a frame's delta; longer stalls are treated as this long. */
  readonly maxFrameDeltaSeconds: number;
  /** Upper bound of simulation ticks run in a single frame. */
  readonly maxTicksPerFrame: number;
  /** Invoked (once) if a frame throws. The loop is stopped before the call. */
  readonly onError: (error: unknown) => void;
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/**
 * Browser main loop.
 *
 * Driven by requestAnimationFrame: simulation runs at a fixed tick rate
 * (decoupled from display refresh rate) while presentation and rendering run
 * once per displayed frame. See GameSystem for the phase order.
 */
export class GameLoop {
  private readonly scheduler: SystemScheduler;
  private readonly options: GameLoopOptions;
  private readonly timestep: FixedTimestep;
  private readonly frame: Mutable<FrameContext> = { index: 0, deltaSeconds: 0, elapsedSeconds: 0, alpha: 0 };
  private readonly tickContext: Mutable<TickContext>;

  private requestId: number | null = null;
  private lastTimestamp: number | null = null;

  constructor(scheduler: SystemScheduler, options: GameLoopOptions) {
    this.scheduler = scheduler;
    this.options = options;
    this.timestep = new FixedTimestep(options.tickRate, options.maxTicksPerFrame);
    this.tickContext = { tick: 0, deltaSeconds: this.timestep.stepSeconds };
  }

  get running(): boolean {
    return this.requestId !== null;
  }

  start(): void {
    if (this.running) return;
    this.lastTimestamp = null;
    this.requestId = requestAnimationFrame(this.onAnimationFrame);
  }

  stop(): void {
    if (this.requestId === null) return;
    cancelAnimationFrame(this.requestId);
    this.requestId = null;
  }

  private readonly onAnimationFrame = (timestamp: DOMHighResTimeStamp): void => {
    this.requestId = requestAnimationFrame(this.onAnimationFrame);

    const rawDelta = this.lastTimestamp === null ? 0 : (timestamp - this.lastTimestamp) / 1000;
    this.lastTimestamp = timestamp;
    const deltaSeconds = Math.min(Math.max(rawDelta, 0), this.options.maxFrameDeltaSeconds);

    try {
      this.runFrame(deltaSeconds);
    } catch (error) {
      // A broken frame would otherwise throw again on every following frame.
      this.stop();
      this.options.onError(error);
    }
  };

  private runFrame(deltaSeconds: number): void {
    const frame = this.frame;
    frame.deltaSeconds = deltaSeconds;
    frame.elapsedSeconds += deltaSeconds;

    this.scheduler.beginFrame(frame);
    this.timestep.advance(deltaSeconds, this.onTick);
    frame.alpha = this.timestep.alpha;
    this.scheduler.update(frame);
    this.scheduler.render(frame);
    this.scheduler.endFrame(frame);

    frame.index++;
  }

  private readonly onTick = (tick: number, stepSeconds: number): void => {
    this.tickContext.tick = tick;
    this.tickContext.deltaSeconds = stepSeconds;
    this.scheduler.fixedUpdate(this.tickContext);
  };
}
