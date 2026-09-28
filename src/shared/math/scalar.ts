export const TAU = Math.PI * 2;

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Moves `current` towards `target` by at most `maxDelta` (never overshoots). */
export function moveTowards(current: number, target: number, maxDelta: number): number {
  if (current < target) return Math.min(current + maxDelta, target);
  return Math.max(current - maxDelta, target);
}

/** Wraps an angle in radians to [-π, π). */
export function wrapAngle(radians: number): number {
  return radians - TAU * Math.floor((radians + Math.PI) / TAU);
}
