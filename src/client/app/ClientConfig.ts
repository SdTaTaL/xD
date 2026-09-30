import type { SpawnPose } from '@shared/player/PlayerState';
import type { RendererBackendPreference, RendererSettings } from '../rendering/GameRenderer';
import type { ViewCameraSettings } from '../rendering/ViewCamera';

export interface LoopSettings {
  /** Longest frame delta accepted; longer stalls (tab switch, breakpoint) are clamped. */
  readonly maxFrameDeltaSeconds: number;
  /** Most simulation ticks run in one frame before the backlog is dropped. */
  readonly maxTicksPerFrame: number;
}

export interface InputSettings {
  /** Mouse sensitivity: multiplier of 0.022° of rotation per mouse count (Source/CS scale). */
  readonly mouseSensitivity: number;
  readonly invertMouseY: boolean;
  /** Request raw (unaccelerated) mouse movement when capturing, where supported. */
  readonly rawMouseInput: boolean;
}

/**
 * How recoil and the weapon look on screen. Presentation only: none of this
 * changes where bullets go. Defaults are CS2's.
 */
export interface WeaponViewSettings {
  /** Share of the recoil (aim punch × recoil scale) the camera follows. CS `view_recoil_tracking` 0.45. */
  readonly viewRecoilTracking: number;
  /** Screen kick per shot, as a fraction of the recoil kick. CS `weapon_recoil_view_punch_extra` 0.055. */
  readonly viewPunchExtra: number;
  /** Exponential decay rate of the screen kick, 1/s. CS2 `view_punch_decay` 18. */
  readonly viewPunchDecay: number;
  /** The crosshair shows where bullets go, recoil included. CS2 `cl_crosshair_recoil` (default on). */
  readonly crosshairFollowsRecoil: boolean;
  /** Horizontal field of view of the weapon model at 4:3, degrees. CS2 `viewmodel_fov` 60. */
  readonly viewmodelFovDegrees: number;
  /** Show the first-person weapon model. CS `r_drawviewmodel` 1. */
  readonly drawViewModel: boolean;
}

export interface AudioSettings {
  /** Master volume, 0–1. */
  readonly volume: number;
}

export interface DebugSettings {
  readonly overlay: boolean;
  /** Temporary input debug panel. */
  readonly input: boolean;
  /** Temporary player movement debug panel. */
  readonly player: boolean;
  /** Temporary weapon debug panel. */
  readonly weapon: boolean;
  /** Temporary audio debug panel. */
  readonly audio: boolean;
  /** Development override of the spawn pose, for reproducible tests. */
  readonly spawn: SpawnPose | null;
}

export interface ClientConfig {
  readonly renderer: RendererSettings;
  readonly camera: ViewCameraSettings;
  readonly loop: LoopSettings;
  readonly input: InputSettings;
  readonly weaponView: WeaponViewSettings;
  readonly audio: AudioSettings;
  readonly debug: DebugSettings;
}

const DEFAULT_CONFIG: ClientConfig = {
  renderer: {
    backend: 'auto',
    antialias: true,
    maxPixelRatio: 2,
    shadows: true,
  },
  camera: {
    // CS2's default: 90° horizontal at 4:3, i.e. 106.26° at 16:9 with Hor+ scaling.
    horizontalFovDegrees: 106.26,
    near: 0.05,
    far: 500,
  },
  loop: {
    maxFrameDeltaSeconds: 0.25,
    maxTicksPerFrame: 8,
  },
  input: {
    mouseSensitivity: 2,
    invertMouseY: false,
    rawMouseInput: true,
  },
  weaponView: {
    viewRecoilTracking: 0.45,
    viewPunchExtra: 0.055,
    viewPunchDecay: 18,
    crosshairFollowsRecoil: true,
    viewmodelFovDegrees: 60,
    drawViewModel: true,
  },
  audio: {
    volume: 0.8,
  },
  debug: {
    overlay: true,
    input: false,
    player: false,
    weapon: false,
    audio: false,
    spawn: null,
  },
};

/** Parses a volume in 0–1; anything else keeps the default. */
function parseVolume(value: string | null): number | null {
  if (value === null || value.trim() === '') return null;
  const volume = Number(value);
  return Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : null;
}

/** Parses `x,y,z,yawDegrees`. */
function parseSpawn(value: string | null): SpawnPose | null {
  if (value === null) return null;
  const parts = value.split(',').map(Number);
  if (parts.length !== 4 || !parts.every(Number.isFinite)) return null;
  const [x, y, z, yawDegrees] = parts as [number, number, number, number];
  return { position: { x, y, z }, yaw: (yawDegrees * Math.PI) / 180 };
}

/** Copy of `config` that renders with the given backend. */
export function withRendererBackend(config: ClientConfig, backend: RendererBackendPreference): ClientConfig {
  return { ...config, renderer: { ...config.renderer, backend } };
}

/**
 * Resolves the client configuration: defaults plus developer overrides from
 * the URL query string.
 *
 * - `?renderer=webgl` forces the WebGL 2 backend.
 * - `?debug=0` hides the debug overlay.
 * - `?debug=input`, `?debug=player`, `?debug=weapon`, `?debug=audio` (or a
 *   list such as `?debug=input,player`) also show the temporary debug panels.
 * - `?spawn=x,y,z,yawDegrees` spawns the player there instead of the map spawn.
 * - `?viewmodel=0` hides the first-person weapon model (CS `r_drawviewmodel 0`).
 * - `?volume=0.5` sets the master volume (0 mutes).
 */
export function resolveClientConfig(search: string): ClientConfig {
  const params = new URLSearchParams(search);
  const debug = new Set((params.get('debug') ?? '').split(','));

  return {
    ...DEFAULT_CONFIG,
    renderer: {
      ...DEFAULT_CONFIG.renderer,
      backend: params.get('renderer') === 'webgl' ? 'webgl' : DEFAULT_CONFIG.renderer.backend,
    },
    weaponView: {
      ...DEFAULT_CONFIG.weaponView,
      drawViewModel: params.get('viewmodel') === '0' ? false : DEFAULT_CONFIG.weaponView.drawViewModel,
    },
    audio: {
      volume: parseVolume(params.get('volume')) ?? DEFAULT_CONFIG.audio.volume,
    },
    debug: {
      overlay: debug.has('0') ? false : DEFAULT_CONFIG.debug.overlay,
      input: debug.has('input') || DEFAULT_CONFIG.debug.input,
      player: debug.has('player') || DEFAULT_CONFIG.debug.player,
      weapon: debug.has('weapon') || DEFAULT_CONFIG.debug.weapon,
      audio: debug.has('audio') || DEFAULT_CONFIG.debug.audio,
      spawn: parseSpawn(params.get('spawn')) ?? DEFAULT_CONFIG.debug.spawn,
    },
  };
}
