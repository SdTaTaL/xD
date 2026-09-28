import type { FrameContext, GameSystem, TickContext } from './GameSystem';

type FrameHook = (frame: FrameContext) => void;
type TickHook = (tick: TickContext) => void;

/**
 * Ordered registry of game systems. Dispatches each loop phase to the systems
 * that implement it, using pre-bound per-phase lists so the per-frame path
 * performs no lookups or allocations.
 */
export class SystemScheduler {
  private readonly systems: GameSystem[] = [];
  private readonly beginFrameHooks: FrameHook[] = [];
  private readonly fixedUpdateHooks: TickHook[] = [];
  private readonly updateHooks: FrameHook[] = [];
  private readonly renderHooks: FrameHook[] = [];
  private readonly endFrameHooks: FrameHook[] = [];
  private disposed = false;

  add(system: GameSystem): void {
    if (this.disposed) {
      throw new Error(`Cannot add system "${system.name}" to a disposed scheduler`);
    }
    if (this.systems.some((existing) => existing.name === system.name)) {
      throw new Error(`A system named "${system.name}" is already registered`);
    }

    this.systems.push(system);
    if (system.beginFrame) this.beginFrameHooks.push(system.beginFrame.bind(system));
    if (system.fixedUpdate) this.fixedUpdateHooks.push(system.fixedUpdate.bind(system));
    if (system.update) this.updateHooks.push(system.update.bind(system));
    if (system.render) this.renderHooks.push(system.render.bind(system));
    if (system.endFrame) this.endFrameHooks.push(system.endFrame.bind(system));
  }

  beginFrame(frame: FrameContext): void {
    for (const hook of this.beginFrameHooks) hook(frame);
  }

  fixedUpdate(tick: TickContext): void {
    for (const hook of this.fixedUpdateHooks) hook(tick);
  }

  update(frame: FrameContext): void {
    for (const hook of this.updateHooks) hook(frame);
  }

  render(frame: FrameContext): void {
    for (const hook of this.renderHooks) hook(frame);
  }

  endFrame(frame: FrameContext): void {
    for (const hook of this.endFrameHooks) hook(frame);
  }

  /** Disposes every system in reverse registration order. Idempotent. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    for (let i = this.systems.length - 1; i >= 0; i--) {
      this.systems[i]?.dispose?.();
    }

    this.systems.length = 0;
    this.beginFrameHooks.length = 0;
    this.fixedUpdateHooks.length = 0;
    this.updateHooks.length = 0;
    this.renderHooks.length = 0;
    this.endFrameHooks.length = 0;
  }
}
