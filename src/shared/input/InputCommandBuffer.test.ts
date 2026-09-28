import { describe, expect, it } from 'vitest';
import { neutralCommand } from './InputCommand';
import { InputCommandBuffer } from './InputCommandBuffer';

describe('InputCommandBuffer', () => {
  it('returns commands by tick and tracks the latest one', () => {
    const buffer = new InputCommandBuffer(4);
    expect(buffer.latest).toBeUndefined();
    for (let tick = 0; tick < 3; tick++) buffer.push(neutralCommand(tick));
    expect(buffer.get(1)?.tick).toBe(1);
    expect(buffer.latest?.tick).toBe(2);
    expect(buffer.get(3)).toBeUndefined();
  });

  it('evicts commands older than its capacity', () => {
    const buffer = new InputCommandBuffer(4);
    for (let tick = 0; tick < 10; tick++) buffer.push(neutralCommand(tick));
    expect(buffer.get(5)).toBeUndefined();
    expect(buffer.get(6)?.tick).toBe(6);
    expect(buffer.get(9)?.tick).toBe(9);
  });

  it('requires strictly increasing ticks', () => {
    const buffer = new InputCommandBuffer(4);
    buffer.push(neutralCommand(5));
    expect(() => buffer.push(neutralCommand(5))).toThrow(RangeError);
    expect(() => buffer.push(neutralCommand(4))).toThrow(RangeError);
  });

  it('ignores invalid lookups and can be cleared', () => {
    const buffer = new InputCommandBuffer(4);
    buffer.push(neutralCommand(0));
    expect(buffer.get(-4)).toBeUndefined();
    expect(buffer.get(Number.NaN)).toBeUndefined();
    buffer.clear();
    expect(buffer.get(0)).toBeUndefined();
    expect(buffer.latest).toBeUndefined();
  });
});
