/**
 * Tunable movement parameters. Units: meters, seconds, radians.
 *
 * These are the initial tuning for a responsive, readable competitive feel:
 * quick starts and stops, no momentum tricks, committed jumps. Each value
 * states why it was chosen and what it implies at the 64 Hz tick rate, so
 * later tuning can be deliberate. Change them here, never in the controller.
 */
export interface PlayerMovementConfig {
  // --- Collision hull -------------------------------------------------------
  /** Half the hull width. 0.3 m → 0.6 m wide: fits 0.65 m gaps and 1 m doors comfortably. */
  readonly radius: number;
  /** Standing hull height. 1.8 m: an average adult. */
  readonly standingHeight: number;
  /** Crouched hull height. 1.3 m (72 % of standing): hides behind ~1.3 m cover, fits 1.5 m tunnels. */
  readonly crouchingHeight: number;
  /**
   * Eye height when standing / crouched. Both sit 0.18 m below the top of
   * their hull, so crouching in the air (head fixed, legs tucked) keeps the
   * view perfectly still.
   */
  readonly standingEyeHeight: number;
  readonly crouchingEyeHeight: number;
  /** Time for the view to move between standing and crouched eye height on the ground. */
  readonly crouchTransitionSeconds: number;

  // --- Horizontal speed -----------------------------------------------------
  /** Default ground speed. 4.8 m/s: crosses the 48 m arena in 10 s. */
  readonly walkSpeed: number;
  /** Sprint speed (+33 %). 6.4 m/s: a clear rotation boost without outrunning information. */
  readonly sprintSpeed: number;
  /** Crouched speed (40 % of walk). 1.9 m/s: precise peeking, clearly a commitment. */
  readonly crouchSpeed: number;
  /**
   * Sprint needs at least this much forward component in the move direction
   * (0.5 = within 60° of forward): W and W+A/D sprint, pure strafes and
   * backpedals never do.
   */
  readonly sprintMinForward: number;

  // --- Acceleration ---------------------------------------------------------
  /** Ground acceleration towards the wish velocity. 50 m/s²: 0 → walk speed in 0.096 s (7 ticks). */
  readonly groundAcceleration: number;
  /**
   * Ground deceleration when stopping, braking or over the speed limit.
   * 70 m/s²: walk → 0 in 0.069 s (5 ticks, ~0.19 m). Stops are crisp, so
   * standing still to shoot never needs counter-strafing tricks.
   */
  readonly groundDeceleration: number;
  /**
   * Air control. 5 m/s²: about 3 m/s of steering over a full jump, enough to
   * correct, not to reverse. Air control only steers: it never adds speed
   * beyond the current speed or the mode's limit, so strafe-jumping and
   * bunny-hopping gain nothing.
   */
  readonly airAcceleration: number;

  // --- Vertical ---------------------------------------------------------------
  /** Gravity. 20 m/s² (≈ 2 g): snappy, readable arcs, as competitive shooters use. */
  readonly gravity: number;
  /** Jump apex height (feet). 1.0 m: clears 0.9 m obstacles; ~1.2 m ledges need a crouch-jump. */
  readonly jumpHeight: number;
  /** A jump pressed up to this long before landing still fires on landing. 0.1 s ≈ 6 ticks. */
  readonly jumpBufferSeconds: number;
  /** Highest ledge climbed by walking (stairs, curbs) and dropped without leaving the ground. 0.35 m. */
  readonly stepHeight: number;
  /** Terminal fall speed. 50 m/s: a safety bound, never reached in normal play. */
  readonly maxFallSpeed: number;

  // --- View -----------------------------------------------------------------
  /** Pitch limit, up and down. 89°: never straight up/down, which would make yaw undefined. */
  readonly maxPitch: number;
}

export const DEFAULT_PLAYER_MOVEMENT: PlayerMovementConfig = Object.freeze({
  radius: 0.3,
  standingHeight: 1.8,
  crouchingHeight: 1.3,
  standingEyeHeight: 1.62,
  crouchingEyeHeight: 1.12,
  crouchTransitionSeconds: 0.12,

  walkSpeed: 4.8,
  sprintSpeed: 6.4,
  crouchSpeed: 1.9,
  sprintMinForward: 0.5,

  groundAcceleration: 50,
  groundDeceleration: 70,
  airAcceleration: 5,

  gravity: 20,
  jumpHeight: 1.0,
  jumpBufferSeconds: 0.1,
  stepHeight: 0.35,
  maxFallSpeed: 50,

  maxPitch: (89 * Math.PI) / 180,
});

/** Take-off speed that reaches exactly `jumpHeight` under `gravity`: v = √(2gh). */
export function jumpVelocity(config: PlayerMovementConfig): number {
  return Math.sqrt(2 * config.gravity * config.jumpHeight);
}

/** Jump buffer length in whole ticks. */
export function jumpBufferTicks(config: PlayerMovementConfig, tickSeconds: number): number {
  return Math.max(0, Math.round(config.jumpBufferSeconds / tickSeconds));
}
