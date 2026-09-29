import { INPUT_ACTIONS, actionBit, type InputAction } from '../../input/InputAction';
import { createInputCommand, type InputCommand } from '../../input/InputCommand';
import type { Vec3 } from '../../math/Vec3';
import { aabb, type Aabb } from '../../physics/Aabb';
import { CollisionWorld } from '../../physics/CollisionWorld';
import { SIMULATION_TICK_SECONDS } from '../../simulation/SimulationConfig';
import { simulatePlayerTick, type PlayerSimulationContext } from '../PlayerController';
import { DEFAULT_PLAYER_MOVEMENT, type PlayerMovementConfig } from '../PlayerMovementConfig';
import { createPlayerState, freezeState, type PlayerState } from '../PlayerState';

export const TICK = SIMULATION_TICK_SECONDS;
export const CONFIG = DEFAULT_PLAYER_MOVEMENT;

/** A large floor whose top face is y = 0, plus extra solids. */
export function floorWorld(...solids: Aabb[]): CollisionWorld {
  return new CollisionWorld([aabb(-100, -1, -100, 100, 0, 100), ...solids]);
}

export function simulationContext(world: CollisionWorld, config: PlayerMovementConfig = CONFIG): PlayerSimulationContext {
  return { world, config, tickSeconds: TICK };
}

export interface Intent {
  /** [moveX, moveY]. */
  readonly move?: readonly [number, number] | undefined;
  /** [lookX, lookY] radians. */
  readonly look?: readonly [number, number] | undefined;
  readonly held?: readonly InputAction[] | undefined;
  readonly pressed?: readonly InputAction[] | undefined;
}

function mask(actions: readonly InputAction[] | undefined): number {
  return (actions ?? []).reduce((bits, action) => bits | actionBit(action), 0);
}

export function command(intent: Intent, tick: number): InputCommand {
  return createInputCommand({
    tick,
    moveX: intent.move?.[0] ?? 0,
    moveY: intent.move?.[1] ?? 0,
    lookX: intent.look?.[0] ?? 0,
    lookY: intent.look?.[1] ?? 0,
    held: mask(intent.held),
    pressed: mask(intent.pressed),
  });
}

/** Small driver: feeds commands tick by tick and records every state. */
export class Sim {
  readonly context: PlayerSimulationContext;
  state: PlayerState;
  tick = 0;
  readonly history: PlayerState[] = [];

  constructor(world: CollisionWorld, position: Vec3 = { x: 0, y: 0, z: 0 }, yaw = 0, config: PlayerMovementConfig = CONFIG) {
    this.context = simulationContext(world, config);
    this.state = createPlayerState({ position, yaw });
  }

  /** Runs `ticks` ticks with the same intent; `pressed` applies to the first tick only. */
  step(intent: Intent = {}, ticks = 1): PlayerState {
    for (let i = 0; i < ticks; i++) {
      const current = i === 0 ? intent : { ...intent, pressed: [] };
      this.state = simulatePlayerTick(this.state, command(current, this.tick++), this.context);
      this.history.push(this.state);
    }
    return this.state;
  }

  /** Steps until grounded (at most a few seconds). */
  settle(intent: Intent = {}): PlayerState {
    for (let i = 0; i < 400 && !(this.state.grounded && this.tick > 0); i++) this.step(intent);
    return this.state;
  }

  withVelocity(velocity: Vec3): void {
    this.state = freezeState({ ...this.state, position: { ...this.state.position }, velocity });
  }
}

/** Deterministic PRNG (mulberry32) for reproducible fuzzing. */
export function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Random but human-like input: directions held for a while, occasional jumps/crouches, mouse sweeps. */
export function randomIntents(seed: number, ticks: number): Intent[] {
  const next = random(seed);
  const intents: Intent[] = [];
  let move: [number, number] = [0, 0];
  let held: InputAction[] = [];
  let lookRate = 0;
  for (let i = 0; i < ticks; i++) {
    if (next() < 0.04) move = [Math.round(next() * 2 - 1), Math.round(next() * 2 - 1)];
    if (next() < 0.02) move = [next() * 2 - 1, next() * 2 - 1];
    if (next() < 0.03) held = INPUT_ACTIONS.filter((action) => (action === 'crouch' || action === 'walk') && next() < 0.4);
    if (next() < 0.03) lookRate = (next() * 2 - 1) * 0.08;
    const pressed: InputAction[] = next() < 0.05 ? ['jump'] : [];
    intents.push({ move, look: [lookRate, (next() * 2 - 1) * 0.02], held: [...held, ...pressed], pressed });
  }
  return intents;
}
