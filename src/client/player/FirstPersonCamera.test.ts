import { PerspectiveCamera } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PLAYER_MOVEMENT as CONFIG } from '@shared/player/PlayerMovementConfig';
import { createPlayerState, freezeState, type PlayerState } from '@shared/player/PlayerState';
import { SIMULATION_TICK_SECONDS as TICK } from '@shared/simulation/SimulationConfig';
import type { FrameContext } from '../core/GameSystem';
import type { LookDelta } from '../input/InputState';
import { FirstPersonCamera, type PlayerViewSource } from './FirstPersonCamera';

function state(overrides: Partial<PlayerState> & { x?: number; y?: number; z?: number } = {}): PlayerState {
  const { x = 0, y = 0, z = 0, ...rest } = overrides;
  const base = createPlayerState({ position: { x, y, z }, yaw: 0 });
  return freezeState({ ...base, grounded: true, ...rest, position: { x, y, z } });
}

function frame(alpha: number, deltaSeconds = 1 / 144): FrameContext {
  return { index: 0, deltaSeconds, elapsedSeconds: 0, alpha };
}

function setup(initial: PlayerState, preview: LookDelta = { yaw: 0, pitch: 0 }) {
  const view: { previous: PlayerState; current: PlayerState } = { previous: initial, current: initial };
  const camera = new PerspectiveCamera();
  let look = preview;
  const fp = new FirstPersonCamera({
    camera,
    player: view as PlayerViewSource,
    config: CONFIG,
    tickSeconds: TICK,
    previewLook: () => look,
  });
  const advance = (next: PlayerState): void => {
    view.previous = view.current;
    view.current = next;
  };
  return { camera, fp, advance, setLook: (value: LookDelta) => (look = value) };
}

describe('FirstPersonCamera', () => {
  it('sits at the eye of the player as soon as it is created', () => {
    const { camera } = setup(state({ x: 3, z: -2 }));
    expect(camera.position.toArray()).toEqual([3, CONFIG.standingEyeHeight, -2]);
  });

  it('interpolates the eye between the last two ticks', () => {
    const { camera, fp, advance } = setup(state({ x: 0 }));
    advance(state({ x: 1 }));
    fp.update(frame(0));
    expect(camera.position.x).toBe(0);
    fp.update(frame(0.25));
    expect(camera.position.x).toBeCloseTo(0.25, 12);
    fp.update(frame(1));
    expect(camera.position.x).toBe(1);
  });

  it('turns with look input that is not yet in a tick, and clamps pitch like the simulation', () => {
    const { camera, fp, setLook } = setup(state({ yaw: 0.5, pitch: 1.5 }));
    setLook({ yaw: 0.1, pitch: 0.2 });
    fp.update(frame(0.5));
    expect(camera.rotation.y).toBeCloseTo(-0.6, 12);
    expect(camera.rotation.x).toBe(CONFIG.maxPitch);
    expect(camera.rotation.order).toBe('YXZ');
  });

  it('eases a step up instead of popping, without a jump at the tick boundary', () => {
    const { camera, fp, advance } = setup(state({ y: 0 }));
    fp.update(frame(1));
    const before = camera.position.y;

    advance(state({ y: 0.3 })); // grounded → grounded, 0.3 m higher: a step
    fp.update(frame(0, 0));
    expect(camera.position.y).toBeCloseTo(before, 12);

    let previousY = camera.position.y;
    for (let i = 0; i < 30; i++) {
      fp.update(frame(1, 1 / 144));
      expect(camera.position.y).toBeGreaterThanOrEqual(previousY - 1e-12);
      expect(camera.position.y - previousY).toBeLessThan(0.05); // at most ~4 m/s at 144 fps
      previousY = camera.position.y;
    }
    expect(camera.position.y).toBeCloseTo(0.3 + CONFIG.standingEyeHeight, 12);
  });

  it('does not smooth landings (only grounded height changes are steps)', () => {
    const { camera, fp, advance } = setup(state({ y: 1, grounded: false }));
    advance(state({ y: 0, grounded: true }));
    fp.update(frame(1, 0));
    expect(camera.position.y).toBeCloseTo(CONFIG.standingEyeHeight, 12);
  });
});
