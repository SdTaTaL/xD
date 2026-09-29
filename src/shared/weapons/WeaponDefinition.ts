import { SOURCE_UNIT } from '../player/PlayerMovementConfig';

const DEGREE = Math.PI / 180;

/** Accuracy recovery time, blended from `initial` to `final` as a spray goes on. */
export interface RecoveryTime {
  /** Seconds, for the first shots of a spray. */
  readonly initial: number;
  /** Seconds, once the spray passes {@link WeaponDefinition.recoveryTransitionShots}. */
  readonly final: number;
}

/**
 * Static data of one weapon. Units: meters, seconds, radians.
 *
 * Real weapons use Counter-Strike 2's values (the `m_…` fields of
 * `scripts/weapons.vdata`), converted to meters. Inaccuracy and spread keep
 * CS's unit: the radius of the spread disc one unit in front of the muzzle,
 * i.e. the tangent of the cone's half-angle (0.00641 ≈ 0.37°).
 */
export interface WeaponDefinition {
  readonly id: string;
  readonly name: string;

  // --- Firing -----------------------------------------------------------------
  /** Seconds between shots. `m_flCycleTime`. */
  readonly cycleSeconds: number;
  /** Holding the trigger keeps firing; otherwise one shot per press. `m_bIsFullAuto`. */
  readonly fullAuto: boolean;
  /** Damage of one bullet at point-blank range, before hit-group and armor. `m_nDamage`. */
  readonly damage: number;
  /** Damage multiplier per 500 units (12.7 m) travelled. `m_flRangeModifier`. */
  readonly rangeModifier: number;
  /** Farthest a bullet travels, meters. `m_flRange`. */
  readonly range: number;

  // --- Ammunition -------------------------------------------------------------
  /** Rounds per magazine. `m_iMaxClip1`. */
  readonly magazineSize: number;
  /** Spare rounds carried. `m_nPrimaryReserveAmmoMax` magazines × magazine size. */
  readonly reserveAmmo: number;
  /** From the start of a reload until the magazine is full and firing is allowed. `m_flDisallowAttackAfterReloadStartDuration`. */
  readonly reloadSeconds: number;

  // --- Movement ---------------------------------------------------------------
  /** Running speed while carrying it, m/s. `m_flMaxSpeed`. */
  readonly maxSpeed: number;

  // --- Accuracy ---------------------------------------------------------------
  /** Intrinsic spread of every shot. `m_flSpread`. */
  readonly spread: number;
  /** Inaccuracy standing still / crouched still. `m_flInaccuracyStand`, `m_flInaccuracyCrouch`. */
  readonly inaccuracyStand: number;
  readonly inaccuracyCrouch: number;
  /** Extra inaccuracy at full running speed. `m_flInaccuracyMove`. */
  readonly inaccuracyMove: number;
  /** Extra inaccuracy while airborne. `m_flInaccuracyJump`. */
  readonly inaccuracyJump: number;
  /** Inaccuracy added by each shot, recovering over the recovery time. `m_flInaccuracyFire`. */
  readonly inaccuracyFire: number;
  /**
   * Inaccuracy added on landing per m/s of fall speed. `m_flInaccuracyLand`
   * is per unit/s of fall speed in our reading (see docs/ARCHITECTURE.md).
   */
  readonly inaccuracyLandPerSpeed: number;
  /** Recovery standing / crouched. `m_flRecoveryTimeStand(Final)`, `m_flRecoveryTimeCrouch(Final)`. */
  readonly recoveryStand: RecoveryTime;
  readonly recoveryCrouch: RecoveryTime;
  /** Spray shots over which recovery blends from initial to final. `m_nRecoveryTransitionStart/EndBullet`. */
  readonly recoveryTransitionShots: readonly [start: number, end: number];

  // --- Recoil -----------------------------------------------------------------
  /** Mean direction of each kick, radians from straight up (positive towards the right). `m_flRecoilAngle`. */
  readonly recoilAngle: number;
  /** Random range of the kick direction, ± radians. `m_flRecoilAngleVariance`. */
  readonly recoilAngleVariance: number;
  /** Angular velocity each shot adds to the aim punch, rad/s. `m_flRecoilMagnitude` (°/s). */
  readonly recoilMagnitude: number;
  /** Random range of the kick strength, ± rad/s. `m_flRecoilMagnitudeVariance`. */
  readonly recoilMagnitudeVariance: number;
  /** Seed of the weapon's fixed spray pattern. `m_nRecoilSeed`. */
  readonly recoilSeed: number;
}

/** AK-47, with Counter-Strike 2's values. */
export const AK47: WeaponDefinition = Object.freeze({
  id: 'ak47',
  name: 'AK-47',

  cycleSeconds: 0.1,
  fullAuto: true,
  damage: 36,
  rangeModifier: 0.98,
  range: 8192 * SOURCE_UNIT,

  magazineSize: 30,
  reserveAmmo: 3 * 30,
  reloadSeconds: 2.466667,

  maxSpeed: 215 * SOURCE_UNIT,

  spread: 0.0006,
  inaccuracyStand: 0.00641,
  inaccuracyCrouch: 0.00481,
  inaccuracyMove: 0.17506,
  inaccuracyJump: 0.14076,
  inaccuracyFire: 0.0078,
  inaccuracyLandPerSpeed: 0.000242 / SOURCE_UNIT,
  recoveryStand: Object.freeze({ initial: 0.368, final: 0.506 }),
  recoveryCrouch: Object.freeze({ initial: 0.305257, final: 0.419728 }),
  recoveryTransitionShots: Object.freeze([2, 5] as const),

  recoilAngle: 0,
  recoilAngleVariance: 70 * DEGREE,
  recoilMagnitude: 30 * DEGREE,
  recoilMagnitudeVariance: 0,
  recoilSeed: 223,
});
