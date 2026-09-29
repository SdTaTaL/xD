export interface VerticalStep {
  /** Vertical displacement over the tick, meters. */
  readonly displacement: number;
  /** Vertical velocity at the end of the tick, m/s. */
  readonly velocity: number;
}

/**
 * Exact constant-acceleration kinematics over one tick
 * (Δy = v·dt − ½·g·dt², v' = v − g·dt), like Source's half-gravity before
 * and after the move. The arc does not depend on the tick rate: every jump
 * reaches the configured height.
 */
export function integrateGravity(velocity: number, gravity: number, dt: number, maxVelocity: number): VerticalStep {
  return {
    displacement: velocity * dt - 0.5 * gravity * dt * dt,
    velocity: Math.max(velocity - gravity * dt, -maxVelocity),
  };
}

/**
 * Jump buffer after this tick's input. A press (re)arms the buffer; otherwise
 * it counts down. Holding the button never re-arms it, so there is no
 * auto-jump.
 */
export function nextJumpBuffer(previous: number, pressed: boolean, bufferTicks: number): number {
  return pressed ? Math.max(1, bufferTicks) : Math.max(0, previous - 1);
}
