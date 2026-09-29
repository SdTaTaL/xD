import type { Vec3 } from '../../math/Vec3';
import type { CollisionWorld } from '../../physics/CollisionWorld';
import { command, CONFIG, TICK, type Intent } from '../../player/test-support/simulation';
import { AK47, type WeaponDefinition } from '../../weapons/WeaponDefinition';
import type { Shot } from '../../weapons/WeaponController';
import { DEFAULT_WEAPON_RULES, type WeaponRules } from '../../weapons/WeaponRules';
import { freezeWeaponState, type WeaponState } from '../../weapons/WeaponState';
import { createCharacterState, simulateCharacterTick, type CharacterSimulationContext, type CharacterState } from '../CharacterSimulation';

export { AK47, DEFAULT_WEAPON_RULES as RULES };

export interface CharacterSimOptions {
  readonly position?: Vec3;
  readonly yaw?: number;
  readonly weapon?: WeaponDefinition;
  readonly rules?: WeaponRules;
  readonly spreadSeed?: number;
}

/** Feeds commands tick by tick to a character and records its states and shots. */
export class CharacterSim {
  readonly context: CharacterSimulationContext;
  state: CharacterState;
  tick = 0;
  readonly shots: Shot[] = [];
  readonly history: CharacterState[] = [];

  constructor(world: CollisionWorld, options: CharacterSimOptions = {}) {
    const weapon = options.weapon ?? AK47;
    this.context = {
      world,
      weapon,
      rules: options.rules ?? DEFAULT_WEAPON_RULES,
      movement: CONFIG,
      tickSeconds: TICK,
      spreadSeed: options.spreadSeed ?? 1,
    };
    this.state = createCharacterState({ position: options.position ?? { x: 0, y: 0, z: 0 }, yaw: options.yaw ?? 0 }, weapon);
  }

  get weapon(): WeaponState {
    return this.state.weapon;
  }

  /** Runs `ticks` ticks with the same intent (`pressed` on the first only). Returns the shots fired. */
  step(intent: Intent = {}, ticks = 1): Shot[] {
    const fired: Shot[] = [];
    for (let i = 0; i < ticks; i++) {
      const current = i === 0 ? intent : { ...intent, pressed: [] };
      const result = simulateCharacterTick(this.state, command(current, this.tick++), this.context);
      this.state = result.state;
      this.history.push(result.state);
      if (result.shot) fired.push(result.shot);
    }
    this.shots.push(...fired);
    return fired;
  }

  /** Stands still until grounded and settled. */
  settle(): void {
    this.step({}, 8);
  }

  /** Holds the trigger for `ticks` ticks (a press on the first). */
  fire(ticks = 1, extra: Intent = {}): Shot[] {
    return this.step({ ...extra, held: ['fire', ...(extra.held ?? [])], pressed: ['fire', ...(extra.pressed ?? [])] }, ticks);
  }

  /** Overrides weapon state fields (test setup). */
  setWeapon(fields: Partial<WeaponState>): void {
    this.state = Object.freeze({ ...this.state, weapon: freezeWeaponState({ ...this.state.weapon, ...fields }) });
  }
}
