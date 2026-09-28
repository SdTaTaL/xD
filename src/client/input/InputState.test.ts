import { describe, expect, it } from 'vitest';
import { actionBit, NO_ACTIONS } from '@shared/input/InputAction';
import { InputState } from './InputState';

const TICK = 1 / 64;
const JUMP = actionBit('jump');
const FIRE = actionBit('fire');

describe('InputState actions', () => {
  it('reports a held action on every tick but its press only on the first', () => {
    const state = new InputState();
    const port = state.connect('kbm');
    port.press('fire');

    const first = state.sample(TICK);
    const second = state.sample(TICK);
    expect(first.held).toBe(FIRE);
    expect(first.pressed).toBe(FIRE);
    expect(second.held).toBe(FIRE);
    expect(second.pressed).toBe(NO_ACTIONS);

    port.release('fire');
    expect(state.sample(TICK).held).toBe(NO_ACTIONS);
  });

  it('keeps a tap shorter than one tick as a press', () => {
    const state = new InputState();
    const port = state.connect('kbm');
    port.press('jump');
    port.release('jump');

    const sample = state.sample(TICK);
    expect(sample.pressed).toBe(JUMP);
    expect(sample.held).toBe(NO_ACTIONS);
  });

  it('ignores repeated presses of an action that is already held', () => {
    const state = new InputState();
    const port = state.connect('kbm');
    port.press('jump');
    state.sample(TICK);
    port.press('jump');
    expect(state.sample(TICK).pressed).toBe(NO_ACTIONS);
  });

  it('holds an action while any source holds it and does not re-trigger it', () => {
    const state = new InputState();
    const keyboard = state.connect('kbm');
    const touch = state.connect('touch');

    keyboard.press('fire');
    state.sample(TICK);
    touch.press('fire');
    expect(state.sample(TICK).pressed).toBe(NO_ACTIONS);

    keyboard.release('fire');
    expect(state.sample(TICK).held).toBe(FIRE);
    touch.release('fire');
    expect(state.sample(TICK).held).toBe(NO_ACTIONS);
  });

  it('rejects connecting the same source twice', () => {
    const state = new InputState();
    state.connect('kbm');
    expect(() => state.connect('kbm')).toThrow();
  });
});

describe('InputState movement', () => {
  it('clamps combined movement to the unit disc', () => {
    const state = new InputState();
    const port = state.connect('kbm');
    port.setMove(1, 1);
    const sample = state.sample(TICK);
    expect(sample.moveX).toBeCloseTo(Math.SQRT1_2, 12);
    expect(sample.moveY).toBeCloseTo(Math.SQRT1_2, 12);
  });

  it('sums sources and keeps analog values inside the disc untouched', () => {
    const state = new InputState();
    state.connect('kbm').setMove(0.25, 0);
    state.connect('stick').setMove(0.25, 0.5);
    const sample = state.sample(TICK);
    expect(sample.moveX).toBe(0.5);
    expect(sample.moveY).toBe(0.5);
  });

  it('clamps out-of-range and non-finite axis values', () => {
    const state = new InputState();
    const port = state.connect('kbm');
    port.setMove(5, Number.NaN);
    const sample = state.sample(TICK);
    expect(sample.moveX).toBe(1);
    expect(sample.moveY).toBe(0);
  });
});

describe('InputState look', () => {
  it('accumulates relative look between samples and consumes it', () => {
    const state = new InputState();
    const port = state.connect('kbm');
    port.addLook(0.01, -0.02);
    port.addLook(0.03, 0.005);

    const sample = state.sample(TICK);
    expect(sample.lookX).toBeCloseTo(0.04, 12);
    expect(sample.lookY).toBeCloseTo(-0.015, 12);
    expect(state.sample(TICK).lookX).toBe(0);
  });

  it('integrates look rates over the tick duration', () => {
    const state = new InputState();
    const stick = state.connect('stick');
    stick.setLookRate(Math.PI, -Math.PI / 2);

    let yaw = 0;
    let pitch = 0;
    for (let i = 0; i < 64; i++) {
      const sample = state.sample(TICK);
      yaw += sample.lookX;
      pitch += sample.lookY;
    }
    expect(yaw).toBeCloseTo(Math.PI, 12);
    expect(pitch).toBeCloseTo(-Math.PI / 2, 12);
  });

  it('ignores non-finite look input', () => {
    const state = new InputState();
    const port = state.connect('kbm');
    port.addLook(Number.NaN, Number.POSITIVE_INFINITY);
    port.setLookRate(Number.NaN, 1);
    const sample = state.sample(1);
    expect(sample.lookX).toBe(0);
    expect(sample.lookY).toBe(1);
  });
});

describe('InputState release', () => {
  it('releaseAll clears only the calling source', () => {
    const state = new InputState();
    const keyboard = state.connect('kbm');
    const touch = state.connect('touch');
    keyboard.press('sprint');
    keyboard.setMove(0, 1);
    touch.press('aim');
    touch.setLookRate(1, 0);

    keyboard.releaseAll();
    const sample = state.sample(TICK);
    expect(sample.held).toBe(actionBit('aim'));
    expect(sample.moveY).toBe(0);
    expect(sample.lookX).toBeCloseTo(TICK, 12);
  });

  it('reset clears every source, pending presses and accumulated look', () => {
    const state = new InputState();
    const port = state.connect('kbm');
    port.press('jump');
    port.setMove(1, 0);
    port.addLook(1, 1);

    state.reset();
    expect(state.sample(TICK)).toEqual({ moveX: 0, moveY: 0, lookX: 0, lookY: 0, held: NO_ACTIONS, pressed: NO_ACTIONS });
  });

  it('disconnect removes the source and what it held', () => {
    const state = new InputState();
    state.connect('touch').press('fire');
    state.disconnect('touch');
    expect(state.held).toBe(NO_ACTIONS);
  });
});

describe('InputState look preview', () => {
  it('peeks at pending look without consuming it', () => {
    const state = new InputState();
    const mouse = state.connect('kbm');
    const stick = state.connect('stick');
    mouse.addLook(0.02, -0.01);
    stick.setLookRate(1, 0.5);

    expect(state.peekLook(0.25)).toEqual({ yaw: 0.02 + 0.25, pitch: -0.01 + 0.125 });
    const sample = state.sample(TICK);
    expect(sample.lookX).toBeCloseTo(0.02 + TICK, 12);
    expect(state.peekLook(0)).toEqual({ yaw: 0, pitch: 0 });
  });
});
