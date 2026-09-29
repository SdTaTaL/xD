import { SOURCE_UNIT } from '../player/PlayerMovementConfig';
import type { WeaponDefinition } from './WeaponDefinition';

/** Distance over which one `rangeModifier` step applies: 500 units. */
const RANGE_MODIFIER_DISTANCE = 500 * SOURCE_UNIT;

/**
 * Damage of one bullet after travelling `distance` meters, before hit group
 * and armor: damage × rangeModifier^(distance / 500 units), as in CS.
 *
 * Damage is decided by the authority (the server), never predicted, so it
 * may use Math.pow: it does not need to be bit-identical between machines.
 */
export function damageAtDistance(weapon: WeaponDefinition, distance: number): number {
  return weapon.damage * Math.pow(weapon.rangeModifier, distance / RANGE_MODIFIER_DISTANCE);
}
