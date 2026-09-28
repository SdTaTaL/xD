/** Coordinate axis index: 0 = x, 1 = y (up), 2 = z. */
export type Axis = 0 | 1 | 2;

export type Vector3Tuple = readonly [number, number, number];

/** Axis-aligned bounding box, world space, meters. */
export interface Aabb {
  readonly min: Vector3Tuple;
  readonly max: Vector3Tuple;
}

/**
 * Tolerance for contact tests, in meters. Boxes that touch or overlap by less
 * than this are "in contact", not intersecting, so resting on a floor or
 * sliding along a wall never counts as a collision and seams between
 * adjacent boxes cannot snag.
 */
export const CONTACT_EPSILON = 1e-6;

export function aabb(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): Aabb {
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}

export function translateAabb(box: Aabb, axis: Axis, distance: number): Aabb {
  if (distance === 0) return box;
  const min: [number, number, number] = [box.min[0], box.min[1], box.min[2]];
  const max: [number, number, number] = [box.max[0], box.max[1], box.max[2]];
  min[axis] += distance;
  max[axis] += distance;
  return { min, max };
}

/** Overlap on one axis by more than the contact tolerance. */
export function overlapsOnAxis(a: Aabb, b: Aabb, axis: Axis): boolean {
  return a.min[axis] < b.max[axis] - CONTACT_EPSILON && a.max[axis] > b.min[axis] + CONTACT_EPSILON;
}

/** True when the boxes intersect by more than the contact tolerance on every axis. */
export function intersects(a: Aabb, b: Aabb): boolean {
  return overlapsOnAxis(a, b, 0) && overlapsOnAxis(a, b, 1) && overlapsOnAxis(a, b, 2);
}
