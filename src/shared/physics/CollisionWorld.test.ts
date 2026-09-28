import { describe, expect, it } from 'vitest';
import { GRAYBOX_ARENA } from '../maps/grayboxArena';
import { aabb, translateAabb } from './Aabb';
import { CollisionWorld } from './CollisionWorld';

const unit = aabb(0, 0, 0, 1, 1, 1);

describe('CollisionWorld.sweep', () => {
  const world = new CollisionWorld([aabb(3, 0, 0, 4, 1, 1), aabb(-4, 0, 0, -3, 1, 1), aabb(0, 3, 0, 1, 4, 1), aabb(0, -3, 0, 1, -2, 1)]);

  it('stops exactly at the first face in each direction', () => {
    expect(world.sweep(unit, 0, 10)).toBe(2);
    expect(world.sweep(unit, 0, -10)).toBe(-3);
    expect(world.sweep(unit, 1, 10)).toBe(2);
    expect(world.sweep(unit, 1, -10)).toBe(-2);
    expect(world.sweep(unit, 2, 10)).toBe(10);
  });

  it('returns the full distance when nothing is in the way', () => {
    expect(world.sweep(unit, 0, 1.5)).toBe(1.5);
    expect(world.sweep(unit, 2, -7)).toBe(-7);
  });

  it('never tunnels, whatever the distance', () => {
    const thin = new CollisionWorld([aabb(5, 0, 0, 5.001, 1, 1)]);
    expect(thin.sweep(unit, 0, 1e6)).toBe(4);
  });

  it('does not block movement along a surface it merely touches', () => {
    const floor = new CollisionWorld([aabb(-10, -1, -10, 0, 0, 10), aabb(0, -1, -10, 10, 0, 10)]);
    const resting = aabb(-0.5, 0, -0.5, 0.5, 1, 0.5);
    expect(floor.sweep(resting, 0, 5)).toBe(5); // across the seam between the two floor boxes
    expect(floor.sweep(resting, 1, -1)).toBe(0); // but cannot sink
  });

  it('ignores solids the box already intersects, so it can move out', () => {
    const inside = new CollisionWorld([aabb(-1, -1, -1, 2, 2, 2)]);
    expect(inside.sweep(unit, 0, 3)).toBe(3);
  });
});

describe('CollisionWorld overlap and penetration', () => {
  const world = new CollisionWorld([aabb(0, 0, 0, 2, 2, 2)]);

  it('treats touching as free and intersecting as overlapping', () => {
    expect(world.overlaps(aabb(2, 0, 0, 3, 1, 1))).toBe(false);
    expect(world.overlaps(aabb(1.9, 0, 0, 3, 1, 1))).toBe(true);
  });

  it('pushes an embedded box out along the shallowest axis', () => {
    const embedded = aabb(1.8, 0.5, 0.5, 2.8, 1.5, 1.5);
    const push = world.resolvePenetration(embedded);
    expect(push).toEqual({ x: expect.closeTo(0.2, 12), y: 0, z: 0 });
    expect(world.overlaps(translateAabb(embedded, 0, push.x))).toBe(false);
  });

  it('leaves free boxes alone', () => {
    expect(world.resolvePenetration(aabb(5, 5, 5, 6, 6, 6))).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('builds one solid per map box', () => {
    const map = CollisionWorld.fromMap(GRAYBOX_ARENA);
    expect(map.solids).toHaveLength(GRAYBOX_ARENA.solids.length);
    // The floor top is the y = 0 plane.
    expect(map.solids[0]?.max[1]).toBe(0);
  });
});
