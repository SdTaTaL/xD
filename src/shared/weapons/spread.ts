import { sinCos } from '../math/deterministicTrig';
import { TAU } from '../math/scalar';
import type { SeededRandom } from '../math/SeededRandom';
import type { Vec3 } from '../math/Vec3';
import type { ViewAngles } from '../player/look';

/** Unit forward, right and up vectors of a view. Yaw 0 looks towards −Z; positive yaw turns right, positive pitch looks up. */
export interface ViewBasis {
  readonly forward: Vec3;
  readonly right: Vec3;
  readonly up: Vec3;
}

export function viewBasis(angles: ViewAngles): ViewBasis {
  const yaw = sinCos(angles.yaw);
  const pitch = sinCos(angles.pitch);
  return {
    forward: { x: yaw.sin * pitch.cos, y: pitch.sin, z: -yaw.cos * pitch.cos },
    right: { x: yaw.cos, y: 0, z: yaw.sin },
    up: { x: -yaw.sin * pitch.sin, y: pitch.cos, z: yaw.cos * pitch.sin },
  };
}

/**
 * Direction of one bullet: the aim direction deflected by two random offsets
 * inside discs of radius `inaccuracy` and `spread` (tangent units, one unit
 * in front of the muzzle). The radius is drawn uniformly, which clusters
 * shots towards the centre of the cone, as in Counter-Strike.
 *
 * Deterministic: the same angles, values and random stream give the same
 * direction on every machine.
 */
export function bulletDirection(aim: ViewAngles, inaccuracy: number, spread: number, random: SeededRandom): Vec3 {
  const { forward, right, up } = viewBasis(aim);

  const inaccuracyAngle = sinCos(random.next() * TAU);
  const inaccuracyRadius = random.next() * inaccuracy;
  const spreadAngle = sinCos(random.next() * TAU);
  const spreadRadius = random.next() * spread;

  const x = inaccuracyAngle.cos * inaccuracyRadius + spreadAngle.cos * spreadRadius;
  const y = inaccuracyAngle.sin * inaccuracyRadius + spreadAngle.sin * spreadRadius;

  const dx = forward.x + right.x * x + up.x * y;
  const dy = forward.y + right.y * x + up.y * y;
  const dz = forward.z + right.z * x + up.z * y;
  const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
  return { x: dx / length, y: dy / length, z: dz / length };
}
