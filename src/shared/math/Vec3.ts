/**
 * Plain immutable 3D vector used by shared (engine-agnostic) code.
 *
 * Shared code must not depend on Three.js so it can run unchanged on a
 * headless server. The client converts to Three.js types at its boundary.
 */
export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export function vec3(x: number, y: number, z: number): Vec3 {
  return { x, y, z };
}
