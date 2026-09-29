import type { PerspectiveCamera } from 'three/webgpu';
import { clamp, lerp, moveTowards } from '@shared/math/scalar';
import type { ViewAngles } from '@shared/player/look';
import type { PlayerMovementConfig } from '@shared/player/PlayerMovementConfig';
import { eyePosition, type PlayerState } from '@shared/player/PlayerState';
import type { FrameContext, GameSystem } from '../core/GameSystem';
import type { LookDelta } from '../input/InputState';

/** The two latest simulated states of the viewed player. */
export interface PlayerViewSource {
  readonly previous: PlayerState;
  readonly current: PlayerState;
}

export interface FirstPersonCameraOptions {
  readonly camera: PerspectiveCamera;
  readonly player: PlayerViewSource;
  readonly config: PlayerMovementConfig;
  readonly tickSeconds: number;
  /** Look input not yet committed to a tick (see InputSystem.previewLook). */
  readonly previewLook: (elapsedSinceTickSeconds: number) => LookDelta;
  /** Extra rotation on top of the view, e.g. weapon recoil (see RecoilView). */
  readonly viewOffset?: (alpha: number) => ViewAngles;
}

const NO_OFFSET: ViewAngles = Object.freeze({ yaw: 0, pitch: 0 });

/**
 * Speed at which the view catches up after a step up or down, m/s. A 0.35 m
 * step settles in ~0.09 s instead of popping within one tick.
 */
const STEP_SMOOTHING_SPEED = 4;
/** The smoothed view never lags the real eye by more than this. */
const MAX_STEP_OFFSET = 0.5;

/**
 * First-person view of a simulated player. Presentation only: it reads
 * player states and never feeds anything back into the simulation.
 *
 * - Position: the eye, interpolated between the last two ticks with
 *   `frame.alpha`, so motion is smooth at any display rate.
 * - Orientation: the latest tick's yaw/pitch plus look input received since
 *   that tick, so aiming responds at display rate with no added latency. The
 *   next tick commits the same rotation, so there is no jump.
 * - Steps: grounded height changes (stairs, curbs) are eased over a few
 *   frames instead of popping.
 * - Recoil: an optional view offset is added on top of the view angles.
 */
export class FirstPersonCamera implements GameSystem {
  readonly name = 'first-person-camera';

  private readonly camera: PerspectiveCamera;
  private readonly player: PlayerViewSource;
  private readonly config: PlayerMovementConfig;
  private readonly tickSeconds: number;
  private readonly previewLook: (elapsedSinceTickSeconds: number) => LookDelta;
  private readonly viewOffset: (alpha: number) => ViewAngles;
  private currentView: ViewAngles = NO_OFFSET;

  private lastSeen: PlayerState | null = null;
  /** Grounded feet height change of the latest tick, excluded from interpolation. */
  private tickStep = 0;
  /** Vertical offset still to be eased out after steps. */
  private stepOffset = 0;

  constructor(options: FirstPersonCameraOptions) {
    this.camera = options.camera;
    this.player = options.player;
    this.config = options.config;
    this.tickSeconds = options.tickSeconds;
    this.previewLook = options.previewLook;
    this.viewOffset = options.viewOffset ?? (() => NO_OFFSET);
    this.camera.rotation.order = 'YXZ';
    this.place(1, 0);
  }

  /** The player's view (yaw, pitch) shown this frame, before the view offset. */
  get view(): ViewAngles {
    return this.currentView;
  }

  update(frame: FrameContext): void {
    this.place(frame.alpha, frame.deltaSeconds);
  }

  private place(alpha: number, deltaSeconds: number): void {
    const { previous, current } = this.player;

    if (current !== this.lastSeen) {
      this.lastSeen = current;
      this.tickStep = previous.grounded && current.grounded ? current.position.y - previous.position.y : 0;
      this.stepOffset = clamp(this.stepOffset - this.tickStep, -MAX_STEP_OFFSET, MAX_STEP_OFFSET);
    }
    this.stepOffset = moveTowards(this.stepOffset, 0, STEP_SMOOTHING_SPEED * deltaSeconds);

    const from = eyePosition(previous, this.config);
    const to = eyePosition(current, this.config);
    this.camera.position.set(
      lerp(from.x, to.x, alpha),
      lerp(from.y + this.tickStep, to.y, alpha) + this.stepOffset,
      lerp(from.z, to.z, alpha),
    );

    const look = this.previewLook(alpha * this.tickSeconds);
    const pitch = clamp(current.pitch + look.pitch, -this.config.maxPitch, this.config.maxPitch);
    const yaw = current.yaw + look.yaw;
    this.currentView = { yaw, pitch };
    const offset = this.viewOffset(alpha);
    this.camera.rotation.set(pitch + offset.pitch, -(yaw + offset.yaw), 0);
  }
}
