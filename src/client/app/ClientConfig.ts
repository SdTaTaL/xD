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

export interface DebugSettings {
  readonly overlay: boolean;
  /** Temporary input debug panel. */
  readonly input: boolean;
  /** Temporary player movement debug panel. */
  readonly player: boolean;
  /** Development override of the spawn pose, for reproducible tests. */
  readonly spawn: SpawnPose | null;
}

export interface ClientConfig {
  readonly renderer: RendererSettings;
  readonly camera: ViewCameraSettings;
  readonly loop: LoopSettings;
  readonly input: InputSettings;
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
  debug: {
    overlay: true,
    input: false,
    player: false,
    spawn: null,
  },
};

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
 * - `?debug=input`, `?debug=player` or `?debug=input,player` also show the
 *   (temporary) input / player debug panels.
 * - `?spawn=x,y,z,yawDegrees` spawns the player there instead of the map spawn.
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
    debug: {
      overlay: debug.has('0') ? false : DEFAULT_CONFIG.debug.overlay,
      input: debug.has('input') || DEFAULT_CONFIG.debug.input,
      player: debug.has('player') || DEFAULT_CONFIG.debug.player,
      spawn: parseSpawn(params.get('spawn')) ?? DEFAULT_CONFIG.debug.spawn,
    },
  };
}
