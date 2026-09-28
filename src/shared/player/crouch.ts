import { moveTowards } from '../math/scalar';
import type { CollisionWorld } from '../physics/CollisionWorld';
import type { Body } from './kinematics';
import type { PlayerMovementConfig } from './PlayerMovementConfig';

export interface Stance {
  readonly crouched: boolean;
  readonly crouchAmount: number;
}

/**
 * Updates the stance, resizing `body` in place when the hull changes.
 *
 * - Crouching always succeeds: the hull shrinks inside the space it already
 *   occupies. On the ground the feet stay put; in the air the legs tuck up
 *   and the head stays put (crouch-jumping reaches higher ledges).
 * - Standing up needs the full standing hull to be free. In the air the legs
 *   extend downwards first, else the head rises; on the ground the head
 *   rises. Without room the player simply stays crouched, so standing up can
 *   never push anyone into a ceiling.
 * - When the head stays fixed the eye height snaps with the hull (the view
 *   does not move); when the feet stay fixed it blends over
 *   `crouchTransitionSeconds`.
 */
export function updateStance(
  world: CollisionWorld,
  body: Body,
  current: Stance,
  wantsCrouch: boolean,
  grounded: boolean,
  config: PlayerMovementConfig,
  dt: number,
): Stance {
  const heightDelta = config.standingHeight - config.crouchingHeight;
  let { crouched, crouchAmount } = current;

  if (wantsCrouch && !crouched) {
    crouched = true;
    body.height = config.crouchingHeight;
    if (!grounded) {
      body.y += heightDelta;
      crouchAmount = 1;
    }
  } else if (!wantsCrouch && crouched) {
    const standing = body.clone();
    standing.height = config.standingHeight;

    if (!grounded) {
      standing.y -= heightDelta;
      if (standing.fits(world)) {
        body.y = standing.y;
        body.height = config.standingHeight;
        crouched = false;
        crouchAmount = 0;
      }
      standing.y = body.y;
    }

    if (crouched && standing.fits(world)) {
      body.height = config.standingHeight;
      crouched = false;
    }
  }

  const blendRate = config.crouchTransitionSeconds > 0 ? dt / config.crouchTransitionSeconds : 1;
  return { crouched, crouchAmount: moveTowards(crouchAmount, crouched ? 1 : 0, blendRate) };
}
