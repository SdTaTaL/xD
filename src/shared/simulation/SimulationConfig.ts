/**
 * Authoritative simulation settings.
 *
 * Every participant in a match (client prediction today, dedicated server
 * later) must simulate with exactly these values.
 */

/** Simulation ticks per second. */
export const SIMULATION_TICK_RATE = 64;

/** Duration of one simulation tick, in seconds. */
export const SIMULATION_TICK_SECONDS = 1 / SIMULATION_TICK_RATE;
