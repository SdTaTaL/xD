import { describe, expect, it } from 'vitest';
import type { InputAction } from '../input/InputAction';
import { SeededRandom } from '../math/SeededRandom';
import { aabb } from '../physics/Aabb';
import { eyePosition, horizontalSpeed } from '../player/PlayerState';
import { CONFIG, floorWorld, randomIntents, TICK, type Intent } from '../player/test-support/simulation';
import { recoilKick } from '../weapons/recoil';
import { viewBasis } from '../weapons/spread';
import { AK47, CharacterSim, RULES } from './test-support/characterSim';

/** Floor plus a wall whose near face is the plane z = −10. */
const range = () => floorWorld(aabb(-50, 0, -11, 50, 20, -10));
const W = { move: [0, 1] as const };
const settled = (options: ConstructorParameters<typeof CharacterSim>[1] = {}): CharacterSim => {
  const sim = new CharacterSim(range(), options);
  sim.settle();
  return sim;
};
/** Tangent of the angle between a bullet and the direction it was aimed at. */
function deviation(shot: { direction: { x: number; y: number; z: number }; aim: { yaw: number; pitch: number } }): number {
  const { forward } = viewBasis(shot.aim);
  const cos = shot.direction.x * forward.x + shot.direction.y * forward.y + shot.direction.z * forward.z;
  return Math.tan(Math.acos(Math.min(1, cos)));
}

describe('movement with the AK-47', () => {
  it('runs at the weapon speed (215 u/s = 5.46 m/s); walk and crouch scale from it', () => {
    const run = settled();
    run.step(W, 64);
    expect(horizontalSpeed(run.state.player)).toBeCloseTo(AK47.maxSpeed, 12);

    const walk = settled();
    walk.step({ ...W, held: ['walk'] }, 64);
    expect(horizontalSpeed(walk.state.player)).toBeCloseTo(AK47.maxSpeed * CONFIG.walkSpeedScale, 12);

    const crouch = settled();
    crouch.step({ ...W, held: ['crouch'] }, 64);
    expect(horizontalSpeed(crouch.state.player)).toBeCloseTo(AK47.maxSpeed * CONFIG.crouchSpeedScale, 12);
  });
});

describe('firing', () => {
  it('fires the first shot on the press tick, from the eye, where the view points (standing accuracy)', () => {
    const sim = settled();
    const [shot] = sim.fire(1);
    expect(shot?.tick).toBe(sim.tick - 1);
    expect(shot?.origin).toEqual(eyePosition(sim.state.player, CONFIG));
    expect(shot?.aim).toEqual({ yaw: 0, pitch: 0 });
    expect(shot?.inaccuracy).toBe(AK47.inaccuracyStand);
    expect(deviation(shot!)).toBeLessThanOrEqual(AK47.inaccuracyStand + AK47.spread + 1e-12);
    expect(shot?.hit?.normal).toEqual({ x: 0, y: 0, z: 1 });
    expect(shot?.hit?.point.z).toBe(-10);
    expect(shot?.hit?.distance).toBeCloseTo(10, 3);
  });

  it('fires exactly 600 rounds per minute while held: shot k at tick ⌈6.4 k⌉', () => {
    const sim = settled();
    const shots = sim.fire(64 * 3);
    expect(shots).toHaveLength(30);
    const first = shots[0]!.tick;
    shots.forEach((shot, k) => expect(shot.tick - first).toBe(Math.ceil((k * 32) / 5)));
    expect((shots[29]!.tick - first) * TICK).toBeCloseTo(2.9, 1);
  });

  it('counts down the magazine and walks through the spray pattern', () => {
    const sim = settled();
    const shots = sim.fire(64);
    expect(shots.map((shot) => shot.sprayIndex)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(sim.weapon.ammo).toBe(20);
    expect(sim.weapon.reserve).toBe(90);
  });

  it('fires one shot per press with a semi-automatic weapon', () => {
    const sim = settled({ weapon: { ...AK47, id: 'semi', fullAuto: false } });
    expect(sim.fire(64)).toHaveLength(1);
    expect(sim.fire(1)).toHaveLength(1);
  });
});

describe('recoil', () => {
  it('climbs during a spray: later shots aim higher than the view', () => {
    const sim = settled();
    const shots = sim.fire(64);
    expect(shots[0]!.aim.pitch).toBe(0);
    expect(shots[1]!.aim.pitch).toBeGreaterThan(0);
    expect(shots[9]!.aim.pitch).toBeGreaterThan(shots[4]!.aim.pitch);
    expect(shots[9]!.aim.pitch).toBeGreaterThan(5 * (Math.PI / 180));
    // Aim = view + punch × 2 (the view itself never moved).
    expect(sim.state.player.pitch).toBe(0);
  });

  it('kicks the aim punch by the pattern, then recovers to rest after the spray', () => {
    const sim = settled();
    sim.fire(1);
    const kick = recoilKick(AK47, RULES, 0);
    expect(sim.weapon.aimPunchVelocity.pitch).toBeGreaterThan(0.9 * kick.pitch);
    sim.fire(64);
    sim.step({}, 5 * 64);
    expect(sim.weapon.aimPunch).toEqual({ yaw: 0, pitch: 0 });
    expect(sim.weapon.aimPunchVelocity).toEqual({ yaw: 0, pitch: 0 });
  });

  it('continues the pattern after a short pause, restarts it after 0.55 s', () => {
    const sim = settled();
    expect(sim.fire(27)).toHaveLength(5);
    sim.step({}, 19); // 0.3 s
    expect(sim.fire(1)[0]?.sprayIndex).toBe(5);
    sim.step({}, 36); // > 0.55 s since the last shot
    expect(sim.fire(1)[0]?.sprayIndex).toBe(0);
  });
});

describe('accuracy', () => {
  it('adds the fire penalty per shot and recovers first-shot accuracy after a tap', () => {
    const sim = settled();
    sim.fire(1);
    expect(sim.weapon.accuracyPenalty).toBeCloseTo(AK47.inaccuracyFire, 15);
    sim.step({}, Math.ceil(AK47.recoveryStand.initial / TICK));
    // One recovery time later only ~10 % is left.
    expect(sim.weapon.accuracyPenalty).toBeLessThan(0.1 * AK47.inaccuracyFire);
    const [next] = sim.fire(1);
    expect(next!.inaccuracy - AK47.inaccuracyStand).toBeLessThan(0.1 * AK47.inaccuracyFire);
  });

  it('is poor while running and full again after counter-strafing below 34 % speed', () => {
    const sim = settled({ yaw: Math.PI });
    sim.step({ move: [1, 0] }, 64);
    const [running] = sim.fire(1, { move: [1, 0] });
    expect(running!.inaccuracy).toBeCloseTo(AK47.inaccuracyStand + AK47.inaccuracyMove, 12);

    sim.step({}, 64); // let the tap's penalty recover
    sim.step({ move: [1, 0] }, 64);
    let ticks = 0;
    while (horizontalSpeed(sim.state.player) > 0.34 * AK47.maxSpeed) {
      sim.step({ move: [-1, 0] });
      ticks++;
    }
    expect(ticks).toBeLessThanOrEqual(5);
    const [stopped] = sim.fire(1, { move: [-1, 0] });
    expect(stopped!.inaccuracy - AK47.inaccuracyStand).toBeLessThan(1e-4); // only what is left of the earlier tap
  });

  it('is crouch accuracy while crouched and still', () => {
    const sim = settled();
    sim.step({ held: ['crouch'] }, 16);
    expect(sim.fire(1, { held: ['crouch'] })[0]?.inaccuracy).toBe(AK47.inaccuracyCrouch);
  });

  it('is very poor in the air', () => {
    const sim = settled();
    sim.step({ pressed: ['jump'] }, 10);
    expect(sim.fire(1)[0]?.inaccuracy).toBeCloseTo(AK47.inaccuracyStand + AK47.inaccuracyJump, 15);
  });

  it('adds landing inaccuracy in proportion to the fall speed', () => {
    const probe = settled();
    probe.step({ pressed: ['jump'] });
    while (!probe.state.player.grounded) probe.step();
    const landingTick = probe.tick - 1;
    const fallSpeed = -probe.history[probe.history.length - 2]!.player.velocity.y;

    const sim = settled();
    sim.step({ pressed: ['jump'] });
    sim.step({}, landingTick - sim.tick);
    const [shot] = sim.fire(1);
    expect(sim.state.player.grounded).toBe(true);
    expect(shot!.inaccuracy).toBeCloseTo(AK47.inaccuracyStand + AK47.inaccuracyLandPerSpeed * fallSpeed, 12);
    expect(shot!.inaccuracy).toBeGreaterThan(5 * AK47.inaccuracyStand);
  });
});

describe('reload', () => {
  it('reloads automatically when the trigger is held on an empty magazine, in 2.47 s', () => {
    const sim = settled();
    sim.fire(64 * 3 + 1);
    expect(sim.weapon.ammo).toBe(0);
    expect(sim.weapon.reloadRemaining).toBeGreaterThan(0);
    // History index = tick. The reload started on the tick after the last shot.
    const started = sim.history.findIndex((state) => state.weapon.reloadRemaining > 0);
    expect(started - 1).toBe(sim.shots[29]!.tick);
    let reloaded = -1;
    for (let i = 0; i < 400 && reloaded < 0; i++) {
      const fired = sim.fire(1);
      if (sim.weapon.reloadRemaining > 0) {
        expect(fired).toHaveLength(0); // never fires while reloading
      } else {
        // Firing is allowed again on the tick the reload ends; the trigger is still held.
        reloaded = sim.tick - 1;
        expect(fired).toHaveLength(1);
      }
    }
    expect((reloaded - started) * TICK).toBeCloseTo(AK47.reloadSeconds, 1);
    expect(reloaded - started).toBe(Math.ceil(AK47.reloadSeconds / TICK));
    expect([sim.weapon.ammo, sim.weapon.reserve]).toEqual([29, 60]);
  });

  it('refills a partial magazine from the reserve with the reload key', () => {
    const sim = settled();
    sim.fire(27);
    sim.step({}, 64);
    sim.step({ pressed: ['reload'] });
    expect(sim.weapon.reloadRemaining).toBeGreaterThan(0);
    sim.step({}, 160);
    expect([sim.weapon.ammo, sim.weapon.reserve]).toEqual([30, 85]);
  });

  it('ignores the reload key with a full magazine or no spare ammo', () => {
    const full = settled();
    full.step({ pressed: ['reload'] });
    expect(full.weapon.reloadRemaining).toBe(0);

    const dry = settled();
    dry.setWeapon({ ammo: 0, reserve: 0 });
    dry.step({ pressed: ['reload'] });
    expect(dry.fire(64)).toHaveLength(0);
    expect(dry.weapon.reloadRemaining).toBe(0);
  });

  it('loads only what the reserve has left', () => {
    const sim = settled();
    sim.setWeapon({ ammo: 0, reserve: 12 });
    sim.step({ pressed: ['reload'] }, 170);
    expect([sim.weapon.ammo, sim.weapon.reserve]).toEqual([12, 0]);
  });
});

describe('determinism', () => {
  /** Movement fuzz plus random trigger, reload and bursts. */
  function combatIntents(seed: number, ticks: number): Intent[] {
    const random = new SeededRandom(seed);
    let trigger = false;
    return randomIntents(seed, ticks).map((intent) => {
      if (random.next() < 0.05) trigger = !trigger;
      const extra: InputAction[] = trigger ? ['fire'] : [];
      const reload: InputAction[] = random.next() < 0.01 ? ['reload'] : [];
      return {
        ...intent,
        held: [...(intent.held ?? []), ...extra],
        pressed: [...(intent.pressed ?? []), ...extra, ...reload],
      };
    });
  }

  it('produces identical states and shots from identical commands', () => {
    const intents = combatIntents(4, 3000);
    const run = (): CharacterSim => {
      const sim = new CharacterSim(range(), { spreadSeed: 77 });
      for (const intent of intents) sim.step(intent);
      return sim;
    };
    const a = run();
    const b = run();
    expect(a.shots.length).toBeGreaterThan(50);
    expect(b.history).toEqual(a.history);
    expect(b.shots).toEqual(a.shots);
  });

  it('draws different spread for a different shooter seed, with the same recoil', () => {
    const a = settled({ spreadSeed: 1 }).fire(10);
    const b = settled({ spreadSeed: 2 }).fire(10);
    expect(b.map((shot) => shot.aim)).toEqual(a.map((shot) => shot.aim));
    expect(b.map((shot) => shot.direction)).not.toEqual(a.map((shot) => shot.direction));
  });

  it('keeps plain, frozen, serializable state', () => {
    const sim = settled();
    sim.fire(20);
    expect(Object.isFrozen(sim.state)).toBe(true);
    expect(Object.isFrozen(sim.weapon.aimPunch)).toBe(true);
    expect(JSON.parse(JSON.stringify(sim.weapon))).toEqual(sim.weapon);
  });
});

describe('trigger input', () => {
  it('fires on a click shorter than a tick (pressed, no longer held)', () => {
    const sim = settled();
    expect(sim.step({ pressed: ['fire'] })).toHaveLength(1);
  });
});
