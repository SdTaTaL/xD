import { sinCos } from '../math/deterministicTrig';
import type { PlayerMovementConfig } from './PlayerMovementConfig';

/** Horizontal (XZ-plane) vector, m/s. */
export interface Planar {
  readonly x: number;
  readonly z: number;
}

const ZERO: Planar = Object.freeze({ x: 0, z: 0 });

function length(x: number, z: number): number {
  return Math.sqrt(x * x + z * z);
}

/** Moves `current` towards `target` by at most `maxDelta` along the straight line between them. */
function moveTowards(current: Planar, target: Planar, maxDelta: number): Planar {
  const dx = target.x - current.x;
  const dz = target.z - current.z;
  const distance = length(dx, dz);
  if (distance <= maxDelta) return target;
  const scale = maxDelta / distance;
  return { x: current.x + dx * scale, z: current.z + dz * scale };
}

/** Sprinting requires the sprint action, standing stance and a mostly-forward move direction. */
export function isSprinting(moveX: number, moveY: number, crouched: boolean, sprintHeld: boolean, config: PlayerMovementConfig): boolean {
  if (!sprintHeld || crouched) return false;
  const magnitude = length(moveX, moveY);
  return magnitude > 0 && moveY / magnitude >= config.sprintMinForward;
}

/** Speed limit for the current stance. */
export function stanceSpeed(crouched: boolean, sprinting: boolean, config: PlayerMovementConfig): number {
  if (crouched) return config.crouchSpeed;
  return sprinting ? config.sprintSpeed : config.walkSpeed;
}

/**
 * World-space velocity the player wants, from the command's move axes.
 *
 * The move vector is clamped to the unit disc: a keyboard diagonal (1, 1) is
 * normalized so W+D is exactly as fast as W, while an analog stick pushed
 * halfway asks for half speed.
 */
export function wishVelocity(moveX: number, moveY: number, yaw: number, maxSpeed: number): Planar {
  const magnitude = length(moveX, moveY);
  if (magnitude === 0) return ZERO;

  const scale = (magnitude > 1 ? 1 / magnitude : 1) * maxSpeed;
  const forward = moveY * scale;
  const strafe = moveX * scale;
  // Forward = (sin yaw, −cos yaw), right = (cos yaw, sin yaw) in the XZ plane.
  const { sin, cos } = sinCos(yaw);
  return { x: forward * sin + strafe * cos, z: strafe * sin - forward * cos };
}

/**
 * Ground acceleration: approach the wish velocity in a straight line at a
 * constant rate. Speeding up uses `groundAcceleration`; stopping, braking
 * against the current motion and shedding speed above the limit use the
 * stronger `groundDeceleration`. Straight-line approach can never overshoot
 * the target, so speed never exceeds max(current speed, stance limit).
 */
export function accelerateGround(velocity: Planar, wish: Planar, config: PlayerMovementConfig, dt: number): Planar {
  const wishSpeed = length(wish.x, wish.z);
  const braking =
    wishSpeed === 0 ||
    velocity.x * wish.x + velocity.z * wish.z < 0 ||
    length(velocity.x, velocity.z) > wishSpeed;
  const rate = braking ? config.groundDeceleration : config.groundAcceleration;
  return moveTowards(velocity, wish, rate * dt);
}

/**
 * Air control: without input momentum is kept untouched. With input the
 * velocity is steered towards the wish direction at the larger of the current
 * speed and the stance limit, so air control can turn and slow you (by
 * pushing against your motion) but never adds speed through strafing.
 */
export function accelerateAir(velocity: Planar, wish: Planar, config: PlayerMovementConfig, dt: number): Planar {
  const wishSpeed = length(wish.x, wish.z);
  if (wishSpeed === 0) return velocity;

  const targetSpeed = Math.max(wishSpeed, length(velocity.x, velocity.z));
  const scale = targetSpeed / wishSpeed;
  return moveTowards(velocity, { x: wish.x * scale, z: wish.z * scale }, config.airAcceleration * dt);
}
