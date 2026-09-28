import type { MapDefinition, MapSolid, SolidKind } from './MapDefinition';

/**
 * Small symmetric graybox arena (48 m × 48 m playable area).
 *
 * Layout is point-symmetric around the origin (a 180° rotation maps one half
 * onto the other) so both sides of the map are equivalent.
 */

const HALF_EXTENT = 24;
const WALL_THICKNESS = 1;
const WALL_HEIGHT = 6;
const FLOOR_THICKNESS = 0.5;
const OUTER_SIZE = HALF_EXTENT * 2 + WALL_THICKNESS * 2;
const WALL_OFFSET = HALF_EXTENT + WALL_THICKNESS / 2;

/** Box resting on the ground plane (y = 0). */
function grounded(kind: SolidKind, x: number, z: number, width: number, height: number, depth: number): MapSolid {
  return {
    kind,
    center: { x, y: height / 2, z },
    size: { x: width, y: height, z: depth },
  };
}

/** Box resting on top of another box. */
function stackedOn(base: MapSolid, width: number, height: number, depth: number): MapSolid {
  return {
    kind: base.kind,
    center: { x: base.center.x, y: base.center.y + base.size.y / 2 + height / 2, z: base.center.z },
    size: { x: width, y: height, z: depth },
  };
}

/** The solid plus its 180° rotation around the vertical axis through the origin. */
function withCounterpart(solid: MapSolid): MapSolid[] {
  const { center } = solid;
  return [solid, { ...solid, center: { x: -center.x, y: center.y, z: -center.z } }];
}

const stackBase = grounded('cover', -17, 9, 1.6, 1.6, 1.6);

export const GRAYBOX_ARENA: MapDefinition = {
  id: 'graybox_arena',
  name: 'Graybox Arena',
  solids: [
    // Ground slab; its top face is the y = 0 plane.
    {
      kind: 'floor',
      center: { x: 0, y: -FLOOR_THICKNESS / 2, z: 0 },
      size: { x: OUTER_SIZE, y: FLOOR_THICKNESS, z: OUTER_SIZE },
    },

    // Perimeter walls.
    grounded('wall', 0, -WALL_OFFSET, OUTER_SIZE, WALL_HEIGHT, WALL_THICKNESS),
    grounded('wall', 0, WALL_OFFSET, OUTER_SIZE, WALL_HEIGHT, WALL_THICKNESS),
    grounded('wall', -WALL_OFFSET, 0, WALL_THICKNESS, WALL_HEIGHT, HALF_EXTENT * 2),
    grounded('wall', WALL_OFFSET, 0, WALL_THICKNESS, WALL_HEIGHT, HALF_EXTENT * 2),

    // Mid block: breaks the long sightline through the center.
    grounded('wall', 0, 0, 4, 3, 4),

    // Lane dividers.
    ...withCounterpart(grounded('wall', -10, -4, 1, 3, 12)),

    // Pillars near the corners.
    ...withCounterpart(grounded('wall', 16, 16, 1.5, 4.5, 1.5)),
    ...withCounterpart(grounded('wall', -16, 16, 1.5, 4.5, 1.5)),

    // Crouch-height cover in front of mid.
    ...withCounterpart(grounded('cover', 0, 7, 6, 1.1, 0.6)),

    // Standing-height cover in front of each base.
    ...withCounterpart(grounded('cover', 0, 19, 8, 1.6, 0.8)),

    // Crates.
    ...withCounterpart(grounded('cover', -5, 13, 1.2, 1.2, 1.2)),
    ...withCounterpart(grounded('cover', 7, 11, 1.2, 1.2, 1.2)),
    ...withCounterpart(stackBase),
    ...withCounterpart(stackedOn(stackBase, 1, 1, 1)),
  ],
};
