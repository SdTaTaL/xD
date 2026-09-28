import { actionBit, NO_ACTIONS, type ActionMask, type InputAction } from '@shared/input/InputAction';

/**
 * The only way input adapters write into the input state. Each adapter gets
 * its own port, so contributions stay attributed to their device and can be
 * released independently. All values are device independent.
 */
export interface InputPort {
  /** Stable identifier of the input source this port belongs to. */
  readonly sourceId: string;
  /** Starts holding `action`. Idempotent per source. */
  press(action: InputAction): void;
  /** Stops holding `action`. Idempotent per source. */
  release(action: InputAction): void;
  /**
   * Sets this source's analog movement intent (keys, stick, virtual
   * joystick). Components are clamped to [-1, 1]; +x = right, +y = forward.
   */
  setMove(x: number, y: number): void;
  /**
   * Adds a relative view rotation, in radians (+yaw = right, +pitch = up).
   * For position-based devices: mouse, touch drag.
   */
  addLook(yaw: number, pitch: number): void;
  /**
   * Sets a continuous view rotation rate, in radians per second. Integrated
   * over each simulation tick. For rate-based devices: gamepad stick,
   * virtual camera joystick.
   */
  setLookRate(yawRate: number, pitchRate: number): void;
  /** Releases every action, movement and look rate held by this source. */
  releaseAll(): void;
}

/** Aggregated input of all sources for one tick, before quantization. */
export interface InputSample {
  /** Combined movement, clamped to the unit disc. */
  readonly moveX: number;
  readonly moveY: number;
  /** Look rotation accumulated since the previous sample, in radians. */
  readonly lookX: number;
  readonly lookY: number;
  /** Actions held by at least one source at sampling time. */
  readonly held: ActionMask;
  /** Actions that went down since the previous sample. */
  readonly pressed: ActionMask;
}

/** A view rotation, in radians (+yaw = right, +pitch = up). */
export interface LookDelta {
  readonly yaw: number;
  readonly pitch: number;
}

interface SourceState {
  held: ActionMask;
  moveX: number;
  moveY: number;
  lookRateX: number;
  lookRateY: number;
}

function finiteOr0(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(-1, finiteOr0(value)));
}

/**
 * Device-independent input state shared by every input source.
 *
 * - Actions are held while at least one source holds them. A press is
 *   recorded as an edge the moment it happens, so taps shorter than a tick
 *   are never lost.
 * - Movement is the sum of all sources, clamped to the unit disc.
 * - Look rotation accumulates between samples (relative devices) or is
 *   integrated per tick from rates (rate-based devices).
 *
 * `sample()` is called once per simulation tick and consumes the edges and
 * accumulated look.
 */
export class InputState {
  private readonly sources = new Map<string, SourceState>();
  private pendingPressed: ActionMask = NO_ACTIONS;
  private pendingLookX = 0;
  private pendingLookY = 0;

  /** Opens a port for a new input source. */
  connect(sourceId: string): InputPort {
    if (this.sources.has(sourceId)) {
      throw new Error(`Input source "${sourceId}" is already connected`);
    }

    const source: SourceState = { held: NO_ACTIONS, moveX: 0, moveY: 0, lookRateX: 0, lookRateY: 0 };
    this.sources.set(sourceId, source);

    return {
      sourceId,
      press: (action) => this.press(source, action),
      release: (action) => {
        source.held &= ~actionBit(action);
      },
      setMove: (x, y) => {
        source.moveX = clampUnit(x);
        source.moveY = clampUnit(y);
      },
      addLook: (yaw, pitch) => {
        this.pendingLookX += finiteOr0(yaw);
        this.pendingLookY += finiteOr0(pitch);
      },
      setLookRate: (yawRate, pitchRate) => {
        source.lookRateX = finiteOr0(yawRate);
        source.lookRateY = finiteOr0(pitchRate);
      },
      releaseAll: () => InputState.clearSource(source),
    };
  }

  /** Removes a source and everything it was holding. */
  disconnect(sourceId: string): void {
    this.sources.delete(sourceId);
  }

  /** Actions currently held by any source. */
  get held(): ActionMask {
    let mask = NO_ACTIONS;
    for (const source of this.sources.values()) mask |= source.held;
    return mask;
  }

  /**
   * Snapshot for one simulation tick. Consumes pressed edges and accumulated
   * look; held actions, movement and look rates persist.
   *
   * @param tickSeconds Duration of the tick, used to integrate look rates.
   */
  sample(tickSeconds: number): InputSample {
    let moveX = 0;
    let moveY = 0;
    let lookX = this.pendingLookX;
    let lookY = this.pendingLookY;

    for (const source of this.sources.values()) {
      moveX += source.moveX;
      moveY += source.moveY;
      lookX += source.lookRateX * tickSeconds;
      lookY += source.lookRateY * tickSeconds;
    }

    // Math.sqrt is exactly specified by IEEE 754 (unlike Math.hypot), keeping this reproducible.
    const length = Math.sqrt(moveX * moveX + moveY * moveY);
    if (length > 1) {
      moveX /= length;
      moveY /= length;
    }

    const sample: InputSample = { moveX, moveY, lookX, lookY, held: this.held, pressed: this.pendingPressed };

    this.pendingPressed = NO_ACTIONS;
    this.pendingLookX = 0;
    this.pendingLookY = 0;
    return sample;
  }

  /**
   * Look rotation the next sample will contain so far, without consuming it:
   * accumulated relative look plus rates integrated over `elapsedSeconds`.
   * Lets presentation show the view at display rate, ahead of the next tick.
   */
  peekLook(elapsedSeconds: number): LookDelta {
    let yaw = this.pendingLookX;
    let pitch = this.pendingLookY;
    for (const source of this.sources.values()) {
      yaw += source.lookRateX * elapsedSeconds;
      pitch += source.lookRateY * elapsedSeconds;
    }
    return { yaw, pitch };
  }

  /** Releases every source and discards all pending edges and look. */
  reset(): void {
    for (const source of this.sources.values()) InputState.clearSource(source);
    this.pendingPressed = NO_ACTIONS;
    this.pendingLookX = 0;
    this.pendingLookY = 0;
  }

  private press(source: SourceState, action: InputAction): void {
    const bit = actionBit(action);
    if ((source.held & bit) !== 0) return;

    // Only an up -> down transition of the combined state is a press: a second
    // device joining an action that is already held does not re-trigger it.
    if ((this.held & bit) === 0) this.pendingPressed |= bit;
    source.held |= bit;
  }

  private static clearSource(source: SourceState): void {
    source.held = NO_ACTIONS;
    source.moveX = 0;
    source.moveY = 0;
    source.lookRateX = 0;
    source.lookRateY = 0;
  }
}
