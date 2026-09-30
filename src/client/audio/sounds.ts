import { bandpass, envelope, fadeOut, highpass, lowpass, mix, noise, normalize, saturate, silence, tone } from './dsp';

/** Every sound the game plays. */
export const SOUND_IDS = ['shot', 'dryfire', 'step', 'jump', 'land', 'impact', 'flesh', 'helmet', 'magout', 'magin', 'bolt'] as const;

export type SoundId = (typeof SOUND_IDS)[number];

export interface SoundDefinition {
  /** Different takes of the sound, cycled through so repeats do not sound identical. */
  readonly variants: number;
  /** Playback gain (the synthesized buffers are normalized). */
  readonly gain: number;
  /** Generates one take; `seed` differs per take. */
  readonly synthesize: (sampleRate: number, seed: number) => Float32Array;
}

/** A metallic click: a damped tone pair with a noise tick. */
function click(length: number, sampleRate: number, hz: number, tau: number, start: number, seed: number): Float32Array {
  return mix(length, [
    [tone(length, sampleRate, hz, tau, { start }), 0.8],
    [tone(length, sampleRate, hz * 2.07, tau * 0.7, { start }), 0.4],
    [envelope(highpass(noise(length, seed), 3000, sampleRate), sampleRate, tau * 0.5, 0.0003, start), 0.6],
  ]);
}

/** AK-47 shot: a sharp crack, a low muzzle thump, the body of the blast and a short room tail. */
function shot(sampleRate: number, seed: number): Float32Array {
  const n = silence(0.7, sampleRate).length;
  const white = noise(n, seed);
  return fadeOut(
    normalize(
      saturate(
        mix(n, [
          [envelope(highpass(white, 2500, sampleRate), sampleRate, 0.006, 0.0002), 1],
          [envelope(lowpass(white, 1700, sampleRate), sampleRate, 0.045, 0.0005), 1.6],
          [tone(n, sampleRate, 130, 0.07, { toHz: 42, glide: 0.035 }), 0.9],
          [envelope(lowpass(noise(n, seed + 1), 800, sampleRate), sampleRate, 0.2, 0.012, 0.004), 0.5],
        ]),
        2.2,
      ),
      0.95,
    ),
    sampleRate,
  );
}

/** Empty magazine: the hammer's double click. */
function dryFire(sampleRate: number, seed: number): Float32Array {
  const n = silence(0.12, sampleRate).length;
  return fadeOut(
    normalize(mix(n, [[click(n, sampleRate, 3100, 0.004, 0, seed), 1], [click(n, sampleRate, 2300, 0.005, 0.035, seed + 1), 0.6]]), 0.9),
    sampleRate,
  );
}

/** Boot on concrete: heel thud and a short scuff; takes vary in tone. */
function step(sampleRate: number, seed: number): Float32Array {
  const n = silence(0.2, sampleRate).length;
  const vary = 0.85 + (seed % 4) * 0.1;
  return fadeOut(
    normalize(
      mix(n, [
        [envelope(lowpass(noise(n, seed), 650 * vary, sampleRate), sampleRate, 0.022, 0.002), 1.2],
        [tone(n, sampleRate, 95 * vary, 0.028), 0.7],
        [envelope(bandpass(noise(n, seed + 7), 2400 * vary, 1.2, sampleRate), sampleRate, 0.02, 0.004, 0.028), 0.35],
      ]),
      0.9,
    ),
    sampleRate,
  );
}

/** Take-off: a quick scuff of both feet. */
function jump(sampleRate: number, seed: number): Float32Array {
  const n = silence(0.2, sampleRate).length;
  return fadeOut(
    normalize(
      mix(n, [
        [envelope(bandpass(noise(n, seed), 1700, 0.8, sampleRate), sampleRate, 0.04, 0.02), 1],
        [envelope(lowpass(noise(n, seed + 3), 500, sampleRate), sampleRate, 0.02, 0.002), 0.6],
      ]),
      0.8,
    ),
    sampleRate,
  );
}

/** Landing: both feet, heavier and lower than a step. */
function land(sampleRate: number, seed: number): Float32Array {
  const n = silence(0.32, sampleRate).length;
  return fadeOut(
    normalize(
      mix(n, [
        [step(sampleRate, seed), 0.8],
        [envelope(lowpass(noise(n, seed + 11), 450, sampleRate), sampleRate, 0.05, 0.002, 0.012), 1.2],
        [tone(n, sampleRate, 72, 0.06, { start: 0.01 }), 1],
      ]),
      0.95,
    ),
    sampleRate,
  );
}

/** Bullet into concrete: crack, a dusty body and a few debris ticks. */
function impact(sampleRate: number, seed: number): Float32Array {
  const n = silence(0.35, sampleRate).length;
  const layers: [Float32Array, number][] = [
    [envelope(highpass(noise(n, seed), 3500, sampleRate), sampleRate, 0.003, 0.0002), 1],
    [envelope(bandpass(noise(n, seed + 1), 1400, 1, sampleRate), sampleRate, 0.028, 0.001), 1.4],
  ];
  for (let i = 0; i < 5; i++) {
    const start = 0.02 + ((seed * 37 + i * 53) % 130) / 1000;
    layers.push([envelope(highpass(noise(n, seed + 20 + i), 2500, sampleRate), sampleRate, 0.003, 0.0002, start), 0.25]);
  }
  return fadeOut(normalize(mix(n, layers), 0.9), sampleRate);
}

/** Bullet into a body: a dull, wet thud. */
function flesh(sampleRate: number, seed: number): Float32Array {
  const n = silence(0.22, sampleRate).length;
  return fadeOut(
    normalize(
      mix(n, [
        [envelope(lowpass(noise(n, seed), 420, sampleRate), sampleRate, 0.025, 0.001), 1.3],
        [tone(n, sampleRate, 150, 0.045, { toHz: 70, glide: 0.03 }), 0.9],
        [envelope(bandpass(noise(n, seed + 5), 900, 1.5, sampleRate), sampleRate, 0.015, 0.001), 0.4],
      ]),
      0.9,
    ),
    sampleRate,
  );
}

/** Headshot on a helmet: the metallic "tink" CS players listen for. Inharmonic partials over a click. */
function helmet(sampleRate: number, seed: number): Float32Array {
  const n = silence(0.75, sampleRate).length;
  return fadeOut(
    normalize(
      mix(n, [
        [envelope(highpass(noise(n, seed), 4000, sampleRate), sampleRate, 0.002, 0.0002), 0.7],
        [tone(n, sampleRate, 2150, 0.2), 1],
        [tone(n, sampleRate, 3420, 0.14), 0.6],
        [tone(n, sampleRate, 5130, 0.09), 0.4],
        [tone(n, sampleRate, 6890, 0.06), 0.25],
      ]),
      0.85,
    ),
    sampleRate,
  );
}

/** Reload, magazine out: release catch and the magazine sliding free. */
function magOut(sampleRate: number, seed: number): Float32Array {
  const n = silence(0.25, sampleRate).length;
  return fadeOut(
    normalize(
      mix(n, [
        [click(n, sampleRate, 1900, 0.006, 0, seed), 1],
        [envelope(bandpass(noise(n, seed + 2), 3000, 2, sampleRate), sampleRate, 0.05, 0.03, 0.02), 0.5],
      ]),
      0.8,
    ),
    sampleRate,
  );
}

/** Reload, magazine in: a scrape into the well and the latch. */
function magIn(sampleRate: number, seed: number): Float32Array {
  const n = silence(0.25, sampleRate).length;
  return fadeOut(
    normalize(
      mix(n, [
        [envelope(bandpass(noise(n, seed), 2500, 2, sampleRate), sampleRate, 0.02, 0.01), 0.4],
        [click(n, sampleRate, 1300, 0.008, 0.06, seed + 1), 1],
        [tone(n, sampleRate, 180, 0.015, { start: 0.06 }), 0.6],
      ]),
      0.85,
    ),
    sampleRate,
  );
}

/** Reload, bolt: pulled back and released ("chk-chak"). */
function bolt(sampleRate: number, seed: number): Float32Array {
  const n = silence(0.35, sampleRate).length;
  return fadeOut(
    normalize(
      mix(n, [
        [click(n, sampleRate, 1600, 0.007, 0, seed), 0.7],
        [click(n, sampleRate, 1400, 0.009, 0.15, seed + 1), 1],
        [tone(n, sampleRate, 160, 0.02, { start: 0.15 }), 0.6],
      ]),
      0.85,
    ),
    sampleRate,
  );
}

/** The sound catalog. All procedural: no audio files. */
export const SOUNDS: Readonly<Record<SoundId, SoundDefinition>> = Object.freeze({
  shot: { variants: 3, gain: 0.8, synthesize: shot },
  dryfire: { variants: 1, gain: 0.45, synthesize: dryFire },
  step: { variants: 4, gain: 0.35, synthesize: step },
  jump: { variants: 1, gain: 0.25, synthesize: jump },
  land: { variants: 2, gain: 0.5, synthesize: land },
  impact: { variants: 3, gain: 0.55, synthesize: impact },
  flesh: { variants: 2, gain: 0.7, synthesize: flesh },
  helmet: { variants: 1, gain: 0.6, synthesize: helmet },
  magout: { variants: 1, gain: 0.45, synthesize: magOut },
  magin: { variants: 1, gain: 0.5, synthesize: magIn },
  bolt: { variants: 1, gain: 0.5, synthesize: bolt },
});
