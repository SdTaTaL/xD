import { sinCos } from '../math/deterministicTrig';
import type { Vec3 } from '../math/Vec3';
import { SOURCE_UNIT } from '../player/PlayerMovementConfig';
import type { HitGroup } from './damage';

/** A segment with a radius: every point within `radius` of the segment a–b. */
export interface Capsule {
  readonly a: Vec3;
  readonly b: Vec3;
  readonly radius: number;
}

export interface Hitbox extends Capsule {
  readonly name: string;
  readonly group: HitGroup;
}

/** Where a body stands: feet position and facing (yaw 0 faces −Z, like the player). */
export interface BodyPose {
  readonly position: Vec3;
  readonly yaw: number;
}

export interface BodyHit {
  /** Distance along the ray, meters. */
  readonly distance: number;
  readonly group: HitGroup;
  /** Index into the hitbox list. */
  readonly hitbox: number;
}

/** Capsule from Source units (x right, y up, z back; feet at the origin) to meters. */
function capsule(name: string, group: HitGroup, a: readonly [number, number, number], b: readonly [number, number, number], radius: number): Hitbox {
  const m = (v: readonly [number, number, number]): Vec3 => Object.freeze({ x: v[0] * SOURCE_UNIT, y: v[1] * SOURCE_UNIT, z: v[2] * SOURCE_UNIT });
  return Object.freeze({ name, group, a: m(a), b: m(b), radius: radius * SOURCE_UNIT });
}

/**
 * Hitboxes of a standing body sized like a Counter-Strike player (72 units
 * tall, 32 wide, eyes at 64), arms down: head, chest, stomach (with the
 * pelvis), upper and lower arms, thighs and calves. Body space: feet at the
 * origin, facing −Z, +X to the body's right.
 *
 * CS2's real hitboxes follow the animated skeleton; these are our own
 * proportions for a neutral pose.
 */
export const STANDING_HITBOXES: readonly Hitbox[] = Object.freeze([
  capsule('head', 'head', [0, 63, 0], [0, 67.5, 0], 4.2),
  capsule('chest', 'chest', [-5, 51, 0], [5, 51, 0], 6.5),
  capsule('stomach', 'stomach', [-3.5, 38, 0], [3.5, 38, 0], 6.5),
  capsule('pelvis', 'stomach', [-4, 29.5, 0], [4, 29.5, 0], 5.5),
  capsule('upper arm left', 'arm', [-12, 55, 0], [-13, 42, 0], 3),
  capsule('upper arm right', 'arm', [12, 55, 0], [13, 42, 0], 3),
  capsule('forearm left', 'arm', [-13, 42, 0], [-12.8, 30, 0], 2.6),
  capsule('forearm right', 'arm', [13, 42, 0], [12.8, 30, 0], 2.6),
  capsule('thigh left', 'leg', [-4.2, 27, 0], [-4.5, 15, 0], 3.9),
  capsule('thigh right', 'leg', [4.2, 27, 0], [4.5, 15, 0], 3.9),
  capsule('calf left', 'leg', [-4.5, 15, 0], [-4.5, 3.4, 0], 3.2),
  capsule('calf right', 'leg', [4.5, 15, 0], [4.5, 3.4, 0], 3.2),
]);

function dot(ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
  return ax * bx + ay * by + az * bz;
}

/** Entry distance of a ray into a sphere, or null. */
function raySphere(origin: Vec3, direction: Vec3, center: Vec3, radius: number): number | null {
  const ox = origin.x - center.x;
  const oy = origin.y - center.y;
  const oz = origin.z - center.z;
  const b = dot(ox, oy, oz, direction.x, direction.y, direction.z);
  const c = dot(ox, oy, oz, ox, oy, oz) - radius * radius;
  const h = b * b - c;
  if (h < 0) return null;
  const t = -b - Math.sqrt(h);
  return t >= 0 ? t : null;
}

/** Squared distance from a point to the segment a–b. */
function segmentDistanceSq(point: Vec3, a: Vec3, b: Vec3): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abz = b.z - a.z;
  const apx = point.x - a.x;
  const apy = point.y - a.y;
  const apz = point.z - a.z;
  const length = dot(abx, aby, abz, abx, aby, abz);
  const t = length > 0 ? Math.min(1, Math.max(0, dot(apx, apy, apz, abx, aby, abz) / length)) : 0;
  const dx = apx - abx * t;
  const dy = apy - aby * t;
  const dz = apz - abz * t;
  return dot(dx, dy, dz, dx, dy, dz);
}

/**
 * Distance along a ray (unit `direction`) to where it enters the capsule, or
 * null when it misses. The capsule is a cylinder plus two end spheres; the
 * entry is the nearest entry into any of them. A ray starting inside the
 * capsule does not hit it. Only + − × ÷ and √: deterministic everywhere.
 */
export function rayCapsule(origin: Vec3, direction: Vec3, capsule: Capsule): number | null {
  const { a, b, radius } = capsule;
  if (segmentDistanceSq(origin, a, b) <= radius * radius) return null;

  let nearest = Infinity;

  // Cylinder side, clipped to the segment.
  const bax = b.x - a.x;
  const bay = b.y - a.y;
  const baz = b.z - a.z;
  const oax = origin.x - a.x;
  const oay = origin.y - a.y;
  const oaz = origin.z - a.z;
  const baba = dot(bax, bay, baz, bax, bay, baz);
  const bard = dot(bax, bay, baz, direction.x, direction.y, direction.z);
  const baoa = dot(bax, bay, baz, oax, oay, oaz);
  const rdoa = dot(direction.x, direction.y, direction.z, oax, oay, oaz);
  const oaoa = dot(oax, oay, oaz, oax, oay, oaz);
  const k2 = baba - bard * bard;
  if (k2 > 1e-12 * baba) {
    const k1 = baba * rdoa - baoa * bard;
    const k0 = baba * oaoa - baoa * baoa - radius * radius * baba;
    const h = k1 * k1 - k2 * k0;
    if (h < 0) return null; // misses the infinite cylinder, so the end spheres too
    const t = (-k1 - Math.sqrt(h)) / k2;
    const along = baoa + t * bard;
    if (t >= 0 && along >= 0 && along <= baba) nearest = t;
  }

  // End spheres.
  for (const center of [a, b]) {
    const t = raySphere(origin, direction, center, radius);
    if (t !== null && t < nearest) nearest = t;
  }
  return nearest === Infinity ? null : nearest;
}

/**
 * Nearest hitbox of a body hit by a ray within `maxDistance`. The ray is
 * moved into body space (the body turned by its yaw, feet at its position),
 * so the hitboxes are never transformed. On equal distances the hitbox
 * listed first wins.
 */
export function raycastBody(
  origin: Vec3,
  direction: Vec3,
  maxDistance: number,
  pose: BodyPose,
  hitboxes: readonly Hitbox[] = STANDING_HITBOXES,
): BodyHit | null {
  // World → body: rotate by −yaw around Y (the inverse of facing (sin yaw, 0, −cos yaw)).
  const { sin, cos } = sinCos(pose.yaw);
  const px = origin.x - pose.position.x;
  const pz = origin.z - pose.position.z;
  const localOrigin = { x: px * cos + pz * sin, y: origin.y - pose.position.y, z: -px * sin + pz * cos };
  const localDirection = { x: direction.x * cos + direction.z * sin, y: direction.y, z: -direction.x * sin + direction.z * cos };

  let best: BodyHit | null = null;
  for (let index = 0; index < hitboxes.length; index++) {
    const hitbox = hitboxes[index] as Hitbox;
    const distance = rayCapsule(localOrigin, localDirection, hitbox);
    if (distance !== null && distance <= maxDistance && (best === null || distance < best.distance)) {
      best = { distance, group: hitbox.group, hitbox: index };
    }
  }
  return best;
}
