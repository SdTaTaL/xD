import { describe, expect, it } from 'vitest';
import type { ShotOutcome } from '@shared/combat/targets';
import type { TargetSpawn } from '@shared/maps/MapDefinition';
import { SOURCE_UNIT } from '@shared/player/PlayerMovementConfig';
import { SIMULATION_TICK_SECONDS as TICK } from '@shared/simulation/SimulationConfig';
import type { Shot } from '@shared/weapons/WeaponController';
import { AK47 } from '@shared/weapons/WeaponDefinition';
import { TrainingRange } from './TrainingRange';

const SPAWN: TargetSpawn = { position: { x: 0, y: 0, z: 0 }, yaw: 0, kevlar: 100, helmet: true };

/** A bullet flying along +Z at the given height (in units), towards the body's front. */
function shotAtHeight(units: number, tick = 0): Shot {
  return {
    tick,
    origin: { x: 0, y: units * SOURCE_UNIT, z: -10 },
    direction: { x: 0, y: 0, z: 1 },
    aim: { yaw: 0, pitch: 0 },
    inaccuracy: 0,
    sprayIndex: 0,
    hit: null,
  };
}

function setup() {
  let fire: (shot: Shot) => void = () => {};
  let subscribed = 0;
  const source = {
    onShot: (listener: (shot: Shot) => void) => {
      fire = listener;
      subscribed++;
      return () => subscribed--;
    },
  };
  const range = new TrainingRange({ source, weapon: AK47, spawns: [SPAWN] });
  const outcomes: ShotOutcome[] = [];
  range.onShotResolved((outcome) => outcomes.push(outcome));
  return { range, outcomes, fire: (shot: Shot) => fire(shot), subscribed: () => subscribed };
}

describe('TrainingRange', () => {
  it('resolves every shot as it is fired and reports the outcome', () => {
    const { range, outcomes, fire } = setup();
    fire(shotAtHeight(51));
    fire(shotAtHeight(100)); // over the head
    expect(outcomes.map((outcome) => outcome.target?.group ?? null)).toEqual(['chest', null]);
    expect(range.states[0]).toMatchObject({ health: 73, kevlar: 97 }); // at 10 m the kevlar cost is 3.98 → 3
  });

  it('knocks a target down with a headshot and stands it up 2 s later, once per tick', () => {
    const { range, fire } = setup();
    fire(shotAtHeight(65));
    expect(range.states[0]?.health).toBe(0);
    for (let tick = 0; tick < 127; tick++) range.fixedUpdate({ tick, deltaSeconds: TICK });
    expect(range.states[0]?.health).toBe(0);
    range.fixedUpdate({ tick: 127, deltaSeconds: TICK });
    expect(range.states[0]).toMatchObject({ health: 100, kevlar: 100, helmet: true });
  });

  it('stops listening to shots when disposed', () => {
    const { range, subscribed } = setup();
    expect(subscribed()).toBe(1);
    range.dispose();
    expect(subscribed()).toBe(0);
  });
});
