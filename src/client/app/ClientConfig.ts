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
    horizontalFovDegrees: 103,
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
  },
};

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
 * - `?debug=input` also shows the (temporary) input debug panel.
 */
export function resolveClientConfig(search: string): ClientConfig {
  const params = new URLSearchParams(search);
  const debug = params.get('debug');

  return {
    ...DEFAULT_CONFIG,
    renderer: {
      ...DEFAULT_CONFIG.renderer,
      backend: params.get('renderer') === 'webgl' ? 'webgl' : DEFAULT_CONFIG.renderer.backend,
    },
    debug: {
      overlay: debug === '0' ? false : DEFAULT_CONFIG.debug.overlay || debug === 'input',
      input: debug === 'input' || DEFAULT_CONFIG.debug.input,
    },
  };
}
