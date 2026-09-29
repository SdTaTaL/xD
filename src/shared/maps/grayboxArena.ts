import type { MapDefinition, MapSolid, SolidKind } from './MapDefinition';

/**
 * Graybox arena: a 48 m × 48 m symmetric arena plus a movement lab.
 *
 * The arena itself is point-symmetric around the origin (a 180° rotation maps
 * one half onto the other) so both sides are equivalent. East of it, through
 * a door, is the movement lab: a development-only annex with calibrated
 * obstacles for testing the player controller. It breaks the symmetry on
 * purpose and will move to a dedicated test map once one exists.
 */

const HALF_EXTENT = 24;
const WALL_THICKNESS = 1;
const WALL_HEIGHT = 6;
const FLOOR_THICKNESS = 0.5;
const OUTER_SIZE = HALF_EXTENT * 2 + WALL_THICKNESS * 2;
const WALL_OFFSET = HALF_EXTENT + WALL_THICKNESS / 2;

/** Opening in the east wall towards the movement lab. */
const DOOR_HALF_WIDTH = 1.5;
const DOOR_HEIGHT = 2.4;

/** Box resting on the ground plane (y = 0). */
function grounded(kind: SolidKind, x: number, z: number, width: number, height: number, depth: number): MapSolid {
  return {
    kind,
    center: { x, y: height / 2, z },
    size: { x: width, y: height, z: depth },
  };
}

/** Box given by its min/max corners. */
function box(kind: SolidKind, minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): MapSolid {
  return {
    kind,
    center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2, z: (minZ + maxZ) / 2 },
    size: { x: maxX - minX, y: maxY - minY, z: maxZ - minZ },
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

const ARENA: readonly MapSolid[] = [
  // Ground slab; its top face is the y = 0 plane.
  {
    kind: 'floor',
    center: { x: 0, y: -FLOOR_THICKNESS / 2, z: 0 },
    size: { x: OUTER_SIZE, y: FLOOR_THICKNESS, z: OUTER_SIZE },
  },

  // Perimeter walls (the east wall has the door to the movement lab).
  grounded('wall', 0, -WALL_OFFSET, OUTER_SIZE, WALL_HEIGHT, WALL_THICKNESS),
  grounded('wall', 0, WALL_OFFSET, OUTER_SIZE, WALL_HEIGHT, WALL_THICKNESS),
  grounded('wall', -WALL_OFFSET, 0, WALL_THICKNESS, WALL_HEIGHT, HALF_EXTENT * 2),
  box('wall', HALF_EXTENT, 0, -HALF_EXTENT, HALF_EXTENT + WALL_THICKNESS, WALL_HEIGHT, -DOOR_HALF_WIDTH),
  box('wall', HALF_EXTENT, 0, DOOR_HALF_WIDTH, HALF_EXTENT + WALL_THICKNESS, WALL_HEIGHT, HALF_EXTENT),
  box('wall', HALF_EXTENT, DOOR_HEIGHT, -DOOR_HALF_WIDTH, HALF_EXTENT + WALL_THICKNESS, WALL_HEIGHT, DOOR_HALF_WIDTH),

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
];

/** Movement lab interior: x ∈ [25, 49], z ∈ [-12, 12]. */
const LAB_MIN_X = HALF_EXTENT + WALL_THICKNESS;
const LAB_MAX_X = 49;
const LAB_HALF_DEPTH = 12;
const LAB_WALL_HEIGHT = 4;

/** A Counter-Strike crate: 64 units. */
const CRATE_HEIGHT = 64 * 0.0254;

/** Stairs: six 0.25 m risers with 0.6 m treads, up to a 1.5 m platform. */
const STAIR_START_X = 38.4;
const STAIR_RISE = 0.25;
const STAIR_TREAD = 0.6;
const STAIR_COUNT = 6;

const MOVEMENT_LAB: readonly MapSolid[] = [
  box('floor', LAB_MIN_X, -FLOOR_THICKNESS, -LAB_HALF_DEPTH - 1, LAB_MAX_X + 1, 0, LAB_HALF_DEPTH + 1),
  box('wall', LAB_MIN_X, 0, -LAB_HALF_DEPTH - 1, LAB_MAX_X + 1, LAB_WALL_HEIGHT, -LAB_HALF_DEPTH),
  box('wall', LAB_MIN_X, 0, LAB_HALF_DEPTH, LAB_MAX_X + 1, LAB_WALL_HEIGHT, LAB_HALF_DEPTH + 1),
  box('wall', LAB_MAX_X, 0, -LAB_HALF_DEPTH, LAB_MAX_X + 1, LAB_WALL_HEIGHT, LAB_HALF_DEPTH),

  // Obstacle row (north), calibrated for CS2 movement: 0.2 and 0.45 m are
  // climbed by walking (step 18 u = 0.457 m), 0.6 and 1.2 m need a jump
  // (57 u = 1.448 m), a 64-unit crate (1.63 m) needs a crouch-jump, 2.1 m
  // cannot be reached from the floor.
  box('cover', 28, 0, -10, 30, 0.2, -7),
  box('cover', 31.5, 0, -10, 33.5, 0.45, -7),
  box('cover', 35, 0, -10, 37, 0.6, -7),
  box('cover', 38.5, 0, -10, 40.5, 1.2, -7),
  box('cover', 42, 0, -10, 44, CRATE_HEIGHT, -7),
  box('cover', 45.5, 0, -10, 47.5, 2.1, -7),

  // Canopy with its underside at 2.2 m: a standing player (1.83 m) fits, a jump bumps the head.
  box('wall', 30, 2.2, -4.5, 33, 2.4, -2.5),

  // Stairs up to a 1.5 m platform against the east wall (drop off its sides to test landings).
  ...Array.from({ length: STAIR_COUNT }, (_, i) =>
    box('cover', STAIR_START_X + i * STAIR_TREAD, 0, -1.5, STAIR_START_X + (i + 1) * STAIR_TREAD, (i + 1) * STAIR_RISE, 1.5),
  ),
  box('cover', STAIR_START_X + STAIR_COUNT * STAIR_TREAD, 0, -3, LAB_MAX_X, STAIR_COUNT * STAIR_RISE, 3),

  // Corridor, 1.2 m wide.
  box('wall', 28, 0, 4.6, 35, 3, 5),
  box('wall', 28, 0, 6.2, 35, 3, 6.6),

  // Tunnel with a 1.5 m ceiling: crouched (1.37 m) to enter, standing up inside is refused.
  box('wall', 38, 0, 4.6, 44, 1.8, 5),
  box('wall', 38, 0, 7, 44, 1.8, 7.4),
  box('wall', 38, 1.5, 4.6, 44, 1.8, 7.4),

  // Gaps: 0.85 m lets the 0.81 m hull through, 0.75 m does not.
  box('cover', 27, 0, 8.5, 29.2, 2, 10.5),
  box('cover', 30.05, 0, 8.5, 32, 2, 10.5),
  box('cover', 33, 0, 8.5, 35.1, 2, 10.5),
  box('cover', 35.85, 0, 8.5, 38, 2, 10.5),
];

export const GRAYBOX_ARENA: MapDefinition = {
  id: 'graybox_arena',
  name: 'Graybox Arena',
  solids: [...ARENA, ...MOVEMENT_LAB],
  spawnPoints: [
    // Movement lab entrance, facing into the lab (+X).
    { position: { x: 26.5, y: 0, z: 0 }, yaw: Math.PI / 2 },
    // Arena bases, facing the center.
    { position: { x: 0, y: 0, z: 21 }, yaw: 0 },
    { position: { x: 0, y: 0, z: -21 }, yaw: -Math.PI },
  ],
};
