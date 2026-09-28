import { describe, expect, it, vi } from 'vitest';
import { actionBit, NO_ACTIONS } from '@shared/input/InputAction';
import type { InputCommand } from '@shared/input/InputCommand';
import { SIMULATION_TICK_RATE, SIMULATION_TICK_SECONDS } from '@shared/simulation/SimulationConfig';
import { FixedTimestep } from '@shared/time/FixedTimestep';
import type { GameSystem, TickContext } from '../core/GameSystem';
import { SystemScheduler } from '../core/SystemScheduler';
import { DEFAULT_KEYBOARD_MOUSE_BINDINGS, KeyboardMouseAdapter } from './adapters/KeyboardMouseAdapter';
import type { InputPort } from './InputState';
import { InputSystem } from './InputSystem';
import { FakeKeyboardMouseDevice } from './test-support/FakeKeyboardMouseDevice';

const MOUSE = { sensitivity: 1, invertY: false };

function createInput() {
  const input = new InputSystem({ historyTicks: 256 });
  const device = new FakeKeyboardMouseDevice();
  const kbm = input.addAdapter('kbm', (port) => new KeyboardMouseAdapter(port, device, { bindings: DEFAULT_KEYBOARD_MOUSE_BINDINGS, mouse: MOUSE }));
  return { input, device, kbm };
}

/** Drives the input system like GameLoop does: beginFrame, then the frame's fixed ticks. */
function frameDriver(input: InputSystem) {
  const timestep = new FixedTimestep(SIMULATION_TICK_RATE, 8);
  const tick: { tick: number; deltaSeconds: number } = { tick: 0, deltaSeconds: SIMULATION_TICK_SECONDS };
  return (seconds: number): number => {
    input.beginFrame();
    return timestep.advance(seconds, (index, step) => {
      tick.tick = index;
      tick.deltaSeconds = step;
      input.fixedUpdate(tick);
    });
  };
}

function tickContext(tick: number): TickContext {
  return { tick, deltaSeconds: SIMULATION_TICK_SECONDS };
}

describe('InputSystem commands per tick', () => {
  it('produces exactly one command per tick, with consecutive tick numbers', () => {
    const { input } = createInput();
    for (let tick = 0; tick < 5; tick++) input.fixedUpdate(tickContext(tick));
    expect([0, 1, 2, 3, 4].map((tick) => input.commands.get(tick)?.tick)).toEqual([0, 1, 2, 3, 4]);
  });

  it('produces neutral commands when there is no input', () => {
    const { input } = createInput();
    input.fixedUpdate(tickContext(0));
    expect(input.commands.latest).toEqual({ tick: 0, moveX: 0, moveY: 0, lookX: 0, lookY: 0, held: NO_ACTIONS, pressed: NO_ACTIONS });
  });

  it('makes the current command available to gameplay systems registered after it', () => {
    const { input, kbm } = createInput();
    const seen: InputCommand[] = [];
    const gameplay: GameSystem = {
      name: 'gameplay',
      fixedUpdate: (tick) => {
        const command = input.commands.get(tick.tick);
        if (command) seen.push(command);
      },
    };
    const scheduler = new SystemScheduler();
    scheduler.add(input);
    scheduler.add(gameplay);

    kbm.keyDown('KeyW');
    scheduler.fixedUpdate(tickContext(0));
    scheduler.fixedUpdate(tickContext(1));
    expect(seen.map((c) => [c.tick, c.moveY])).toEqual([
      [0, 1],
      [1, 1],
    ]);
  });

  it('runs at 64 commands per second regardless of frame rate', () => {
    for (const fps of [30, 60, 144, 240]) {
      const { input } = createInput();
      const frame = frameDriver(input);
      let ticks = 0;
      for (let i = 0; i < fps * 2; i++) ticks += frame(1 / fps);
      expect(ticks).toBeGreaterThanOrEqual(2 * SIMULATION_TICK_RATE - 1);
      expect(ticks).toBeLessThanOrEqual(2 * SIMULATION_TICK_RATE);
      expect(input.commands.latest?.tick).toBe(ticks - 1);
    }
  });
});

describe('InputSystem continuous vs one-shot input', () => {
  it('reports a held button on every tick and its press on the first only', () => {
    const { input, kbm } = createInput();
    kbm.buttonDown('left');
    for (let tick = 0; tick < 3; tick++) input.fixedUpdate(tickContext(tick));

    const commands = [0, 1, 2].map((tick) => input.commands.get(tick)!);
    expect(commands.map((c) => c.held)).toEqual([actionBit('fire'), actionBit('fire'), actionBit('fire')]);
    expect(commands.map((c) => c.pressed)).toEqual([actionBit('fire'), 0, 0]);
  });

  it('keeps a click that starts and ends between two ticks', () => {
    const { input, kbm } = createInput();
    kbm.buttonDown('left');
    kbm.buttonUp('left');
    input.fixedUpdate(tickContext(0));
    expect(input.commands.latest).toMatchObject({ pressed: actionBit('fire'), held: NO_ACTIONS });
  });
});

describe('InputSystem mouse accumulation', () => {
  it('accumulates movement across frames that run no tick', () => {
    const { input, kbm } = createInput();
    const frame = frameDriver(input);
    const frameSeconds = SIMULATION_TICK_SECONDS / 4; // 256 fps: 4 frames per tick

    const produced: number[] = [];
    for (let i = 0; i < 8; i++) {
      kbm.move(10, 0);
      if (frame(frameSeconds) > 0) produced.push(input.commands.latest!.lookX);
    }

    const perCount = (0.022 * Math.PI) / 180;
    const total = produced.reduce((sum, look) => sum + look, 0);
    expect(total).toBeCloseTo(80 * perCount, 4);
  });

  it('puts a slow frame\'s movement into its first tick only', () => {
    const { input, kbm } = createInput();
    const frame = frameDriver(input);
    kbm.move(100, 0);
    kbm.keyDown('Space');
    const ticks = frame(3 * SIMULATION_TICK_SECONDS + 1e-9);

    expect(ticks).toBe(3);
    const commands = [0, 1, 2].map((tick) => input.commands.get(tick)!);
    expect(commands[0]!.lookX).toBeGreaterThan(0);
    expect(commands[1]!.lookX).toBe(0);
    expect(commands.map((c) => c.pressed)).toEqual([actionBit('jump'), 0, 0]);
    expect(commands.map((c) => c.held)).toEqual([actionBit('jump'), actionBit('jump'), actionBit('jump')]);
  });
});

describe('InputSystem determinism and device independence', () => {
  type Step = { frameSeconds: number; act?: (kbm: KeyboardMouseAdapter) => void };

  const script: Step[] = [
    { frameSeconds: 0.007, act: (k) => k.keyDown('KeyW') },
    { frameSeconds: 0.011, act: (k) => k.move(7, -3) },
    { frameSeconds: 0.016, act: (k) => (k.keyDown('ShiftLeft'), k.move(-2, 1)) },
    { frameSeconds: 0.004, act: (k) => (k.buttonDown('left'), k.buttonUp('left')) },
    { frameSeconds: 0.033, act: (k) => (k.keyDown('KeyD'), k.move(13, 0)) },
    { frameSeconds: 0.009, act: (k) => k.keyUp('ShiftLeft') },
    { frameSeconds: 0.021, act: (k) => k.keyDown('Space') },
    { frameSeconds: 0.016 },
  ];

  const replay = (): InputCommand[] => {
    const { input, kbm } = createInput();
    const frame = frameDriver(input);
    for (const step of script) {
      step.act?.(kbm);
      frame(step.frameSeconds);
    }
    const commands: InputCommand[] = [];
    for (let tick = 0; tick <= input.commands.latest!.tick; tick++) commands.push(input.commands.get(tick)!);
    return commands;
  };

  it('produces identical commands for identical input and frame timing', () => {
    const first = replay();
    expect(first.length).toBeGreaterThan(5);
    expect(replay()).toEqual(first);
  });

  it('gives gameplay the same command whether input came from keyboard/mouse or a touch-style source', () => {
    const desktop = createInput();
    desktop.kbm.keyDown('KeyW');
    desktop.kbm.keyDown('Space');
    desktop.kbm.move(12, 0);
    desktop.input.fixedUpdate(tickContext(0));

    // A future touch adapter: virtual joystick -> setMove, button -> press, drag -> addLook.
    const mobile = new InputSystem({ historyTicks: 16 });
    let touch!: InputPort;
    mobile.addAdapter('touch', (port) => {
      touch = port;
      return { dispose: () => port.releaseAll() };
    });
    touch.setMove(0, 1);
    touch.press('jump');
    touch.addLook(12 * ((0.022 * Math.PI) / 180), 0);
    mobile.fixedUpdate(tickContext(0));

    expect(mobile.commands.latest).toEqual(desktop.input.commands.latest);
  });

  it('integrates rate-based look (camera joystick) deterministically per tick', () => {
    const input = new InputSystem({ historyTicks: 128 });
    let stick!: InputPort;
    input.addAdapter('gamepad', (port) => {
      stick = port;
      return { dispose: () => undefined };
    });
    stick.setLookRate(Math.PI / 2, 0); // 90°/s
    let yaw = 0;
    for (let tick = 0; tick < 64; tick++) {
      input.fixedUpdate(tickContext(tick));
      yaw += input.commands.latest!.lookX;
    }
    expect(yaw).toBeCloseTo(Math.PI / 2, 4);
  });
});

describe('InputSystem lifecycle', () => {
  it('polls adapters once per frame', () => {
    const input = new InputSystem({ historyTicks: 8 });
    const poll = vi.fn();
    input.addAdapter('gamepad', () => ({ poll, dispose: () => undefined }));
    input.beginFrame();
    input.beginFrame();
    expect(poll).toHaveBeenCalledTimes(2);
  });

  it('frees the source id when adapter creation fails', () => {
    const input = new InputSystem({ historyTicks: 8 });
    expect(() =>
      input.addAdapter('touch', () => {
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(() => input.addAdapter('touch', () => ({ dispose: () => undefined }))).not.toThrow();
  });

  it('disposes adapters and their devices', () => {
    const { input, device } = createInput();
    input.dispose();
    expect(device.disposed).toBe(true);
  });
});
