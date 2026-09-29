import type { InputCommand } from '../input/InputCommand';
import { simulatePlayerTick } from '../player/PlayerController';
import { createPlayerState, type PlayerState, type SpawnPose } from '../player/PlayerState';
import type { WeaponDefinition } from '../weapons/WeaponDefinition';
import { simulateWeaponTick, type Shot, type WeaponSimulationContext } from '../weapons/WeaponController';
import { createWeaponState, type WeaponState } from '../weapons/WeaponState';

/** Everything that is simulated for one player: movement and the weapon in hand. */
export interface CharacterState {
  readonly player: PlayerState;
  readonly weapon: WeaponState;
}

/** World, rules and tuning for a character tick (the same inputs a weapon tick needs). */
export type CharacterSimulationContext = WeaponSimulationContext;

export interface CharacterTickResult {
  readonly state: CharacterState;
  readonly shot: Shot | null;
}

export function createCharacterState(spawn: SpawnPose, weapon: WeaponDefinition): CharacterState {
  return Object.freeze({ player: createPlayerState(spawn), weapon: createWeaponState(weapon) });
}

/**
 * Advances one player by one tick: movement first, at the speed the held
 * weapon allows, then the weapon, which fires from the resulting position
 * and view. This is the whole per-tick step that client prediction replays
 * and that an authoritative server will run for every player.
 *
 * Pure and deterministic.
 */
export function simulateCharacterTick(previous: CharacterState, command: InputCommand, context: CharacterSimulationContext): CharacterTickResult {
  const movement = { world: context.world, config: context.movement, tickSeconds: context.tickSeconds };
  const player = simulatePlayerTick(previous.player, command, movement, context.weapon.maxSpeed);
  const { state: weapon, shot } = simulateWeaponTick(previous.weapon, previous.player, player, command, context);
  return { state: Object.freeze({ player, weapon }), shot };
}
