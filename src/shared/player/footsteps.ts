import { SOURCE_UNIT } from './PlayerMovementConfig';
import { horizontalSpeed, type PlayerState } from './PlayerState';

/** A sound a player's movement makes. */
export type MovementSound = 'step' | 'jump' | 'land';

/** Stride progress between two ticks. Plain data, like the other simulation state. */
export interface FootstepState {
  /** Ground distance covered since the last step, meters. */
  readonly distance: number;
  /** Foot of the next step: 0 left, 1 right. */
  readonly foot: 0 | 1;
}

export interface FootstepRules {
  /** Steps are audible above this fraction of the max speed. CS2 `footstep_audible_threshold` 0.55. */
  readonly audibleSpeedFraction: number;
  /** Ground distance per step, meters. */
  readonly strideLength: number;
  /** Landings are audible from this fall speed, m/s. CS2 `sv_min_jump_landing_sound` 260 u/s. */
  readonly landingSpeed: number;
}

export const DEFAULT_FOOTSTEP_RULES: FootstepRules = Object.freeze({
  audibleSpeedFraction: 0.55,
  // One step every 0.3 s at knife speed (Source's running step time): 75 units.
  strideLength: 75 * SOURCE_UNIT,
  landingSpeed: 260 * SOURCE_UNIT,
});

/** Share of a stride already covered when a player starts making noise, so the first step comes quickly. */
const FIRST_STEP_HEAD_START = 0.6;

export const FOOTSTEPS_AT_REST: FootstepState = Object.freeze({ distance: 0, foot: 0 });

export interface FootstepResult {
  readonly state: FootstepState;
  readonly sound: MovementSound | null;
  /** Foot of a step sound. */
  readonly foot: 0 | 1;
}

/**
 * The movement sound of one tick, if any, from the states before and after it.
 *
 * - Leaving the ground upwards is a jump; touching down faster than
 *   `landingSpeed` is a landing (stepping off a curb is silent).
 * - On the ground, steps come every `strideLength` of distance, but only
 *   above `audibleSpeedFraction` of the max speed: walking (52 %) and
 *   crouching (34 %) are silent, as in CS.
 *
 * Pure and deterministic: the authority decides who makes noise (CS2 plays
 * footsteps server-side), every client can compute its own.
 */
export function advanceFootsteps(
  state: FootstepState,
  previous: PlayerState,
  current: PlayerState,
  maxSpeed: number,
  tickSeconds: number,
  rules: FootstepRules = DEFAULT_FOOTSTEP_RULES,
): FootstepResult {
  if (previous.grounded && !current.grounded && current.velocity.y > 0) {
    return { state: { distance: 0, foot: state.foot }, sound: 'jump', foot: state.foot };
  }
  if (!previous.grounded && current.grounded) {
    const loud = -previous.velocity.y >= rules.landingSpeed;
    return { state: { distance: 0, foot: state.foot }, sound: loud ? 'land' : null, foot: state.foot };
  }

  const speed = horizontalSpeed(current);
  if (!current.grounded || speed <= maxSpeed * rules.audibleSpeedFraction) {
    const quiet = rules.strideLength * FIRST_STEP_HEAD_START;
    return { state: state.distance === quiet ? state : { distance: quiet, foot: state.foot }, sound: null, foot: state.foot };
  }

  const distance = state.distance + speed * tickSeconds;
  if (distance < rules.strideLength) return { state: { distance, foot: state.foot }, sound: null, foot: state.foot };
  const foot = state.foot;
  return { state: { distance: distance - rules.strideLength, foot: foot === 0 ? 1 : 0 }, sound: 'step', foot };
}
