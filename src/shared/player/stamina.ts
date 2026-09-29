import type { PlayerMovementConfig } from './PlayerMovementConfig';

/** Fatigue after recovering for one tick. */
export function recoverStamina(stamina: number, config: PlayerMovementConfig, dt: number): number {
  return Math.max(0, stamina - config.staminaRecoveryRate * dt);
}

/** Adds a jump or landing cost, capped at full fatigue (1). */
export function spendStamina(stamina: number, cost: number): number {
  return Math.min(1, stamina + cost);
}

/** Fraction of speed kept at this fatigue: 1 when fresh, (1 − staminaSpeedPenalty) when exhausted. */
export function staminaSpeedFactor(stamina: number, config: PlayerMovementConfig): number {
  return 1 - stamina * config.staminaSpeedPenalty;
}
