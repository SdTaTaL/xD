import { neutralCommand, type InputCommand } from '@shared/input/InputCommand';
import type { InputCommandSource } from '@shared/input/InputCommandBuffer';
import { simulatePlayerTick, type PlayerSimulationContext } from '@shared/player/PlayerController';
import { createPlayerState, type PlayerState, type SpawnPose } from '@shared/player/PlayerState';
import type { GameSystem, TickContext } from '../core/GameSystem';

export interface LocalPlayerSystemOptions {
  readonly commands: InputCommandSource;
  readonly context: PlayerSimulationContext;
  readonly spawn: SpawnPose;
}

/**
 * Runs the local player's simulation: one `simulatePlayerTick` per tick,
 * driven only by that tick's input command. Register it after the input
 * system so the command exists.
 *
 * It keeps the last two states for presentation. Client-side prediction will
 * extend this with a per-tick history of commands and states to re-simulate
 * from server corrections; the pure step function already makes that a replay.
 */
export class LocalPlayerSystem implements GameSystem {
  readonly name = 'local-player';

  private readonly commands: InputCommandSource;
  private readonly context: PlayerSimulationContext;
  private previousState: PlayerState;
  private currentState: PlayerState;
  private lastCommand: InputCommand | undefined;

  constructor(options: LocalPlayerSystemOptions) {
    this.commands = options.commands;
    this.context = options.context;
    this.currentState = createPlayerState(options.spawn);
    this.previousState = this.currentState;
  }

  /** State at the end of the tick before the latest one. */
  get previous(): PlayerState {
    return this.previousState;
  }

  /** State at the end of the latest tick. */
  get current(): PlayerState {
    return this.currentState;
  }

  /** Command consumed by the latest tick. */
  get command(): InputCommand | undefined {
    return this.lastCommand;
  }

  fixedUpdate(tick: TickContext): void {
    const command = this.commands.get(tick.tick) ?? neutralCommand(tick.tick);
    this.previousState = this.currentState;
    this.currentState = simulatePlayerTick(this.currentState, command, this.context);
    this.lastCommand = command;
  }
}
