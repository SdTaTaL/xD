import type { Vec3 } from '../math/Vec3';
import type { Axis } from '../physics/Aabb';
import type { CollisionWorld } from '../physics/CollisionWorld';
import { playerHull } from './PlayerState';

/**
 * Mutable body used while resolving one tick of movement. The hull is always
 * rebuilt from the position, and the position only ever changes by the
 * distances the collision queries allow, so a player at rest never drifts.
 */
export class Body {
  x: number;
  y: number;
  z: number;
  height: number;
  readonly radius: number;

  constructor(position: Vec3, height: number, radius: number) {
    this.x = position.x;
    this.y = position.y;
    this.z = position.z;
    this.height = height;
    this.radius = radius;
  }

  get position(): Vec3 {
    return { x: this.x, y: this.y, z: this.z };
  }

  clone(): Body {
    return new Body(this.position, this.height, this.radius);
  }

  hull() {
    return playerHull(this, this.height, this.radius);
  }

  fits(world: CollisionWorld): boolean {
    return !world.overlaps(this.hull());
  }

  /** Moves along one axis as far as the world allows. Returns the distance actually moved. */
  sweep(world: CollisionWorld, axis: Axis, delta: number): number {
    const allowed = world.sweep(this.hull(), axis, delta);
    if (axis === 0) this.x += allowed;
    else if (axis === 1) this.y += allowed;
    else this.z += allowed;
    return allowed;
  }
}

export interface HorizontalMove {
  readonly blockedX: boolean;
  readonly blockedZ: boolean;
}

/**
 * Collide-and-slide in the horizontal plane: each axis is swept separately,
 * so the component along a wall is kept (sliding) and only the blocked one is
 * stopped. The larger component goes first, which makes sliding around
 * corners follow the dominant direction.
 */
function slide(world: CollisionWorld, body: Body, dx: number, dz: number): HorizontalMove {
  let blockedX = false;
  let blockedZ = false;
  const moveX = (): void => {
    blockedX = body.sweep(world, 0, dx) !== dx;
  };
  const moveZ = (): void => {
    blockedZ = body.sweep(world, 2, dz) !== dz;
  };

  if (Math.abs(dx) >= Math.abs(dz)) {
    moveX();
    moveZ();
  } else {
    moveZ();
    moveX();
  }
  return { blockedX, blockedZ };
}

function planarDistanceSquared(from: Body, to: Body): number {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  return dx * dx + dz * dz;
}

/**
 * Horizontal movement with step climbing. When grounded movement is blocked,
 * the move is retried lifted by up to `stepHeight` and then lowered back onto
 * whatever is below; the lifted attempt wins only if it gets further. Walls
 * taller than a step still block, so nothing can be climbed by walking.
 */
export function moveHorizontal(
  world: CollisionWorld,
  body: Body,
  dx: number,
  dz: number,
  canStep: boolean,
  stepHeight: number,
): HorizontalMove {
  if (dx === 0 && dz === 0) return { blockedX: false, blockedZ: false };

  const start = body.clone();
  const direct = slide(world, body, dx, dz);
  if (!canStep || stepHeight <= 0 || !(direct.blockedX || direct.blockedZ)) return direct;

  const stepped = start.clone();
  const lift = stepped.sweep(world, 1, stepHeight);
  if (lift <= 0) return direct;
  const steppedMove = slide(world, stepped, dx, dz);
  stepped.sweep(world, 1, -lift);

  if (planarDistanceSquared(start, stepped) <= planarDistanceSquared(start, body)) return direct;

  body.x = stepped.x;
  body.y = stepped.y;
  body.z = stepped.z;
  return steppedMove;
}

/**
 * Distance from the hull's bottom down to the nearest surface, if one is
 * within `reach`; otherwise `Infinity`.
 */
export function groundDistance(world: CollisionWorld, body: Body, reach: number): number {
  const allowed = world.sweep(body.hull(), 1, -reach);
  return allowed > -reach ? -allowed : Infinity;
}
