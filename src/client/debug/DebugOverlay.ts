import type { GameSystem } from '../core/GameSystem';
import type { RenderStats } from '../rendering/GameRenderer';
import { FrameStats, type FrameStatsSample } from './FrameStats';

export interface DebugOverlayOptions {
  /** Element the overlay is appended to. */
  readonly parent: HTMLElement;
  /** Configured simulation tick rate, shown next to the measured one. */
  readonly tickRate: number;
  readonly getRenderStats: () => RenderStats;
}

const SAMPLE_WINDOW_MS = 500;

/**
 * Developer overlay with frame timing, simulation rate and renderer stats.
 *
 * Register it before every other system: its `beginFrame` must run first and
 * its `endFrame` last so the measured CPU time covers the whole frame. The
 * DOM is only touched once per sample window.
 */
export class DebugOverlay implements GameSystem {
  readonly name = 'debug-overlay';

  private readonly element: HTMLPreElement;
  private readonly stats = new FrameStats(SAMPLE_WINDOW_MS);
  private readonly tickRate: number;
  private readonly getRenderStats: () => RenderStats;
  private frameStart = 0;
  private previousFrameStart: number | null = null;

  constructor(options: DebugOverlayOptions) {
    this.tickRate = options.tickRate;
    this.getRenderStats = options.getRenderStats;

    this.element = document.createElement('pre');
    this.element.className = 'debug-overlay';
    this.element.setAttribute('aria-hidden', 'true');
    this.element.textContent = 'Measuring…';
    options.parent.append(this.element);
  }

  beginFrame(): void {
    this.frameStart = performance.now();
  }

  fixedUpdate(): void {
    this.stats.recordTick();
  }

  endFrame(): void {
    const now = performance.now();

    if (this.previousFrameStart !== null) {
      this.stats.recordFrame(this.frameStart - this.previousFrameStart, now - this.frameStart);
    }
    this.previousFrameStart = this.frameStart;

    const sample = this.stats.flush(now);
    if (sample) this.draw(sample, this.getRenderStats());
  }

  dispose(): void {
    this.element.remove();
  }

  private draw(sample: FrameStatsSample, render: RenderStats): void {
    this.element.textContent = [
      `FPS      ${sample.fps.toFixed(0)}`,
      `Frame    ${sample.frameTimeMs.toFixed(2)} ms  (max ${sample.frameTimeMaxMs.toFixed(2)})`,
      `CPU      ${sample.cpuTimeMs.toFixed(2)} ms`,
      `Tick     ${this.tickRate} Hz  (measured ${sample.tickRate.toFixed(1)})`,
      `Backend  ${render.backend}`,
      `Draws    ${render.drawCalls}`,
      `Tris     ${render.triangles.toLocaleString('en-US')}`,
      `Buffer   ${render.bufferWidth}×${render.bufferHeight} @ ${render.pixelRatio.toFixed(2)}x`,
    ].join('\n');
  }
}
