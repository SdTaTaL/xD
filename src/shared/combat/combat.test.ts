import { describe, expect, it } from 'vitest';
import { GRAYBOX_ARENA } from '../maps/grayboxArena';
import type { TargetSpawn } from '../maps/MapDefinition';
import type { Vec3 } from '../math/Vec3';
import { aabb } from '../physics/Aabb';
import { CollisionWorld } from '../physics/CollisionWorld';
import { DEFAULT_PLAYER_MOVEMENT, SOURCE_UNIT } from '../player/PlayerMovementConfig';
import type { Shot } from '../weapons/WeaponController';
import { AK47 } from '../weapons/WeaponDefinition';
import { bulletDamage, isArmored, type Armor } from './damage';
import { rayCapsule, raycastBody, STANDING_HITBOXES } from './hitboxes';
import { createTarget, resolveShot, TARGET_HEALTH, TARGET_RESPAWN_SECONDS, tickTargets, type TargetState } from './targets';

const u = (units: number): number => units * SOURCE_UNIT;
const NONE: Armor = { kevlar: 0, helmet: false };
const KEVLAR: Armor = { kevlar: 100, helmet: false };
const FULL: Armor = { kevlar: 100, helmet: true };

function normalize(v: Vec3): Vec3 {
  const length = Math.hypot(v.x, v.y, v.z);
  return { x: v.x / length, y: v.y / length, z: v.z / length };
}

/** A shot from `origin` towards `at`, stopped by `world` if given. */
function shotAt(origin: Vec3, at: Vec3, world?: CollisionWorld): Shot {
  const direction = normalize({ x: at.x - origin.x, y: at.y - origin.y, z: at.z - origin.z });
  return {
    tick: 0,
    origin,
    direction,
    aim: { yaw: 0, pitch: 0 },
    inaccuracy: 0,
    sprayIndex: 0,
    hit: world ? world.raycast(origin, direction, AK47.range) : null,
  };
}

describe('bullet damage (CS2 rules)', () => {
  it('matches the AK-47 reference values at point blank', () => {
    expect(bulletDamage(AK47, 0, 'chest', NONE)).toEqual({ health: 36, kevlar: 0 });
    expect(bulletDamage(AK47, 0, 'stomach', NONE).health).toBe(45);
    expect(bulletDamage(AK47, 0, 'arm', NONE).health).toBe(36);
    expect(bulletDamage(AK47, 0, 'leg', NONE).health).toBe(27);
    expect(bulletDamage(AK47, 0, 'head', NONE).health).toBe(144);
  });

  it('goes through armor at 77.5 % (armor ratio 1.55), costing kevlar', () => {
    expect(bulletDamage(AK47, 0, 'chest', KEVLAR)).toEqual({ health: 27, kevlar: 4 });
    expect(bulletDamage(AK47, 0, 'stomach', KEVLAR).health).toBe(34);
    expect(bulletDamage(AK47, 0, 'head', FULL).health).toBe(111); // still a one-tap
  });

  it('protects the head only with a helmet, and never the legs', () => {
    expect(bulletDamage(AK47, 0, 'head', KEVLAR).health).toBe(144);
    expect(bulletDamage(AK47, 0, 'leg', FULL)).toEqual({ health: 27, kevlar: 0 });
    expect(isArmored({ kevlar: 0, helmet: true }, 'head')).toBe(false);
  });

  it('lets through what depleted kevlar cannot absorb', () => {
    // Blocking 36 − 27.9 would cost 4.05 kevlar; only 2 are left, which absorb 4 damage.
    expect(bulletDamage(AK47, 0, 'chest', { kevlar: 2, helmet: false })).toEqual({ health: 32, kevlar: 2 });
  });

  it('applies range falloff first', () => {
    expect(bulletDamage(AK47, 10, 'chest', NONE).health).toBe(35);
    expect(bulletDamage(AK47, 10, 'head', FULL).health).toBe(109);
  });
});

describe('rayCapsule', () => {
  const capsule = { a: { x: 0, y: 0, z: 0 }, b: { x: 0, y: 2, z: 0 }, radius: 0.5 };
  const X = { x: 1, y: 0, z: 0 };

  it('hits the side, the end caps, and along the axis', () => {
    expect(rayCapsule({ x: -5, y: 1, z: 0 }, X, capsule)).toBeCloseTo(4.5, 12);
    expect(rayCapsule({ x: -5, y: 2.3, z: 0 }, X, capsule)).toBeCloseTo(5 - Math.sqrt(0.25 - 0.09), 12);
    expect(rayCapsule({ x: 0, y: 5, z: 0 }, { x: 0, y: -1, z: 0 }, capsule)).toBeCloseTo(2.5, 12);
    expect(rayCapsule({ x: 0, y: -3, z: 0 }, { x: 0, y: 1, z: 0 }, capsule)).toBeCloseTo(2.5, 12);
  });

  it('misses beside it, behind the ray, and from inside', () => {
    expect(rayCapsule({ x: -5, y: 1, z: 0.6 }, X, capsule)).toBeNull();
    expect(rayCapsule({ x: -5, y: 2.6, z: 0 }, X, capsule)).toBeNull();
    expect(rayCapsule({ x: 5, y: 1, z: 0 }, X, capsule)).toBeNull();
    expect(rayCapsule({ x: 0, y: 1, z: 0 }, X, capsule)).toBeNull();
  });
});

describe('body hitboxes', () => {
  // A body at the origin facing −Z; the shooter stands 10 m in front of it.
  const pose = { position: { x: 0, y: 0, z: 0 }, yaw: 0 };
  const groupAt = (x: number, y: number): string | undefined =>
    raycastBody({ x: u(x), y: u(y), z: -10 }, { x: 0, y: 0, z: 1 }, 100, pose)?.group;

  it('maps heights to hit groups like a CS player', () => {
    expect(groupAt(0, 66)).toBe('head');
    expect(groupAt(0, 52)).toBe('chest');
    expect(groupAt(0, 38)).toBe('stomach');
    expect(groupAt(0, 29)).toBe('stomach'); // pelvis
    expect(groupAt(4.3, 20)).toBe('leg');
    expect(groupAt(4.5, 6)).toBe('leg');
    expect(groupAt(13.6, 36)).toBe('arm');
  });

  it('has gaps where a body has none: above the head, beside it, between the calves', () => {
    expect(groupAt(0, 72.5)).toBeUndefined();
    expect(groupAt(6, 66)).toBeUndefined();
    expect(groupAt(0, 8)).toBeUndefined();
    expect(groupAt(17, 45)).toBeUndefined();
  });

  it('fits the player hull: 72 units tall, 32 wide', () => {
    for (const box of STANDING_HITBOXES) {
      for (const end of [box.a, box.b]) {
        expect(end.y + box.radius).toBeLessThanOrEqual(u(72));
        expect(end.y - box.radius).toBeGreaterThanOrEqual(0);
        expect(Math.abs(end.x) + box.radius).toBeLessThanOrEqual(u(16));
      }
    }
  });

  it('turns with the body and stops at the max distance', () => {
    const facingEast = { position: { x: 5, y: 0, z: 0 }, yaw: Math.PI / 2 };
    const hit = raycastBody({ x: 15, y: u(65), z: 0 }, { x: -1, y: 0, z: 0 }, 100, facingEast);
    expect(hit?.group).toBe('head');
    expect(hit?.distance).toBeCloseTo(10 - u(4.2), 9);
    // From its side (a body faces +X here, so its left arm is towards −Z).
    expect(raycastBody({ x: 5, y: u(36), z: -10 }, { x: 0, y: 0, z: 1 }, 100, facingEast)?.group).toBe('arm');
    expect(raycastBody({ x: 15, y: u(65), z: 0 }, { x: -1, y: 0, z: 0 }, 9, facingEast)).toBeNull();
  });
});

describe('training targets', () => {
  const spawn: TargetSpawn = { position: { x: 0, y: 0, z: 0 }, yaw: 0, kevlar: 100, helmet: true };
  const eye = { x: 0, y: DEFAULT_PLAYER_MOVEMENT.standingEyeHeight, z: -10 };
  const head = { x: 0, y: u(65), z: 0 };
  const chest = { x: 0, y: u(51), z: 0 };

  it('drops to an AK headshot through the helmet (one-tap)', () => {
    const { targets, outcome } = resolveShot([createTarget(spawn)], shotAt(eye, head), AK47);
    expect(outcome.target).toMatchObject({ target: 0, group: 'head', health: 0, killed: true });
    expect(outcome.target?.damage.health).toBe(109);
    expect(targets[0]).toMatchObject({ health: 0, downFor: TARGET_RESPAWN_SECONDS });
  });

  it('takes four armored body shots, losing kevlar on each', () => {
    let targets: readonly TargetState[] = [createTarget(spawn)];
    const healths: number[] = [];
    for (let i = 0; i < 4; i++) {
      ({ targets } = resolveShot(targets, shotAt(eye, chest), AK47));
      healths.push(targets[0]!.health);
    }
    expect(healths).toEqual([73, 46, 19, 0]);
    expect(targets[0]!.kevlar).toBe(100 - 4 * 3);
  });

  it('is shielded by a wall in front of it, and a knocked-down target is not hit', () => {
    const wall = new CollisionWorld([aabb(-5, 0, -3, 5, 3, -2.5)]);
    expect(resolveShot([createTarget(spawn)], shotAt(eye, chest, wall), AK47).outcome.target).toBeNull();

    const down = resolveShot([createTarget(spawn)], shotAt(eye, head), AK47).targets;
    expect(resolveShot(down, shotAt(eye, chest), AK47).outcome.target).toBeNull();
  });

  it('hits the nearest of two targets in line', () => {
    const behind: TargetSpawn = { ...spawn, position: { x: 0, y: 0, z: 3 } };
    const { outcome } = resolveShot([createTarget(behind), createTarget(spawn)], shotAt(eye, chest), AK47);
    expect(outcome.target?.target).toBe(1);
  });

  it('stands up again after 2 s with full health and armor', () => {
    let targets = resolveShot([createTarget(spawn)], shotAt(eye, head), AK47).targets;
    const tick = 1 / 64;
    for (let i = 0; i < 127; i++) targets = tickTargets(targets, tick);
    expect(targets[0]!.health).toBe(0);
    targets = tickTargets(targets, tick);
    expect(targets[0]).toEqual(createTarget(spawn));
    expect(targets[0]!.health).toBe(TARGET_HEALTH);
  });

  it('on the graybox arena, every target can be shot from the range spawn (head and chest)', () => {
    const world = CollisionWorld.fromMap(GRAYBOX_ARENA);
    const range = GRAYBOX_ARENA.spawnPoints[0]!;
    const from = { ...range.position, y: range.position.y + DEFAULT_PLAYER_MOVEMENT.standingEyeHeight };
    const all = (GRAYBOX_ARENA.targets ?? []).map(createTarget);
    expect(all).toHaveLength(4);
    all.forEach((target, index) => {
      const { x, z } = target.spawn.position;
      for (const [height, group] of [[65, 'head'], [51, 'chest']] as const) {
        const { outcome } = resolveShot(all, shotAt(from, { x, y: u(height), z }, world), AK47);
        expect(outcome.target, `target ${index} ${group}`).toMatchObject({ target: index, group });
      }
    });
  });
});
