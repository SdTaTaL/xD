import { ALL_ACTIONS_MASK, hasAction, NO_ACTIONS, type ActionMask, type InputAction } from './InputAction';

/**
 * Device-independent player intent for one simulation tick.
 *
 * It is the only input gameplay ever sees: keyboard/mouse, touch and gamepads
 * all produce this same shape. Commands are immutable and every numeric field
 * lies on a fixed quantization grid, so the value a client simulates with is
 * exactly the value that can later be sent to (and re-simulated by) an
 * authoritative server.
 *
 * Axis conventions: +moveX strafes right, +moveY moves forward,
 * +lookX turns right, +lookY looks up.
 */
export interface InputCommand {
  /** Simulation tick this command drives. */
  readonly tick: number;
  /** Strafe intent in [-1, 1], a multiple of 1/{@link MOVE_AXIS_STEPS}. */
  readonly moveX: number;
  /**
   * Forward intent in [-1, 1], a multiple of 1/{@link MOVE_AXIS_STEPS}.
   * The client clamps (moveX, moveY) to the unit disc before quantization, so
   * its length is at most 1 plus quantization error (< 1%). Consumers must
   * still clamp: commands from untrusted peers carry no such guarantee.
   */
  readonly moveY: number;
  /** Yaw change during this tick, in radians. A multiple of {@link LOOK_QUANTUM}. */
  readonly lookX: number;
  /** Pitch change during this tick, in radians. A multiple of {@link LOOK_QUANTUM}. */
  readonly lookY: number;
  /** Actions held when the tick was sampled. */
  readonly held: ActionMask;
  /**
   * Actions that went down during this tick, including taps released before
   * the tick was sampled (pressed but not held).
   */
  readonly pressed: ActionMask;
}

/** Steps per unit of a movement axis (wire format: signed 8-bit). */
export const MOVE_AXIS_STEPS = 127;

/** Smallest representable look change, in radians (2^-16 rad ≈ 0.00087°). */
export const LOOK_QUANTUM = 2 ** -16;

/** Normalizes -0 to +0 so equal commands are equal under Object.is and serialize identically. */
function positiveZero(value: number): number {
  return value + 0;
}

/** Clamps to [-1, 1] and snaps to the movement grid. Non-finite input becomes 0. */
export function quantizeMoveAxis(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const clamped = Math.min(1, Math.max(-1, value));
  return positiveZero(Math.round(clamped * MOVE_AXIS_STEPS) / MOVE_AXIS_STEPS);
}

/** Snaps a look delta (radians) to the nearest multiple of {@link LOOK_QUANTUM}. Non-finite input becomes 0. */
export function quantizeLook(radians: number): number {
  if (!Number.isFinite(radians)) return 0;
  return positiveZero(Math.round(radians / LOOK_QUANTUM) * LOOK_QUANTUM);
}

export interface InputCommandFields {
  readonly tick: number;
  readonly moveX: number;
  readonly moveY: number;
  readonly lookX: number;
  readonly lookY: number;
  readonly held: ActionMask;
  readonly pressed: ActionMask;
}

/**
 * Creates an immutable command, snapping every field onto its grid. Idempotent
 * for already-quantized values, so it is also the entry point for commands
 * decoded from the network.
 */
export function createInputCommand(fields: InputCommandFields): InputCommand {
  if (!Number.isSafeInteger(fields.tick) || fields.tick < 0) {
    throw new RangeError(`Command tick must be a non-negative integer, got ${fields.tick}`);
  }

  return Object.freeze({
    tick: fields.tick,
    moveX: quantizeMoveAxis(fields.moveX),
    moveY: quantizeMoveAxis(fields.moveY),
    lookX: quantizeLook(fields.lookX),
    lookY: quantizeLook(fields.lookY),
    held: fields.held & ALL_ACTIONS_MASK,
    pressed: fields.pressed & ALL_ACTIONS_MASK,
  });
}

/** Command with no intent at all (no input device captured, or nothing pressed). */
export function neutralCommand(tick: number): InputCommand {
  return createInputCommand({ tick, moveX: 0, moveY: 0, lookX: 0, lookY: 0, held: NO_ACTIONS, pressed: NO_ACTIONS });
}

/** True while the action is held (continuous input: walk, crouch, automatic fire). */
export function isActionHeld(command: InputCommand, action: InputAction): boolean {
  return hasAction(command.held, action);
}

/** True only on the tick the action went down (one-shot input: jump, reload, semi-automatic fire). */
export function wasActionPressed(command: InputCommand, action: InputAction): boolean {
  return hasAction(command.pressed, action);
}
