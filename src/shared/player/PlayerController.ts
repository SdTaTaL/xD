import { isActionHeld, wasActionPressed, type InputCommand } from '../input/InputCommand';
import type { CollisionWorld } from '../physics/CollisionWorld';
import { updateStance } from './crouch';
import { accelerateAir, accelerateGround, isSprinting, stanceSpeed, wishVelocity } from './horizontal';
import { Body, groundDistance, moveHorizontal } from './kinematics';
import { applyLook } from './look';
import { jumpBufferTicks, jumpVelocity, type PlayerMovementConfig } from './PlayerMovementConfig';
import { freezeState, hullHeight, type PlayerState } from './PlayerState';
import { integrateGravity, nextJumpBuffer } from './vertical';

/** Everything besides the state and the command that a tick depends on. */
export interface PlayerSimulationContext {
  readonly world: CollisionWorld;
  readonly config: PlayerMovementConfig;
  /** Fixed simulation step, seconds. */
  readonly tickSeconds: number;
}

/**
 * Airborne bodies closer than this to a surface below count as landed (and
 * are snapped onto it). Keeps grounding stable against rounding.
 */
const GROUND_CONTACT_DISTANCE = 0.01;

/**
 * Advances one player by one simulation tick.
 *
 * Pure and deterministic: the result depends only on the arguments, which
 * are never mutated. The same initial state and the same commands therefore
 * always yield the same states, which is what client-side prediction and
 * server re-simulation rely on.
 *
 * Order within a tick:
 * 1. depenetration safety net
 * 2. view (yaw/pitch)
 * 3. jump decision (buffered press + grounded at the start of the tick)
 * 4. stance (crouch/stand, hull resize); on a take-off tick it follows air rules
 * 5. horizontal acceleration (ground or air rules, from the start-of-tick grounded state)
 * 6. gravity
 * 7. horizontal collide-and-slide (with step climbing on the ground), then vertical movement
 * 8. ground detection and snapping
 */
export function simulatePlayerTick(previous: PlayerState, command: InputCommand, context: PlayerSimulationContext): PlayerState {
  const { world, config, tickSeconds: dt } = context;
  const body = new Body(previous.position, hullHeight(previous.crouched, config), config.radius);

  // 1. Never start a tick inside geometry (spawns, teleports, corrections).
  const push = world.resolvePenetration(body.hull());
  body.x += push.x;
  body.y += push.y;
  body.z += push.z;

  // 2. View.
  const view = applyLook(previous.yaw, previous.pitch, command.lookX, command.lookY, config.maxPitch);

  // 3. Jump decision.
  let jumpBuffer = nextJumpBuffer(previous.jumpBufferTicks, wasActionPressed(command, 'jump'), jumpBufferTicks(config, dt));
  const jumped = previous.grounded && jumpBuffer > 0;
  if (jumped) jumpBuffer = 0;

  // 4. Stance. Crouching on the take-off tick tucks the legs like any airborne
  // crouch, so pressing jump and crouch together always gives the crouch-jump.
  const stance = updateStance(world, body, previous, isActionHeld(command, 'crouch'), previous.grounded && !jumped, config, dt);

  // 5. Horizontal velocity.
  const sprinting = isSprinting(command.moveX, command.moveY, stance.crouched, isActionHeld(command, 'sprint'), config);
  const wish = wishVelocity(command.moveX, command.moveY, view.yaw, stanceSpeed(stance.crouched, sprinting, config));
  const planar = { x: previous.velocity.x, z: previous.velocity.z };
  const accelerate = previous.grounded ? accelerateGround : accelerateAir;
  let horizontal = accelerate(planar, wish, config, dt);

  // 6. Gravity (and the jump impulse).
  let velocityY = jumped ? jumpVelocity(config) : previous.grounded ? 0 : previous.velocity.y;
  let displacementY = 0;
  if (jumped || !previous.grounded) {
    const step = integrateGravity(velocityY, config.gravity, dt, config.maxFallSpeed);
    displacementY = step.displacement;
    velocityY = step.velocity;
  }

  // 7. Move: horizontal first (so a rising jump can clear a ledge), then vertical.
  const onGround = previous.grounded && !jumped;
  const moved = moveHorizontal(world, body, horizontal.x * dt, horizontal.z * dt, onGround, config.stepHeight);
  if (moved.blockedX || moved.blockedZ) {
    // Against a wall only the wall-parallel part of the input counts. Re-derive
    // the velocity from it so sliding accelerates at the full rate instead of
    // wasting acceleration on the blocked axis.
    const along = (value: number, blocked: boolean): number => (blocked ? 0 : value);
    horizontal = accelerate(
      { x: along(planar.x, moved.blockedX), z: along(planar.z, moved.blockedZ) },
      { x: along(wish.x, moved.blockedX), z: along(wish.z, moved.blockedZ) },
      config,
      dt,
    );
  }
  const velocityX = moved.blockedX ? 0 : horizontal.x;
  const velocityZ = moved.blockedZ ? 0 : horizontal.z;

  if (body.sweep(world, 1, displacementY) !== displacementY) velocityY = 0; // landed or hit a ceiling

  // 8. Ground: rest on surfaces within contact distance; while walking, follow drops up to a step.
  let grounded = false;
  if (velocityY <= 0) {
    const reach = onGround ? config.stepHeight : GROUND_CONTACT_DISTANCE;
    const distance = groundDistance(world, body, reach);
    if (distance !== Infinity) {
      body.y -= distance;
      grounded = true;
      velocityY = 0;
    }
  }

  return freezeState({
    position: body.position,
    velocity: { x: velocityX, y: velocityY, z: velocityZ },
    yaw: view.yaw,
    pitch: view.pitch,
    grounded,
    crouched: stance.crouched,
    crouchAmount: stance.crouchAmount,
    sprinting,
    jumpBufferTicks: jumpBuffer,
  });
}
