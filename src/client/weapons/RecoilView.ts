import { lerp } from '@shared/math/scalar';
import type { ViewAngles } from '@shared/player/look';
import { recoilKick } from '@shared/weapons/recoil';
import type { Shot } from '@shared/weapons/WeaponController';
import type { WeaponDefinition } from '@shared/weapons/WeaponDefinition';
import type { WeaponRules } from '@shared/weapons/WeaponRules';
import type { WeaponState } from '@shared/weapons/WeaponState';
import type { WeaponViewSettings } from '../app/ClientConfig';
import type { FrameContext, GameSystem } from '../core/GameSystem';

/** The two latest simulated weapon states, and the shots as they happen. */
export interface RecoilSource {
  readonly previousWeapon: WeaponState;
  readonly weapon: WeaponState;
  onShot(listener: (shot: Shot) => void): () => void;
}

export interface RecoilViewOptions {
  readonly source: RecoilSource;
  readonly weapon: WeaponDefinition;
  readonly rules: WeaponRules;
  readonly settings: WeaponViewSettings;
}

/**
 * Turns the simulated recoil into view offsets, relative to the player's
 * view angles. Presentation only.
 *
 * - `aimOffset`: where bullets go, the aim punch × recoil scale, interpolated
 *   between ticks like the camera position.
 * - `cameraOffset`: how far the camera follows it (CS's view recoil
 *   tracking), plus a short screen kick per shot (view punch). Following only
 *   part of the recoil is what makes sprays climb above the screen centre in
 *   CS; the crosshair can show the real aim point (see Crosshair).
 *
 * Register it before the camera: its update decays the screen kick.
 */
export class RecoilView implements GameSystem {
  readonly name = 'recoil-view';

  private readonly source: RecoilSource;
  private readonly recoilScale: number;
  private readonly settings: WeaponViewSettings;
  private readonly unsubscribe: () => void;
  private punchPitch = 0;
  private punchYaw = 0;

  constructor(options: RecoilViewOptions) {
    this.source = options.source;
    this.recoilScale = options.rules.recoilScale;
    this.settings = options.settings;
    this.unsubscribe = options.source.onShot((shot) => {
      const kick = recoilKick(options.weapon, options.rules, shot.sprayIndex);
      this.punchPitch += kick.pitch * this.settings.viewPunchExtra;
      this.punchYaw += kick.yaw * this.settings.viewPunchExtra;
    });
  }

  update(frame: FrameContext): void {
    const decay = Math.exp(-this.settings.viewPunchDecay * frame.deltaSeconds);
    this.punchPitch *= decay;
    this.punchYaw *= decay;
  }

  /** Where bullets go relative to the view, radians. */
  aimOffset(alpha: number): ViewAngles {
    const from = this.source.previousWeapon.aimPunch;
    const to = this.source.weapon.aimPunch;
    return {
      yaw: lerp(from.yaw, to.yaw, alpha) * this.recoilScale,
      pitch: lerp(from.pitch, to.pitch, alpha) * this.recoilScale,
    };
  }

  /** Rotation added to the camera, radians. */
  cameraOffset(alpha: number): ViewAngles {
    const aim = this.aimOffset(alpha);
    const tracking = this.settings.viewRecoilTracking;
    return { yaw: aim.yaw * tracking + this.punchYaw, pitch: aim.pitch * tracking + this.punchPitch };
  }

  dispose(): void {
    this.unsubscribe();
  }
}
