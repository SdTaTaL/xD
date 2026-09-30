import type { Vec3 } from '@shared/math/Vec3';
import { createLogger } from '../core/Logger';
import type { AudioOutput, AudioOutputState, PlayOptions } from './AudioOutput';
import { SOUND_IDS, SOUNDS, type SoundId } from './sounds';

export interface WebAudioOutputOptions {
  /** Pointer presses here unlock audio (the game view: the click that captures the mouse). */
  readonly gestureTarget: EventTarget;
  /** Key presses here unlock audio too. */
  readonly keyTarget: EventTarget;
  /** Master volume, 0–1. */
  readonly volume: number;
}

const log = createLogger('audio');

/** Distance at which a positional sound starts to fade, and beyond which it fades no further, meters. */
const REFERENCE_DISTANCE = 2;
const MAX_DISTANCE = 80;
/** Output level window: the level readout covers about this long, seconds. */
const LEVEL_WINDOW = 2048;

/**
 * Plays the procedural sounds with the Web Audio API.
 *
 * Browsers only let audio start after a user gesture, so the AudioContext is
 * created on the first pointer or key press, never before (no autoplay
 * warnings; the capture click unlocks it), and the sounds are synthesized
 * right after it.
 * Positional sounds go through HRTF panners (direction and distance, as with
 * headphones in CS2); the player's own weapon and steps play at the ears.
 */
export class WebAudioOutput implements AudioOutput {
  private readonly options: WebAudioOutputOptions;
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private levelBuffer: Float32Array<ArrayBuffer> | null = null;
  private readonly buffers = new Map<SoundId, AudioBuffer[]>();
  private readonly nextVariant = new Map<SoundId, number>();
  private readonly counts = new Map<SoundId, number>();
  private closed = false;

  constructor(options: WebAudioOutputOptions) {
    this.options = options;
    options.gestureTarget.addEventListener('pointerdown', this.unlock);
    options.keyTarget.addEventListener('keydown', this.unlock);
  }

  get state(): AudioOutputState {
    if (this.closed) return 'closed';
    if (typeof AudioContext === 'undefined') return 'unavailable';
    if (!this.context) return 'locked';
    return this.context.state === 'running' ? 'running' : this.context.state === 'closed' ? 'closed' : 'suspended';
  }

  get sampleRate(): number {
    return this.context?.sampleRate ?? 0;
  }

  /** Sounds started so far, per id. */
  get played(): ReadonlyMap<SoundId, number> {
    return this.counts;
  }

  /** Peak of the output over the last ~40 ms, 0–1 (for the debug panel and tests). */
  level(): number {
    if (!this.analyser || !this.levelBuffer) return 0;
    this.analyser.getFloatTimeDomainData(this.levelBuffer);
    let peak = 0;
    for (const value of this.levelBuffer) peak = Math.max(peak, Math.abs(value));
    return peak;
  }

  play(id: SoundId, options: PlayOptions = {}): void {
    const context = this.context;
    const takes = this.buffers.get(id);
    if (!context || !this.master || !takes || context.state !== 'running') return;

    const variant = this.nextVariant.get(id) ?? 0;
    this.nextVariant.set(id, (variant + 1) % takes.length);
    this.counts.set(id, (this.counts.get(id) ?? 0) + 1);

    const source = context.createBufferSource();
    source.buffer = takes[variant] ?? null;
    source.playbackRate.value = options.rate ?? 1;
    const gain = context.createGain();
    gain.gain.value = SOUNDS[id].gain;
    source.connect(gain);

    if (options.position) {
      const panner = context.createPanner();
      panner.panningModel = 'HRTF';
      panner.distanceModel = 'inverse';
      panner.refDistance = REFERENCE_DISTANCE;
      panner.maxDistance = MAX_DISTANCE;
      panner.rolloffFactor = 1;
      panner.positionX.value = options.position.x;
      panner.positionY.value = options.position.y;
      panner.positionZ.value = options.position.z;
      gain.connect(panner);
      panner.connect(this.master);
    } else {
      gain.connect(this.master);
    }
    source.start();
  }

  setListener(position: Vec3, forward: Vec3, up: Vec3): void {
    const listener = this.context?.listener;
    if (!listener) return;
    if (listener.positionX) {
      listener.positionX.value = position.x;
      listener.positionY.value = position.y;
      listener.positionZ.value = position.z;
      listener.forwardX.value = forward.x;
      listener.forwardY.value = forward.y;
      listener.forwardZ.value = forward.z;
      listener.upX.value = up.x;
      listener.upY.value = up.y;
      listener.upZ.value = up.z;
    } else {
      // Older implementations (Firefox before AudioParam listeners).
      listener.setPosition(position.x, position.y, position.z);
      listener.setOrientation(forward.x, forward.y, forward.z, up.x, up.y, up.z);
    }
  }

  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    this.removeUnlockListeners();
    void this.context?.close().catch(() => {});
    this.context = null;
  }

  private removeUnlockListeners(): void {
    this.options.gestureTarget.removeEventListener('pointerdown', this.unlock);
    this.options.keyTarget.removeEventListener('keydown', this.unlock);
  }

  private readonly unlock = (): void => {
    if (this.closed) return;
    if (this.context) {
      // Suspended again (e.g. by the browser): a new gesture resumes it.
      if (this.context.state === 'suspended') void this.context.resume().catch(() => {});
      return;
    }
    if (typeof AudioContext === 'undefined') {
      this.removeUnlockListeners();
      log.warn('Web Audio is not available; the game runs without sound.');
      return;
    }

    const context = new AudioContext({ latencyHint: 'interactive' });
    this.context = context;
    this.master = context.createGain();
    this.master.gain.value = this.options.volume;
    // A limiter keeps overlapping sounds (a spray's tails, impacts) from
    // clipping: fast attack, gentle release, only the peaks are touched.
    const limiter = context.createDynamicsCompressor();
    limiter.threshold.value = -6;
    limiter.knee.value = 4;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.12;
    this.analyser = context.createAnalyser();
    this.analyser.fftSize = LEVEL_WINDOW;
    this.levelBuffer = new Float32Array(LEVEL_WINDOW);
    this.master.connect(limiter);
    limiter.connect(this.analyser);
    this.analyser.connect(context.destination);
    void context.resume().catch(() => {});
    // The context has to be created inside the gesture; synthesizing the
    // sounds (tens of milliseconds) can wait until the click is handled.
    setTimeout(() => this.synthesize(context), 0);
  };

  private synthesize(context: AudioContext): void {
    if (this.closed) return;
    for (const id of SOUND_IDS) {
      const definition = SOUNDS[id];
      const takes: AudioBuffer[] = [];
      for (let seed = 0; seed < definition.variants; seed++) {
        const samples = definition.synthesize(context.sampleRate, seed);
        const buffer = context.createBuffer(1, samples.length, context.sampleRate);
        buffer.getChannelData(0).set(samples);
        takes.push(buffer);
      }
      this.buffers.set(id, takes);
    }
  }
}
