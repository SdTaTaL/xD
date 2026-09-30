import { PerspectiveCamera } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { AK47, CharacterSim } from '@shared/character/test-support/characterSim';
import type { CharacterState } from '@shared/character/CharacterSimulation';
import type { ShotOutcome } from '@shared/combat/targets';
import type { InputCommand } from '@shared/input/InputCommand';
import type { Vec3 } from '@shared/math/Vec3';
import { command, floorWorld, TICK, type Intent } from '@shared/player/test-support/simulation';
import type { Shot } from '@shared/weapons/WeaponController';
import type { AudioOutput, PlayOptions } from './AudioOutput';
import { GameAudio, type AudioPlayerSource } from './GameAudio';
import type { SoundId } from './sounds';

class FakeOutput implements AudioOutput {
  readonly state = 'running' as const;
  readonly plays: { id: SoundId; options: PlayOptions; tick: number }[] = [];
  listener: { position: Vec3; forward: Vec3; up: Vec3 } | null = null;
  tick = 0;
  play(id: SoundId, options: PlayOptions = {}): void {
    this.plays.push({ id, options, tick: this.tick });
  }
  setListener(position: Vec3, forward: Vec3, up: Vec3): void {
    this.listener = { position: { ...position }, forward: { ...forward }, up: { ...up } };
  }
  dispose(): void {}
  ids(): SoundId[] {
    return this.plays.map((play) => play.id);
  }
}

/** Runs a real character tick by tick and feeds GameAudio like LocalPlayerSystem does. */
class Driver implements AudioPlayerSource {
  readonly sim = new CharacterSim(floorWorld());
  readonly output = new FakeOutput();
  readonly audio: GameAudio;
  private readonly shotListeners = new Set<(shot: Shot) => void>();
  readonly outcomeListeners = new Set<(outcome: ShotOutcome) => void>();
  private before: CharacterState;
  private lastCommand: InputCommand | undefined;

  constructor() {
    this.sim.settle();
    this.before = this.sim.state;
    this.audio = new GameAudio({
      output: this.output,
      player: this,
      range: { onShotResolved: (listener) => (this.outcomeListeners.add(listener), () => this.outcomeListeners.delete(listener)) },
      weapon: AK47,
      camera: new PerspectiveCamera(),
      tickSeconds: TICK,
    });
  }

  get previous() { return this.before.player; }
  get current() { return this.sim.state.player; }
  get previousWeapon() { return this.before.weapon; }
  get weapon() { return this.sim.state.weapon; }
  get command() { return this.lastCommand; }
  onShot(listener: (shot: Shot) => void): () => void {
    this.shotListeners.add(listener);
    return () => this.shotListeners.delete(listener);
  }

  run(intent: Intent, ticks: number): void {
    for (let i = 0; i < ticks; i++) {
      const current = i === 0 ? intent : { ...intent, pressed: [] };
      this.output.tick = this.sim.tick;
      this.lastCommand = command(current, this.sim.tick);
      this.before = this.sim.state;
      for (const shot of this.sim.step(current)) for (const listener of this.shotListeners) listener(shot);
      this.audio.fixedUpdate();
    }
  }
}

const shot = (fields: Partial<Shot>): Shot => ({
  tick: 0,
  origin: { x: 0, y: 1.6, z: 0 },
  direction: { x: 0, y: 0, z: -1 },
  aim: { yaw: 0, pitch: 0 },
  inaccuracy: 0,
  sprayIndex: 0,
  hit: null,
  ...fields,
});

describe('GameAudio', () => {
  it('plays each own shot at the ears, varying its pitch slightly', () => {
    const driver = new Driver();
    driver.run({ held: ['fire'], pressed: ['fire'] }, 64);
    const shots = driver.output.plays.filter((play) => play.id === 'shot');
    expect(shots).toHaveLength(10);
    expect(shots.every((play) => play.options.position === undefined)).toBe(true);
    const rates = shots.map((play) => play.options.rate ?? 1);
    expect(Math.min(...rates)).toBeGreaterThanOrEqual(0.97);
    expect(Math.max(...rates)).toBeLessThanOrEqual(1.03);
    expect(new Set(rates).size).toBeGreaterThan(1);
  });

  it('plays where the bullet went: concrete, a body, or the helmet tink', () => {
    const driver = new Driver();
    const resolve = (outcome: ShotOutcome): void => {
      for (const listener of driver.outcomeListeners) listener(outcome);
    };
    const wall = { distance: 10, point: { x: 0, y: 1.6, z: -10 }, normal: { x: 0, y: 0, z: 1 }, solid: 0 };
    const body = (group: 'head' | 'chest', kevlar: number) => ({
      target: 0,
      group,
      distance: 5,
      point: { x: 1, y: 1.5, z: -5 },
      damage: { health: 27, kevlar },
      health: 73,
      killed: false,
    });
    resolve({ shot: shot({ hit: wall }), target: null });
    resolve({ shot: shot({}), target: body('chest', 4) });
    resolve({ shot: shot({}), target: body('head', 16) });
    resolve({ shot: shot({}), target: body('head', 0) }); // no helmet
    resolve({ shot: shot({}), target: null }); // into the sky
    expect(driver.output.plays.map((play) => [play.id, play.options.position])).toEqual([
      ['impact', wall.point],
      ['flesh', { x: 1, y: 1.5, z: -5 }],
      ['helmet', { x: 1, y: 1.5, z: -5 }],
      ['flesh', { x: 1, y: 1.5, z: -5 }],
    ]);
  });

  it('steps when running, not when walking; jumps and lands', () => {
    const running = new Driver();
    running.run({ move: [0, 1] }, 64 * 2);
    expect(running.output.ids().filter((id) => id === 'step').length).toBeGreaterThanOrEqual(5);
    expect(running.audio.movement?.sound).toBe('step');

    const walking = new Driver();
    walking.run({ move: [0, 1], held: ['walk'] }, 64 * 2);
    expect(walking.output.ids()).toEqual([]);

    const jumping = new Driver();
    jumping.run({ pressed: ['jump'] }, 64);
    expect(jumping.output.ids()).toEqual(['jump', 'land']);
  });

  it("plays the reload in three steps at the view model's magazine swap", () => {
    const driver = new Driver();
    driver.sim.setWeapon({ ammo: 10 });
    driver.run({ pressed: ['reload'] }, 170);
    const reload = driver.output.plays.filter((play) => play.id !== 'step');
    expect(reload.map((play) => play.id)).toEqual(['magout', 'magin', 'bolt']);
    const ticks = Math.ceil(AK47.reloadSeconds / TICK);
    expect(reload.map((play) => Math.round((100 * (play.tick - 8)) / ticks))).toEqual([20, 55, 80]);
  });

  it('clicks dry when firing an empty magazine, but not during the reload that follows', () => {
    const dry = new Driver();
    dry.sim.setWeapon({ ammo: 0, reserve: 0 });
    dry.run({ held: ['fire'], pressed: ['fire'] }, 10);
    expect(dry.output.ids()).toEqual(['dryfire']);

    const reloading = new Driver();
    reloading.sim.setWeapon({ ammo: 0 });
    reloading.run({ pressed: ['fire'] }, 20); // empty click; the reload starts
    reloading.run({ pressed: ['fire'] }, 20); // pressed again mid-reload
    expect(reloading.output.ids()).toEqual(['dryfire', 'magout']);
  });

  it('places the ears at the camera', () => {
    const camera = new PerspectiveCamera();
    camera.position.set(1, 2, 3);
    camera.rotation.set(0, -Math.PI / 2, 0, 'YXZ'); // yaw +90°: facing +X
    const output = new FakeOutput();
    const audio = new GameAudio({
      output,
      player: new Driver(),
      range: { onShotResolved: () => () => {} },
      weapon: AK47,
      camera,
      tickSeconds: TICK,
    });
    audio.update();
    expect(output.listener?.position).toEqual({ x: 1, y: 2, z: 3 });
    expect(output.listener?.forward.x).toBeCloseTo(1, 12);
    expect(output.listener?.up.y).toBeCloseTo(1, 12);
  });
});
