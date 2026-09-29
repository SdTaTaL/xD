const DEGREE = Math.PI / 180;

/**
 * Rules shared by every weapon: how recoil builds up and recovers, and how
 * movement affects accuracy.
 *
 * Values are Counter-Strike's. CS2 no longer exposes the recoil variables as
 * console variables; these are their CS:GO defaults, which CS2 inherited.
 * Visual-only settings (how much the camera follows recoil, screen shake)
 * belong to the client, not here.
 */
export interface WeaponRules {
  /** Bullets fly at view + aim punch × this. `weapon_recoil_scale` 2. */
  readonly recoilScale: number;
  /** Exponential decay rate of the aim punch, 1/s. `weapon_recoil_decay2_exp` 8. */
  readonly aimPunchDecay: number;
  /** Linear decay of the aim punch, rad/s. `weapon_recoil_decay2_lin` 18°/s. */
  readonly aimPunchLinearDecay: number;
  /** Exponential decay rate of the aim punch's velocity, 1/s. `weapon_recoil_vel_decay` 4.5. */
  readonly aimPunchVelocityDecay: number;
  /** The first shots of a spray kick less. `weapon_recoil_suppression_shots` 4. */
  readonly recoilSuppressionShots: number;
  /** Kick strength of the very first shot, ramping to 1 over the suppressed shots. `weapon_recoil_suppression_factor` 0.5. */
  readonly recoilSuppressionFactor: number;
  /**
   * How much each kick of the fixed pattern follows its own random direction
   * (1) instead of the previous kick's (0): keeps sprays continuous.
   * `weapon_recoil_variance` 0.55 (our interpretation of it).
   */
  readonly recoilVariance: number;
  /** Idle time after which the next shot starts the spray pattern over. `weapon_recoil_cooldown` 0.55 s. */
  readonly recoilCooldownSeconds: number;
  /**
   * Movement inaccuracy starts above this fraction of the weapon's speed and
   * is full at {@link inaccurateSpeedFraction}. 0.34 is CS's crouch-speed
   * factor: below it, shots are as accurate as standing still.
   */
  readonly accurateSpeedFraction: number;
  readonly inaccurateSpeedFraction: number;
  /** Scale of the jumping inaccuracy. `weapon_air_spread_scale` 1. */
  readonly airSpreadScale: number;
}

export const DEFAULT_WEAPON_RULES: WeaponRules = Object.freeze({
  recoilScale: 2,
  aimPunchDecay: 8,
  aimPunchLinearDecay: 18 * DEGREE,
  aimPunchVelocityDecay: 4.5,
  recoilSuppressionShots: 4,
  recoilSuppressionFactor: 0.5,
  recoilVariance: 0.55,
  recoilCooldownSeconds: 0.55,
  accurateSpeedFraction: 0.34,
  inaccurateSpeedFraction: 0.95,
  airSpreadScale: 1,
});
