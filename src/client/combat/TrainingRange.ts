import { createTarget, resolveShot, tickTargets, type ShotOutcome, type TargetState } from '@shared/combat/targets';
import type { TargetSpawn } from '@shared/maps/MapDefinition';
import type { Shot } from '@shared/weapons/WeaponController';
import type { WeaponDefinition } from '@shared/weapons/WeaponDefinition';
import type { GameSystem, TickContext } from '../core/GameSystem';

export type ShotOutcomeListener = (outcome: ShotOutcome) => void;

export interface TrainingRangeOptions {
  /** Shots as they are fired (see LocalPlayerSystem.onShot). */
  readonly source: { onShot(listener: (shot: Shot) => void): () => void };
  readonly weapon: WeaponDefinition;
  readonly spawns: readonly TargetSpawn[];
}

/**
 * The map's training targets, and the local stand-in for the authority that
 * decides hits: every shot is resolved against the targets as it is fired
 * (`resolveShot`), damage is applied, and knocked-down targets stand up again
 * (`tickTargets`, once per tick). With a server, this moves there unchanged
 * and the client only shows the results.
 *
 * Register it after the local player.
 */
export class TrainingRange implements GameSystem {
  readonly name = 'training-range';

  private readonly listeners = new Set<ShotOutcomeListener>();
  private readonly unsubscribe: () => void;
  private targets: readonly TargetState[];

  constructor(options: TrainingRangeOptions) {
    this.targets = options.spawns.map(createTarget);
    this.unsubscribe = options.source.onShot((shot) => {
      const { targets, outcome } = resolveShot(this.targets, shot, options.weapon);
      this.targets = targets;
      for (const listener of this.listeners) listener(outcome);
    });
  }

  /** Current state of every target, in map order. */
  get states(): readonly TargetState[] {
    return this.targets;
  }

  /**
   * Calls `listener` with the outcome of every shot: the target it hit, or
   * none (the bullet went on to the map).
   * @returns Function that removes the listener.
   */
  onShotResolved(listener: ShotOutcomeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  fixedUpdate(tick: TickContext): void {
    this.targets = tickTargets(this.targets, tick.deltaSeconds);
  }

  dispose(): void {
    this.unsubscribe();
    this.listeners.clear();
  }
}
