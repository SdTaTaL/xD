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

/** Speed limit for the current stance: crouch and walk are fractions of the max speed. */
export function stanceSpeed(crouched: boolean, walking: boolean, maxSpeed: number, config: PlayerMovementConfig): number {
  if (crouched) return maxSpeed * config.crouchSpeedScale;
  return walking ? maxSpeed * config.walkSpeedScale : maxSpeed;
}

/**
 * World-space velocity the player wants, from the command's move axes.
 *
 * The move vector is clamped to the unit disc: a keyboard diagonal (1, 1) is
 * normalized so W+D is exactly as fast as W, while an analog stick pushed
 * halfway asks for half speed.
 */
export function wishVelocity(moveX: number, moveY: number, yaw: number, speed: number): Planar {
  const magnitude = length(moveX, moveY);
  if (magnitude === 0) return ZERO;

  const scale = (magnitude > 1 ? 1 / magnitude : 1) * speed;
  const forward = moveY * scale;
  const strafe = moveX * scale;
  // Forward = (sin yaw, −cos yaw), right = (cos yaw, sin yaw) in the XZ plane.
  const { sin, cos } = sinCos(yaw);
  return { x: forward * sin + strafe * cos, z: strafe * sin - forward * cos };
}

/**
 * Source ground friction: speed drops by max(speed, stopSpeed) × friction
 * per second. Proportional at running speeds (a smooth slow-down), constant
 * near standstill (so it ends in finite time).
 */
export function applyFriction(velocity: Planar, config: PlayerMovementConfig, dt: number): Planar {
  const speed = length(velocity.x, velocity.z);
  if (speed === 0) return velocity;
  const drop = Math.max(speed, config.stopSpeed) * config.friction * dt;
  const scale = Math.max(speed - drop, 0) / speed;
  return scale === 0 ? ZERO : { x: velocity.x * scale, z: velocity.z * scale };
}

/**
 * Source acceleration: adds speed along the wish direction until the
 * velocity's component along it reaches `targetSpeed`, at most
 * `rate × accelSpeed × dt` per tick. It never removes speed, which is why
 * pressing the opposite direction (counter-strafing) brakes so much harder
 * than friction alone.
 */
function accelerate(velocity: Planar, direction: Planar, targetSpeed: number, rate: number, accelSpeed: number, dt: number): Planar {
  const current = velocity.x * direction.x + velocity.z * direction.z;
  const add = targetSpeed - current;
  if (add <= 0) return velocity;
  const step = Math.min(rate * accelSpeed * dt, add);
  return { x: velocity.x + direction.x * step, z: velocity.z + direction.z * step };
}

/**
 * One tick of ground movement: friction, then acceleration towards the wish
 * velocity, then the speed limit. `speedLimit` is the equipment's max speed
 * (already reduced by fatigue); stance limits come through `wish`.
 *
 * The acceleration rate scales with the full `speedLimit`, not with the
 * (slower) walk/crouch wish speed: in plain Source maths a crouch start
 * would take ~1.6 s because friction nearly cancels a crouch-scaled
 * acceleration, whereas CS starts walking and crouching as briskly as running.
 */
export function groundMove(velocity: Planar, wish: Planar, speedLimit: number, config: PlayerMovementConfig, dt: number): Planar {
  let result = applyFriction(velocity, config, dt);
  const wishSpeed = length(wish.x, wish.z);
  if (wishSpeed > 0) {
    const direction = { x: wish.x / wishSpeed, z: wish.z / wishSpeed };
    result = accelerate(result, direction, wishSpeed, config.accelerate, Math.max(wishSpeed, speedLimit), dt);
  }

  const speed = length(result.x, result.z);
  if (speed > speedLimit) {
    const scale = speedLimit / speed;
    result = { x: result.x * scale, z: result.z * scale };
  }
  return result;
}

/**
 * One tick of air movement (Source): no friction; acceleration towards the
 * wish direction, but only up to `airMaxWishSpeed` along it. Holding a key
 * barely changes existing momentum; turning the view while strafing keeps
 * the wish direction nearly perpendicular to the velocity, which is what
 * lets skilled players steer and gain speed in the air (air strafing).
 */
export function airMove(velocity: Planar, wish: Planar, config: PlayerMovementConfig, dt: number): Planar {
  const wishSpeed = length(wish.x, wish.z);
  if (wishSpeed === 0) return velocity;
  const direction = { x: wish.x / wishSpeed, z: wish.z / wishSpeed };
  return accelerate(velocity, direction, Math.min(wishSpeed, config.airMaxWishSpeed), config.airAccelerate, wishSpeed, dt);
}
