import { describe, expect, it } from 'vitest';
import { recoilKick } from '@shared/weapons/recoil';
import type { Shot } from '@shared/weapons/WeaponController';
import { AK47 } from '@shared/weapons/WeaponDefinition';
import { DEFAULT_WEAPON_RULES as RULES } from '@shared/weapons/WeaponRules';
import { createWeaponState, freezeWeaponState, type WeaponState } from '@shared/weapons/WeaponState';
import { resolveClientConfig } from '../app/ClientConfig';
import type { FrameContext } from '../core/GameSystem';
import { RecoilView } from './RecoilView';

const SETTINGS = resolveClientConfig('').weaponView;

function withPunch(pitch: number, yaw: number): WeaponState {
  return freezeWeaponState({ ...createWeaponState(AK47), aimPunch: { pitch, yaw } });
}

function setup() {
  const listeners = new Set<(shot: Shot) => void>();
  const source = {
    previousWeapon: withPunch(0, 0),
    weapon: withPunch(0.02, -0.01),
    onShot: (listener: (shot: Shot) => void) => (listeners.add(listener), () => listeners.delete(listener)),
  };
  const view = new RecoilView({ source, weapon: AK47, rules: RULES, settings: SETTINGS });
  const shoot = (sprayIndex: number): void => {
    for (const listener of listeners) listener({ sprayIndex } as Shot);
  };
  return { view, shoot, listeners };
}

const frame = (deltaSeconds: number): FrameContext => ({ index: 0, deltaSeconds, elapsedSeconds: 0, alpha: 0 });

describe('RecoilView', () => {
  it('aims where bullets go: the interpolated aim punch × recoil scale (2)', () => {
    const { view } = setup();
    expect(view.aimOffset(0)).toEqual({ pitch: 0, yaw: 0 });
    expect(view.aimOffset(1)).toEqual({ pitch: 0.04, yaw: -0.02 });
    expect(view.aimOffset(0.5).pitch).toBeCloseTo(0.02, 15);
  });

  it('moves the camera by 45 % of that (view_recoil_tracking), so sprays climb above the centre', () => {
    const { view } = setup();
    const camera = view.cameraOffset(1);
    expect(camera.pitch).toBeCloseTo(0.04 * SETTINGS.viewRecoilTracking, 15);
    expect(camera.yaw).toBeCloseTo(-0.02 * SETTINGS.viewRecoilTracking, 15);
  });

  it('adds a short screen kick per shot that fades within a fraction of a second', () => {
    const { view, shoot } = setup();
    const still = view.cameraOffset(0);
    shoot(5);
    const kick = recoilKick(AK47, RULES, 5);
    const kicked = view.cameraOffset(0);
    expect(kicked.pitch - still.pitch).toBeCloseTo(kick.pitch * SETTINGS.viewPunchExtra, 15);
    for (let i = 0; i < 30; i++) view.update(frame(1 / 60));
    expect(view.cameraOffset(0).pitch - still.pitch).toBeLessThan(1e-4 * kick.pitch);
  });

  it('stops listening to shots when disposed', () => {
    const { view, listeners } = setup();
    view.dispose();
    expect(listeners.size).toBe(0);
  });
});
