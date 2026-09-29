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
/** A CS crate: 64 units. */
const CRATE = 64 * 0.0254;

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

const SPEED = CONFIG.maxSpeed;
const WALK_SPEED = CONFIG.maxSpeed * CONFIG.walkSpeedScale;
const CROUCH_SPEED = CONFIG.maxSpeed * CONFIG.crouchSpeedScale;
/** CS rule of thumb: shots are accurate below 34 % of the max speed. */
const ACCURATE_SPEED = CONFIG.maxSpeed * 0.34;

describe('ground movement (WASD)', () => {
  it.each([
    ['W', W, 0, -1],
    ['S', S, 0, 1],
    ['A', A, -1, 0],
    ['D', D, 1, 0],
  ] as const)('%s runs at full speed in the expected direction (yaw 0 faces −Z)', (_, intent, dirX, dirZ) => {
    const sim = settled();
    sim.step(intent, 64);
    expect(sim.state.velocity.x).toBeCloseTo(dirX * SPEED, 12);
    expect(sim.state.velocity.z).toBeCloseTo(dirZ * SPEED, 12);
    expect(sim.state.grounded).toBe(true);
  });

  it('runs by default at CS2 knife speed: 250 u/s = 6.35 m/s', () => {
    expect(SPEED).toBeCloseTo(6.35, 12);
  });

  it('moves relative to the view: W at yaw 90° goes towards +X', () => {
    const sim = settled(floorWorld(), { x: 0, y: 0, z: 0 }, Math.PI / 2);
    sim.step(W, 64);
    expect(sim.state.velocity.x).toBeCloseTo(SPEED, 12);
    expect(sim.state.velocity.z).toBeCloseTo(0, 12);
  });

  it('is exactly as fast diagonally as straight', () => {
    const sim = settled();
    sim.step(WD, 64);
    expect(horizontalSpeed(sim.state)).toBeCloseTo(SPEED, 12);
    expect(sim.state.velocity.x).toBeCloseTo(-sim.state.velocity.z, 12);
  });

  it('scales with analog input (half stick = half speed)', () => {
    const sim = settled();
    sim.step({ move: [0, 0.5] }, 64);
    expect(horizontalSpeed(sim.state)).toBeCloseTo((SPEED * 64) / 127, 12);
  });

  it('accelerates like Source: sv_accelerate × speed per second, full speed in 35 ticks (0.55 s)', () => {
    const sim = settled();
    sim.step(W);
    expect(horizontalSpeed(sim.state)).toBeCloseTo(CONFIG.accelerate * SPEED * TICK, 12);
    sim.step(W, 33);
    expect(horizontalSpeed(sim.state)).toBeLessThan(SPEED);
    sim.step(W);
    expect(horizontalSpeed(sim.state)).toBe(SPEED);
  });

  it('slides to a stop with friction when the keys are released: accurate after 0.2 s, stopped after 0.41 s', () => {
    const sim = settled();
    sim.step(W, 64);
    sim.step({}, 12);
    expect(horizontalSpeed(sim.state)).toBeGreaterThan(ACCURATE_SPEED);
    sim.step({});
    expect(horizontalSpeed(sim.state)).toBeLessThanOrEqual(ACCURATE_SPEED);
    sim.step({}, 12);
    expect(horizontalSpeed(sim.state)).toBeGreaterThan(0);
    sim.step({});
    expect(horizontalSpeed(sim.state)).toBe(0);
  });

  it('counter-strafing stops far faster than releasing: accurate after 5 ticks (0.08 s)', () => {
    const sim = settled();
    sim.step(D, 64);
    sim.step(A, 4);
    expect(sim.state.velocity.x).toBeGreaterThan(ACCURATE_SPEED);
    sim.step(A);
    expect(sim.state.velocity.x).toBeLessThanOrEqual(ACCURATE_SPEED);
    sim.step(A, 3);
    expect(sim.state.velocity.x).toBeLessThanOrEqual(0); // already moving the other way
  });

  it('stays put when idle: no drift, no gravity accumulation', () => {
    const sim = settled();
    const rest = sim.state;
    sim.step({}, 640);
    expect(sim.state.position).toEqual(rest.position);
    expect(sim.state.velocity).toEqual({ x: 0, y: 0, z: 0 });
  });
});

describe('walk (Shift) and crouch speeds', () => {
  const WALK: Intent = { held: ['walk'] };
  const stanceTarget = (stance: Intent): number => (stance.held?.includes('crouch') ? CROUCH_SPEED : WALK_SPEED);

  it('walks at 52 % of the max speed (130 u/s), in every direction', () => {
    for (const move of [W, A, S, D, WD]) {
      const sim = settled();
      sim.step(with_(move, WALK), 64);
      expect(horizontalSpeed(sim.state)).toBeCloseTo(WALK_SPEED, 12);
      expect(sim.state.walking).toBe(true);
    }
  });

  it('starts walking and crouching briskly: full stance speed within 0.15 s', () => {
    for (const stance of [{ held: ['walk'] }, CROUCH] as Intent[]) {
      const sim = settled();
      sim.step(with_(W, stance), 9);
      expect(horizontalSpeed(sim.state)).toBeCloseTo(stanceTarget(stance), 12);
    }
  });

  it('crouches at 34 % of the max speed (85 u/s); crouch overrides walk', () => {
    const sim = settled();
    sim.step(with_(with_(W, WALK), CROUCH), 64);
    expect(horizontalSpeed(sim.state)).toBeCloseTo(CROUCH_SPEED, 12);
    expect(sim.state.walking).toBe(false);
  });

  it('slows from running to walking through friction, not instantly', () => {
    const sim = settled();
    sim.step(W, 64);
    sim.step(with_(W, WALK));
    expect(horizontalSpeed(sim.state)).toBeGreaterThan(WALK_SPEED);
    expect(horizontalSpeed(sim.state)).toBeLessThan(SPEED);
    sim.step(with_(W, WALK), 64);
    expect(horizontalSpeed(sim.state)).toBeCloseTo(WALK_SPEED, 12);
  });
});

describe('jump and gravity', () => {
  it('jumps 57 units (1.448 m) with a tick-rate independent arc and lands after ~0.76 s', () => {
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
    expect(ticks).toBe(49);
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
    sim.step({ held: ['jump'] }, 150);
    const takeoffs = sim.history.filter((s, i) => i > 0 && s.velocity.y > 0 && sim.history[i - 1]!.grounded).length;
    expect(takeoffs).toBe(1); // the initial press only
    expect(sim.state.grounded).toBe(true);
  });

  it('like CS, needs the press on the ground: a press just before landing is lost', () => {
    const sim = settled();
    sim.step(JUMP);
    while (sim.state.position.y > 0.25 || sim.state.velocity.y > 0) sim.step();
    sim.step(JUMP);
    sim.settle();
    sim.step();
    expect(sim.state.grounded).toBe(true);
  });

  it('can buffer early presses when configured (e.g. for touch)', () => {
    const sim = new Sim(floorWorld(), { x: 0, y: 0, z: 0 }, 0, { ...CONFIG, jumpBufferSeconds: 0.1 });
    sim.settle();
    sim.step(JUMP);
    while (sim.state.position.y > 0.25 || sim.state.velocity.y > 0) sim.step();
    sim.step(JUMP);
    while (!sim.state.grounded) sim.step();
    sim.step();
    expect(sim.state.velocity.y).toBeGreaterThan(0);
  });

  it('stops rising at a ceiling and falls back', () => {
    const sim = settled(floorWorld(aabb(-1, 2.2, -1, 1, 2.4, 1)));
    sim.step(JUMP);
    sim.settle();
    const apex = Math.max(...sim.history.map((s) => s.position.y));
    expect(apex).toBeLessThanOrEqual(2.2 - CONFIG.standingHeight + 1e-9);
    expect(apex).toBeGreaterThan(0.36);
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
    sim.step(W, 64);
    sim.step(with_(W, JUMP));
    const speed = horizontalSpeed(sim.state);
    sim.step({}, 20);
    expect(horizontalSpeed(sim.state)).toBeCloseTo(speed, 12);
  });

  it('holding a direction in the air does not add speed beyond the 30 u/s air wish cap', () => {
    const sim = settled();
    sim.step(W, 64);
    sim.step(with_(W, JUMP));
    const speed = horizontalSpeed(sim.state);
    sim.step(W, 20);
    expect(horizontalSpeed(sim.state)).toBeCloseTo(speed, 12);
  });

  it('air strafing (strafe key + turning the view) gains speed, as in CS', () => {
    const sim = settled();
    sim.step(W, 64);
    sim.step(with_(W, JUMP));
    const takeoff = horizontalSpeed(sim.state);
    while (!sim.state.grounded) sim.step({ move: [1, 0], look: [0.03, 0] });
    expect(horizontalSpeed(sim.state)).toBeGreaterThan(takeoff * 1.1);
  });
});

describe('stamina (jump and landing slowdown)', () => {
  it('a running jump slows you for a moment after landing, then you recover full speed', () => {
    const sim = settled();
    sim.step(W, 64);
    sim.step(with_(W, JUMP));
    while (!sim.state.grounded) sim.step(W);
    expect(sim.state.stamina).toBeCloseTo(CONFIG.landStaminaCost, 12);
    sim.step(W);
    expect(horizontalSpeed(sim.state)).toBeLessThan(SPEED * 0.95);
    sim.step(W, 32);
    expect(horizontalSpeed(sim.state)).toBe(SPEED);
    expect(sim.state.stamina).toBe(0);
  });

  it('bunny-hopping without strafing loses speed on every hop', () => {
    const sim = settled();
    sim.step(W, 64);
    const speeds: number[] = [];
    for (let hop = 0; hop < 5; hop++) {
      sim.step(with_(W, JUMP));
      while (!sim.state.grounded) sim.step(W);
      speeds.push(horizontalSpeed(sim.state));
    }
    for (let i = 1; i < speeds.length; i++) expect(speeds[i]!).toBeLessThan(speeds[i - 1]! * 0.95);
  });

  it('does not charge a landing for spawning on the floor or stepping down', () => {
    const sim = new Sim(floorWorld(aabb(-10, 0, -10, 0, 0.3, 10)), { x: -1, y: 0.3, z: 0 });
    sim.settle();
    sim.step(D, 64);
    expect(sim.history.every((s) => s.stamina === 0)).toBe(true);
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

  it('slides along a wall when pushing diagonally into it', () => {
    const sim = settled(floorWorld(aabb(CONFIG.radius, 0, -80, 1, 3, 80)));
    sim.step(WD, 128);
    expect(sim.state.position.x).toBe(0);
    expect(sim.state.velocity.x).toBe(0);
    // Source-style: pushing diagonally into a wall slides at ~75 % of the max speed.
    expect(-sim.state.velocity.z).toBeGreaterThan(SPEED * 0.7);
    expect(-sim.state.velocity.z).toBeLessThan(SPEED * 0.8);
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
    expect(sim.state.position.x).toBeGreaterThan(3 + CONFIG.radius);
  });

  it('walks across floor seams without losing speed', () => {
    const world = new CollisionWorld([aabb(-50, -1, -50, 0, 0, 50), aabb(0, -1, -50, 50, 0, 50)]);
    const sim = new Sim(world, { x: -2, y: 0, z: 0 });
    sim.settle();
    sim.step(D, 40);
    sim.step(D, 64);
    expect(sim.history.slice(-64).every((s) => s.grounded && horizontalSpeed(s) === SPEED)).toBe(true);
  });

  it('passes a 0.85 m gap but not a 0.75 m one (the hull is 0.81 m wide)', () => {
    const through = settled(floorWorld(aabb(-3, 0, -3, -0.425, 2, -1), aabb(0.425, 0, -3, 3, 2, -1)));
    through.step(W, 128);
    expect(through.state.position.z).toBeLessThan(-4);

    const blocked = settled(floorWorld(aabb(-3, 0, -3, -0.375, 2, -1), aabb(0.375, 0, -3, 3, 2, -1)));
    blocked.step(W, 128);
    expect(blocked.state.position.z).toBeCloseTo(-1 + CONFIG.radius, 12);
  });

  it('cannot climb a wall by jumping into it', () => {
    const sim = settled(floorWorld(aabb(CONFIG.radius, 0, -5, 2, 10, 5)));
    for (let i = 0; i < 300; i++) sim.step(sim.state.grounded ? with_(D, JUMP) : D);
    expect(Math.max(...sim.history.map((s) => s.position.y))).toBeLessThanOrEqual(CONFIG.jumpHeight);
  });

  it('never tunnels through thin walls, even near the velocity limit', () => {
    const sim = new Sim(floorWorld(aabb(5, 0, -5, 5.01, 30, 5)), { x: 0, y: 10, z: 0 });
    sim.withVelocity({ x: 88, y: 0, z: 0 }); // 1.4 m per tick, airborne (no ground speed limit)
    sim.step({}, 8);
    expect(sim.history.every((s) => s.position.x <= 5 - CONFIG.radius + 1e-12)).toBe(true);
    expect(sim.state.position.x).toBeCloseTo(5 - CONFIG.radius, 12);
  });
});

describe('steps and ledges', () => {
  it.each([0.2, 0.45])('walks up a %d m step (step height 18 u = 0.457 m)', (height) => {
    const sim = settled(floorWorld(aabb(1, 0, -2, 30, height, 2)));
    sim.step(D, 64);
    expect(sim.state.position.y).toBeCloseTo(height, 12);
    expect(sim.state.position.x).toBeGreaterThan(2);
    expect(sim.state.grounded).toBe(true);
  });

  it('is blocked by a 0.6 m obstacle (it needs a jump)', () => {
    const sim = settled(floorWorld(aabb(1, 0, -2, 30, 0.6, 2)));
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
    sim.step(CROUCH, 11);
    expect(sim.state.crouchAmount).toBeLessThan(1);
    sim.step(CROUCH);
    expect(sim.state.crouchAmount).toBe(1);
    expect(eyePosition(sim.state, CONFIG).y).toBeCloseTo(CONFIG.crouchingEyeHeight, 12);
  });

  it('moves at crouch speed', () => {
    const sim = settled();
    sim.step(with_(W, CROUCH), 64);
    expect(horizontalSpeed(sim.state)).toBeCloseTo(CROUCH_SPEED, 12);
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
    const world = floorWorld(aabb(1, 0, -2, 3, CRATE, 2));
    const sim = settled(world, { x: 0.5, y: 0, z: 0 });
    sim.step(with_(with_(D, JUMP), CROUCH));
    expect(sim.state.position.y).toBeGreaterThan(CONFIG.standingHeight - CONFIG.crouchingHeight);
    sim.step(with_(D, CROUCH), 80);
    expect(sim.state.position.y).toBeCloseTo(CRATE, 12);
  });

  it('jumps with the crouched hull (no bonus) when already crouched on the ground', () => {
    const sim = settled();
    sim.step(CROUCH, 10);
    sim.step(with_(CROUCH, JUMP));
    sim.settle(CROUCH);
    expect(Math.max(...sim.history.map((s) => s.position.y))).toBeLessThanOrEqual(CONFIG.jumpHeight);
  });

  it('reaches a 64-unit crate (1.63 m) with a crouch-jump but not with a plain jump', () => {
    const world = floorWorld(aabb(1, 0, -2, 3, CRATE, 2));
    const plain = settled(world, { x: 0.5, y: 0, z: 0 });
    plain.step(with_(D, JUMP));
    plain.step(D, 80);
    expect(plain.state.position.y).toBe(0);

    const crouchJump = settled(world, { x: 0.5, y: 0, z: 0 });
    crouchJump.step(with_(D, JUMP));
    crouchJump.step(with_(D, CROUCH), 80);
    expect(crouchJump.state.position.y).toBeCloseTo(CRATE, 12);
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
          // Air strafing can exceed the run speed, but random input never gets anywhere near runaway speeds.
          if (horizontalSpeed(state) > 2 * SPEED) throw new Error(`too fast: ${horizontalSpeed(state)}`);
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
