import type { MapDefinition } from '../maps/MapDefinition';
import type { Vec3 } from '../math/Vec3';
import { aabb, CONTACT_EPSILON, intersects, overlapsOnAxis, translateAabb, type Aabb, type Axis, type Vector3Tuple } from './Aabb';

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

const AXES: readonly Axis[] = [0, 1, 2];

/** First surface hit by a ray. */
export interface RayHit {
  /** Distance along the ray, meters. */
  readonly distance: number;
  readonly point: Vec3;
  /** Outward normal of the face that was hit (axis-aligned, unit length). */
  readonly normal: Vec3;
  /** Index of the solid in {@link CollisionWorld.solids}. */
  readonly solid: number;
}

/** Entry distance and entry axis of a ray into one box, or null when it misses. */
function rayEntry(origin: Vector3Tuple, direction: Vector3Tuple, box: Aabb, maxDistance: number): { distance: number; axis: Axis } | null {
  let near = -Infinity;
  let far = Infinity;
  let nearAxis: Axis = 0;

  for (const axis of AXES) {
    const o = origin[axis];
    const d = direction[axis];
    const min = box.min[axis];
    const max = box.max[axis];

    if (d === 0) {
      // Parallel to this slab: inside it or never. Grazing a face is not a hit.
      if (o <= min || o >= max) return null;
      continue;
    }

    const t1 = (min - o) / d;
    const t2 = (max - o) / d;
    const enter = t1 < t2 ? t1 : t2;
    const exit = t1 < t2 ? t2 : t1;
    if (enter > near) {
      near = enter;
      nearAxis = axis;
    }
    if (exit < far) far = exit;
    if (near >= far) return null;
  }

  // Boxes containing the origin are ignored, like embedded boxes in sweep().
  if (near < 0 || near > maxDistance) return null;
  return { distance: near, axis: nearAxis };
}

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
   * First solid surface along a ray, within `maxDistance`. Exact (slab test
   * against every box) and deterministic: on equal distances the solid listed
   * first wins. Solids that contain the origin are ignored, and a ray that
   * only grazes a face does not hit it.
   *
   * @param direction unit vector
   */
  raycast(origin: Vec3, direction: Vec3, maxDistance: number): RayHit | null {
    const o: Vector3Tuple = [origin.x, origin.y, origin.z];
    const d: Vector3Tuple = [direction.x, direction.y, direction.z];
    let distance = maxDistance;
    let axis: Axis = 0;
    let hit: Aabb | null = null;
    let hitIndex = -1;

    for (let index = 0; index < this.solids.length; index++) {
      const solid = this.solids[index] as Aabb;
      const entry = rayEntry(o, d, solid, distance);
      if (entry && (hit === null || entry.distance < distance)) {
        distance = entry.distance;
        axis = entry.axis;
        hit = solid;
        hitIndex = index;
      }
    }
    if (hit === null) return null;

    const normal: [number, number, number] = [0, 0, 0];
    normal[axis] = d[axis] > 0 ? -1 : 1;
    const point: [number, number, number] = [o[0] + d[0] * distance, o[1] + d[1] * distance, o[2] + d[2] * distance];
    // Put the hit coordinate exactly on the face (no rounding drift off the surface).
    point[axis] = normal[axis] < 0 ? hit.min[axis] : hit.max[axis];

    return {
      distance,
      point: { x: point[0], y: point[1], z: point[2] },
      normal: { x: normal[0], y: normal[1], z: normal[2] },
      solid: hitIndex,
    };
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
