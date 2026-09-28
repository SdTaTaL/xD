import type { Vec3 } from '../math/Vec3';

/**
 * Level-design role of a solid. Drives graybox colour coding; it carries no
 * physical meaning (every solid is fully solid).
 */
export type SolidKind = 'floor' | 'wall' | 'cover';

/** Axis-aligned solid box. World space, meters, Y-up. */
export interface MapSolid {
  readonly kind: SolidKind;
  /** Center of the box. */
  readonly center: Vec3;
  /** Full extents along each axis. */
  readonly size: Vec3;
}

/**
 * Pure-data description of a map's static geometry.
 *
 * Kept free of rendering concerns so the same definition can later feed
 * client rendering, collision and the authoritative server.
 */
export interface MapDefinition {
  readonly id: string;
  readonly name: string;
  readonly solids: readonly MapSolid[];
}

export interface Bounds3 {
  readonly min: Vec3;
  readonly max: Vec3;
}

/** Axis-aligned bounds enclosing every solid of the map. */
export function getMapBounds(map: MapDefinition): Bounds3 {
  if (map.solids.length === 0) {
    throw new Error(`Map "${map.id}" has no solids`);
  }

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  for (const { center, size } of map.solids) {
    minX = Math.min(minX, center.x - size.x / 2);
    minY = Math.min(minY, center.y - size.y / 2);
    minZ = Math.min(minZ, center.z - size.z / 2);
    maxX = Math.max(maxX, center.x + size.x / 2);
    maxY = Math.max(maxY, center.y + size.y / 2);
    maxZ = Math.max(maxZ, center.z + size.z / 2);
  }

  return {
    min: { x: minX, y: minY, z: minZ },
    max: { x: maxX, y: maxY, z: maxZ },
  };
}
