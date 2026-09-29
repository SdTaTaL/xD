import { describe, expect, it } from 'vitest';
import { actionBit, actionsIn, ALL_ACTIONS_MASK, INPUT_ACTIONS } from './InputAction';
import {
  createInputCommand,
  isActionHeld,
  LOOK_QUANTUM,
  MOVE_AXIS_STEPS,
  neutralCommand,
  quantizeLook,
  quantizeMoveAxis,
  wasActionPressed,
} from './InputCommand';

describe('InputAction', () => {
  it('assigns each action a distinct, stable bit in declaration order', () => {
    expect(INPUT_ACTIONS).toEqual(['jump', 'crouch', 'walk', 'fire', 'aim', 'reload']);
    INPUT_ACTIONS.forEach((action, index) => expect(actionBit(action)).toBe(1 << index));
    expect(ALL_ACTIONS_MASK).toBe(0b111111);
    expect(actionsIn(actionBit('fire') | actionBit('jump'))).toEqual(['jump', 'fire']);
  });
});

describe('quantization', () => {
  it('keeps digital movement values exact', () => {
    expect(quantizeMoveAxis(1)).toBe(1);
    expect(quantizeMoveAxis(-1)).toBe(-1);
    expect(quantizeMoveAxis(0)).toBe(0);
  });

  it('snaps analog movement to 1/127 steps and clamps to [-1, 1]', () => {
    expect(quantizeMoveAxis(0.5)).toBe(64 / MOVE_AXIS_STEPS);
    expect(quantizeMoveAxis(3)).toBe(1);
    expect(quantizeMoveAxis(-3)).toBe(-1);
  });

  it('never produces -0 or non-finite values', () => {
    expect(Object.is(quantizeMoveAxis(-0.001), 0)).toBe(true);
    expect(Object.is(quantizeLook(-LOOK_QUANTUM / 4), 0)).toBe(true);
    expect(quantizeMoveAxis(Number.NaN)).toBe(0);
    expect(quantizeLook(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('snaps look to multiples of the look quantum', () => {
    const value = quantizeLook(0.0123456);
    expect(Number.isInteger(value / LOOK_QUANTUM)).toBe(true);
    expect(Math.abs(value - 0.0123456)).toBeLessThanOrEqual(LOOK_QUANTUM / 2);
  });
});

describe('createInputCommand', () => {
  it('returns a frozen command with quantized fields and known action bits only', () => {
    const command = createInputCommand({ tick: 7, moveX: 0.5, moveY: 2, lookX: 0.01, lookY: -0.01, held: 0xffff, pressed: actionBit('jump') });
    expect(Object.isFrozen(command)).toBe(true);
    expect(command.moveX).toBe(64 / 127);
    expect(command.moveY).toBe(1);
    expect(command.held).toBe(ALL_ACTIONS_MASK);
    expect(() => {
      (command as { tick: number }).tick = 8;
    }).toThrow(TypeError);
  });

  it('is idempotent, so decoding an already-quantized command changes nothing', () => {
    const command = createInputCommand({ tick: 1, moveX: 0.3, moveY: -0.7, lookX: 0.02, lookY: -0.03, held: 5, pressed: 1 });
    expect(createInputCommand(command)).toEqual(command);
  });

  it('rejects invalid ticks', () => {
    expect(() => neutralCommand(-1)).toThrow(RangeError);
    expect(() => neutralCommand(1.5)).toThrow(RangeError);
  });

  it('distinguishes held (continuous) from pressed (one-shot) actions', () => {
    const command = createInputCommand({ tick: 0, moveX: 0, moveY: 0, lookX: 0, lookY: 0, held: actionBit('walk'), pressed: actionBit('jump') });
    expect(isActionHeld(command, 'walk')).toBe(true);
    expect(wasActionPressed(command, 'walk')).toBe(false);
    expect(isActionHeld(command, 'jump')).toBe(false);
    expect(wasActionPressed(command, 'jump')).toBe(true);
  });
});
