import { describe, expect, it } from 'vitest';
import { GRAYBOX_ARENA } from '../maps/grayboxArena';
import { aabb } from '../physics/Aabb';
import { CollisionWorld } from '../physics/CollisionWorld';
import { simulatePlayerTick } from './PlayerController';
import { jumpVelocity } from './PlayerMovementConfig';
import { createPlayerState, eyePosition, horizontalSpeed, hullHeight, playerHull, type PlayerState } from './PlayerState';
import { CONFIG, floorWorld, randomIntents, Sim, simulationContext, TICK, command, type Intent } from './test-support/simulation';

const W: Intent = { move: [0, 1] };
const S: Intent = { move: [0, -1] };
const A: Intent = { move: [-1, 0] };
const D: Intent = { move: [1, 0] };
const WD: Intent = { move: [1, 1] };
const JUMP: Intent = { held: ['jump'], pressed: ['jump'] };
const CROUCH: Intent = { held: ['crouch'] };

const with_ = (a: Intent, b: Intent): Intent => ({
  move: b.move ?? a.move,
  look: b.look ?? a.look,
  held: [...(a.held ?? []), ...(b.held ?? [])],
  pressed: [...(a.pressed ?? []), ...(b.pressed ?? [])],
});

function settled(world = floorWorld(), position = { x: 0, y: 0, z: 0 }, yaw = 0): Sim {
  const sim = new Sim(world, position, yaw);
  sim.settle();
  return sim;
}

function overlapsWorld(world: CollisionWorld, state: PlayerState): boolean {
  return world.overlaps(playerHull(state.position, hullHeight(state.crouched, CONFIG), CONFIG.radius));
}

describe('ground movement (WASD)', () => {
  it.each([
    ['W', W, 0, -1],
    ['S', S, 0, 1],
    ['A', A, -1, 0],
    ['D', D, 1, 0],
  ] as const)('%s moves at walk speed in the expected direction (yaw 0 faces −Z)', (_, intent, dirX, dirZ) => {
    const sim = settled();
    sim.step(intent, 64);
    expect(sim.state.velocity.x).toBeCloseTo(dirX * CONFIG.walkSpeed, 12);
    expect(sim.state.velocity.z).toBeCloseTo(dirZ * CONFIG.walkSpeed, 12);
    expect(sim.state.grounded).toBe(true);
  });

  it('moves relative to the view: W at yaw 90° goes towards +X', () => {
    const sim = settled(floorWorld(), { x: 0, y: 0, z: 0 }, Math.PI / 2);
    sim.step(W, 64);
    expect(sim.state.velocity.x).toBeCloseTo(CONFIG.walkSpeed, 12);
    expect(sim.state.velocity.z).toBeCloseTo(0, 12);
  });

  it('is exactly as fast diagonally as straight', () => {
    const sim = settled();
    sim.step(WD, 64);
    expect(horizontalSpeed(sim.state)).toBeCloseTo(CONFIG.walkSpeed, 12);
    expect(sim.state.velocity.x).toBeCloseTo(-sim.state.velocity.z, 12);
  });

  it('scales with analog input (half stick = half speed)', () => {
    const sim = settled();
    sim.step({ move: [0, 0.5] }, 64);
    expect(horizontalSpeed(sim.state)).toBeCloseTo((CONFIG.walkSpeed * 64) / 127, 12);
  });

  it('reaches walk speed in 7 ticks (0.11 s) from standstill', () => {
    const sim = settled();
    sim.step(W, 6);
    expect(horizontalSpeed(sim.state)).toBeLessThan(CONFIG.walkSpeed);
    sim.step(W);
    expect(horizontalSpeed(sim.state)).toBe(CONFIG.walkSpeed);
  });

  it('stops from walk speed in 5 ticks (0.08 s) and less than 0.2 m', () => {
    const sim = settled();
    sim.step(W, 64);
    const before = sim.state.position.z;
    sim.step({}, 4);
    expect(horizontalSpeed(sim.state)).toBeGreaterThan(0);
    sim.step({});
    expect(horizontalSpeed(sim.state)).toBe(0);
    expect(Math.abs(sim.state.position.z - before)).toBeLessThan(0.2);
  });

  it('brakes at the deceleration rate when reversing', () => {
    const sim = settled();
    sim.step(D, 64);
    sim.step(A);
    expect(sim.state.velocity.x).toBeCloseTo(CONFIG.walkSpeed - CONFIG.groundDeceleration * TICK, 12);
  });

  it('stays put when idle: no drift, no gravity accumulation', () => {
    const sim = settled();
    const rest = sim.state;
    sim.step({}, 640);
    expect(sim.state.position).toEqual(rest.position);
    expect(sim.state.velocity).toEqual({ x: 0, y: 0, z: 0 });
  });
});

describe('sprint and crouch speeds', () => {
  const SPRINT: Intent = { held: ['sprint'] };

  it('sprints forward and diagonally forward at sprint speed', () => {
    for (const move of [W, WD]) {
      const sim = settled();
      sim.step(with_(move, SPRINT), 64);
      expect(horizontalSpeed(sim.state)).toBeCloseTo(CONFIG.sprintSpeed, 12);
      expect(sim.state.sprinting).toBe(true);
    }
  });

  it('never sprints strafing or backwards', () => {
    for (const move of [A, D, S]) {
      const sim = settled();
      sim.step(with_(move, SPRINT), 64);
      expect(horizontalSpeed(sim.state)).toBeCloseTo(CONFIG.walkSpeed, 12);
      expect(sim.state.sprinting).toBe(false);
    }
  });

  it('crouching overrides sprint', () => {
    const sim = settled();
    sim.step(with_(with_(W, SPRINT), CROUCH), 64);
    expect(horizontalSpeed(sim.state)).toBeCloseTo(CONFIG.crouchSpeed, 12);
    expect(sim.state.sprinting).toBe(false);
  });

  it('sheds sprint speed at the deceleration rate when sprint is released', () => {
    const sim = settled();
    sim.step(with_(W, SPRINT), 64);
    sim.step(W);
    expect(horizontalSpeed(sim.state)).toBeCloseTo(CONFIG.sprintSpeed - CONFIG.groundDeceleration * TICK, 12);
    sim.step(W, 3);
    expect(horizontalSpeed(sim.state)).toBe(CONFIG.walkSpeed);
  });
});

describe('jump and gravity', () => {
  it('jumps to the configured height with a tick-rate independent arc', () => {
    const sim = settled();
    sim.step(JUMP);
    expect(sim.state.grounded).toBe(false);
    expect(sim.state.velocity.y).toBeCloseTo(jumpVelocity(CONFIG) - CONFIG.gravity * TICK, 12);

    let apex = 0;
    let ticks = 1;
    while (!sim.state.grounded) {
      sim.step();
      apex = Math.max(apex, sim.state.position.y);
      ticks++;
    }
    expect(apex).toBeGreaterThan(CONFIG.jumpHeight - 0.005);
    expect(apex).toBeLessThanOrEqual(CONFIG.jumpHeight);
    // Air time 2v/g = 0.632 s ≈ 40.5 ticks.
    expect(ticks).toBeGreaterThanOrEqual(40);
    expect(ticks).toBeLessThanOrEqual(41);
    expect(sim.state.position.y).toBe(0);
    expect(sim.state.velocity.y).toBe(0);
  });

  it('only jumps from the ground: no double jump', () => {
    const sim = settled();
    sim.step(JUMP);
    sim.step({}, 15);
    const velocityBefore = sim.state.velocity.y;
    sim.step(JUMP);
    expect(sim.state.velocity.y).toBeLessThan(velocityBefore);
  });

  it('does not auto-jump while the button is held', () => {
    const sim = settled();
    sim.step(JUMP);
    sim.step({ held: ['jump'] }, 120);
    const takeoffs = sim.history.filter((s, i) => i > 0 && s.velocity.y > 0 && sim.history[i - 1]!.grounded).length;
    expect(takeoffs).toBe(1); // the initial press only
    expect(sim.state.grounded).toBe(true);
  });

  it('buffers a jump pressed shortly before landing', () => {
    const sim = settled();
    sim.step(JUMP);
    while (sim.state.position.y > 0.25 || sim.state.velocity.y > 0) sim.step();
    sim.step(JUMP); // pressed while still airborne
    let landedTick = -1;
    for (let i = 0; i < 10 && landedTick < 0; i++) {
      sim.step();
      if (sim.state.grounded) landedTick = sim.tick;
    }
    expect(landedTick).toBeGreaterThan(0);
    sim.step();
    expect(sim.state.velocity.y).toBeGreaterThan(0); // jumped on the first grounded tick
  });

  it('forgets a jump pressed too early', () => {
    const sim = settled();
    sim.step(JUMP);
    sim.step({}, 10);
    sim.step(JUMP); // ~30 ticks before landing
    sim.settle();
    sim.step();
    expect(sim.state.grounded).toBe(true);
  });

  it('stops rising at a ceiling and falls back', () => {
    const sim = settled(floorWorld(aabb(-1, 2.2, -1, 1, 2.4, 1)));
    sim.step(JUMP);
    sim.settle();
    const apex = Math.max(...sim.history.map((s) => s.position.y));
    expect(apex).toBeLessThanOrEqual(2.2 - CONFIG.standingHeight + 1e-9);
    expect(apex).toBeGreaterThan(0.39);
    expect(sim.history.every((s) => !overlapsWorld(sim.context.world, s))).toBe(true);
  });

  it('lands exactly on the floor after a long fall', () => {
    const sim = new Sim(floorWorld(), { x: 0, y: 20, z: 0 });
    sim.settle();
    expect(sim.state.position.y).toBe(0);
    expect(sim.state.velocity.y).toBe(0);
    expect(sim.state.grounded).toBe(true);
  });

  it('keeps horizontal momentum in the air without input', () => {
    const sim = settled();
    sim.step(with_(W, { held: ['sprint'] }), 64);
    const speed = horizontalSpeed(sim.state);
    sim.step(with_(W, { ...JUMP, held: ['jump', 'sprint'] }));
    sim.step({}, 20);
    expect(horizontalSpeed(sim.state)).toBeCloseTo(speed, 12);
  });

  it('never gains speed from air strafing or turning', () => {
    const sim = settled();
    sim.step(W, 64);
    const speed = horizontalSpeed(sim.state);
    sim.step(with_(W, JUMP));
    for (let i = 0; i < 40; i++) {
      sim.step({ move: [i % 2 ? 1 : -1, 1], look: [0.05, 0] });
      expect(horizontalSpeed(sim.state)).toBeLessThanOrEqual(speed + 1e-12);
    }
  });
});

describe('walls, corners and gaps', () => {
  it('stops exactly at a wall and keeps no velocity into it', () => {
    const sim = settled(floorWorld(aabb(5, 0, -10, 6, 3, 10)));
    sim.step(D, 192);
    expect(sim.state.position.x).toBeCloseTo(5 - CONFIG.radius, 12);
    expect(sim.state.velocity.x).toBe(0);
    expect(sim.state.grounded).toBe(true);
  });

  it('slides along a wall with the wall-parallel part of the input, accelerating at the full rate', () => {
    const sim = settled(floorWorld(aabb(0.3, 0, -50, 1, 3, 50)));
    const slideSpeed = CONFIG.walkSpeed * Math.SQRT1_2;
    sim.step(WD, Math.ceil(slideSpeed / (CONFIG.groundAcceleration * TICK)));
    expect(sim.state.position.x).toBe(0);
    expect(sim.state.velocity.z).toBeCloseTo(-slideSpeed, 12);
  });

  it('comes to rest in a concave corner', () => {
    const sim = settled(floorWorld(aabb(5, 0, -10, 6, 3, 10), aabb(-10, 0, -6, 10, 3, -5)));
    sim.step(WD, 192);
    expect(sim.state.position.x).toBeCloseTo(5 - CONFIG.radius, 12);
    expect(sim.state.position.z).toBeCloseTo(-5 + CONFIG.radius, 12);
    expect(horizontalSpeed(sim.state)).toBe(0);
  });

  it('slides around an outside corner instead of sticking', () => {
    const sim = settled(floorWorld(aabb(1, 0, -3, 3, 2, -1)));
    sim.step(WD, 128);
    expect(sim.state.position.x).toBeGreaterThan(3.3);
  });

  it('walks across floor seams without losing speed', () => {
    const world = new CollisionWorld([aabb(-50, -1, -50, 0, 0, 50), aabb(0, -1, -50, 50, 0, 50)]);
    const sim = new Sim(world, { x: -2, y: 0, z: 0 });
    sim.settle();
    sim.step(D, 20);
    sim.step(D, 40);
    expect(sim.history.slice(-40).every((s) => s.grounded && horizontalSpeed(s) === CONFIG.walkSpeed)).toBe(true);
  });

  it('passes a 0.65 m gap but not a 0.55 m one', () => {
    const through = settled(floorWorld(aabb(-3, 0, -3, -0.325, 2, -1), aabb(0.325, 0, -3, 3, 2, -1)));
    through.step(W, 128);
    expect(through.state.position.z).toBeLessThan(-4);

    const blocked = settled(floorWorld(aabb(-3, 0, -3, -0.275, 2, -1), aabb(0.275, 0, -3, 3, 2, -1)));
    blocked.step(W, 128);
    expect(blocked.state.position.z).toBeCloseTo(-1 + CONFIG.radius, 12);
  });

  it('cannot climb a wall by jumping into it', () => {
    const sim = settled(floorWorld(aabb(CONFIG.radius, 0, -5, 2, 10, 5)));
    for (let i = 0; i < 300; i++) sim.step(sim.state.grounded ? with_(D, JUMP) : D);
    expect(Math.max(...sim.history.map((s) => s.position.y))).toBeLessThanOrEqual(CONFIG.jumpHeight);
  });

  it('never tunnels through thin walls at extreme speed', () => {
    const sim = settled(floorWorld(aabb(5, 0, -5, 5.01, 3, 5)));
    sim.withVelocity({ x: 2000, y: 0, z: 0 });
    sim.step({});
    expect(sim.state.position.x).toBeCloseTo(5 - CONFIG.radius, 12);
  });
});

describe('steps and ledges', () => {
  it.each([0.2, 0.35])('walks up a %d m step', (height) => {
    const sim = settled(floorWorld(aabb(1, 0, -2, 30, height, 2)));
    sim.step(D, 64);
    expect(sim.state.position.y).toBeCloseTo(height, 12);
    expect(sim.state.position.x).toBeGreaterThan(2);
    expect(sim.state.grounded).toBe(true);
  });

  it('is blocked by a 0.5 m obstacle (it needs a jump)', () => {
    const sim = settled(floorWorld(aabb(1, 0, -2, 30, 0.5, 2)));
    sim.step(D, 64);
    expect(sim.state.position.x).toBeCloseTo(1 - CONFIG.radius, 12);
    expect(sim.state.position.y).toBe(0);
  });

  it('climbs stairs of 0.25 m risers to a 1.5 m platform', () => {
    const steps = Array.from({ length: 6 }, (_, i) => aabb(1 + i * 0.6, 0, -2, 1.6 + i * 0.6, (i + 1) * 0.25, 2));
    const sim = settled(floorWorld(...steps, aabb(4.6, 0, -2, 30, 1.5, 2)));
    sim.step(D, 128);
    expect(sim.state.position.y).toBeCloseTo(1.5, 12);
    expect(sim.state.position.x).toBeGreaterThan(5);
  });

  it('stays grounded walking down a step', () => {
    const sim = settled(floorWorld(aabb(-10, 0, -10, 0, 0.3, 10)), { x: -1, y: 0.3, z: 0 });
    sim.step(D, 64);
    expect(sim.history.slice(-64).every((s) => s.grounded)).toBe(true);
    expect(sim.state.position.y).toBe(0);
  });

  it('falls off ledges higher than a step', () => {
    const sim = settled(floorWorld(aabb(-10, 0, -10, 0, 1, 10)), { x: -1, y: 1, z: 0 });
    sim.step(D, 64);
    expect(sim.history.some((s) => !s.grounded)).toBe(true);
    expect(sim.state.position.y).toBe(0);
    expect(sim.state.grounded).toBe(true);
  });
});

describe('crouch', () => {
  it('shrinks the hull at once and lowers the view over the transition time', () => {
    const sim = settled();
    sim.step(CROUCH);
    expect(sim.state.crouched).toBe(true);
    expect(sim.state.position.y).toBe(0);
    sim.step(CROUCH, 6);
    expect(sim.state.crouchAmount).toBeLessThan(1);
    sim.step(CROUCH);
    expect(sim.state.crouchAmount).toBe(1);
    expect(eyePosition(sim.state, CONFIG).y).toBeCloseTo(CONFIG.crouchingEyeHeight, 12);
  });

  it('moves at crouch speed', () => {
    const sim = settled();
    sim.step(with_(W, CROUCH), 64);
    expect(horizontalSpeed(sim.state)).toBeCloseTo(CONFIG.crouchSpeed, 12);
  });

  it('enters a 1.5 m tunnel only crouched, cannot stand inside and stands again after it', () => {
    const world = floorWorld(aabb(2, 1.5, -2, 8, 1.8, 2));
    const standing = settled(world);
    standing.step(D, 128);
    expect(standing.state.position.x).toBeCloseTo(2 - CONFIG.radius, 12);

    const sim = settled(world);
    sim.step(with_(D, CROUCH), 150); // x ≈ 4.7: under the ceiling
    expect(sim.state.position.x).toBeGreaterThan(3);
    sim.step(D, 20); // crouch released inside
    expect(sim.state.crouched).toBe(true);
    sim.step(D, 200);
    expect(sim.state.position.x).toBeGreaterThan(8 + CONFIG.radius);
    expect(sim.state.crouched).toBe(false);
    expect(sim.history.every((s) => !overlapsWorld(world, s))).toBe(true);
  });

  it('crouching in the air tucks the legs up and keeps the view still', () => {
    const plain = settled();
    const tucked = settled();
    plain.step(JUMP);
    tucked.step(JUMP);
    plain.step({}, 4);
    tucked.step({}, 4);
    tucked.step(CROUCH);
    plain.step();
    expect(tucked.state.position.y - plain.state.position.y).toBeCloseTo(CONFIG.standingHeight - CONFIG.crouchingHeight, 12);
    for (let i = 0; i < 10; i++) {
      tucked.step(i < 6 ? CROUCH : {}); // stands up again mid-air: legs extend downwards
      plain.step();
      expect(eyePosition(tucked.state, CONFIG).y).toBeCloseTo(eyePosition(plain.state, CONFIG).y, 12);
    }
    expect(tucked.state.crouched).toBe(false);
  });

  it('gives the crouch-jump when jump and crouch are pressed on the same tick', () => {
    const world = floorWorld(aabb(1, 0, -2, 3, 1.2, 2));
    const sim = settled(world, { x: 0.6, y: 0, z: 0 });
    sim.step(with_(with_(D, JUMP), CROUCH));
    expect(sim.state.position.y).toBeGreaterThan(CONFIG.standingHeight - CONFIG.crouchingHeight);
    sim.step(with_(D, CROUCH), 80);
    expect(sim.state.position.y).toBeCloseTo(1.2, 12);
  });

  it('jumps with the crouched hull (no bonus) when already crouched on the ground', () => {
    const sim = settled();
    sim.step(CROUCH, 10);
    sim.step(with_(CROUCH, JUMP));
    sim.settle(CROUCH);
    expect(Math.max(...sim.history.map((s) => s.position.y))).toBeLessThanOrEqual(CONFIG.jumpHeight);
  });

  it('reaches a 1.2 m ledge with a crouch-jump but not with a plain jump', () => {
    const world = floorWorld(aabb(1, 0, -2, 3, 1.2, 2));
    const plain = settled(world, { x: 0.6, y: 0, z: 0 });
    plain.step(with_(D, JUMP));
    plain.step(D, 80);
    expect(plain.state.position.y).toBe(0);

    const crouchJump = settled(world, { x: 0.6, y: 0, z: 0 });
    crouchJump.step(with_(D, JUMP));
    crouchJump.step(with_(D, CROUCH), 80);
    expect(crouchJump.state.position.y).toBeCloseTo(1.2, 12);
    expect(crouchJump.state.grounded).toBe(true);
  });
});

describe('view', () => {
  it('wraps yaw and clamps pitch to ±89°', () => {
    const sim = settled();
    sim.step({ look: [0.1, 0.05] }, 200);
    expect(sim.state.yaw).toBeGreaterThanOrEqual(-Math.PI);
    expect(sim.state.yaw).toBeLessThan(Math.PI);
    expect(sim.state.pitch).toBe(CONFIG.maxPitch);
    sim.step({ look: [0, -0.05] }, 200);
    expect(sim.state.pitch).toBe(-CONFIG.maxPitch);
  });
});

describe('determinism and robustness', () => {
  const world = CollisionWorld.fromMap(GRAYBOX_ARENA);

  const run = (seed: number, spawnIndex: number, ticks: number): PlayerState[] => {
    const spawn = GRAYBOX_ARENA.spawnPoints[spawnIndex]!;
    const context = simulationContext(world);
    let state = createPlayerState(spawn);
    const states: PlayerState[] = [];
    randomIntents(seed, ticks).forEach((intent, tick) => {
      state = simulatePlayerTick(state, command(intent, tick), context);
      states.push(state);
    });
    return states;
  };

  it('same start state + same commands = identical states, bit for bit', () => {
    const first = run(7, 0, 3000);
    const second = run(7, 0, 3000);
    expect(second).toEqual(first);
    const a = first.at(-1)!;
    const b = second.at(-1)!;
    expect([Object.is(a.position.x, b.position.x), Object.is(a.position.z, b.position.z), Object.is(a.yaw, b.yaw)]).toEqual([true, true, true]);
  });

  it('never leaves the player inside geometry, under the floor or over the speed limit (fuzzed in the real map)', () => {
    for (let spawnIndex = 0; spawnIndex < GRAYBOX_ARENA.spawnPoints.length; spawnIndex++) {
      for (const seed of [1, 2, 3]) {
        for (const state of run(seed * 31 + spawnIndex, spawnIndex, 4000)) {
          const values = [state.position.x, state.position.y, state.position.z, state.velocity.x, state.velocity.y, state.velocity.z];
          if (!values.every(Number.isFinite)) throw new Error('non-finite state');
          if (overlapsWorld(world, state)) throw new Error(`inside geometry at ${JSON.stringify(state.position)}`);
          if (state.position.y < -1e-9) throw new Error(`below the floor at ${JSON.stringify(state.position)}`);
          if (horizontalSpeed(state) > CONFIG.sprintSpeed + 1e-9) throw new Error(`too fast: ${horizontalSpeed(state)}`);
        }
      }
    }
  });

  it('pushes a player that starts inside geometry out on the next tick', () => {
    const crateWorld = floorWorld(aabb(-1, 0, -1, 1, 1.2, 1));
    const context = simulationContext(crateWorld);
    const inside = createPlayerState({ position: { x: 0.8, y: 0, z: 0 }, yaw: 0 });
    const next = simulatePlayerTick(inside, command({}, 0), context);
    expect(overlapsWorld(crateWorld, next)).toBe(false);
    expect(next.position.x).toBeCloseTo(1 + CONFIG.radius, 12);
  });

  it('does not mutate its input state', () => {
    const context = simulationContext(floorWorld());
    const start = createPlayerState({ position: { x: 0, y: 0, z: 0 }, yaw: 0 });
    const copy: unknown = JSON.parse(JSON.stringify(start));
    simulatePlayerTick(start, command(with_(W, JUMP), 0), context);
    expect(start).toEqual(copy);
    expect(Object.isFrozen(start) && Object.isFrozen(start.position)).toBe(true);
  });
});
