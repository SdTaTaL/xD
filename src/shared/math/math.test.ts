import { describe, expect, it } from 'vitest';
import { sinCos } from './deterministicTrig';
import { clamp, moveTowards, TAU, wrapAngle } from './scalar';

describe('sinCos', () => {
  const maxError = (range: number): number => {
    let max = 0;
    for (let i = -20000; i <= 20000; i++) {
      const angle = (i / 20000) * range;
      const { sin, cos } = sinCos(angle);
      max = Math.max(max, Math.abs(sin - Math.sin(angle)), Math.abs(cos - Math.cos(angle)));
    }
    return max;
  };

  it('is within 1 ulp of Math.sin/Math.cos for wrapped angles [-π, π]', () => {
    expect(maxError(Math.PI)).toBeLessThanOrEqual(2 ** -53);
  });

  it('stays within an ulp of the angle magnitude over several turns', () => {
    expect(maxError(3 * TAU)).toBeLessThan(4e-15);
  });

  it('is exact at the cardinal angles used for movement axes', () => {
    expect(sinCos(0)).toEqual({ sin: 0, cos: 1 });
    expect(sinCos(Math.PI / 2).sin).toBe(1);
    expect(Math.abs(sinCos(Math.PI / 2).cos)).toBeLessThan(1e-16);
    expect(sinCos(-Math.PI).cos).toBe(-1);
  });
});

describe('scalar helpers', () => {
  it('wraps angles into [-π, π)', () => {
    expect(wrapAngle(0)).toBe(0);
    expect(wrapAngle(Math.PI)).toBeCloseTo(-Math.PI, 15);
    expect(wrapAngle(3 * TAU + 1)).toBeCloseTo(1, 12);
    expect(wrapAngle(-Math.PI - 0.5)).toBeCloseTo(Math.PI - 0.5, 12);
  });

  it('moves towards a target without overshooting', () => {
    expect(moveTowards(0, 10, 3)).toBe(3);
    expect(moveTowards(9, 10, 3)).toBe(10);
    expect(moveTowards(5, -10, 20)).toBe(-10);
  });

  it('clamps', () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-5, 0, 1)).toBe(0);
    expect(clamp(0.5, 0, 1)).toBe(0.5);
  });
});
