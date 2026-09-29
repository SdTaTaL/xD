import { damageAtDistance } from '../weapons/damage';
import type { WeaponDefinition } from '../weapons/WeaponDefinition';

/** Body region a bullet hit, as in Counter-Strike. */
export type HitGroup = 'head' | 'chest' | 'stomach' | 'arm' | 'leg';

/** Damage multiplier of each hit group (the head uses the weapon's own multiplier). CS2: stomach ×1.25, legs ×0.75. */
const GROUP_MULTIPLIER: Readonly<Record<Exclude<HitGroup, 'head'>, number>> = Object.freeze({
  chest: 1,
  stomach: 1.25,
  arm: 1,
  leg: 0.75,
});

/** Share of the damage blocked by armor that also costs armor points (CS's armor bonus). */
const ARMOR_BONUS = 0.5;

/** Protection a player wears. */
export interface Armor {
  /** Kevlar points, 0–100. Kevlar covers the chest, stomach and arms. */
  readonly kevlar: number;
  /** Helmet: covers the head, only while there is kevlar left. */
  readonly helmet: boolean;
}

export interface BulletDamage {
  /** Health removed (whole points). */
  readonly health: number;
  /** Kevlar points removed (whole points). */
  readonly kevlar: number;
}

export function hitGroupMultiplier(weapon: WeaponDefinition, group: HitGroup): number {
  return group === 'head' ? weapon.headshotMultiplier : GROUP_MULTIPLIER[group];
}

/** Whether armor protects this hit group. Legs never are; the head only with a helmet. */
export function isArmored(armor: Armor, group: HitGroup): boolean {
  if (armor.kevlar <= 0 || group === 'leg') return false;
  return group !== 'head' || armor.helmet;
}

/**
 * Damage of one bullet, the Counter-Strike way:
 *
 * 1. the weapon's damage after range falloff, × the hit group multiplier;
 * 2. on an armored hit group, health takes `armorRatio / 2` of it (AK-47:
 *    77.5 %), and kevlar loses half of the part it blocked; if the kevlar
 *    runs out, what it could not absorb goes to health;
 * 3. both are rounded down to whole points.
 *
 * Reference values (AK-47, point blank): body 36 (27 through kevlar),
 * stomach 45, legs 27, head 144 (111 through a helmet).
 */
export function bulletDamage(weapon: WeaponDefinition, distance: number, group: HitGroup, armor: Armor): BulletDamage {
  const damage = damageAtDistance(weapon, distance) * hitGroupMultiplier(weapon, group);
  if (!isArmored(armor, group)) return { health: Math.floor(damage), kevlar: 0 };

  let toHealth = damage * weapon.armorRatio * 0.5;
  let toKevlar = (damage - toHealth) * ARMOR_BONUS;
  if (toKevlar > armor.kevlar) {
    toKevlar = armor.kevlar;
    toHealth = damage - armor.kevlar / ARMOR_BONUS;
  }
  return { health: Math.floor(toHealth), kevlar: Math.floor(toKevlar) };
}
