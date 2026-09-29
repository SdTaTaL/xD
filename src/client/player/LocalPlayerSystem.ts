import {
  createCharacterState,
  simulateCharacterTick,
  type CharacterSimulationContext,
  type CharacterState,
} from '@shared/character/CharacterSimulation';
import { neutralCommand, type InputCommand } from '@shared/input/InputCommand';
import type { InputCommandSource } from '@shared/input/InputCommandBuffer';
import type { PlayerState, SpawnPose } from '@shared/player/PlayerState';
import type { Shot } from '@shared/weapons/WeaponController';
import type { WeaponState } from '@shared/weapons/WeaponState';
import type { GameSystem, TickContext } from '../core/GameSystem';

export interface LocalPlayerSystemOptions {
  readonly commands: InputCommandSource;
  readonly context: CharacterSimulationContext;
  readonly spawn: SpawnPose;
}

export type ShotListener = (shot: Shot) => void;

/**
 * Runs the local player's simulation: one `simulateCharacterTick` (movement,
 * then the held weapon) per tick, driven only by that tick's input command.
 * Register it after the input system so the command exists.
 *
 * It keeps the last two states for presentation and reports every shot to
 * its listeners as it happens. Client-side prediction will extend this with
 * a per-tick history of commands and states to re-simulate from server
 * corrections; the pure step function already makes that a replay.
 */
export class LocalPlayerSystem implements GameSystem {
  readonly name = 'local-player';

  private readonly commands: InputCommandSource;
  private readonly context: CharacterSimulationContext;
  private readonly shotListeners = new Set<ShotListener>();
  private previousState: CharacterState;
  private currentState: CharacterState;
  private lastCommand: InputCommand | undefined;

  constructor(options: LocalPlayerSystemOptions) {
    this.commands = options.commands;
    this.context = options.context;
    this.currentState = createCharacterState(options.spawn, options.context.weapon);
    this.previousState = this.currentState;
  }

  /** Movement state at the end of the tick before the latest one. */
  get previous(): PlayerState {
    return this.previousState.player;
  }

  /** Movement state at the end of the latest tick. */
  get current(): PlayerState {
    return this.currentState.player;
  }

  /** Weapon state at the end of the tick before the latest one. */
  get previousWeapon(): WeaponState {
    return this.previousState.weapon;
  }

  /** Weapon state at the end of the latest tick. */
  get weapon(): WeaponState {
    return this.currentState.weapon;
  }

  /** Command consumed by the latest tick. */
  get command(): InputCommand | undefined {
    return this.lastCommand;
  }

  /**
   * Calls `listener` for every shot, during the tick that fires it.
   * @returns Function that removes the listener.
   */
  onShot(listener: ShotListener): () => void {
    this.shotListeners.add(listener);
    return () => this.shotListeners.delete(listener);
  }

  fixedUpdate(tick: TickContext): void {
    const command = this.commands.get(tick.tick) ?? neutralCommand(tick.tick);
    const result = simulateCharacterTick(this.currentState, command, this.context);
    this.previousState = this.currentState;
    this.currentState = result.state;
    this.lastCommand = command;
    if (result.shot) {
      for (const listener of this.shotListeners) listener(result.shot);
    }
  }

  dispose(): void {
    this.shotListeners.clear();
  }
}
