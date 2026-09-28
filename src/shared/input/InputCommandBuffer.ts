import type { InputCommand } from './InputCommand';

/** Read-only access to the commands produced so far, indexed by tick. */
export interface InputCommandSource {
  /** Command for `tick`, or `undefined` if it was never produced or has been evicted. */
  get(tick: number): InputCommand | undefined;
  /** Most recent command, or `undefined` before the first tick. */
  readonly latest: InputCommand | undefined;
}

/**
 * Fixed-size history of input commands keyed by tick (ring buffer).
 *
 * Gameplay reads the command of the tick it is simulating; the history is
 * what client-side prediction will replay and what a network layer will
 * resend redundantly.
 */
export class InputCommandBuffer implements InputCommandSource {
  readonly capacity: number;

  private readonly slots: (InputCommand | undefined)[];
  private newest: InputCommand | undefined;

  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError(`capacity must be an integer >= 1, got ${capacity}`);
    }
    this.capacity = capacity;
    this.slots = new Array<InputCommand | undefined>(capacity).fill(undefined);
  }

  get latest(): InputCommand | undefined {
    return this.newest;
  }

  /** Appends a command. Ticks must be strictly increasing. */
  push(command: InputCommand): void {
    if (this.newest && command.tick <= this.newest.tick) {
      throw new RangeError(`Command tick ${command.tick} is not after the latest tick ${this.newest.tick}`);
    }
    this.slots[command.tick % this.capacity] = command;
    this.newest = command;
  }

  get(tick: number): InputCommand | undefined {
    if (!Number.isSafeInteger(tick) || tick < 0) return undefined;
    const command = this.slots[tick % this.capacity];
    return command?.tick === tick ? command : undefined;
  }

  clear(): void {
    this.slots.fill(undefined);
    this.newest = undefined;
  }
}
