import { describe, expect, it } from 'vitest';
import { SOUND_IDS, SOUNDS } from './sounds';

const RATE = 48000;

function rms(samples: Float32Array, from: number, to: number): number {
  let sum = 0;
  for (let i = from; i < to; i++) sum += (samples[i] as number) ** 2;
  return Math.sqrt(sum / Math.max(1, to - from));
}

/** Zero crossings per second: a rough brightness measure. */
function crossingRate(samples: Float32Array): number {
  let crossings = 0;
  for (let i = 1; i < samples.length; i++) if ((samples[i - 1] as number) < 0 !== (samples[i] as number) < 0) crossings++;
  return (crossings * RATE) / samples.length;
}

describe('procedural sounds', () => {
  for (const id of SOUND_IDS) {
    const definition = SOUNDS[id];

    it(`${id}: valid, normalized samples that start quickly and die out`, () => {
      for (let seed = 0; seed < definition.variants; seed++) {
        const samples = definition.synthesize(RATE, seed);
        expect(samples.length).toBeGreaterThan(RATE * 0.1);
        expect(samples.length).toBeLessThan(RATE * 0.8);

        let peak = 0;
        let onset = -1;
        for (let i = 0; i < samples.length; i++) {
          const value = Math.abs(samples[i] as number);
          expect(Number.isFinite(value)).toBe(true);
          peak = Math.max(peak, value);
          if (onset < 0 && value > 0.1) onset = i;
        }
        expect(peak).toBeLessThanOrEqual(1);
        expect(peak).toBeGreaterThan(0.75);
        expect(onset / RATE).toBeLessThan(0.07);

        const tenth = Math.floor(samples.length / 10);
        expect(rms(samples, samples.length - tenth, samples.length)).toBeLessThan(0.1 * rms(samples, onset, onset + tenth));
        expect(Math.abs(samples[samples.length - 1] as number)).toBeLessThan(1e-6); // faded out: no click at the end
      }
    });

    it(`${id}: deterministic, with distinct takes`, () => {
      expect(definition.synthesize(RATE, 0)).toEqual(definition.synthesize(RATE, 0));
      if (definition.variants > 1) expect(definition.synthesize(RATE, 1)).not.toEqual(definition.synthesize(RATE, 0));
    });
  }

  it('sound like what they are: the helmet tink is bright, steps and flesh hits are dull', () => {
    const brightness = (id: (typeof SOUND_IDS)[number]): number => crossingRate(SOUNDS[id].synthesize(RATE, 0));
    expect(brightness('helmet')).toBeGreaterThan(3000);
    expect(brightness('step')).toBeLessThan(1000);
    expect(brightness('flesh')).toBeLessThan(1000);
    expect(brightness('helmet')).toBeGreaterThan(4 * brightness('step'));
  });

  it('the shot is the longest and loudest-bodied sound', () => {
    const shot = SOUNDS.shot.synthesize(RATE, 0);
    const step = SOUNDS.step.synthesize(RATE, 0);
    expect(shot.length).toBeGreaterThan(step.length);
    expect(rms(shot, 0, RATE * 0.1)).toBeGreaterThan(rms(step, 0, RATE * 0.1));
  });
});
