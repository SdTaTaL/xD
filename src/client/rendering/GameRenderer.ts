import {
  NeutralToneMapping,
  PCFShadowMap,
  Vector2,
  WebGPURenderer,
  type PerspectiveCamera,
  type Scene,
} from 'three/webgpu';
import type { GameSystem } from '../core/GameSystem';
import { createLogger } from '../core/Logger';
import { setCameraAspect } from './ViewCamera';
import type { ViewportSize } from './Viewport';

/** `auto` prefers WebGPU and falls back to WebGL 2; `webgl` forces WebGL 2. */
export type RendererBackendPreference = 'auto' | 'webgl';

export type RenderBackend = 'WebGPU' | 'WebGL 2';

export interface RendererSettings {
  readonly backend: RendererBackendPreference;
  readonly antialias: boolean;
  /** Cap for the device pixel ratio; trades sharpness on high-DPI screens for frame rate. */
  readonly maxPixelRatio: number;
  readonly shadows: boolean;
}

/** A scene and the camera it is drawn with. */
export interface RenderLayer {
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
}

/** Everything drawn in a frame: the world, then an optional overlay. */
interface FrameLayers extends RenderLayer {
  readonly overlay?: RenderLayer | undefined;
}

export interface GameRendererOptions extends RendererSettings {
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  /**
   * Drawn over the scene with its own depth buffer and camera: the
   * first-person weapon, which must never clip into walls and uses its own
   * field of view.
   */
  readonly overlay?: RenderLayer;
  /** Called if the GPU device (or WebGL context) is lost after initialisation. */
  readonly onDeviceLost: (error: Error, backend: RenderBackend) => void;
}

export interface RenderStats {
  readonly backend: RenderBackend;
  /** Draw calls of the last rendered frame (including shadow passes). */
  readonly drawCalls: number;
  /** Triangles of the last rendered frame (including shadow passes). */
  readonly triangles: number;
  /** Drawing buffer width, in device pixels. */
  readonly bufferWidth: number;
  /** Drawing buffer height, in device pixels. */
  readonly bufferHeight: number;
  /** Effective pixel ratio (device pixel ratio after the cap). */
  readonly pixelRatio: number;
}

const log = createLogger('renderer');

/**
 * Owns the GPU renderer and its canvas, and draws the scene through the
 * active camera.
 *
 * Uses Three.js' WebGPURenderer: WebGPU when available, WebGL 2 otherwise.
 * Materials written as node materials (TSL) compile for both backends.
 */
export class GameRenderer implements GameSystem {
  readonly name = 'renderer';
  readonly backend: RenderBackend;
  /** Canvas the renderer draws into. The caller attaches it to the document. */
  readonly canvas: HTMLCanvasElement;

  private readonly renderer: WebGPURenderer;
  private readonly layers: FrameLayers;
  private readonly maxPixelRatio: number;
  private readonly bufferSize = new Vector2();
  private disposed = false;

  /**
   * Creates a renderer that has been proven to draw `options.scene`.
   *
   * With the `auto` preference WebGPU is tried first. Three.js already falls
   * back to WebGL 2 when WebGPU is missing; this additionally covers
   * WebGPU implementations that initialise but fail once they draw (driver
   * bugs, browser/spec mismatches), by retrying on WebGL 2.
   */
  static async create(options: GameRendererOptions): Promise<GameRenderer> {
    if (options.backend === 'auto') {
      try {
        return await GameRenderer.createValidated(options, false);
      } catch (error) {
        log.warn('Renderer failed its startup check; retrying with WebGL 2.', error);
      }
    }

    try {
      return await GameRenderer.createValidated(options, true);
    } catch (cause) {
      throw new Error(
        'Could not initialise a WebGPU or WebGL 2 renderer. ' +
          'Update your browser or graphics drivers and make sure hardware acceleration is enabled.',
        { cause },
      );
    }
  }

  private static async createValidated(options: GameRendererOptions, forceWebGL: boolean): Promise<GameRenderer> {
    // A canvas keeps the first context type it hands out, so each attempt gets its own.
    const canvas = document.createElement('canvas');
    const renderer = new WebGPURenderer({
      canvas,
      antialias: options.antialias,
      powerPreference: 'high-performance',
      forceWebGL,
    });

    renderer.toneMapping = NeutralToneMapping;
    renderer.shadowMap.enabled = options.shadows;
    renderer.shadowMap.type = PCFShadowMap;

    try {
      await renderer.init();
      // Compile every pipeline now (no shader-compilation hitches in the first
      // frames), then draw once so a backend that cannot render fails here,
      // while falling back is still possible.
      await renderer.compileAsync(options.scene, options.camera);
      if (options.overlay) await renderer.compileAsync(options.overlay.scene, options.overlay.camera);
      GameRenderer.draw(renderer, options);
    } catch (error) {
      renderer.dispose();
      throw error;
    }

    return new GameRenderer(renderer, canvas, options);
  }

  private constructor(renderer: WebGPURenderer, canvas: HTMLCanvasElement, options: GameRendererOptions) {
    this.renderer = renderer;
    this.canvas = canvas;
    this.layers = { scene: options.scene, camera: options.camera, overlay: options.overlay };
    this.maxPixelRatio = options.maxPixelRatio;
    this.backend = 'isWebGPUBackend' in renderer.backend ? 'WebGPU' : 'WebGL 2';

    const defaultDeviceLostHandler = renderer.onDeviceLost;
    renderer.onDeviceLost = (info) => {
      defaultDeviceLostHandler.call(renderer, info);
      if (!this.disposed) options.onDeviceLost(new Error(`${info.api} device lost: ${info.message}`), this.backend);
    };
  }

  /** Applies a viewport size to the drawing buffer and the camera projection. */
  setViewportSize(size: ViewportSize): void {
    const pixelRatio = Math.min(size.devicePixelRatio, this.maxPixelRatio);
    this.renderer.setDrawingBufferSize(size.width, size.height, pixelRatio);
    setCameraAspect(this.layers.camera, size.width / size.height);
    if (this.layers.overlay) setCameraAspect(this.layers.overlay.camera, size.width / size.height);
  }

  render(): void {
    GameRenderer.draw(this.renderer, this.layers);
  }

  /** Draws the scene, then the overlay on top of it: same colour buffer, cleared depth. */
  private static draw(renderer: WebGPURenderer, layers: FrameLayers): void {
    renderer.render(layers.scene, layers.camera);
    if (!layers.overlay) return;
    renderer.autoClearColor = false;
    try {
      renderer.render(layers.overlay.scene, layers.overlay.camera);
    } finally {
      renderer.autoClearColor = true;
    }
  }

  getStats(): RenderStats {
    const { drawCalls, triangles } = this.renderer.info.render;
    this.renderer.getDrawingBufferSize(this.bufferSize);
    return {
      backend: this.backend,
      drawCalls,
      triangles,
      bufferWidth: this.bufferSize.x,
      bufferHeight: this.bufferSize.y,
      pixelRatio: this.renderer.getPixelRatio(),
    };
  }

  /** Idempotent. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.renderer.dispose();
    this.canvas.remove();
  }
}
