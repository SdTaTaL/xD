import { MathUtils, Vector3, type PerspectiveCamera } from 'three/webgpu';
import type { ViewAngles } from '@shared/player/look';
import type { PlayerState } from '@shared/player/PlayerState';
import { situationalInaccuracy } from '@shared/weapons/inaccuracy';
import { viewBasis } from '@shared/weapons/spread';
import type { WeaponDefinition } from '@shared/weapons/WeaponDefinition';
import type { WeaponRules } from '@shared/weapons/WeaponRules';
import type { WeaponState } from '@shared/weapons/WeaponState';
import type { FrameContext, GameSystem } from '../core/GameSystem';
import type { ViewportSize } from '../rendering/Viewport';

export interface CrosshairOptions {
  readonly parent: HTMLElement;
  /** The world camera, already placed for this frame. */
  readonly camera: PerspectiveCamera;
  /** The player's view shown this frame, before recoil (see FirstPersonCamera.view). */
  readonly view: { readonly view: ViewAngles };
  /** Where bullets go relative to the view (see RecoilView.aimOffset). */
  readonly aimOffset: (alpha: number) => ViewAngles;
  readonly source: { readonly current: PlayerState; readonly weapon: WeaponState };
  readonly weapon: WeaponDefinition;
  readonly rules: WeaponRules;
  /** Centre the crosshair on the real aim point, recoil included (CS2 `cl_crosshair_recoil`). */
  readonly followRecoil: boolean;
  readonly viewport: { subscribe(listener: (size: ViewportSize) => void): () => void };
}

/** Smallest gap between the bars, CSS pixels, so the centre stays readable when perfectly accurate. */
const MIN_GAP_PX = 3;

/**
 * Dynamic crosshair (like CS2's style 7): four bars whose gap is the real
 * inaccuracy cone projected on screen, so it opens while running, jumping
 * and spraying and closes as accuracy recovers. With `followRecoil` it sits
 * where bullets go instead of at the screen centre.
 *
 * Runs after the camera: it projects through the camera's final pose.
 */
export class Crosshair implements GameSystem {
  readonly name = 'crosshair';

  private readonly element: HTMLDivElement;
  private readonly options: CrosshairOptions;
  private readonly unsubscribe: () => void;
  private readonly point = new Vector3();
  private height = 1;
  private width = 1;
  private shown = { x: NaN, y: NaN, gap: NaN };

  constructor(options: CrosshairOptions) {
    this.options = options;
    this.element = document.createElement('div');
    this.element.className = 'crosshair';
    this.element.setAttribute('aria-hidden', 'true');
    for (const side of ['top', 'bottom', 'left', 'right']) {
      const bar = document.createElement('span');
      bar.className = `crosshair__bar crosshair__bar--${side}`;
      this.element.append(bar);
    }
    options.parent.append(this.element);
    this.unsubscribe = options.viewport.subscribe((size) => {
      this.width = size.width;
      this.height = size.height;
    });
  }

  /** Current gap between the centre and each bar, CSS pixels (for tests and tuning). */
  get gap(): number {
    return this.shown.gap;
  }

  update(frame: FrameContext): void {
    const { camera, source, weapon, rules } = this.options;

    // Inaccuracy cone → pixels: a tangent of t spans t / tan(vfov/2) half-heights.
    const cone = situationalInaccuracy(weapon, rules, source.current) + source.weapon.accuracyPenalty + weapon.spread;
    const halfHeight = this.height / 2;
    const gap = Math.max(MIN_GAP_PX, (cone / Math.tan(MathUtils.degToRad(camera.fov) / 2)) * halfHeight);

    let x = 0;
    let y = 0;
    if (this.options.followRecoil) {
      const view = this.options.view.view;
      const offset = this.options.aimOffset(frame.alpha);
      const { forward } = viewBasis({ yaw: view.yaw + offset.yaw, pitch: view.pitch + offset.pitch });
      camera.updateMatrixWorld();
      this.point.set(camera.position.x + forward.x, camera.position.y + forward.y, camera.position.z + forward.z).project(camera);
      x = (this.point.x * this.width) / 2;
      y = (-this.point.y * this.height) / 2;
    }

    // Touch the DOM only when something visibly changed.
    if (Math.abs(x - this.shown.x) < 0.05 && Math.abs(y - this.shown.y) < 0.05 && Math.abs(gap - this.shown.gap) < 0.05) return;
    this.shown = { x, y, gap };
    this.element.style.transform = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px)`;
    this.element.style.setProperty('--gap', `${gap.toFixed(2)}px`);
  }

  dispose(): void {
    this.unsubscribe();
    this.element.remove();
  }
}
