import { lerp } from '../math/scalar';
import type { Vec3 } from '../math/Vec3';
import { aabb, type Aabb } from '../physics/Aabb';
import type { PlayerMovementConfig } from './PlayerMovementConfig';

/**
 * Complete simulation state of one player at the end of a tick.
 *
 * Plain, immutable, serializable data: exactly what client-side prediction
 * will store per tick and what a server snapshot will carry. Nothing else
 * influences the next tick besides this state, the input command, the
 * collision world, the config and the fixed tick duration.
 */
export interface PlayerState {
  /** Bottom-center of the collision hull (the feet), meters. */
  readonly position: Vec3;
  /** Meters per second. */
  readonly velocity: Vec3;
  /** View yaw in radians, [-π, π). 0 looks towards −Z; positive turns right. */
  readonly yaw: number;
  /** View pitch in radians, within ±maxPitch. Positive looks up. */
  readonly pitch: number;
  /** Standing on something at the end of the tick. */
  readonly grounded: boolean;
  /** Uses the crouched collision hull. */
  readonly crouched: boolean;
  /** View blend between standing (0) and crouched (1) eye height. */
  readonly crouchAmount: number;
  /** Moving at sprint speed this tick. */
  readonly sprinting: boolean;
  /** Remaining ticks in which a buffered jump press still triggers a jump. */
  readonly jumpBufferTicks: number;
}

export interface SpawnPose {
  readonly position: Vec3;
  readonly yaw: number;
}

export function createPlayerState(spawn: SpawnPose): PlayerState {
  return freezeState({
    position: spawn.position,
    velocity: { x: 0, y: 0, z: 0 },
    yaw: spawn.yaw,
    pitch: 0,
    grounded: false,
    crouched: false,
    crouchAmount: 0,
    sprinting: false,
    jumpBufferTicks: 0,
  });
}

export function freezeState(state: PlayerState): PlayerState {
  Object.freeze(state.position);
  Object.freeze(state.velocity);
  return Object.freeze(state);
}

export function hullHeight(crouched: boolean, config: PlayerMovementConfig): number {
  return crouched ? config.crouchingHeight : config.standingHeight;
}

/** Collision hull of a player whose feet are at `position`. */
export function playerHull(position: Vec3, height: number, radius: number): Aabb {
  return aabb(position.x - radius, position.y, position.z - radius, position.x + radius, position.y + height, position.z + radius);
}

/** Eye height above the feet, blended by the crouch transition. */
export function eyeHeight(state: PlayerState, config: PlayerMovementConfig): number {
  return lerp(config.standingEyeHeight, config.crouchingEyeHeight, state.crouchAmount);
}

/** World-space eye position: the origin of the view (and, later, of shots). */
export function eyePosition(state: PlayerState, config: PlayerMovementConfig): Vec3 {
  return { x: state.position.x, y: state.position.y + eyeHeight(state, config), z: state.position.z };
}

/** Horizontal speed in m/s. */
export function horizontalSpeed(state: PlayerState): number {
  return Math.sqrt(state.velocity.x * state.velocity.x + state.velocity.z * state.velocity.z);
}
