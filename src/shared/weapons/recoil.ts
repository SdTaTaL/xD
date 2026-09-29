import { sinCos } from '../math/deterministicTrig';
import { deterministicExp } from '../math/deterministicExp';
import { lerp } from '../math/scalar';
import { SeededRandom } from '../math/SeededRandom';
import type { ViewAngles } from '../player/look';
import type { WeaponDefinition } from './WeaponDefinition';
import type { WeaponRules } from './WeaponRules';

/** Kicks stored per pattern; later shots of a longer spray reuse the last one. */
const PATTERN_LENGTH = 64;

/** Aim punch and its angular velocity. */
export interface AimPunch {
  readonly angle: ViewAngles;
  readonly velocity: ViewAngles;
}

/** Generated patterns, per weapon and rules. */
const patterns = new WeakMap<WeaponDefinition, WeakMap<WeaponRules, readonly ViewAngles[]>>();

/**
 * The weapon's fixed spray pattern: the kick (angular velocity added to the
 * aim punch, rad/s) of every shot of a spray, in order.
 *
 * Generated once from the weapon's recoil seed, so it is identical in every
 * spray, on every machine, and can be learned. Each kick points
 * `recoilAngle ± recoilAngleVariance` away from straight up, with strength
 * `recoilMagnitude ± recoilMagnitudeVariance`; in automatic weapons each kick
 * blends with the previous one (`recoilVariance`), so the spray drifts
 * smoothly instead of jittering. The first shots are suppressed.
 */
export function recoilPattern(weapon: WeaponDefinition, rules: WeaponRules): readonly ViewAngles[] {
  let byRules = patterns.get(weapon);
  if (!byRules) {
    byRules = new WeakMap();
    patterns.set(weapon, byRules);
  }
  const cached = byRules.get(rules);
  if (cached) return cached;

  const random = new SeededRandom(weapon.recoilSeed);
  const pattern: ViewAngles[] = [];
  let angle = 0;
  let magnitude = 0;

  for (let shot = 0; shot < PATTERN_LENGTH; shot++) {
    const newAngle = weapon.recoilAngle + random.range(-weapon.recoilAngleVariance, weapon.recoilAngleVariance);
    const newMagnitude = weapon.recoilMagnitude + random.range(-weapon.recoilMagnitudeVariance, weapon.recoilMagnitudeVariance);
    const blend = weapon.fullAuto && shot > 0 ? rules.recoilVariance : 1;
    angle = lerp(angle, newAngle, blend);
    magnitude = lerp(magnitude, newMagnitude, blend);

    const suppression =
      shot < rules.recoilSuppressionShots ? lerp(rules.recoilSuppressionFactor, 1, shot / rules.recoilSuppressionShots) : 1;
    const { sin, cos } = sinCos(angle);
    pattern.push(Object.freeze({ pitch: cos * magnitude * suppression, yaw: sin * magnitude * suppression }));
  }

  const frozen = Object.freeze(pattern);
  byRules.set(rules, frozen);
  return frozen;
}

/** Kick of the `index`-th shot of a spray (0 = first). */
export function recoilKick(weapon: WeaponDefinition, rules: WeaponRules, index: number): ViewAngles {
  const pattern = recoilPattern(weapon, rules);
  return pattern[Math.min(index, pattern.length - 1)] as ViewAngles;
}

/**
 * Advances the aim punch by `dt` seconds with no new shots.
 *
 * - The velocity decays exponentially (`aimPunchVelocityDecay`) and moves the
 *   angle by its exact integral over the step.
 * - The angle is pulled back towards zero exponentially (`aimPunchDecay`) and
 *   linearly (`aimPunchLinearDecay`), so it settles in finite time.
 */
export function decayAimPunch(punch: AimPunch, rules: WeaponRules, dt: number): AimPunch {
  const exponential = deterministicExp(-rules.aimPunchDecay * dt);
  let pitch = punch.angle.pitch * exponential;
  let yaw = punch.angle.yaw * exponential;

  const size = Math.sqrt(pitch * pitch + yaw * yaw);
  if (size > 0) {
    const scale = Math.max(size - rules.aimPunchLinearDecay * dt, 0) / size;
    pitch *= scale;
    yaw *= scale;
  }

  const k = rules.aimPunchVelocityDecay;
  const velocityDecay = deterministicExp(-k * dt);
  const travelled = (1 - velocityDecay) / k;
  pitch += punch.velocity.pitch * travelled;
  yaw += punch.velocity.yaw * travelled;

  return {
    angle: { pitch: pitch + 0, yaw: yaw + 0 },
    velocity: { pitch: settle(punch.velocity.pitch * velocityDecay), yaw: settle(punch.velocity.yaw * velocityDecay) },
  };
}

/**
 * Below this the punch velocity is dropped, rad/s (≈ 0.00001°/s): an
 * exponential never reaches zero, and without the cut an idle weapon's state
 * would keep changing in the last bits forever.
 */
const REST_VELOCITY = 1e-7;

function settle(velocity: number): number {
  return Math.abs(velocity) < REST_VELOCITY ? 0 : velocity + 0;
}
