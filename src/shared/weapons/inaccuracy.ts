import { deterministicExp } from '../math/deterministicExp';
import { clamp, lerp } from '../math/scalar';
import { horizontalSpeed, type PlayerState } from '../player/PlayerState';
import type { WeaponDefinition } from './WeaponDefinition';
import type { WeaponRules } from './WeaponRules';

/** ln 10: an accuracy penalty falls to a tenth of its value in one recovery time. */
const LN_10 = 2.302585092994046;

/** Largest accumulated penalty (a full-inaccuracy cone, ~45°). */
const MAX_PENALTY = 1;

/**
 * Extra inaccuracy from moving on the ground: none up to
 * `accurateSpeedFraction` of the weapon's speed (34 %: counter-strafing or
 * crouch-walking keeps full accuracy), rising linearly to the full
 * `inaccuracyMove` at `inaccurateSpeedFraction` (95 %).
 */
export function movementInaccuracy(weapon: WeaponDefinition, rules: WeaponRules, speed: number): number {
  const accurate = weapon.maxSpeed * rules.accurateSpeedFraction;
  const inaccurate = weapon.maxSpeed * rules.inaccurateSpeedFraction;
  return clamp((speed - accurate) / (inaccurate - accurate), 0, 1) * weapon.inaccuracyMove;
}

/**
 * Inaccuracy the player's situation imposes, before the accumulated
 * penalty: the stance's base value plus either the movement term (on the
 * ground) or the jumping term (in the air).
 */
export function situationalInaccuracy(weapon: WeaponDefinition, rules: WeaponRules, player: PlayerState): number {
  const stance = player.crouched ? weapon.inaccuracyCrouch : weapon.inaccuracyStand;
  const motion = player.grounded
    ? movementInaccuracy(weapon, rules, horizontalSpeed(player))
    : weapon.inaccuracyJump * rules.airSpreadScale;
  return stance + motion;
}

/**
 * Accuracy recovery time for the current spray: the initial value for the
 * first shots, blending to the final (slower) value between the transition
 * shots, so taps recover faster than long sprays.
 */
export function recoveryTime(weapon: WeaponDefinition, crouched: boolean, recoilIndex: number): number {
  const times = crouched ? weapon.recoveryCrouch : weapon.recoveryStand;
  const [start, end] = weapon.recoveryTransitionShots;
  return lerp(times.initial, times.final, clamp((recoilIndex - start) / (end - start), 0, 1));
}

/** The penalty after recovering for `dt` seconds: exponential, down to 10 % per recovery time. */
export function recoverPenalty(penalty: number, recovery: number, dt: number): number {
  return penalty * deterministicExp((-LN_10 * dt) / recovery);
}

/** Adds to the penalty, capped. */
export function addPenalty(penalty: number, amount: number): number {
  return Math.min(penalty + amount, MAX_PENALTY);
}
