import { SeededRandom } from '@shared/math/SeededRandom';

/**
 * Minimal offline DSP for synthesizing sound effects into sample arrays.
 * Pure functions on Float32Array (mono, −1..1), no Web Audio needed, so
 * every sound can be generated and tested anywhere and is identical on
 * every run (noise comes from a seeded generator).
 */

const TAU = Math.PI * 2;

/** A silent buffer of `seconds`. */
export function silence(seconds: number, sampleRate: number): Float32Array {
  return new Float32Array(Math.max(1, Math.round(seconds * sampleRate)));
}

/** White noise in −1..1. */
export function noise(length: number, seed: number): Float32Array {
  const random = new SeededRandom(seed);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) out[i] = random.next() * 2 - 1;
  return out;
}

/** One-pole low-pass (6 dB/octave). */
export function lowpass(input: Float32Array, cutoffHz: number, sampleRate: number): Float32Array {
  const a = 1 - Math.exp((-TAU * cutoffHz) / sampleRate);
  const out = new Float32Array(input.length);
  let y = 0;
  for (let i = 0; i < input.length; i++) {
    y += a * ((input[i] as number) - y);
    out[i] = y;
  }
  return out;
}

/** One-pole high-pass (the input minus its low-pass). */
export function highpass(input: Float32Array, cutoffHz: number, sampleRate: number): Float32Array {
  const low = lowpass(input, cutoffHz, sampleRate);
  return input.map((value, i) => value - (low[i] as number));
}

/** Band-pass biquad (RBJ cookbook, constant 0 dB peak gain). */
export function bandpass(input: Float32Array, centerHz: number, q: number, sampleRate: number): Float32Array {
  const w = (TAU * centerHz) / sampleRate;
  const alpha = Math.sin(w) / (2 * q);
  const a0 = 1 + alpha;
  const b0 = alpha / a0;
  const b2 = -alpha / a0;
  const a1 = (-2 * Math.cos(w)) / a0;
  const a2 = (1 - alpha) / a0;
  const out = new Float32Array(input.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < input.length; i++) {
    const x = input[i] as number;
    const y = b0 * x + b2 * x2 - a1 * y1 - a2 * y2;
    out[i] = y;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
  }
  return out;
}

/**
 * Multiplies by an envelope: silent before `start`, a linear rise over
 * `attack`, then an exponential decay with time constant `tau` (seconds).
 */
export function envelope(input: Float32Array, sampleRate: number, tau: number, attack = 0.001, start = 0): Float32Array {
  return input.map((value, i) => {
    const t = i / sampleRate - start;
    if (t < 0) return 0;
    const rise = attack > 0 ? Math.min(1, t / attack) : 1;
    return value * rise * Math.exp(-t / tau);
  });
}

/** A decaying sine starting at `start`, its pitch gliding exponentially from `fromHz` to `toHz` (time constant `glide`). */
export function tone(length: number, sampleRate: number, fromHz: number, tau: number, options: { toHz?: number; glide?: number; start?: number } = {}): Float32Array {
  const { toHz = fromHz, glide = 0.05, start = 0 } = options;
  const out = new Float32Array(length);
  let phase = 0;
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate - start;
    if (t < 0) continue;
    const frequency = toHz + (fromHz - toHz) * Math.exp(-t / glide);
    phase += (TAU * frequency) / sampleRate;
    out[i] = Math.sin(phase) * Math.exp(-t / tau);
  }
  return out;
}

/** Sum of layers, each scaled by its gain. Layers may be shorter than the result. */
export function mix(length: number, layers: readonly (readonly [Float32Array, number])[]): Float32Array {
  const out = new Float32Array(length);
  for (const [layer, gain] of layers) {
    const n = Math.min(length, layer.length);
    for (let i = 0; i < n; i++) out[i] = (out[i] as number) + (layer[i] as number) * gain;
  }
  return out;
}

/** Smooth saturation: adds punch and keeps peaks within −1..1. */
export function saturate(input: Float32Array, drive: number): Float32Array {
  const norm = Math.tanh(drive);
  return input.map((value) => Math.tanh(value * drive) / norm);
}

/** Scales to the given peak (a silent buffer stays silent). */
export function normalize(input: Float32Array, peak: number): Float32Array {
  let max = 0;
  for (const value of input) max = Math.max(max, Math.abs(value));
  if (max === 0) return input;
  const scale = peak / max;
  return input.map((value) => value * scale);
}

/** Short fade-out at the end, so a buffer never stops with a click. */
export function fadeOut(input: Float32Array, sampleRate: number, seconds = 0.01): Float32Array {
  const n = Math.min(input.length, Math.round(seconds * sampleRate));
  const out = input.slice();
  for (let i = 0; i < n; i++) {
    const index = input.length - 1 - i;
    out[index] = (out[index] as number) * (i / n);
  }
  return out;
}
