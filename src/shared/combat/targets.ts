import type { TargetSpawn } from '../maps/MapDefinition';
import type { Vec3 } from '../math/Vec3';
import type { Shot } from '../weapons/WeaponController';
import type { WeaponDefinition } from '../weapons/WeaponDefinition';
import { bulletDamage, type BulletDamage, type HitGroup } from './damage';
import { raycastBody } from './hitboxes';

/** Health of a target (and of a player). */
export const TARGET_HEALTH = 100;
/** Seconds a knocked-down target stays down. */
export const TARGET_RESPAWN_SECONDS = 2;

/** State of one training target. Plain, immutable data. */
export interface TargetState {
  readonly spawn: TargetSpawn;
  /** 0 when down. */
  readonly health: number;
  readonly kevlar: number;
  readonly helmet: boolean;
  /** Seconds until it stands up again; 0 while standing. */
  readonly downFor: number;
}

/** A bullet that hit a target. */
export interface TargetHit {
  /** Index of the target. */
  readonly target: number;
  readonly group: HitGroup;
  /** Distance from the muzzle, meters. */
  readonly distance: number;
  readonly point: Vec3;
  readonly damage: BulletDamage;
  /** Health left after the hit. */
  readonly health: number;
  readonly killed: boolean;
}

/** What a shot ended up doing. */
export interface ShotOutcome {
  readonly shot: Shot;
  /** The target hit, or null when the bullet went on to the map (see `shot.hit`). */
  readonly target: TargetHit | null;
}

export function createTarget(spawn: TargetSpawn): TargetState {
  return Object.freeze({ spawn, health: TARGET_HEALTH, kevlar: spawn.kevlar, helmet: spawn.helmet, downFor: 0 });
}

export function isStanding(target: TargetState): boolean {
  return target.health > 0;
}

/**
 * Resolves a shot against the targets: the nearest standing target whose
 * hitboxes the bullet crosses before reaching the map (walls stop bullets;
 * there is no penetration yet) takes the damage. The bullet stops there.
 *
 * This is the authority's job: in multiplayer the server does it, with lag
 * compensation. Pure and deterministic.
 */
export function resolveShot(
  targets: readonly TargetState[],
  shot: Shot,
  weapon: WeaponDefinition,
): { readonly targets: readonly TargetState[]; readonly outcome: ShotOutcome } {
  const reach = shot.hit ? shot.hit.distance : weapon.range;
  let found: { index: number; distance: number; group: HitGroup } | null = null;
  for (let index = 0; index < targets.length; index++) {
    const target = targets[index] as TargetState;
    if (!isStanding(target)) continue;
    const hit = raycastBody(shot.origin, shot.direction, reach, target.spawn);
    if (hit && (found === null || hit.distance < found.distance)) found = { index, distance: hit.distance, group: hit.group };
  }
  if (found === null) return { targets, outcome: Object.freeze({ shot, target: null }) };

  const target = targets[found.index] as TargetState;
  const damage = bulletDamage(weapon, found.distance, found.group, target);
  const health = Math.max(0, target.health - damage.health);
  const updated = Object.freeze({
    ...target,
    health,
    kevlar: Math.max(0, target.kevlar - damage.kevlar),
    downFor: health === 0 ? TARGET_RESPAWN_SECONDS : 0,
  });
  const { origin, direction } = shot;
  const hit: TargetHit = Object.freeze({
    target: found.index,
    group: found.group,
    distance: found.distance,
    point: {
      x: origin.x + direction.x * found.distance,
      y: origin.y + direction.y * found.distance,
      z: origin.z + direction.z * found.distance,
    },
    damage,
    health,
    killed: health === 0,
  });

  const next = targets.slice();
  next[found.index] = updated;
  return { targets: Object.freeze(next), outcome: Object.freeze({ shot, target: hit }) };
}

/** Advances down timers by `dt`: a target whose timer ends stands up again with full health and its armor back. */
export function tickTargets(targets: readonly TargetState[], dt: number): readonly TargetState[] {
  if (targets.every(isStanding)) return targets;
  return Object.freeze(
    targets.map((target) => {
      if (isStanding(target)) return target;
      const downFor = target.downFor - dt;
      return downFor > 1e-9 ? Object.freeze({ ...target, downFor }) : createTarget(target.spawn);
    }),
  );
}
