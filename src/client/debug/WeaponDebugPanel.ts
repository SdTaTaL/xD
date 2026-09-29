import type { PlayerState } from '@shared/player/PlayerState';
import { damageAtDistance } from '@shared/weapons/damage';
import { situationalInaccuracy } from '@shared/weapons/inaccuracy';
import type { Shot } from '@shared/weapons/WeaponController';
import type { WeaponDefinition } from '@shared/weapons/WeaponDefinition';
import type { WeaponRules } from '@shared/weapons/WeaponRules';
import type { WeaponState } from '@shared/weapons/WeaponState';
import type { GameSystem } from '../core/GameSystem';

export interface WeaponDebugSource {
  readonly current: PlayerState;
  readonly weapon: WeaponState;
  onShot(listener: (shot: Shot) => void): () => void;
}

export interface WeaponDebugPanelOptions {
  readonly parent: HTMLElement;
  readonly source: WeaponDebugSource;
  readonly weapon: WeaponDefinition;
  readonly rules: WeaponRules;
  readonly tickSeconds: number;
  /** Bullet holes currently shown. */
  readonly marks: () => number;
}

const REFRESH_MS = 100;
const DEGREES_PER_RADIAN = 180 / Math.PI;
/** Latest shots of the current spray used for the fire-rate readout. */
const RATE_WINDOW = 10;

function signed(value: number, digits: number): string {
  const text = value.toFixed(digits);
  return text.startsWith('-') ? text : `+${text}`;
}

/**
 * TEMPORARY weapon debug panel, enabled with `?debug=weapon`: ammunition,
 * fire rate, spray position, recoil, inaccuracy and the last shot's hit.
 * Delete it once weapon tuning is done.
 */
export class WeaponDebugPanel implements GameSystem {
  readonly name = 'weapon-debug';

  private readonly element: HTMLPreElement;
  private readonly options: WeaponDebugPanelOptions;
  private readonly unsubscribe: () => void;
  private readonly shotTicks: number[] = [];
  private shots = 0;
  private lastShot: Shot | null = null;
  private lastDraw = -Infinity;

  constructor(options: WeaponDebugPanelOptions) {
    this.options = options;
    this.element = document.createElement('pre');
    this.element.className = 'debug-overlay';
    this.element.dataset['panel'] = 'weapon';
    this.element.setAttribute('aria-hidden', 'true');
    this.element.style.left = 'auto';
    this.element.style.right = '8px';
    options.parent.append(this.element);

    this.unsubscribe = options.source.onShot((shot) => {
      this.shots++;
      this.lastShot = shot;
      // The rate is measured within one spray: a new spray starts a new window.
      if (shot.sprayIndex === 0) this.shotTicks.length = 0;
      this.shotTicks.push(shot.tick);
      if (this.shotTicks.length > RATE_WINDOW) this.shotTicks.shift();
    });
  }

  endFrame(): void {
    const now = performance.now();
    if (now - this.lastDraw < REFRESH_MS) return;
    this.lastDraw = now;
    this.draw();
  }

  dispose(): void {
    this.unsubscribe();
    this.element.remove();
  }

  private draw(): void {
    const { weapon, rules, source, tickSeconds } = this.options;
    const state = source.weapon;
    const inaccuracy = situationalInaccuracy(weapon, rules, source.current) + state.accuracyPenalty;
    const first = this.shotTicks[0];
    const last = this.shotTicks[this.shotTicks.length - 1];
    const rate =
      first !== undefined && last !== undefined && last > first ? (60 * (this.shotTicks.length - 1)) / ((last - first) * tickSeconds) : 0;
    const shot = this.lastShot;
    const hit = shot?.hit;

    this.element.textContent = [
      'WEAPON (temporary debug)',
      `Weapon    ${weapon.name}  ammo ${state.ammo} / ${state.reserve}  reload ${state.reloadRemaining.toFixed(2)} s`,
      `Fire      shots ${this.shots}  rate ${rate.toFixed(0)} rpm  cooldown ${state.cooldown.toFixed(3)}`,
      `Spray     index ${state.recoilIndex}  punch pitch ${signed(state.aimPunch.pitch * DEGREES_PER_RADIAN, 2)}°  yaw ${signed(state.aimPunch.yaw * DEGREES_PER_RADIAN, 2)}°`,
      `Accuracy  inaccuracy ${inaccuracy.toFixed(5)}  penalty ${state.accuracyPenalty.toFixed(5)}`,
      shot
        ? `Last shot spray ${shot.sprayIndex}  inaccuracy ${shot.inaccuracy.toFixed(5)}  aim pitch ${signed(shot.aim.pitch * DEGREES_PER_RADIAN, 2)}°`
        : 'Last shot —',
      hit
        ? `Hit       ${hit.distance.toFixed(3)} m  at ${hit.point.x.toFixed(3)} ${hit.point.y.toFixed(3)} ${hit.point.z.toFixed(3)}  damage ${damageAtDistance(weapon, hit.distance).toFixed(1)}`
        : 'Hit       —',
      `Marks     ${this.options.marks()}`,
    ].join('\n');
  }
}
