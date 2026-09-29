import type { WeaponDefinition } from '@shared/weapons/WeaponDefinition';
import { isReloading, type WeaponState } from '@shared/weapons/WeaponState';
import type { GameSystem } from '../core/GameSystem';

export interface AmmoCounterOptions {
  readonly parent: HTMLElement;
  readonly source: { readonly weapon: WeaponState };
  readonly weapon: WeaponDefinition;
}

/** Magazine and reserve ammunition, bottom right, with a reload progress bar. */
export class AmmoCounter implements GameSystem {
  readonly name = 'ammo-counter';

  private readonly element: HTMLDivElement;
  private readonly magazine: HTMLSpanElement;
  private readonly reserve: HTMLSpanElement;
  private readonly progress: HTMLDivElement;
  private readonly source: { readonly weapon: WeaponState };
  private readonly weapon: WeaponDefinition;
  private shown = '';

  constructor(options: AmmoCounterOptions) {
    this.source = options.source;
    this.weapon = options.weapon;

    this.element = document.createElement('div');
    this.element.className = 'ammo';
    this.element.setAttribute('aria-live', 'off');
    const name = document.createElement('span');
    name.className = 'ammo__weapon';
    name.textContent = options.weapon.name;
    this.magazine = document.createElement('span');
    this.magazine.className = 'ammo__magazine';
    this.reserve = document.createElement('span');
    this.reserve.className = 'ammo__reserve';
    this.progress = document.createElement('div');
    this.progress.className = 'ammo__reload';
    this.element.append(name, this.magazine, this.reserve, this.progress);
    options.parent.append(this.element);
  }

  update(): void {
    const state = this.source.weapon;
    const reloading = isReloading(state);
    const fraction = reloading ? 1 - state.reloadRemaining / this.weapon.reloadSeconds : 0;
    const key = `${state.ammo}/${state.reserve}/${reloading ? fraction.toFixed(2) : '-'}`;
    if (key === this.shown) return;
    this.shown = key;

    this.magazine.textContent = String(state.ammo);
    this.reserve.textContent = `/ ${state.reserve}`;
    this.element.classList.toggle('ammo--empty', state.ammo === 0);
    this.element.classList.toggle('ammo--reloading', reloading);
    this.progress.style.transform = `scaleX(${fraction.toFixed(3)})`;
  }

  dispose(): void {
    this.element.remove();
  }
}
