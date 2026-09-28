/**
 * Sine and cosine computed only with IEEE 754 basic operations (+ − × ÷ and
 * Math.round), which every JavaScript engine evaluates bit-identically.
 *
 * `Math.sin`/`Math.cos` are implementation-approximated by the spec and differ
 * between engines in the last bits. Simulation code that must re-run
 * identically on another engine (a server re-simulating client input) uses
 * these instead. Accuracy: within a few ulp of the exact result.
 */

// π/2 split in two doubles (Cody–Waite) so the range reduction stays exact.
const HALF_PI_HI = 1.5707963267948966;
const HALF_PI_LO = 6.123233995736766e-17;

// Minimax polynomial coefficients for |x| ≤ π/4 (the classic fdlibm kernels).
const S1 = -1.66666666666666324348e-1;
const S2 = 8.33333333332248946124e-3;
const S3 = -1.98412698298579493134e-4;
const S4 = 2.75573137070700676789e-6;
const S5 = -2.50507602534068634195e-8;
const S6 = 1.58969099521155010221e-10;

const C1 = 4.16666666666666019037e-2;
const C2 = -1.38888888888741095749e-3;
const C3 = 2.48015872894767294178e-5;
const C4 = -2.75573143513906633035e-7;
const C5 = 2.08757232129817482790e-9;
const C6 = -1.13596475577881948265e-11;

function kernelSin(x: number): number {
  const z = x * x;
  return x + x * z * (S1 + z * (S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)))));
}

function kernelCos(x: number): number {
  const z = x * x;
  return 1 - 0.5 * z + z * z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
}

export interface SinCos {
  readonly sin: number;
  readonly cos: number;
}

/** Deterministic sine and cosine of `radians`. Intended for moderate angles (|x| ≲ 1e5). */
export function sinCos(radians: number): SinCos {
  const quadrant = Math.round(radians / HALF_PI_HI);
  const r = radians - quadrant * HALF_PI_HI - quadrant * HALF_PI_LO;
  const s = kernelSin(r);
  const c = kernelCos(r);

  switch (((quadrant % 4) + 4) % 4) {
    case 0:
      return { sin: s, cos: c };
    case 1:
      return { sin: c, cos: -s };
    case 2:
      return { sin: -s, cos: -c };
    default:
      return { sin: -c, cos: s };
  }
}
