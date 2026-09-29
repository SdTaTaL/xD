import type { InputAction } from '@shared/input/InputAction';
import type { InputPort } from '../InputState';
import type { KeyboardMouseDevice, KeyboardMouseSink, MouseButton } from '../devices/KeyboardMouseDevice';
import type { InputAdapter } from './InputAdapter';

export type MoveDirection = 'forward' | 'back' | 'left' | 'right';

/** What a physical key or button does: a digital action or a movement direction. */
export type KeyboardMouseBinding = InputAction | MoveDirection;

export interface KeyboardMouseBindings {
  /**
   * Physical key (`KeyboardEvent.code`) to binding. Physical codes keep the
   * layout position (WASD stays WASD on AZERTY/QWERTZ keyboards).
   */
  readonly keys: Readonly<Record<string, KeyboardMouseBinding>>;
  readonly mouseButtons: Readonly<Partial<Record<MouseButton, KeyboardMouseBinding>>>;
}

export interface MouseLookSettings {
  /** Multiplier of 0.022° of rotation per mouse count (the Source/CS scale). */
  readonly sensitivity: number;
  /** Moving the mouse forward looks down instead of up. */
  readonly invertY: boolean;
}

export interface KeyboardMouseAdapterOptions {
  readonly bindings: KeyboardMouseBindings;
  readonly mouse: MouseLookSettings;
}

export const DEFAULT_KEYBOARD_MOUSE_BINDINGS: KeyboardMouseBindings = {
  keys: {
    KeyW: 'forward',
    KeyS: 'back',
    KeyA: 'left',
    KeyD: 'right',
    Space: 'jump',
    ControlLeft: 'crouch',
    ControlRight: 'crouch',
    ShiftLeft: 'walk',
    ShiftRight: 'walk',
    KeyR: 'reload',
  },
  mouseButtons: {
    left: 'fire',
    right: 'aim',
  },
};

/** Rotation per mouse count at sensitivity 1, in radians. */
const RADIANS_PER_COUNT = (0.022 * Math.PI) / 180;

const MOVE_DIRECTIONS: ReadonlySet<string> = new Set<MoveDirection>(['forward', 'back', 'left', 'right']);

function isMoveDirection(binding: KeyboardMouseBinding): binding is MoveDirection {
  return MOVE_DIRECTIONS.has(binding);
}

/**
 * Maps physical keyboard/mouse input to device-independent input.
 *
 * - Several physical inputs may share a binding (both Ctrl keys crouch); a
 *   binding stays active until the last of them is released.
 * - Opposite directions cancel out (neutral SOCD): A + D = no strafe.
 * - Mouse counts become radians through the sensitivity setting.
 */
export class KeyboardMouseAdapter implements InputAdapter, KeyboardMouseSink {
  readonly device: KeyboardMouseDevice;

  private readonly port: InputPort;
  private readonly keyBindings: ReadonlyMap<string, KeyboardMouseBinding>;
  private readonly buttonBindings: ReadonlyMap<MouseButton, KeyboardMouseBinding>;
  private readonly yawPerCount: number;
  private readonly pitchPerCount: number;
  private readonly keysDown = new Set<string>();
  private readonly buttonsDown = new Set<MouseButton>();
  /** Number of physical inputs currently holding each binding. */
  private readonly holdCounts = new Map<KeyboardMouseBinding, number>();

  constructor(port: InputPort, device: KeyboardMouseDevice, options: KeyboardMouseAdapterOptions) {
    this.port = port;
    this.device = device;
    // Maps avoid inherited-property lookups on arbitrary key codes.
    this.keyBindings = new Map(Object.entries(options.bindings.keys));
    this.buttonBindings = new Map(
      Object.entries(options.bindings.mouseButtons) as [MouseButton, KeyboardMouseBinding][],
    );
    this.yawPerCount = options.mouse.sensitivity * RADIANS_PER_COUNT;
    // Mouse +y is "down", which is negative pitch unless inverted.
    this.pitchPerCount = options.mouse.sensitivity * RADIANS_PER_COUNT * (options.mouse.invertY ? 1 : -1);

    device.connect(this);
  }

  /** Physical keys currently down (diagnostics). */
  get pressedKeys(): ReadonlySet<string> {
    return this.keysDown;
  }

  /** Mouse buttons currently down (diagnostics). */
  get pressedButtons(): ReadonlySet<MouseButton> {
    return this.buttonsDown;
  }

  keyDown(code: string): void {
    if (this.keysDown.has(code)) return;
    this.keysDown.add(code);
    this.engage(this.keyBindings.get(code));
  }

  keyUp(code: string): void {
    if (!this.keysDown.delete(code)) return;
    this.disengage(this.keyBindings.get(code));
  }

  buttonDown(button: MouseButton): void {
    if (this.buttonsDown.has(button)) return;
    this.buttonsDown.add(button);
    this.engage(this.buttonBindings.get(button));
  }

  buttonUp(button: MouseButton): void {
    if (!this.buttonsDown.delete(button)) return;
    this.disengage(this.buttonBindings.get(button));
  }

  move(dx: number, dy: number): void {
    this.port.addLook(dx * this.yawPerCount, dy * this.pitchPerCount);
  }

  releaseAll(): void {
    this.keysDown.clear();
    this.buttonsDown.clear();
    this.holdCounts.clear();
    this.port.releaseAll();
  }

  dispose(): void {
    this.device.dispose();
    this.releaseAll();
  }

  private engage(binding: KeyboardMouseBinding | undefined): void {
    if (binding === undefined) return;
    const count = (this.holdCounts.get(binding) ?? 0) + 1;
    this.holdCounts.set(binding, count);
    if (count === 1) this.apply(binding, true);
  }

  private disengage(binding: KeyboardMouseBinding | undefined): void {
    if (binding === undefined) return;
    const count = this.holdCounts.get(binding) ?? 0;
    if (count === 0) return;
    if (count > 1) {
      this.holdCounts.set(binding, count - 1);
      return;
    }
    this.holdCounts.delete(binding);
    this.apply(binding, false);
  }

  private apply(binding: KeyboardMouseBinding, active: boolean): void {
    if (isMoveDirection(binding)) {
      this.port.setMove(this.axis('right', 'left'), this.axis('forward', 'back'));
    } else if (active) {
      this.port.press(binding);
    } else {
      this.port.release(binding);
    }
  }

  private axis(positive: MoveDirection, negative: MoveDirection): number {
    return (this.holdCounts.has(positive) ? 1 : 0) - (this.holdCounts.has(negative) ? 1 : 0);
  }
}
