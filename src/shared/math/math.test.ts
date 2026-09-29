import { describe, expect, it } from 'vitest';
import { deterministicExp } from './deterministicExp';
import { sinCos } from './deterministicTrig';
import { hashSeed, SeededRandom } from './SeededRandom';
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

describe('SeededRandom', () => {
  it('reproduces the same sequence from the same seed', () => {
    const a = new SeededRandom(223);
    const b = new SeededRandom(223);
    const first = Array.from({ length: 100 }, () => a.next());
    expect(Array.from({ length: 100 }, () => b.next())).toEqual(first);
  });

  it('is pinned to known values, so any change to the generator is caught', () => {
    // Cross-engine determinism relies on these exact integers never changing.
    const random = new SeededRandom(1);
    expect([random.nextUint32(), random.nextUint32(), random.nextUint32()]).toMatchInlineSnapshot(`
      [
        2527132011,
        314344336,
        2535364964,
      ]
    `);
    expect(hashSeed(223, 64)).toMatchInlineSnapshot(`1551090207`);
  });

  it('draws floats in [0, 1) that cover the range evenly', () => {
    const random = new SeededRandom(42);
    const buckets = new Array<number>(10).fill(0);
    for (let i = 0; i < 100_000; i++) {
      const value = random.next();
      expect(value >= 0 && value < 1).toBe(true);
      buckets[Math.floor(value * 10)]! += 1;
    }
    for (const count of buckets) expect(Math.abs(count - 10_000)).toBeLessThan(500);
  });

  it('derives unrelated seeds from nearby inputs, and depends on the order', () => {
    expect(hashSeed(1, 2)).not.toBe(hashSeed(2, 1));
    expect(hashSeed(7, 100)).not.toBe(hashSeed(7, 101));
    expect(new SeededRandom(hashSeed(7, 100)).next()).not.toBeCloseTo(new SeededRandom(hashSeed(7, 101)).next(), 2);
  });
});

describe('deterministicExp', () => {
  const maxRelativeError = (from: number, to: number): number => {
    let max = 0;
    for (let i = 0; i <= 20000; i++) {
      const x = from + ((to - from) * i) / 20000;
      const expected = Math.exp(x);
      max = Math.max(max, Math.abs(deterministicExp(x) - expected) / expected);
    }
    return max;
  };

  it('matches Math.exp to a few ulp where the simulation uses it (|x| ≤ 1)', () => {
    expect(maxRelativeError(-1, 1)).toBeLessThan(4 * Number.EPSILON);
  });

  it('stays accurate over a wide range', () => {
    expect(maxRelativeError(-50, 50)).toBeLessThan(1e-13);
  });

  it('is exact at 0 and handles the extremes', () => {
    expect(deterministicExp(0)).toBe(1);
    expect(deterministicExp(1000)).toBe(Infinity);
    expect(deterministicExp(-1000)).toBe(0);
    expect(deterministicExp(Number.NaN)).toBeNaN();
  });
});
