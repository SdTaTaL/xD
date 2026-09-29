/**
 * Source / Counter-Strike units to meters: the CS player is 72 units tall
 * (1.83 m), i.e. 1 unit = 1 inch = 0.0254 m.
 */
export const SOURCE_UNIT = 0.0254;

/**
 * Tunable movement parameters. Units: meters, seconds, radians.
 *
 * The defaults reproduce Counter-Strike 2's movement model (the reference
 * the genre shares with Standoff 2 and Critical Ops): values come from CS2's
 * console variables and player dimensions, converted to meters. Where CS2
 * behaviour is not public (stamina), the value is our own approximation and
 * says so. Tune here, never in the controller.
 */
export interface PlayerMovementConfig {
  // --- Collision hull -------------------------------------------------------
  /** Half the hull width. CS: 32 × 32 units → 0.4064 m. */
  readonly radius: number;
  /** Standing hull height. CS: 72 units → 1.8288 m. */
  readonly standingHeight: number;
  /** Crouched hull height. CS: 54 units → 1.3716 m. */
  readonly crouchingHeight: number;
  /**
   * Eye height standing / crouched. CS: 64 / 46 units → 1.6256 / 1.1684 m.
   * Both are 8 units below the top of their hull, so crouching in the air
   * (head fixed, legs tucked) keeps the view still.
   */
  readonly standingEyeHeight: number;
  readonly crouchingEyeHeight: number;
  /** Time for the view to move between standing and crouched eye height on the ground (approximation). */
  readonly crouchTransitionSeconds: number;

  // --- Speed ----------------------------------------------------------------
  /**
   * Running speed with the lightest equipment (knife). CS: 250 units/s →
   * 6.35 m/s. Weapons will lower it (e.g. AK-47 215 u/s = 5.46 m/s).
   */
  readonly maxSpeed: number;
  /** Walk (Shift, silent) speed as a fraction of the max speed. CS: 0.52 (knife: 3.30 m/s). */
  readonly walkSpeedScale: number;
  /** Crouched speed as a fraction of the max speed. CS: 0.34 (knife: 2.16 m/s). */
  readonly crouchSpeedScale: number;

  // --- Ground (Source friction + acceleration) ------------------------------
  /** Ground friction. CS `sv_friction` 5.2: speed decays ~5.2 × speed per second. */
  readonly friction: number;
  /**
   * Below this speed friction acts as if moving at it, so slow movement stops
   * in finite time. CS `sv_stopspeed` 80 u/s → 2.032 m/s.
   */
  readonly stopSpeed: number;
  /**
   * Ground acceleration, as a multiple of the wish speed per second. CS
   * `sv_accelerate` 5.5: from standstill, full speed in ~0.55 s. Combined
   * with friction this is what makes counter-strafing stop you in ~0.1 s,
   * while just releasing the keys takes ~0.4 s.
   */
  readonly accelerate: number;

  // --- Air ------------------------------------------------------------------
  /** Air acceleration multiplier. CS `sv_airaccelerate` 12. */
  readonly airAccelerate: number;
  /**
   * Cap of the wish speed in the air. CS `sv_air_max_wishspeed` 30 u/s →
   * 0.762 m/s. Small, so holding a direction barely changes momentum, but
   * strafing while turning the view can add speed (air strafing).
   */
  readonly airMaxWishSpeed: number;

  // --- Vertical -------------------------------------------------------------
  /** Gravity. CS `sv_gravity` 800 u/s² → 20.32 m/s². */
  readonly gravity: number;
  /** Jump apex height (feet). CS: 57 units → 1.448 m (impulse 301.99 u/s = 7.67 m/s). */
  readonly jumpHeight: number;
  /**
   * A jump pressed up to this long before landing still fires on landing.
   * 0 like CS: the press must happen on the ground. Mobile builds may want a few ticks.
   */
  readonly jumpBufferSeconds: number;
  /** Highest ledge climbed by walking and dropped without leaving the ground. CS `sv_stepsize` 18 u → 0.457 m. */
  readonly stepHeight: number;
  /** Per-axis velocity safety bound. CS `sv_maxvelocity` 3500 u/s → 88.9 m/s. */
  readonly maxVelocity: number;

  // --- Stamina (our approximation of CS's jump/landing slowdown) -------------
  /**
   * CS slows players after jumps and landings so bunny-hopping and jump
   * spam are not free; the exact CS2 formula is not public. Model: jumping
   * and landing add fatigue (0..1) that recovers linearly; while fatigued,
   * ground speed is limited to maxSpeed × (1 − fatigue × staminaSpeedPenalty)
   * and each jump keeps only (1 − fatigue × staminaSpeedPenalty) of the
   * horizontal speed. One jump: ~8 % slower for ~0.3 s after landing.
   * Chained hops lose ~8 % per hop.
   */
  readonly jumpStaminaCost: number;
  readonly landStaminaCost: number;
  /** Fatigue recovered per second. */
  readonly staminaRecoveryRate: number;
  /** Speed lost at full fatigue. */
  readonly staminaSpeedPenalty: number;

  // --- View -----------------------------------------------------------------
  /** Pitch limit, up and down. CS: 89°. */
  readonly maxPitch: number;
}

export const DEFAULT_PLAYER_MOVEMENT: PlayerMovementConfig = Object.freeze({
  radius: 16 * SOURCE_UNIT,
  standingHeight: 72 * SOURCE_UNIT,
  crouchingHeight: 54 * SOURCE_UNIT,
  standingEyeHeight: 64 * SOURCE_UNIT,
  crouchingEyeHeight: 46 * SOURCE_UNIT,
  crouchTransitionSeconds: 0.2,

  maxSpeed: 250 * SOURCE_UNIT,
  walkSpeedScale: 0.52,
  crouchSpeedScale: 0.34,

  friction: 5.2,
  stopSpeed: 80 * SOURCE_UNIT,
  accelerate: 5.5,

  airAccelerate: 12,
  airMaxWishSpeed: 30 * SOURCE_UNIT,

  gravity: 800 * SOURCE_UNIT,
  jumpHeight: 57 * SOURCE_UNIT,
  jumpBufferSeconds: 0,
  stepHeight: 18 * SOURCE_UNIT,
  maxVelocity: 3500 * SOURCE_UNIT,

  jumpStaminaCost: 0.2,
  landStaminaCost: 0.2,
  staminaRecoveryRate: 0.6,
  staminaSpeedPenalty: 0.4,

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
