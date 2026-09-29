import { isActionHeld, wasActionPressed, type InputCommand } from '../input/InputCommand';
import { hashSeed, SeededRandom } from '../math/SeededRandom';
import type { Vec3 } from '../math/Vec3';
import type { CollisionWorld, RayHit } from '../physics/CollisionWorld';
import type { ViewAngles } from '../player/look';
import type { PlayerMovementConfig } from '../player/PlayerMovementConfig';
import { eyePosition, type PlayerState } from '../player/PlayerState';
import { addPenalty, recoverPenalty, recoveryTime, situationalInaccuracy } from './inaccuracy';
import { decayAimPunch, recoilKick } from './recoil';
import { bulletDirection } from './spread';
import type { WeaponDefinition } from './WeaponDefinition';
import type { WeaponRules } from './WeaponRules';
import { freezeWeaponState, type WeaponState } from './WeaponState';

/**
 * Timers count as elapsed within this many seconds of zero. Cycle times such
 * as 0.1 s are not exact in binary, so without it a timer can end 1e-16 s
 * short and slip a whole tick (a shot at 33 ticks instead of 32).
 */
const TIME_EPSILON = 1e-9;

/** Everything besides the states and the command that a weapon tick depends on. */
export interface WeaponSimulationContext {
  readonly world: CollisionWorld;
  readonly weapon: WeaponDefinition;
  readonly rules: WeaponRules;
  /** For the eye height, where bullets start. */
  readonly movement: PlayerMovementConfig;
  /** Fixed simulation step, seconds. */
  readonly tickSeconds: number;
  /**
   * Seed of this shooter's spread. Each shot draws from
   * `hashSeed(spreadSeed, tick)`, so client and server compute the same
   * spread. An authoritative server will own this value.
   */
  readonly spreadSeed: number;
}

/** One bullet fired during a tick. */
export interface Shot {
  readonly tick: number;
  /** Eye position the bullet starts from. */
  readonly origin: Vec3;
  /** Unit direction of the bullet, after recoil and inaccuracy. */
  readonly direction: Vec3;
  /** Where the weapon pointed (view + recoil), before inaccuracy. */
  readonly aim: ViewAngles;
  /** Inaccuracy radius the shot was drawn with (situation + penalty), tangent units. */
  readonly inaccuracy: number;
  /** Position in the spray: 0 for the first shot. */
  readonly sprayIndex: number;
  /** First surface hit within the weapon's range, if any. */
  readonly hit: RayHit | null;
}

export interface WeaponTickResult {
  readonly state: WeaponState;
  /** The shot fired this tick, if any (at most one: every cycle time exceeds a tick). */
  readonly shot: Shot | null;
}

/**
 * Advances the held weapon by one tick. Runs after the player's movement for
 * the same tick: `player` is the state the shot is fired from (position,
 * view, stance, speed), `playerBefore` the one before it (landings).
 *
 * Pure and deterministic, like simulatePlayerTick.
 *
 * Order within a tick:
 * 1. recovery: the aim punch decays, the accuracy penalty recovers, a
 *    landing adds penalty, and a long pause restarts the spray pattern
 * 2. reload: progress, completion, and start (reload key, or trigger on an
 *    empty magazine)
 * 3. trigger: when ready, fire one bullet with the current recoil and
 *    inaccuracy, then apply its kick and penalty
 * 4. fire-rate bookkeeping
 */
export function simulateWeaponTick(
  previous: WeaponState,
  playerBefore: PlayerState,
  player: PlayerState,
  command: InputCommand,
  context: WeaponSimulationContext,
): WeaponTickResult {
  const { weapon, rules, tickSeconds: dt } = context;

  // 1. Recovery.
  let punch = decayAimPunch({ angle: previous.aimPunch, velocity: previous.aimPunchVelocity }, rules, dt);
  let penalty = recoverPenalty(previous.accuracyPenalty, recoveryTime(weapon, player.crouched, previous.recoilIndex), dt);
  if (!playerBefore.grounded && player.grounded) {
    penalty = addPenalty(penalty, weapon.inaccuracyLandPerSpeed * Math.max(0, -playerBefore.velocity.y));
  }
  let sinceLastShot = previous.sinceLastShot + dt;
  let recoilIndex = sinceLastShot >= rules.recoilCooldownSeconds ? 0 : previous.recoilIndex;

  // 2. Reload.
  let { ammo, reserve, reloadRemaining } = previous;
  if (reloadRemaining > 0) {
    reloadRemaining -= dt;
    if (reloadRemaining <= TIME_EPSILON) {
      const loaded = Math.min(weapon.magazineSize - ammo, reserve);
      ammo += loaded;
      reserve -= loaded;
      reloadRemaining = 0;
    }
  }
  // A press always pulls the trigger, even a click shorter than a tick (pressed but no longer held);
  // automatic weapons also keep firing while it is held.
  const trigger = wasActionPressed(command, 'fire') || (weapon.fullAuto && isActionHeld(command, 'fire'));
  const canReload = reloadRemaining === 0 && ammo < weapon.magazineSize && reserve > 0;
  if (canReload && (wasActionPressed(command, 'reload') || (trigger && ammo === 0))) {
    reloadRemaining = weapon.reloadSeconds;
  }

  // 3. Trigger.
  const firing = trigger && reloadRemaining === 0 && ammo > 0;
  let cooldown = previous.cooldown;
  let shot: Shot | null = null;

  if (firing && cooldown <= TIME_EPSILON) {
    const aim: ViewAngles = {
      yaw: player.yaw + punch.angle.yaw * rules.recoilScale,
      pitch: player.pitch + punch.angle.pitch * rules.recoilScale,
    };
    // Inaccuracy as it was before this shot: a first shot gets no fire penalty.
    const inaccuracy = situationalInaccuracy(weapon, rules, player) + penalty;
    const direction = bulletDirection(aim, inaccuracy, weapon.spread, new SeededRandom(hashSeed(context.spreadSeed, command.tick)));
    const origin = eyePosition(player, context.movement);
    shot = Object.freeze({
      tick: command.tick,
      origin,
      direction,
      aim,
      inaccuracy,
      sprayIndex: recoilIndex,
      hit: context.world.raycast(origin, direction, weapon.range),
    });

    const kick = recoilKick(weapon, rules, recoilIndex);
    punch = { angle: punch.angle, velocity: { pitch: punch.velocity.pitch + kick.pitch, yaw: punch.velocity.yaw + kick.yaw } };
    penalty = addPenalty(penalty, weapon.inaccuracyFire);
    ammo -= 1;
    recoilIndex += 1;
    sinceLastShot = 0;
    cooldown += weapon.cycleSeconds;
  }

  // 4. While the trigger stays held the overshoot carries into the next shot,
  // which keeps the average fire rate exact; otherwise the weapon just waits.
  cooldown -= dt;
  if (!firing) cooldown = Math.max(cooldown, 0);

  return {
    state: freezeWeaponState({
      ammo,
      reserve,
      cooldown,
      reloadRemaining,
      recoilIndex,
      sinceLastShot,
      accuracyPenalty: penalty,
      aimPunch: punch.angle,
      aimPunchVelocity: punch.velocity,
    }),
    shot,
  };
}
