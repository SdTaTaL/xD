import type { AudioOutputState } from '../audio/AudioOutput';
import type { SoundId } from '../audio/sounds';
import type { GameSystem } from '../core/GameSystem';

export interface AudioDebugSource {
  readonly state: AudioOutputState;
  readonly sampleRate: number;
  readonly played: ReadonlyMap<SoundId, number>;
  level(): number;
}

export interface AudioDebugPanelOptions {
  readonly parent: HTMLElement;
  readonly output: AudioDebugSource;
  /** The last movement sound, e.g. "step (left)". */
  readonly movement: () => string;
}

const REFRESH_MS = 100;

/**
 * TEMPORARY audio debug panel, enabled with `?debug=audio`: output state,
 * the loudest output level of the last refresh, and how many times each
 * sound played. Delete it once audio tuning is done.
 */
export class AudioDebugPanel implements GameSystem {
  readonly name = 'audio-debug';

  private readonly element: HTMLPreElement;
  private readonly options: AudioDebugPanelOptions;
  private peak = 0;
  private lastDraw = -Infinity;

  constructor(options: AudioDebugPanelOptions) {
    this.options = options;
    this.element = document.createElement('pre');
    this.element.className = 'debug-overlay';
    this.element.dataset['panel'] = 'audio';
    this.element.setAttribute('aria-hidden', 'true');
    this.element.style.top = 'auto';
    this.element.style.left = 'auto';
    this.element.style.right = '8px';
    this.element.style.bottom = '90px';
    options.parent.append(this.element);
  }

  endFrame(): void {
    this.peak = Math.max(this.peak, this.options.output.level());
    const now = performance.now();
    if (now - this.lastDraw < REFRESH_MS) return;
    this.lastDraw = now;
    this.draw();
    this.peak = 0;
  }

  dispose(): void {
    this.element.remove();
  }

  private draw(): void {
    const { output } = this.options;
    const played = [...output.played].map(([id, count]) => `${id} ${count}`).join('  ') || '—';
    this.element.textContent = [
      'AUDIO (temporary debug)',
      `Output    ${output.state}  ${output.sampleRate || '—'} Hz`,
      `Level     ${this.peak.toFixed(3)}`,
      `Played    ${played}`,
      `Movement  ${this.options.movement()}`,
    ].join('\n');
  }
}
