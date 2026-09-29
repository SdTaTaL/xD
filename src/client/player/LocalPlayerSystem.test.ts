import { describe, expect, it } from 'vitest';
import { CollisionWorld } from '@shared/physics/CollisionWorld';
import { aabb } from '@shared/physics/Aabb';
import { DEFAULT_PLAYER_MOVEMENT as CONFIG } from '@shared/player/PlayerMovementConfig';
import type { PlayerState } from '@shared/player/PlayerState';
import { SIMULATION_TICK_RATE, SIMULATION_TICK_SECONDS } from '@shared/simulation/SimulationConfig';
import { FixedTimestep } from '@shared/time/FixedTimestep';
import { DEFAULT_KEYBOARD_MOUSE_BINDINGS, KeyboardMouseAdapter } from '../input/adapters/KeyboardMouseAdapter';
import { InputSystem } from '../input/InputSystem';
import { FakeKeyboardMouseDevice } from '../input/test-support/FakeKeyboardMouseDevice';
import { LocalPlayerSystem } from './LocalPlayerSystem';

const WORLD = new CollisionWorld([aabb(-100, -1, -100, 100, 0, 100), aabb(-100, 0, -30, 100, 5, -29)]);

function createClient() {
  const input = new InputSystem({ historyTicks: 256 });
  const kbm = input.addAdapter(
    'kbm',
    (port) => new KeyboardMouseAdapter(port, new FakeKeyboardMouseDevice(), { bindings: DEFAULT_KEYBOARD_MOUSE_BINDINGS, mouse: { sensitivity: 2, invertY: false } }),
  );
  const player = new LocalPlayerSystem({
    commands: input.commands,
    context: { world: WORLD, config: CONFIG, tickSeconds: SIMULATION_TICK_SECONDS },
    spawn: { position: { x: 0, y: 0, z: 0 }, yaw: 0 },
  });
  return { input, kbm, player };
}

type Event = (kbm: KeyboardMouseAdapter) => void;

/**
 * Runs `seconds` of game time at `fps`, like GameLoop does: per frame, input
 * events that happened since the last frame, then the frame's fixed ticks.
 * Key events are scheduled on ticks; mouse motion arrives every frame,
 * proportional to the frame's duration.
 */
function run(fps: number, seconds: number, keys: ReadonlyMap<number, Event>, mouseCountsPerSecond: number): { state: PlayerState; pendingYaw: number } {
  const { input, kbm, player } = createClient();
  const timestep = new FixedTimestep(SIMULATION_TICK_RATE, 8);
  const tick = { tick: 0, deltaSeconds: SIMULATION_TICK_SECONDS };
  for (let frame = 0; frame < fps * seconds; frame++) {
    kbm.move((mouseCountsPerSecond / fps), 0);
    input.beginFrame();
    timestep.advance(1 / fps, (index, step) => {
      keys.get(index)?.(kbm);
      tick.tick = index;
      tick.deltaSeconds = step;
      input.fixedUpdate(tick);
      player.fixedUpdate(tick);
    });
  }
  return { state: player.current, pendingYaw: input.previewLook(0).yaw };
}

describe('LocalPlayerSystem', () => {
  it('advances one simulation step per tick from that tick\'s command', () => {
    const { input, kbm, player } = createClient();
    kbm.keyDown('KeyW');
    for (let tick = 0; tick < 10; tick++) {
      input.fixedUpdate({ tick, deltaSeconds: SIMULATION_TICK_SECONDS });
      player.fixedUpdate({ tick, deltaSeconds: SIMULATION_TICK_SECONDS });
      expect(player.command?.tick).toBe(tick);
    }
    expect(player.current.position.z).toBeLessThan(player.previous.position.z);
    expect(player.current.velocity.z).toBeLessThan(0);
  });

  it('simulates identically at 30, 60, 144 and 240 fps (key input on the same ticks)', () => {
    const keys = new Map<number, Event>([
      [5, (k) => k.keyDown('KeyW')],
      [20, (k) => k.keyDown('ShiftLeft')],
      [40, (k) => (k.keyDown('Space'), k.keyUp('Space'))],
      [70, (k) => (k.keyUp('ShiftLeft'), k.keyDown('ControlLeft'), k.keyDown('KeyD'))],
      [100, (k) => (k.keyUp('KeyW'), k.keyUp('KeyD'), k.keyUp('ControlLeft'))],
    ]);
    const reference = run(60, 2.5, keys, 0).state;
    for (const fps of [30, 144, 240]) expect(run(fps, 2.5, keys, 0).state).toEqual(reference);
    expect(reference.position.z).toBeLessThan(-3); // it did move
  });

  it('loses and duplicates no mouse motion at any frame rate', () => {
    // 400 counts at sensitivity 2 (0.044° per count) = 17.6° in total.
    const expected = (400 * 2 * 0.022 * Math.PI) / 180;
    for (const fps of [30, 60, 144, 240]) {
      const { state, pendingYaw } = run(fps, 1, new Map(), 400);
      // Committed to ticks + received but not yet committed = everything that arrived.
      expect(state.yaw + pendingYaw).toBeCloseTo(expected, 4);
    }
  });
});

describe('first-person view smoothness (no jitter)', () => {
  it('advances the camera by exactly speed × frame time on every frame, at any display rate', async () => {
    const { PerspectiveCamera } = await import('three/webgpu');
    const { FirstPersonCamera } = await import('./FirstPersonCamera');
    for (const fps of [60, 144, 240]) {
      const { input, kbm, player } = createClient();
      const camera = new PerspectiveCamera();
      const view = new FirstPersonCamera({ camera, player, config: CONFIG, tickSeconds: SIMULATION_TICK_SECONDS, previewLook: (s) => input.previewLook(s) });
      const timestep = new FixedTimestep(SIMULATION_TICK_RATE, 8);
      const tick = { tick: 0, deltaSeconds: SIMULATION_TICK_SECONDS };
      kbm.keyDown('KeyD');
      const xs: number[] = [];
      for (let frame = 0; frame < fps * 1.5; frame++) {
        input.beginFrame();
        timestep.advance(1 / fps, (index, step) => {
          tick.tick = index;
          tick.deltaSeconds = step;
          input.fixedUpdate(tick);
          player.fixedUpdate(tick);
        });
        view.update({ index: frame, deltaSeconds: 1 / fps, elapsedSeconds: frame / fps, alpha: timestep.alpha });
        xs.push(camera.position.x);
      }
      // After the ~0.55 s acceleration, every frame moves by the same distance.
      const steps = xs.slice(fps * 0.75).map((x, i, all) => (i === 0 ? null : x - all[i - 1]!)).slice(1) as number[];
      expect(steps.length).toBeGreaterThan(fps / 2);
      for (const step of steps) expect(step).toBeCloseTo(CONFIG.maxSpeed / fps, 9);
    }
  });

  it('turns the view with the mouse on every frame, not only on ticks', async () => {
    const { PerspectiveCamera } = await import('three/webgpu');
    const { FirstPersonCamera } = await import('./FirstPersonCamera');
    const fps = 240;
    const { input, kbm, player } = createClient();
    const camera = new PerspectiveCamera();
    const view = new FirstPersonCamera({ camera, player, config: CONFIG, tickSeconds: SIMULATION_TICK_SECONDS, previewLook: (s) => input.previewLook(s) });
    const timestep = new FixedTimestep(SIMULATION_TICK_RATE, 8);
    const tick = { tick: 0, deltaSeconds: SIMULATION_TICK_SECONDS };
    const perCount = (2 * 0.022 * Math.PI) / 180;
    let previousYaw = -camera.rotation.y;
    for (let frame = 0; frame < fps; frame++) {
      kbm.move(3, 0);
      input.beginFrame();
      timestep.advance(1 / fps, (index, step) => {
        tick.tick = index;
        tick.deltaSeconds = step;
        input.fixedUpdate(tick);
        player.fixedUpdate(tick);
      });
      view.update({ index: frame, deltaSeconds: 1 / fps, elapsedSeconds: frame / fps, alpha: timestep.alpha });
      const yaw = -camera.rotation.y;
      // Every frame shows exactly that frame's mouse motion (up to the 2^-16 rad quantum).
      expect(yaw - previousYaw).toBeCloseTo(3 * perCount, 4);
      previousYaw = yaw;
    }
  });
});
