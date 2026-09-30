import { describe, expect, it } from 'vitest';
import { aabb } from '../physics/Aabb';
import { advanceFootsteps, DEFAULT_FOOTSTEP_RULES, FOOTSTEPS_AT_REST, type MovementSound } from './footsteps';
import type { PlayerState } from './PlayerState';
import { CONFIG, floorWorld, Sim, TICK, type Intent } from './test-support/simulation';

interface Heard {
  readonly tick: number;
  readonly sound: MovementSound;
  readonly foot: 0 | 1;
}

/** Runs the intents after settling on the ground and lists the movement sounds, tick by tick. */
function listen(sim: Sim, steps: readonly [Intent, number][]): Heard[] {
  sim.settle();
  let previous: PlayerState = sim.state;
  let footsteps = FOOTSTEPS_AT_REST;
  const heard: Heard[] = [];
  for (const [intent, ticks] of steps) {
    for (let i = 0; i < ticks; i++) {
      const current = sim.step(i === 0 ? intent : { ...intent, pressed: [] });
      const result = advanceFootsteps(footsteps, previous, current, CONFIG.maxSpeed, TICK);
      footsteps = result.state;
      if (result.sound) heard.push({ tick: sim.tick - 1, sound: result.sound, foot: result.foot });
      previous = current;
    }
  }
  return heard;
}

const W: Intent = { move: [0, 1] };

describe('footsteps', () => {
  it('runs with alternating steps, one every 0.3 s at full speed', () => {
    const heard = listen(new Sim(floorWorld()), [[W, 64 * 4]]);
    expect(heard.every((h) => h.sound === 'step')).toBe(true);
    expect(heard.map((h) => h.foot).slice(0, 4)).toEqual([0, 1, 0, 1]);
    // After the run-up, steps are 75 units apart: 0.3 s = 19.2 ticks at 250 u/s.
    const late = heard.slice(-6);
    for (let i = 1; i < late.length; i++) {
      const gap = late[i]!.tick - late[i - 1]!.tick;
      expect(gap === 19 || gap === 20).toBe(true);
    }
    expect(heard.length).toBeGreaterThanOrEqual(12);
  });

  it('is silent walking with Shift (52 %) and crouching (34 %), and standing still', () => {
    expect(listen(new Sim(floorWorld()), [[{ ...W, held: ['walk'] }, 64 * 3]])).toEqual([]);
    expect(listen(new Sim(floorWorld()), [[{ ...W, held: ['crouch'] }, 64 * 3]])).toEqual([]);
    expect(listen(new Sim(floorWorld()), [[{}, 64]])).toEqual([]);
  });

  it('makes a sound on take-off and on a jump landing', () => {
    const heard = listen(new Sim(floorWorld()), [[{ pressed: ['jump'] }, 64 * 2]]);
    expect(heard.map((h) => h.sound)).toEqual(['jump', 'land']);
    expect(heard[1]!.tick - heard[0]!.tick).toBe(48); // 0.77 s in the air
  });

  it('lands silently from a small drop, loudly from a high one (260 u/s)', () => {
    // Walk off a 0.5 m block (lands at ~4.5 m/s) and off a 1.5 m block (~7.8 m/s).
    for (const [height, expected] of [[0.5, []], [1.5, ['land']]] as const) {
      const world = floorWorld(aabb(-2, 0, -2, 2, height, 2));
      const heard = listen(new Sim(world, { x: 0, y: height, z: 0 }), [[{ ...W, held: ['walk'] }, 64 * 3]]);
      expect(heard.map((h) => h.sound)).toEqual(expected);
    }
    expect(DEFAULT_FOOTSTEP_RULES.landingSpeed).toBeCloseTo(6.604, 12);
  });
});
