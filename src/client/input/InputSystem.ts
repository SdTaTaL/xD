import { InputCommandBuffer, type InputCommandSource } from '@shared/input/InputCommandBuffer';
import type { GameSystem, TickContext } from '../core/GameSystem';
import type { InputAdapter } from './adapters/InputAdapter';
import { InputCommandBuilder } from './InputCommandBuilder';
import { InputState, type InputPort, type LookDelta } from './InputState';

export interface InputSystemOptions {
  /** How many past ticks of commands stay readable. */
  readonly historyTicks: number;
}

/**
 * Produces exactly one immutable {@link InputCommand} per simulation tick
 * from whatever input adapters are registered.
 *
 * Pipeline: device → adapter → {@link InputState} → {@link InputCommandBuilder}
 * → {@link InputCommandBuffer} → gameplay. Gameplay systems registered after
 * this one read `commands.get(tick)` in their own `fixedUpdate`; they never
 * see devices or DOM events. Rendering does not depend on it at all.
 *
 * @see InputCommand
 */
export class InputSystem implements GameSystem {
  readonly name = 'input';

  private readonly state = new InputState();
  private readonly builder = new InputCommandBuilder();
  private readonly buffer: InputCommandBuffer;
  private readonly adapters: InputAdapter[] = [];

  constructor(options: InputSystemOptions) {
    this.buffer = new InputCommandBuffer(options.historyTicks);
  }

  /** Commands produced so far, by tick. */
  get commands(): InputCommandSource {
    return this.buffer;
  }

  /**
   * Connects a new input source and registers the adapter created for it.
   * The system owns the adapter from then on and disposes it.
   */
  addAdapter<T extends InputAdapter>(sourceId: string, create: (port: InputPort) => T): T {
    const port = this.state.connect(sourceId);
    try {
      const adapter = create(port);
      this.adapters.push(adapter);
      return adapter;
    } catch (error) {
      this.state.disconnect(sourceId);
      throw error;
    }
  }

  /**
   * Look input received since the last tick that is not yet in any command
   * (presentation only: the view can turn at display rate without waiting for
   * the next tick; the simulation still only sees commands).
   */
  previewLook(elapsedSinceTickSeconds: number): LookDelta {
    return this.state.peekLook(elapsedSinceTickSeconds);
  }

  beginFrame(): void {
    for (const adapter of this.adapters) adapter.poll?.();
  }

  fixedUpdate(tick: TickContext): void {
    const sample = this.state.sample(tick.deltaSeconds);
    this.buffer.push(this.builder.build(tick.tick, sample));
  }

  dispose(): void {
    for (let i = this.adapters.length - 1; i >= 0; i--) this.adapters[i]?.dispose();
    this.adapters.length = 0;
    this.state.reset();
    this.buffer.clear();
  }
}
