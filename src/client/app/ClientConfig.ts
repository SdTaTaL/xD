import type { RendererBackendPreference, RendererSettings } from '../rendering/GameRenderer';
import type { ViewCameraSettings } from '../rendering/ViewCamera';

export interface LoopSettings {
  /** Longest frame delta accepted; longer stalls (tab switch, breakpoint) are clamped. */
  readonly maxFrameDeltaSeconds: number;
  /** Most simulation ticks run in one frame before the backlog is dropped. */
  readonly maxTicksPerFrame: number;
}

export interface DebugSettings {
  readonly overlay: boolean;
}

export interface ClientConfig {
  readonly renderer: RendererSettings;
  readonly camera: ViewCameraSettings;
  readonly loop: LoopSettings;
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
  debug: {
    overlay: true,
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
 */
export function resolveClientConfig(search: string): ClientConfig {
  const params = new URLSearchParams(search);

  return {
    ...DEFAULT_CONFIG,
    renderer: {
      ...DEFAULT_CONFIG.renderer,
      backend: params.get('renderer') === 'webgl' ? 'webgl' : DEFAULT_CONFIG.renderer.backend,
    },
    debug: {
      ...DEFAULT_CONFIG.debug,
      overlay: params.get('debug') !== '0' && DEFAULT_CONFIG.debug.overlay,
    },
  };
}
