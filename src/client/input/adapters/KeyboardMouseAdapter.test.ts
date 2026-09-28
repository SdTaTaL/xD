import { describe, expect, it } from 'vitest';
import { actionBit, NO_ACTIONS } from '@shared/input/InputAction';
import { InputState } from '../InputState';
import { FakeKeyboardMouseDevice } from '../test-support/FakeKeyboardMouseDevice';
import { DEFAULT_KEYBOARD_MOUSE_BINDINGS, KeyboardMouseAdapter, type KeyboardMouseBindings } from './KeyboardMouseAdapter';

const TICK = 1 / 64;
const COUNT = (0.022 * Math.PI) / 180;

function setup(options: { sensitivity?: number; invertY?: boolean; bindings?: KeyboardMouseBindings } = {}) {
  const state = new InputState();
  const device = new FakeKeyboardMouseDevice();
  const adapter = new KeyboardMouseAdapter(state.connect('kbm'), device, {
    bindings: options.bindings ?? DEFAULT_KEYBOARD_MOUSE_BINDINGS,
    mouse: { sensitivity: options.sensitivity ?? 1, invertY: options.invertY ?? false },
  });
  return { state, device, adapter, sample: () => state.sample(TICK) };
}

describe('KeyboardMouseAdapter movement (WASD)', () => {
  it.each([
    ['KeyW', 0, 1],
    ['KeyS', 0, -1],
    ['KeyA', -1, 0],
    ['KeyD', 1, 0],
  ])('%s moves (%d, %d)', (code, x, y) => {
    const { adapter, sample } = setup();
    adapter.keyDown(code);
    const s = sample();
    expect([s.moveX, s.moveY]).toEqual([x, y]);
  });

  it('cancels opposite directions (neutral SOCD)', () => {
    const { adapter, sample } = setup();
    adapter.keyDown('KeyA');
    adapter.keyDown('KeyD');
    adapter.keyDown('KeyW');
    adapter.keyDown('KeyS');
    const s = sample();
    expect([s.moveX, s.moveY]).toEqual([0, 0]);

    adapter.keyUp('KeyA');
    expect(sample().moveX).toBe(1);
  });

  it('normalizes diagonals to unit length', () => {
    const { adapter, sample } = setup();
    adapter.keyDown('KeyW');
    adapter.keyDown('KeyD');
    const s = sample();
    expect(Math.sqrt(s.moveX ** 2 + s.moveY ** 2)).toBeCloseTo(1, 12);
  });

  it('stops moving on key release', () => {
    const { adapter, sample } = setup();
    adapter.keyDown('KeyW');
    adapter.keyUp('KeyW');
    expect(sample().moveY).toBe(0);
  });
});

describe('KeyboardMouseAdapter actions', () => {
  it.each([
    ['Space', 'jump'],
    ['ControlLeft', 'crouch'],
    ['ShiftLeft', 'sprint'],
    ['KeyR', 'reload'],
  ] as const)('%s holds %s', (code, action) => {
    const { adapter, sample } = setup();
    adapter.keyDown(code);
    expect(sample().held).toBe(actionBit(action));
    adapter.keyUp(code);
    expect(sample().held).toBe(NO_ACTIONS);
  });

  it('maps left and right mouse buttons to fire and aim; middle is tracked but unbound', () => {
    const { adapter, sample } = setup();
    adapter.buttonDown('left');
    adapter.buttonDown('right');
    adapter.buttonDown('middle');
    expect(sample().held).toBe(actionBit('fire') | actionBit('aim'));
    expect([...adapter.pressedButtons]).toEqual(['left', 'right', 'middle']);
  });

  it('keeps an action held until every key bound to it is released', () => {
    const { adapter, sample } = setup();
    adapter.keyDown('ControlLeft');
    adapter.keyDown('ControlRight');
    adapter.keyUp('ControlLeft');
    expect(sample().held).toBe(actionBit('crouch'));
    adapter.keyUp('ControlRight');
    expect(sample().held).toBe(NO_ACTIONS);
  });

  it('reports a press once for a held key, even with duplicate keydowns', () => {
    const { adapter, sample } = setup();
    adapter.keyDown('Space');
    expect(sample().pressed).toBe(actionBit('jump'));
    adapter.keyDown('Space');
    const next = sample();
    expect(next.pressed).toBe(NO_ACTIONS);
    expect(next.held).toBe(actionBit('jump'));
  });

  it('ignores releases of keys and buttons that were never pressed', () => {
    const { adapter, sample } = setup();
    adapter.keyUp('KeyW');
    adapter.buttonUp('left');
    expect(sample()).toEqual({ moveX: 0, moveY: 0, lookX: 0, lookY: 0, held: NO_ACTIONS, pressed: NO_ACTIONS });
  });

  it('supports custom bindings', () => {
    const { adapter, sample } = setup({ bindings: { keys: { ArrowUp: 'forward', KeyE: 'fire' }, mouseButtons: { middle: 'reload' } } });
    adapter.keyDown('ArrowUp');
    adapter.keyDown('KeyE');
    adapter.buttonDown('middle');
    adapter.keyDown('KeyW');
    const s = sample();
    expect(s.moveY).toBe(1);
    expect(s.held).toBe(actionBit('fire') | actionBit('reload'));
  });
});

describe('KeyboardMouseAdapter mouse look', () => {
  it('converts counts to radians with the sensitivity (0.022° per count)', () => {
    const { adapter, sample } = setup({ sensitivity: 2 });
    adapter.move(10, 0);
    expect(sample().lookX).toBeCloseTo(10 * 2 * COUNT, 15);
  });

  it('looks down when the mouse moves down, unless inverted', () => {
    const normal = setup();
    normal.adapter.move(0, 5);
    expect(normal.sample().lookY).toBeCloseTo(-5 * COUNT, 15);

    const inverted = setup({ invertY: true });
    inverted.adapter.move(0, 5);
    expect(inverted.sample().lookY).toBeCloseTo(5 * COUNT, 15);
  });

  it('accumulates every movement event between ticks', () => {
    const { adapter, sample } = setup();
    for (let i = 0; i < 8; i++) adapter.move(1, 1);
    const s = sample();
    expect(s.lookX).toBeCloseTo(8 * COUNT, 15);
    expect(sample().lookX).toBe(0);
  });
});

describe('KeyboardMouseAdapter release', () => {
  it('releaseAll (focus/visibility/capture loss) clears keys, buttons and state', () => {
    const { adapter, sample } = setup();
    adapter.keyDown('KeyW');
    adapter.keyDown('ShiftLeft');
    adapter.buttonDown('left');
    sample();

    adapter.releaseAll();
    const s = sample();
    expect([s.moveX, s.moveY, s.held]).toEqual([0, 0, NO_ACTIONS]);
    expect(adapter.pressedKeys.size + adapter.pressedButtons.size).toBe(0);

    // A key held across the loss must be pressed again to count.
    adapter.keyUp('KeyW');
    adapter.keyDown('KeyW');
    expect(sample().moveY).toBe(1);
  });

  it('releases when the device capture ends', () => {
    const { adapter, device, sample } = setup();
    device.requestCapture();
    adapter.keyDown('KeyD');
    device.releaseCapture();
    expect(sample().moveX).toBe(0);
  });

  it('disposes its device', () => {
    const { adapter, device } = setup();
    adapter.dispose();
    expect(device.disposed).toBe(true);
  });
});
