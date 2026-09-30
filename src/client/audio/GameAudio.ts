import { Vector3, type Camera } from 'three/webgpu';
import type { ShotOutcome } from '@shared/combat/targets';
import { wasActionPressed, type InputCommand } from '@shared/input/InputCommand';
import { advanceFootsteps, FOOTSTEPS_AT_REST, type FootstepState, type MovementSound } from '@shared/player/footsteps';
import type { PlayerState } from '@shared/player/PlayerState';
import type { Shot } from '@shared/weapons/WeaponController';
import type { WeaponDefinition } from '@shared/weapons/WeaponDefinition';
import type { WeaponState } from '@shared/weapons/WeaponState';
import type { GameSystem } from '../core/GameSystem';
import type { AudioOutput } from './AudioOutput';
import type { SoundId } from './sounds';

/** The local player, as the simulation leaves it after each tick. */
export interface AudioPlayerSource {
  readonly previous: PlayerState;
  readonly current: PlayerState;
  readonly previousWeapon: WeaponState;
  readonly weapon: WeaponState;
  readonly command: InputCommand | undefined;
  onShot(listener: (shot: Shot) => void): () => void;
}

export interface GameAudioOptions {
  readonly output: AudioOutput;
  readonly player: AudioPlayerSource;
  readonly range: { onShotResolved(listener: (outcome: ShotOutcome) => void): () => void };
  readonly weapon: WeaponDefinition;
  /** The view camera: the listener's ears. */
  readonly camera: Camera;
  readonly tickSeconds: number;
}

/**
 * Reload sounds, at fractions of the reload: magazine out, magazine in, bolt.
 * They match the view model, which drops the magazine at 20–35 % and seats
 * the new one at 50–70 %.
 */
const RELOAD_CUES: readonly (readonly [number, SoundId])[] = [
  [0.2, 'magout'],
  [0.55, 'magin'],
  [0.8, 'bolt'],
];

/** Shots vary in pitch by up to ± this, so a spray does not sound like one sample repeated. */
const SHOT_PITCH_VARIATION = 0.03;

/**
 * Turns game events into sounds. Presentation only.
 *
 * - Own shot: at the ears, pitch varied per shot.
 * - Where it went: a concrete impact, a hit on a body, or the helmet "tink"
 *   of a headshot absorbed by a helmet, positioned where it happened.
 * - Own movement: footsteps, jump and landing (shared `advanceFootsteps`:
 *   silent walking and crouching, loud landings only from a real fall).
 * - Reload steps, and the dry click of an empty magazine.
 *
 * Register it after the local player and the range (it reads each tick's
 * results) and after the camera (it places the ears).
 */
export class GameAudio implements GameSystem {
  readonly name = 'game-audio';

  private readonly options: GameAudioOptions;
  private readonly unsubscribers: readonly (() => void)[];
  private readonly position = new Vector3();
  private readonly forward = new Vector3();
  private readonly up = new Vector3();
  private footsteps: FootstepState = FOOTSTEPS_AT_REST;
  private lastMovement: { sound: MovementSound; foot: 0 | 1 } | null = null;

  constructor(options: GameAudioOptions) {
    this.options = options;
    const { output } = options;
    this.unsubscribers = [
      options.player.onShot((shot) => {
        const variation = (((shot.tick * 7919) % 7) - 3) / 3;
        output.play('shot', { rate: 1 + variation * SHOT_PITCH_VARIATION });
      }),
      options.range.onShotResolved(({ shot, target }) => {
        if (target) {
          const helmet = target.group === 'head' && target.damage.kevlar > 0;
          output.play(helmet ? 'helmet' : 'flesh', { position: target.point });
        } else if (shot.hit) {
          output.play('impact', { position: shot.hit.point });
        }
      }),
    ];
  }

  /** The last movement sound (for the debug panel). */
  get movement(): { readonly sound: MovementSound; readonly foot: 0 | 1 } | null {
    return this.lastMovement;
  }

  fixedUpdate(): void {
    const { player, output, weapon, tickSeconds } = this.options;

    const step = advanceFootsteps(this.footsteps, player.previous, player.current, weapon.maxSpeed, tickSeconds);
    this.footsteps = step.state;
    if (step.sound) {
      this.lastMovement = { sound: step.sound, foot: step.foot };
      output.play(step.sound);
    }

    const before = this.reloadProgress(player.previousWeapon, false);
    const after = this.reloadProgress(player.weapon, player.previousWeapon.reloadRemaining > 0);
    for (const [at, sound] of RELOAD_CUES) {
      if (before < at && after >= at) output.play(sound);
    }

    // The empty click: a trigger press on an empty magazine (which also starts a
    // reload when there are spare rounds), not presses during a reload.
    const { command, previousWeapon } = player;
    if (command && wasActionPressed(command, 'fire') && previousWeapon.ammo === 0 && previousWeapon.reloadRemaining === 0) {
      output.play('dryfire');
    }
  }

  update(): void {
    const { camera, output } = this.options;
    camera.getWorldPosition(this.position);
    camera.getWorldDirection(this.forward);
    this.up.set(0, 1, 0).applyQuaternion(camera.quaternion);
    output.setListener(this.position, this.forward, this.up);
  }

  dispose(): void {
    for (const unsubscribe of this.unsubscribers) unsubscribe();
  }

  /** How far the reload is, 0–1; a reload that ended this tick counts as 1. */
  private reloadProgress(state: WeaponState, wasReloading: boolean): number {
    if (state.reloadRemaining > 0) return 1 - state.reloadRemaining / this.options.weapon.reloadSeconds;
    return wasReloading ? 1 : 0;
  }
}
