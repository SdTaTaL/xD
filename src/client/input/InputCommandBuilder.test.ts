import { describe, expect, it } from 'vitest';
import { actionBit, NO_ACTIONS } from '@shared/input/InputAction';
import { LOOK_QUANTUM, type InputCommand } from '@shared/input/InputCommand';
import { InputCommandBuilder } from './InputCommandBuilder';
import type { InputSample } from './InputState';

function sample(overrides: Partial<InputSample> = {}): InputSample {
  return { moveX: 0, moveY: 0, lookX: 0, lookY: 0, held: NO_ACTIONS, pressed: NO_ACTIONS, ...overrides };
}

describe('InputCommandBuilder', () => {
  it('builds an immutable command for the given tick', () => {
    const command = new InputCommandBuilder().build(42, sample({ moveY: 1, held: actionBit('sprint'), pressed: actionBit('jump') }));
    expect(command.tick).toBe(42);
    expect(command.moveY).toBe(1);
    expect(command.held).toBe(actionBit('sprint'));
    expect(command.pressed).toBe(actionBit('jump'));
    expect(Object.isFrozen(command)).toBe(true);
  });

  it('carries sub-quantum look remainders so slow mouse movement is never lost', () => {
    const builder = new InputCommandBuilder();
    const perTick = LOOK_QUANTUM * 0.3;
    let total = 0;
    for (let tick = 0; tick < 1000; tick++) total += builder.build(tick, sample({ lookX: perTick })).lookX;

    // 1000 × 0.3 quanta = 300 quanta; rounding error stays within one quantum overall.
    expect(Math.abs(total - perTick * 1000)).toBeLessThanOrEqual(LOOK_QUANTUM);
    expect(total).toBeGreaterThan(0);
  });

  it('is deterministic: identical samples produce identical commands', () => {
    const script = Array.from({ length: 200 }, (_, i) =>
      sample({ moveX: Math.sin(i) * 0.9, moveY: Math.cos(i) * 0.9, lookX: 0.00137 * i, lookY: -0.00071 * i, held: i % 7, pressed: i % 3 }),
    );
    const run = (): InputCommand[] => {
      const builder = new InputCommandBuilder();
      return script.map((s, tick) => builder.build(tick, s));
    };

    const first = run();
    const second = run();
    expect(second).toEqual(first);
    first.forEach((command, i) => expect(Object.is(command.lookX, second[i]?.lookX)).toBe(true));
  });
});
