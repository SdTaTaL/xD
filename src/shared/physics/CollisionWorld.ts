import type { MapDefinition } from '../maps/MapDefinition';
import type { Vec3 } from '../math/Vec3';
import { aabb, CONTACT_EPSILON, intersects, overlapsOnAxis, translateAabb, type Aabb, type Axis } from './Aabb';

const OTHER_AXES: Readonly<Record<Axis, readonly [Axis, Axis]>> = { 0: [1, 2], 1: [0, 2], 2: [0, 1] };

/** Order in which push-out directions are preferred on ties: up first, then the horizontal axes. */
const PUSH_ORDER: readonly (readonly [Axis, 1 | -1])[] = [
  [1, 1],
  [0, -1],
  [0, 1],
  [2, -1],
  [2, 1],
  [1, -1],
];

const MAX_DEPENETRATION_PASSES = 8;

/**
 * Static collision geometry made of axis-aligned boxes.
 *
 * Queries are exact and deterministic: movement is swept one axis at a time
 * against every solid, so nothing can tunnel through geometry at any speed,
 * and iteration order is fixed. A linear scan is ample for graybox maps;
 * a broadphase (grid/BVH) can be added behind the same API when maps grow.
 */
export class CollisionWorld {
  readonly solids: readonly Aabb[];

  constructor(solids: readonly Aabb[]) {
    this.solids = solids;
  }

  static fromMap(map: MapDefinition): CollisionWorld {
    return new CollisionWorld(
      map.solids.map(({ center, size }) =>
        aabb(
          center.x - size.x / 2,
          center.y - size.y / 2,
          center.z - size.z / 2,
          center.x + size.x / 2,
          center.y + size.y / 2,
          center.z + size.z / 2,
        ),
      ),
    );
  }

  /** True when `box` intersects any solid (touching is not intersecting). */
  overlaps(box: Aabb): boolean {
    for (const solid of this.solids) {
      if (intersects(box, solid)) return true;
    }
    return false;
  }

  /**
   * How far `box` can move along `axis` towards `delta` before touching a
   * solid. Returns a value between 0 and `delta` (same sign). Solids the box
   * already intersects are ignored so an embedded box can still move out.
   */
  sweep(box: Aabb, axis: Axis, delta: number): number {
    if (delta === 0) return 0;
    const [a, b] = OTHER_AXES[axis];
    let allowed = delta;

    for (const solid of this.solids) {
      if (!overlapsOnAxis(box, solid, a) || !overlapsOnAxis(box, solid, b)) continue;

      if (delta > 0) {
        const gap = solid.min[axis] - box.max[axis];
        if (gap >= -CONTACT_EPSILON && gap < allowed) allowed = Math.max(gap, 0);
      } else {
        const gap = solid.max[axis] - box.min[axis];
        if (gap <= CONTACT_EPSILON && gap > allowed) allowed = Math.min(gap, 0);
      }
    }

    return allowed;
  }

  /**
   * Smallest translation that moves `box` out of every solid it intersects,
   * resolving one solid at a time along its shallowest axis. Returns the
   * translation (all zeros when the box is already free).
   */
  resolvePenetration(box: Aabb): Vec3 {
    let current = box;
    const total: [number, number, number] = [0, 0, 0];

    for (let pass = 0; pass < MAX_DEPENETRATION_PASSES; pass++) {
      const solid = this.solids.find((candidate) => intersects(current, candidate));
      if (!solid) break;

      let bestAxis: Axis = 1;
      let bestDistance = Infinity;
      for (const [axis, direction] of PUSH_ORDER) {
        const distance = direction > 0 ? solid.max[axis] - current.min[axis] : solid.min[axis] - current.max[axis];
        if (Math.abs(distance) < Math.abs(bestDistance)) {
          bestAxis = axis;
          bestDistance = distance;
        }
      }

      current = translateAabb(current, bestAxis, bestDistance);
      total[bestAxis] += bestDistance;
    }

    return { x: total[0], y: total[1], z: total[2] };
  }
}
