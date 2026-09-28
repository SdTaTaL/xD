import type { GameSystem } from '../core/GameSystem';

export interface ViewportSize {
  /** Width in CSS pixels. */
  readonly width: number;
  /** Height in CSS pixels. */
  readonly height: number;
  /** Device pixels per CSS pixel. */
  readonly devicePixelRatio: number;
}

export type ViewportListener = (size: ViewportSize) => void;

/**
 * Tracks the CSS size and device pixel ratio of the element hosting the game
 * view (window resizes, layout changes, browser zoom, moving between
 * monitors).
 *
 * Changes are coalesced and delivered at the start of the next frame, so the
 * renderer and cameras are never resized in the middle of a frame and a burst
 * of resize events costs a single reconfiguration.
 */
export class Viewport implements GameSystem {
  readonly name = 'viewport';

  private readonly element: HTMLElement;
  private readonly resizeObserver: ResizeObserver;
  private readonly listeners = new Set<ViewportListener>();
  private pixelRatioQuery: MediaQueryList | null = null;
  private current: ViewportSize;
  private dirty = false;

  constructor(element: HTMLElement) {
    this.element = element;
    this.current = this.measure();
    this.resizeObserver = new ResizeObserver(this.invalidate);
    this.resizeObserver.observe(element);
    this.watchPixelRatio();
  }

  get size(): ViewportSize {
    return this.current;
  }

  /**
   * Calls `listener` now with the current size and again on every change.
   * @returns Function that removes the listener.
   */
  subscribe(listener: ViewportListener): () => void {
    this.listeners.add(listener);
    listener(this.current);
    return () => this.listeners.delete(listener);
  }

  beginFrame(): void {
    if (!this.dirty) return;
    this.dirty = false;

    const next = this.measure();
    const { width, height, devicePixelRatio } = this.current;
    if (next.width === width && next.height === height && next.devicePixelRatio === devicePixelRatio) {
      return;
    }

    this.current = next;
    for (const listener of this.listeners) listener(next);
  }

  dispose(): void {
    this.resizeObserver.disconnect();
    this.pixelRatioQuery?.removeEventListener('change', this.onPixelRatioChange);
    this.pixelRatioQuery = null;
    this.listeners.clear();
  }

  private measure(): ViewportSize {
    return {
      // A zero-sized drawing buffer is invalid for WebGPU; keep at least 1×1.
      width: Math.max(1, this.element.clientWidth),
      height: Math.max(1, this.element.clientHeight),
      devicePixelRatio: window.devicePixelRatio || 1,
    };
  }

  private readonly invalidate = (): void => {
    this.dirty = true;
  };

  /**
   * A DPR change does not necessarily change the element's CSS size, so the
   * ResizeObserver alone would miss it. A resolution media query matching the
   * current DPR fires once when it stops matching; it is then re-armed.
   */
  private watchPixelRatio(): void {
    this.pixelRatioQuery?.removeEventListener('change', this.onPixelRatioChange);
    this.pixelRatioQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    this.pixelRatioQuery.addEventListener('change', this.onPixelRatioChange);
  }

  private readonly onPixelRatioChange = (): void => {
    this.invalidate();
    this.watchPixelRatio();
  };
}
