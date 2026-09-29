import { isActionHeld, wasActionPressed, type InputCommand } from '../input/InputCommand';
import { clamp } from '../math/scalar';
import type { CollisionWorld } from '../physics/CollisionWorld';
import { updateStance } from './crouch';
import { airMove, groundMove, stanceSpeed, wishVelocity, type Planar } from './horizontal';
import { Body, groundDistance, moveHorizontal } from './kinematics';
import { applyLook } from './look';
import { jumpBufferTicks, jumpVelocity, type PlayerMovementConfig } from './PlayerMovementConfig';
import { freezeState, hullHeight, type PlayerState } from './PlayerState';
import { recoverStamina, spendStamina, staminaSpeedFactor } from './stamina';
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
 * Landings count (and cost stamina) only when falling at least this fast,
 * m/s. A jump lands at ~7.7 m/s; spawning on the floor or stepping does not count.
 */
const LANDING_IMPACT_SPEED = 1;

/**
 * Advances one player by one simulation tick, following the Source / CS2
 * movement model (see PlayerMovementConfig).
 *
 * Pure and deterministic: the result depends only on the arguments, which
 * are never mutated. The same initial state and the same commands therefore
 * always yield the same states, which is what client-side prediction and
 * server re-simulation rely on.
 *
 * Order within a tick:
 * 1. depenetration safety net
 * 2. view (yaw/pitch) and stamina recovery
 * 3. jump decision (a press, grounded at the start of the tick)
 * 4. stance (crouch/stand, hull resize); on a take-off tick it follows air rules
 * 5. horizontal: ground friction + acceleration, or air acceleration. A jump
 *    tick is an air tick (no friction), as in Source; fatigue trims the speed.
 * 6. gravity (and the jump impulse)
 * 7. horizontal collide-and-slide (with step climbing on the ground), then vertical movement
 * 8. ground detection and snapping; landing costs stamina
 */
export function simulatePlayerTick(previous: PlayerState, command: InputCommand, context: PlayerSimulationContext): PlayerState {
  const { world, config, tickSeconds: dt } = context;
  const body = new Body(previous.position, hullHeight(previous.crouched, config), config.radius);

  // 1. Never start a tick inside geometry (spawns, teleports, corrections).
  const push = world.resolvePenetration(body.hull());
  body.x += push.x;
  body.y += push.y;
  body.z += push.z;

  // 2. View and fatigue recovery.
  const view = applyLook(previous.yaw, previous.pitch, command.lookX, command.lookY, config.maxPitch);
  let stamina = recoverStamina(previous.stamina, config, dt);

  // 3. Jump decision.
  let jumpBuffer = nextJumpBuffer(previous.jumpBufferTicks, wasActionPressed(command, 'jump'), jumpBufferTicks(config, dt));
  const jumped = previous.grounded && jumpBuffer > 0;
  if (jumped) jumpBuffer = 0;

  // 4. Stance. Crouching on the take-off tick tucks the legs like any airborne
  // crouch, so pressing jump and crouch together always gives the crouch-jump.
  const stance = updateStance(world, body, previous, isActionHeld(command, 'crouch'), previous.grounded && !jumped, config, dt);

  // 5. Horizontal velocity.
  const walking = isActionHeld(command, 'walk') && !stance.crouched;
  const speedLimit = config.maxSpeed * staminaSpeedFactor(stamina, config);
  const wish = wishVelocity(command.moveX, command.moveY, view.yaw, stanceSpeed(stance.crouched, walking, speedLimit, config));
  let planar: Planar = { x: previous.velocity.x, z: previous.velocity.z };

  if (jumped) {
    const kept = staminaSpeedFactor(stamina, config);
    planar = { x: planar.x * kept, z: planar.z * kept };
    stamina = spendStamina(stamina, config.jumpStaminaCost);
  }
  const horizontal = previous.grounded && !jumped ? groundMove(planar, wish, speedLimit, config, dt) : airMove(planar, wish, config, dt);

  // 6. Gravity (and the jump impulse).
  let velocityY = jumped ? jumpVelocity(config) : previous.grounded ? 0 : previous.velocity.y;
  let displacementY = 0;
  if (jumped || !previous.grounded) {
    const step = integrateGravity(velocityY, config.gravity, dt, config.maxVelocity);
    displacementY = step.displacement;
    velocityY = step.velocity;
  }

  // 7. Move: horizontal first (so a rising jump can clear a ledge), then vertical.
  const velocityXLimited = clamp(horizontal.x, -config.maxVelocity, config.maxVelocity);
  const velocityZLimited = clamp(horizontal.z, -config.maxVelocity, config.maxVelocity);
  const onGround = previous.grounded && !jumped;
  const moved = moveHorizontal(world, body, velocityXLimited * dt, velocityZLimited * dt, onGround, config.stepHeight);
  // Blocked axes lose their velocity: sliding along a wall keeps only the parallel part.
  const velocityX = moved.blockedX ? 0 : velocityXLimited;
  const velocityZ = moved.blockedZ ? 0 : velocityZLimited;

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
  if (grounded && !previous.grounded && previous.velocity.y <= -LANDING_IMPACT_SPEED) {
    stamina = spendStamina(stamina, config.landStaminaCost);
  }

  return freezeState({
    position: body.position,
    velocity: { x: velocityX, y: velocityY, z: velocityZ },
    yaw: view.yaw,
    pitch: view.pitch,
    grounded,
    crouched: stance.crouched,
    crouchAmount: stance.crouchAmount,
    walking,
    stamina,
    jumpBufferTicks: jumpBuffer,
  });
}
