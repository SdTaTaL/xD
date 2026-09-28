import { Color, Scene } from 'three/webgpu';
import { GRAYBOX_ARENA } from '@shared/maps/grayboxArena';
import { getMapBounds } from '@shared/maps/MapDefinition';
import { SIMULATION_TICK_RATE } from '@shared/simulation/SimulationConfig';
import { GameLoop } from '../core/GameLoop';
import { SystemScheduler } from '../core/SystemScheduler';
import { DebugOverlay } from '../debug/DebugOverlay';
import { GameRenderer, type RenderBackend } from '../rendering/GameRenderer';
import { createViewCamera } from '../rendering/ViewCamera';
import { Viewport } from '../rendering/Viewport';
import { Lighting } from '../world/Lighting';
import { MapView } from '../world/MapView';
import type { ClientConfig } from './ClientConfig';

export interface ClientAppOptions {
  /** Called when a frame throws. The loop is already stopped. */
  readonly onFatalError: (error: unknown) => void;
  /** Called when the GPU device (or WebGL context) is lost. The app can no longer render. */
  readonly onRendererLost: (error: Error, backend: RenderBackend) => void;
}

const SKY_COLOR = 0x9db4c8;

/**
 * Fixed overview of the arena used until a player or spectator camera
 * exists. Position and look-at target, in meters.
 */
const OVERVIEW_CAMERA = {
  position: [-21, 11, 23],
  target: [0, 0, 2],
} as const;

/**
 * Composition root of the browser client: creates the engine services and
 * the world, wires them into the loop and owns their lifetime.
 */
export class ClientApp {
  readonly backend: RenderBackend;

  private readonly loop: GameLoop;
  private readonly scheduler: SystemScheduler;
  private readonly worldDisposers: readonly (() => void)[];
  private disposed = false;

  static async create(root: HTMLElement, config: ClientConfig, options: ClientAppOptions): Promise<ClientApp> {
    const scheduler = new SystemScheduler();
    const worldDisposers: (() => void)[] = [];
    let createdRenderer: GameRenderer | null = null;

    try {
      const scene = new Scene();
      scene.background = new Color(SKY_COLOR);

      const camera = createViewCamera(config.camera);
      camera.position.set(...OVERVIEW_CAMERA.position);
      camera.lookAt(...OVERVIEW_CAMERA.target);

      // The world is built before the renderer so its startup check compiles
      // and draws the real scene.
      const map = GRAYBOX_ARENA;
      const mapView = new MapView(map);
      const lighting = new Lighting({ bounds: getMapBounds(map), shadows: config.renderer.shadows });
      scene.add(mapView.root, lighting.root);
      worldDisposers.push(() => mapView.dispose(), () => lighting.dispose());

      const renderer = await GameRenderer.create({
        ...config.renderer,
        scene,
        camera,
        onDeviceLost: options.onRendererLost,
      });
      createdRenderer = renderer;

      if (config.debug.overlay) {
        // First in registration order: it times the whole frame (see DebugOverlay).
        scheduler.add(
          new DebugOverlay({
            parent: root,
            tickRate: SIMULATION_TICK_RATE,
            getRenderStats: () => renderer.getStats(),
          }),
        );
      }
      const viewport = new Viewport(root);
      scheduler.add(viewport);
      scheduler.add(renderer);

      renderer.canvas.className = 'game-canvas';
      renderer.canvas.setAttribute('aria-label', 'Game view');
      root.prepend(renderer.canvas);
      viewport.subscribe((size) => renderer.setViewportSize(size));

      return new ClientApp(renderer.backend, scheduler, worldDisposers, config, options);
    } catch (error) {
      for (const dispose of worldDisposers.reverse()) dispose();
      scheduler.dispose();
      createdRenderer?.dispose();
      throw error;
    }
  }

  private constructor(
    backend: RenderBackend,
    scheduler: SystemScheduler,
    worldDisposers: readonly (() => void)[],
    config: ClientConfig,
    options: ClientAppOptions,
  ) {
    this.backend = backend;
    this.scheduler = scheduler;
    this.worldDisposers = worldDisposers;
    this.loop = new GameLoop(scheduler, {
      tickRate: SIMULATION_TICK_RATE,
      maxFrameDeltaSeconds: config.loop.maxFrameDeltaSeconds,
      maxTicksPerFrame: config.loop.maxTicksPerFrame,
      onError: options.onFatalError,
    });
  }

  start(): void {
    if (this.disposed) throw new Error('Cannot start a disposed ClientApp');
    this.loop.start();
  }

  /** Stops the loop and releases every resource. World content goes first, the renderer last. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    this.loop.stop();
    for (let i = this.worldDisposers.length - 1; i >= 0; i--) this.worldDisposers[i]?.();
    this.scheduler.dispose();
  }
}
