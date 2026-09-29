/**
 * Deterministic pseudo-random numbers for simulation code.
 *
 * Only 32-bit integer operations (`Math.imul`, shifts, xor) are used, which
 * every JavaScript engine evaluates identically, so a client and a server
 * that start from the same seed draw exactly the same numbers. `Math.random`
 * must never be used in shared simulation code.
 *
 * Not cryptographically secure: an authoritative server will have to own the
 * seeds of anything players must not predict (see docs/ARCHITECTURE.md).
 */

/** Mixes a 32-bit integer into a well-distributed 32-bit hash (avalanche finalizer). */
function mix32(value: number): number {
  let x = value | 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return (x ^ (x >>> 16)) >>> 0;
}

/**
 * Combines integers into one 32-bit seed, order-sensitively. Use it to derive
 * independent streams, e.g. `hashSeed(weaponSeed, tick)`.
 */
export function hashSeed(...values: readonly number[]): number {
  let hash = 0x9e3779b9;
  for (const value of values) {
    hash = mix32(hash ^ mix32(Math.trunc(value)));
  }
  return hash;
}

const TWO_POW_32 = 2 ** 32;

/** Sequential generator: a 32-bit counter passed through {@link mix32} (SplitMix-style). */
export class SeededRandom {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Next integer in [0, 2³²). */
  nextUint32(): number {
    this.state = (this.state + 0x9e3779b9) >>> 0;
    return mix32(this.state);
  }

  /** Next float in [0, 1). */
  next(): number {
    return this.nextUint32() / TWO_POW_32;
  }

  /** Next float in [min, max). */
  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }
}
