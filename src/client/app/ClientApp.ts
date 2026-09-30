import { Color, Scene } from 'three/webgpu';
import { GRAYBOX_ARENA } from '@shared/maps/grayboxArena';
import { getMapBounds } from '@shared/maps/MapDefinition';
import { CollisionWorld } from '@shared/physics/CollisionWorld';
import { DEFAULT_PLAYER_MOVEMENT } from '@shared/player/PlayerMovementConfig';
import { SIMULATION_TICK_RATE, SIMULATION_TICK_SECONDS } from '@shared/simulation/SimulationConfig';
import { AK47 } from '@shared/weapons/WeaponDefinition';
import { DEFAULT_WEAPON_RULES } from '@shared/weapons/WeaponRules';
import { GameLoop } from '../core/GameLoop';
import { GameAudio } from '../audio/GameAudio';
import { WebAudioOutput } from '../audio/WebAudioOutput';
import { BloodPuffs } from '../combat/BloodPuffs';
import { TargetView } from '../combat/TargetView';
import { TrainingRange } from '../combat/TrainingRange';
import { SystemScheduler } from '../core/SystemScheduler';
import { AudioDebugPanel } from '../debug/AudioDebugPanel';
import { DebugOverlay } from '../debug/DebugOverlay';
import { InputDebugPanel } from '../debug/InputDebugPanel';
import { PlayerDebugPanel } from '../debug/PlayerDebugPanel';
import { WeaponDebugPanel } from '../debug/WeaponDebugPanel';
import { DEFAULT_KEYBOARD_MOUSE_BINDINGS, KeyboardMouseAdapter } from '../input/adapters/KeyboardMouseAdapter';
import { BrowserKeyboardMouseDevice } from '../input/devices/BrowserKeyboardMouseDevice';
import { InputSystem } from '../input/InputSystem';
import { FirstPersonCamera } from '../player/FirstPersonCamera';
import { LocalPlayerSystem } from '../player/LocalPlayerSystem';
import { GameRenderer, type RenderBackend } from '../rendering/GameRenderer';
import { createViewCamera } from '../rendering/ViewCamera';
import { Viewport } from '../rendering/Viewport';
import { AmmoCounter } from '../ui/AmmoCounter';
import { Crosshair } from '../ui/Crosshair';
import { ImpactMarks } from '../weapons/ImpactMarks';
import { RecoilView } from '../weapons/RecoilView';
import { WeaponViewModel } from '../weapons/WeaponViewModel';
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

/** Two seconds of input commands stay readable by tick. */
const INPUT_HISTORY_TICKS = 2 * SIMULATION_TICK_RATE;

/**
 * Seed of the local player's bullet spread. Fixed for now; in multiplayer the
 * authoritative server hands it out (see docs/ARCHITECTURE.md).
 */
const LOCAL_SPREAD_SEED = 1;

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
    let unregisteredInput: InputSystem | null = null;

    try {
      const scene = new Scene();
      scene.background = new Color(SKY_COLOR);
      const camera = createViewCamera(config.camera);

      const map = GRAYBOX_ARENA;
      const mapView = new MapView(map);
      const lighting = new Lighting({ bounds: getMapBounds(map), shadows: config.renderer.shadows });
      scene.add(mapView.root, lighting.root);
      worldDisposers.push(() => mapView.dispose(), () => lighting.dispose());

      // Input and the local player exist before the renderer so its startup
      // check draws the real first-person view. Input is independent of the renderer.
      const input = new InputSystem({ historyTicks: INPUT_HISTORY_TICKS });
      unregisteredInput = input;
      const keyboardMouse = input.addAdapter(
        'keyboard-mouse',
        (port) =>
          new KeyboardMouseAdapter(
            port,
            new BrowserKeyboardMouseDevice({
              element: root,
              captureOnClick: true,
              rawMouseInput: config.input.rawMouseInput,
            }),
            {
              bindings: DEFAULT_KEYBOARD_MOUSE_BINDINGS,
              mouse: { sensitivity: config.input.mouseSensitivity, invertY: config.input.invertMouseY },
            },
          ),
      );

      const spawn = config.debug.spawn ?? map.spawnPoints[0];
      if (!spawn) throw new Error(`Map "${map.id}" has no spawn point`);
      const movement = DEFAULT_PLAYER_MOVEMENT;
      const weapon = AK47;
      const rules = DEFAULT_WEAPON_RULES;
      const player = new LocalPlayerSystem({
        commands: input.commands,
        context: {
          world: CollisionWorld.fromMap(map),
          movement,
          weapon,
          rules,
          tickSeconds: SIMULATION_TICK_SECONDS,
          spreadSeed: LOCAL_SPREAD_SEED,
        },
        spawn,
      });
      const recoilView = new RecoilView({ source: player, weapon, rules, settings: config.weaponView });
      const firstPerson = new FirstPersonCamera({
        camera,
        player,
        config: movement,
        tickSeconds: SIMULATION_TICK_SECONDS,
        previewLook: (elapsed) => input.previewLook(elapsed),
        viewOffset: (alpha) => recoilView.cameraOffset(alpha),
      });
      const viewModel = config.weaponView.drawViewModel
        ? new WeaponViewModel({ source: player, weapon, view: firstPerson, fovDegrees: config.weaponView.viewmodelFovDegrees })
        : null;
      if (viewModel) worldDisposers.push(() => viewModel.dispose());
      const range = new TrainingRange({ source: player, weapon, spawns: map.targets ?? [] });
      const targetView = new TargetView({ range });
      const bloodPuffs = new BloodPuffs({ range, camera });
      const impacts = new ImpactMarks({ source: range });
      scene.add(targetView.root, bloodPuffs.mesh, impacts.mesh);
      worldDisposers.push(
        () => impacts.dispose(),
        () => bloodPuffs.dispose(),
        () => targetView.dispose(),
        () => range.dispose(),
      );

      // Sound starts on the first click or key press (browser autoplay policy).
      const audioOutput = new WebAudioOutput({ gestureTarget: root, keyTarget: window, volume: config.audio.volume });
      worldDisposers.push(() => audioOutput.dispose());
      const gameAudio = new GameAudio({
        output: audioOutput,
        player,
        range,
        weapon,
        camera,
        tickSeconds: SIMULATION_TICK_SECONDS,
      });

      const renderer = await GameRenderer.create({
        ...config.renderer,
        scene,
        camera,
        ...(viewModel ? { overlay: viewModel.layer } : {}),
        onDeviceLost: options.onRendererLost,
      });
      createdRenderer = renderer;

      // Registration order is phase order (see GameSystem).
      if (config.debug.overlay) {
        // First: it times the whole frame (see DebugOverlay).
        scheduler.add(
          new DebugOverlay({
            parent: root,
            tickRate: SIMULATION_TICK_RATE,
            getRenderStats: () => renderer.getStats(),
          }),
        );
      }
      // Input before simulation, so each tick's command exists when it is read.
      scheduler.add(input);
      unregisteredInput = null;
      if (config.debug.input) {
        scheduler.add(
          new InputDebugPanel({
            parent: root,
            commands: input.commands,
            getDeviceState: () => ({
              captured: keyboardMouse.device.captured,
              keys: keyboardMouse.pressedKeys,
              buttons: keyboardMouse.pressedButtons,
            }),
          }),
        );
      }
      scheduler.add(player);
      // The local stand-in for the authority: resolves this tick's shots against the targets.
      scheduler.add(range);
      if (config.debug.player) {
        scheduler.add(new PlayerDebugPanel({ parent: root, player, config: movement }));
      }
      if (config.debug.weapon) {
        scheduler.add(
          new WeaponDebugPanel({
            parent: root,
            source: player,
            weapon,
            rules,
            tickSeconds: SIMULATION_TICK_SECONDS,
            marks: () => impacts.size,
            range,
          }),
        );
      }
      // Presentation: after simulation, before rendering. Recoil before the
      // camera (it decays the screen kick), the HUD after it (it projects
      // through the camera's final pose).
      const viewport = new Viewport(root);
      scheduler.add(recoilView);
      scheduler.add(firstPerson);
      if (viewModel) scheduler.add(viewModel);
      scheduler.add(targetView);
      scheduler.add(bloodPuffs);
      // After the player and the range (tick results) and the camera (the ears).
      scheduler.add(gameAudio);
      if (config.debug.audio) {
        scheduler.add(
          new AudioDebugPanel({
            parent: root,
            output: audioOutput,
            movement: () => {
              const last = gameAudio.movement;
              return last ? `${last.sound}${last.sound === 'step' ? ` (${last.foot === 0 ? 'left' : 'right'})` : ''}` : '—';
            },
          }),
        );
      }
      scheduler.add(
        new Crosshair({
          parent: root,
          camera,
          view: firstPerson,
          aimOffset: (alpha) => recoilView.aimOffset(alpha),
          source: player,
          weapon,
          rules,
          followRecoil: config.weaponView.crosshairFollowsRecoil,
          viewport,
        }),
      );
      scheduler.add(new AmmoCounter({ parent: root, source: player, weapon }));

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
      unregisteredInput?.dispose();
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
