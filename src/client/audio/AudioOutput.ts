import type { Vec3 } from '@shared/math/Vec3';
import type { SoundId } from './sounds';

export interface PlayOptions {
  /** World position of a positional sound; omitted, it plays at the listener (own weapon, own steps). */
  readonly position?: Vec3 | undefined;
  /** Playback speed: 1.03 is 3 % higher and shorter. */
  readonly rate?: number;
}

/** `locked` until a user gesture allows audio (browser autoplay policy). */
export type AudioOutputState = 'unavailable' | 'locked' | 'running' | 'suspended' | 'closed';

/** Where sounds go. The game maps events to sounds; this plays them. */
export interface AudioOutput {
  readonly state: AudioOutputState;
  play(id: SoundId, options?: PlayOptions): void;
  /** Places the ears: position, facing and up (unit vectors). */
  setListener(position: Vec3, forward: Vec3, up: Vec3): void;
  dispose(): void;
}
