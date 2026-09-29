/** Terms of the Taylor series; enough for full double precision once |x| ≤ 1/2. */
const TAYLOR_TERMS = 18;

/** Largest x whose e^x is finite, and smallest whose e^x is not zero. */
const MAX_ARGUMENT = 709.78;
const MIN_ARGUMENT = -745.2;

/**
 * e^x computed only with + − × ÷, which every JavaScript engine evaluates
 * bit-identically (`Math.exp` is implementation-approximated and may differ
 * in the last bits). Simulation code whose state is re-simulated elsewhere
 * (decays of recoil and inaccuracy) uses this instead.
 *
 * Method: halve x until |x| ≤ 1/2 (halving is exact), sum the Taylor series
 * in Horner form, then square back once per halving.
 * Accuracy: within a few ulp for |x| ≤ 1; the squarings grow the relative
 * error by 2 per halving (≈1e-14 at |x| = 50). Simulation decays stay far
 * below |x| = 1.
 */
export function deterministicExp(x: number): number {
  if (Number.isNaN(x)) return Number.NaN;
  if (x > MAX_ARGUMENT) return Infinity;
  if (x < MIN_ARGUMENT) return 0;

  let reduced = x;
  let halvings = 0;
  while (reduced > 0.5 || reduced < -0.5) {
    reduced /= 2;
    halvings++;
  }

  let result = 1;
  for (let n = TAYLOR_TERMS; n >= 1; n--) result = 1 + (reduced / n) * result;
  for (let i = 0; i < halvings; i++) result *= result;
  return result;
}
