import { describe, expect, it } from 'vitest';
import { SeededRandom } from '../math/SeededRandom';
import { SOURCE_UNIT } from '../player/PlayerMovementConfig';
import { createPlayerState, freezeState, type PlayerState } from '../player/PlayerState';
import { TICK } from '../player/test-support/simulation';
import { damageAtDistance } from './damage';
import { movementInaccuracy, recoverPenalty, recoveryTime, situationalInaccuracy } from './inaccuracy';
import { decayAimPunch, recoilKick, recoilPattern, type AimPunch } from './recoil';
import { bulletDirection, viewBasis } from './spread';
import { AK47 } from './WeaponDefinition';
import { DEFAULT_WEAPON_RULES as RULES } from './WeaponRules';

const DEGREE = Math.PI / 180;
const strength = (kick: { pitch: number; yaw: number }): number => Math.hypot(kick.pitch, kick.yaw);

function playerWith(fields: Partial<PlayerState>): PlayerState {
  return freezeState({ ...createPlayerState({ position: { x: 0, y: 0, z: 0 }, yaw: 0 }), grounded: true, ...fields });
}

describe('AK-47 data', () => {
  it('carries CS2 values, converted to meters', () => {
    expect(AK47.maxSpeed).toBeCloseTo(5.461, 12); // 215 u/s
    expect(AK47.range).toBeCloseTo(208.0768, 10); // 8192 u
    expect(AK47.cycleSeconds).toBe(0.1); // 600 rounds per minute
    expect([AK47.magazineSize, AK47.reserveAmmo]).toEqual([30, 90]);
  });
});

describe('recoil pattern', () => {
  const pattern = recoilPattern(AK47, RULES);

  it('is generated once per weapon and rules, and is the same on every call', () => {
    expect(recoilPattern(AK47, RULES)).toBe(pattern);
    expect(pattern).toHaveLength(64);
    expect(recoilKick(AK47, RULES, 1000)).toBe(pattern[63]);
  });

  it('kicks upwards, never more than recoilAngleVariance (70°) from vertical', () => {
    for (const kick of pattern) {
      expect(kick.pitch).toBeGreaterThan(0);
      expect(Math.abs(Math.atan2(kick.yaw, kick.pitch))).toBeLessThanOrEqual(AK47.recoilAngleVariance + 1e-12);
    }
  });

  it('suppresses the first shots: half strength, reaching full strength on the fifth', () => {
    const expected = [0.5, 0.625, 0.75, 0.875, 1, 1];
    expected.forEach((fraction, shot) => {
      expect(strength(pattern[shot]!)).toBeCloseTo(AK47.recoilMagnitude * fraction, 12);
    });
  });

  it('drifts smoothly: each kick blends with the previous one', () => {
    const direction = (shot: number): number => Math.atan2(pattern[shot]!.yaw, pattern[shot]!.pitch);
    for (let shot = 1; shot < pattern.length; shot++) {
      // A fresh draw is at most 140° away; blending keeps at most 55 % of that.
      expect(Math.abs(direction(shot) - direction(shot - 1))).toBeLessThanOrEqual(0.55 * 2 * AK47.recoilAngleVariance + 1e-12);
    }
  });

  it('keeps one direction when recoilVariance is 0, and depends on the rules it was built with', () => {
    const steady = recoilPattern(AK47, { ...RULES, recoilVariance: 0 });
    const first = Math.atan2(steady[0]!.yaw, steady[0]!.pitch);
    for (const kick of steady) expect(Math.atan2(kick.yaw, kick.pitch)).toBeCloseTo(first, 12);
    expect(steady).not.toBe(pattern);
  });
});

describe('aim punch', () => {
  it('rises after a kick, then comes back exactly to rest', () => {
    let punch: AimPunch = { angle: { pitch: 0, yaw: 0 }, velocity: recoilKick(AK47, RULES, 10) };
    let peak = 0;
    for (let tick = 0; tick < 4 * 64; tick++) {
      punch = decayAimPunch(punch, RULES, TICK);
      peak = Math.max(peak, punch.angle.pitch);
    }
    expect(peak).toBeGreaterThan(0.5 * DEGREE);
    expect(punch).toEqual({ angle: { pitch: 0, yaw: 0 }, velocity: { pitch: 0, yaw: 0 } });
  });

  it('with no velocity, decays to zero in finite time (exponential + linear)', () => {
    let punch: AimPunch = { angle: { pitch: 5 * DEGREE, yaw: -2 * DEGREE }, velocity: { pitch: 0, yaw: 0 } };
    const ratio = punch.angle.yaw / punch.angle.pitch;
    punch = decayAimPunch(punch, RULES, TICK);
    expect(punch.angle.yaw / punch.angle.pitch).toBeCloseTo(ratio, 12); // direction kept
    for (let tick = 0; tick < 64; tick++) punch = decayAimPunch(punch, RULES, TICK);
    expect(punch.angle).toEqual({ pitch: 0, yaw: 0 });
  });
});

describe('inaccuracy', () => {
  const speed = (fraction: number): number => AK47.maxSpeed * fraction;

  it('uses the stance value when still: standing 0.00641, crouched 0.00481', () => {
    expect(situationalInaccuracy(AK47, RULES, playerWith({}))).toBe(AK47.inaccuracyStand);
    expect(situationalInaccuracy(AK47, RULES, playerWith({ crouched: true }))).toBe(AK47.inaccuracyCrouch);
  });

  it('adds nothing for movement up to 34 % of the weapon speed, all of it from 95 %', () => {
    expect(movementInaccuracy(AK47, RULES, speed(0.34))).toBe(0);
    expect(movementInaccuracy(AK47, RULES, speed(0.95))).toBeCloseTo(AK47.inaccuracyMove, 15);
    expect(movementInaccuracy(AK47, RULES, speed(1.2))).toBeCloseTo(AK47.inaccuracyMove, 15);
    expect(movementInaccuracy(AK47, RULES, speed((0.34 + 0.95) / 2))).toBeCloseTo(AK47.inaccuracyMove / 2, 12);
  });

  it('walking (52 %) is still clearly inaccurate with a rifle, as in CS', () => {
    const walking = movementInaccuracy(AK47, RULES, speed(0.52));
    expect(walking).toBeGreaterThan(5 * AK47.inaccuracyStand);
  });

  it('replaces the movement term with the jump term in the air', () => {
    const airborne = playerWith({ grounded: false, velocity: { x: 6, y: 3, z: 0 } });
    expect(situationalInaccuracy(AK47, RULES, airborne)).toBeCloseTo(AK47.inaccuracyStand + AK47.inaccuracyJump, 15);
  });

  it('recovers faster after taps than after long sprays', () => {
    expect(recoveryTime(AK47, false, 0)).toBe(0.368);
    expect(recoveryTime(AK47, false, 2)).toBe(0.368);
    expect(recoveryTime(AK47, false, 3.5)).toBeCloseTo((0.368 + 0.506) / 2, 12);
    expect(recoveryTime(AK47, false, 30)).toBe(0.506);
    expect(recoveryTime(AK47, true, 0)).toBe(0.305257);
  });

  it('decays the penalty to 10 % in one recovery time, independently of the step size', () => {
    let penalty = 0.05;
    for (let tick = 0; tick < 64; tick++) penalty = recoverPenalty(penalty, 1, TICK);
    expect(penalty).toBeCloseTo(0.005, 12);
    expect(recoverPenalty(0.05, 1, 1)).toBeCloseTo(0.005, 12);
  });
});

describe('bullet direction', () => {
  const aim = { yaw: 0.3, pitch: -0.2 };
  const { forward } = viewBasis(aim);
  const deviation = (direction: { x: number; y: number; z: number }): number => {
    const cos = direction.x * forward.x + direction.y * forward.y + direction.z * forward.z;
    return Math.tan(Math.acos(Math.min(1, cos)));
  };

  it('follows the view basis conventions: yaw 0 looks −Z, positive pitch looks up', () => {
    const basis = viewBasis({ yaw: 0, pitch: 0 });
    expect(basis.forward).toEqual({ x: 0, y: 0, z: -1 });
    expect(basis.right).toEqual({ x: 1, y: 0, z: 0 });
    expect(basis.up).toEqual({ x: -0, y: 1, z: 0 });
    expect(viewBasis({ yaw: 0, pitch: Math.PI / 4 }).forward.y).toBeCloseTo(Math.SQRT1_2, 15);
  });

  it('stays inside the cone of radius inaccuracy + spread, and is a unit vector', () => {
    const random = new SeededRandom(9);
    let widest = 0;
    for (let i = 0; i < 5000; i++) {
      const direction = bulletDirection(aim, 0.02, 0.0006, random);
      expect(Math.hypot(direction.x, direction.y, direction.z)).toBeCloseTo(1, 14);
      widest = Math.max(widest, deviation(direction));
    }
    expect(widest).toBeLessThanOrEqual(0.0206 + 1e-9);
    expect(widest).toBeGreaterThan(0.018); // and does use the whole cone
  });

  it('clusters towards the centre (uniform radius, as in CS)', () => {
    const random = new SeededRandom(10);
    let inner = 0;
    for (let i = 0; i < 20000; i++) if (deviation(bulletDirection(aim, 0.02, 0, random)) < 0.01) inner++;
    // Uniform radius: half the shots in the inner half radius (uniform area would be a quarter).
    expect(inner / 20000).toBeCloseTo(0.5, 1);
  });

  it('goes exactly along the aim with no inaccuracy and no spread', () => {
    const direction = bulletDirection(aim, 0, 0, new SeededRandom(1));
    expect(direction.x).toBeCloseTo(forward.x, 15);
    expect(direction.y).toBeCloseTo(forward.y, 15);
    expect(direction.z).toBeCloseTo(forward.z, 15);
  });
});

describe('damage', () => {
  it('falls off by rangeModifier every 500 units', () => {
    expect(damageAtDistance(AK47, 0)).toBe(36);
    expect(damageAtDistance(AK47, 500 * SOURCE_UNIT)).toBeCloseTo(36 * 0.98, 12);
    expect(damageAtDistance(AK47, 2000 * SOURCE_UNIT)).toBeCloseTo(36 * 0.98 ** 4, 12);
  });
});
