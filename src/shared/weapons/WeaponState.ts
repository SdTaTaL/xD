import type { ViewAngles } from '../player/look';
import type { WeaponDefinition } from './WeaponDefinition';

/**
 * Complete simulation state of the weapon a player holds, at the end of a
 * tick. Plain, immutable, serializable data, like PlayerState: prediction
 * stores it per tick and the server will re-simulate it.
 */
export interface WeaponState {
  /** Rounds in the magazine. */
  readonly ammo: number;
  /** Spare rounds. */
  readonly reserve: number;
  /**
   * Seconds until the next shot may fire; ready at ≤ 0. While the trigger is
   * held the overshoot carries over, so the fire rate is exact even though
   * shots happen on tick boundaries.
   */
  readonly cooldown: number;
  /** Seconds left of the reload in progress; 0 when not reloading. */
  readonly reloadRemaining: number;
  /** Position in the spray pattern: shots fired since the pattern last restarted. */
  readonly recoilIndex: number;
  /** Seconds since the last shot. */
  readonly sinceLastShot: number;
  /** Inaccuracy added by firing and landing; recovers over time. */
  readonly accuracyPenalty: number;
  /**
   * Recoil offset of the bullets from the view, radians. Bullets fly at view
   * angles + aimPunch × recoilScale. Positive pitch is up, positive yaw right.
   */
  readonly aimPunch: ViewAngles;
  /** Angular velocity of the aim punch, rad/s. Each shot kicks it. */
  readonly aimPunchVelocity: ViewAngles;
}

const NO_ANGLES: ViewAngles = Object.freeze({ yaw: 0, pitch: 0 });

export function createWeaponState(weapon: WeaponDefinition): WeaponState {
  return freezeWeaponState({
    ammo: weapon.magazineSize,
    reserve: weapon.reserveAmmo,
    cooldown: 0,
    reloadRemaining: 0,
    recoilIndex: 0,
    // Long idle: the first shot starts a fresh spray.
    sinceLastShot: Number.MAX_VALUE,
    accuracyPenalty: 0,
    aimPunch: NO_ANGLES,
    aimPunchVelocity: NO_ANGLES,
  });
}

export function freezeWeaponState(state: WeaponState): WeaponState {
  Object.freeze(state.aimPunch);
  Object.freeze(state.aimPunchVelocity);
  return Object.freeze(state);
}

export function isReloading(state: WeaponState): boolean {
  return state.reloadRemaining > 0;
}
