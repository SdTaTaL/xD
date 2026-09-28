import { createLogger } from '../../core/Logger';
import type { CaptureListener, KeyboardMouseDevice, KeyboardMouseSink, MouseButton } from './KeyboardMouseDevice';

const log = createLogger('input');

/** Index = `MouseEvent.button`. */
const MOUSE_BUTTONS: readonly MouseButton[] = ['left', 'middle', 'right', 'back', 'forward'];

/**
 * Keys that keep their browser behaviour while capturing: Escape (the user's
 * way out of pointer lock) and function keys (reload, fullscreen, dev tools).
 */
const PASSTHROUGH_KEY = /^(?:Escape|F(?:[1-9]|1[0-2]))$/;

/** macOS does not send keyup for keys released while ⌘ is held. */
const META_KEYS = new Set(['MetaLeft', 'MetaRight']);

export interface BrowserKeyboardMouseDeviceOptions {
  /** Element that is pointer-locked while capturing: the game view. */
  readonly element: HTMLElement;
  /** Request capture when the element is clicked. */
  readonly captureOnClick: boolean;
  /** Ask for raw (unaccelerated) mouse movement where the platform supports it. */
  readonly rawMouseInput: boolean;
  /** Defaults to the global window; injectable for tests. */
  readonly window?: Window;
  /** Defaults to the global document; injectable for tests. */
  readonly document?: Document;
}

type Listener<E extends Event> = (event: E) => void;

/**
 * Browser keyboard + mouse device based on the Pointer Lock API.
 *
 * Capture = pointer lock on the game element. Input is forwarded only while
 * captured, and everything is released whenever it could otherwise get stuck:
 * capture lost (Esc, programmatic exit), window blur, tab hidden, or ⌘
 * released on macOS.
 *
 * The capture state follows `document.pointerLockElement` and is re-checked
 * on every input event: browsers update that property as soon as the lock
 * changes but deliver `pointerlockchange` later (Chromium: on the next
 * animation frame), and input in between must not be lost or leak.
 */
export class BrowserKeyboardMouseDevice implements KeyboardMouseDevice {
  private readonly element: HTMLElement;
  private readonly window: Window;
  private readonly document: Document;
  private readonly captureOnClick: boolean;
  private readonly rawMouseInput: boolean;
  private readonly captureListeners = new Set<CaptureListener>();
  private readonly removers: (() => void)[] = [];

  private sink: KeyboardMouseSink | null = null;
  private isCaptured = false;
  private disposed = false;
  /** Legacy implementations report lock failures only through `pointerlockerror`. */
  private lockErrorsViaEvent = false;

  constructor(options: BrowserKeyboardMouseDeviceOptions) {
    this.element = options.element;
    this.window = options.window ?? window;
    this.document = options.document ?? document;
    this.captureOnClick = options.captureOnClick;
    this.rawMouseInput = options.rawMouseInput;

    this.listen(this.element, 'click', this.onClick);
    this.listen(this.element, 'contextmenu', this.onContextMenu);
    this.listen(this.document, 'pointerlockchange', this.onPointerLockChange);
    this.listen(this.document, 'pointerlockerror', this.onPointerLockError);
    this.listen(this.document, 'visibilitychange', this.onVisibilityChange);
    this.listen(this.document, 'mousedown', this.onMouseDown);
    this.listen(this.document, 'mouseup', this.onMouseUp);
    this.listen(this.document, 'mousemove', this.onMouseMove);
    this.listen(this.window, 'keydown', this.onKeyDown);
    this.listen(this.window, 'keyup', this.onKeyUp);
    this.listen(this.window, 'blur', this.onBlur);
  }

  get captured(): boolean {
    return this.isCaptured;
  }

  connect(sink: KeyboardMouseSink): void {
    if (this.sink) throw new Error('This device is already connected to a sink');
    this.sink = sink;
  }

  disconnect(): void {
    this.sink?.releaseAll();
    this.sink = null;
  }

  requestCapture(): void {
    if (this.isCaptured || this.disposed) return;

    const element = this.element;
    if (typeof element.requestPointerLock !== 'function') {
      log.warn('The Pointer Lock API is not available; mouse capture is not possible.');
      return;
    }

    this.lockPointer(this.rawMouseInput, (error) => {
      if (this.disposed) return;
      if (this.rawMouseInput && error instanceof DOMException && error.name === 'NotSupportedError') {
        // Raw input is not supported on this platform: fall back to OS-accelerated movement.
        log.debug('Raw mouse input unavailable; using accelerated pointer lock.');
        this.lockPointer(false, (retryError) => log.debug('Pointer lock rejected:', retryError));
        return;
      }
      // Expected e.g. when re-locking right after Esc (browsers enforce a short cooldown).
      log.debug('Pointer lock rejected:', error);
    });
  }

  releaseCapture(): void {
    if (this.document.pointerLockElement === this.element) this.document.exitPointerLock();
  }

  onCaptureChange(listener: CaptureListener): () => void {
    this.captureListeners.add(listener);
    return () => this.captureListeners.delete(listener);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    this.releaseCapture();
    this.setUnloadGuard(false);
    for (const remove of this.removers.splice(0)) remove();
    this.captureListeners.clear();
    this.disconnect();
  }

  private lockPointer(raw: boolean, onRejected: (error: unknown) => void): void {
    try {
      const request: Promise<void> | undefined = raw
        ? this.element.requestPointerLock({ unadjustedMovement: true })
        : this.element.requestPointerLock();
      // Older implementations (Safari) return undefined and report failures via `pointerlockerror`.
      this.lockErrorsViaEvent = request === undefined;
      void Promise.resolve(request).catch(onRejected);
    } catch (error) {
      onRejected(error);
    }
  }

  /** Brings the capture state in line with the actual pointer lock and returns it. */
  private syncCapture(): boolean {
    this.setCaptured(this.document.pointerLockElement === this.element);
    return this.isCaptured;
  }

  private setCaptured(captured: boolean): void {
    if (captured === this.isCaptured) return;
    this.isCaptured = captured;

    // A capture boundary always starts from a clean slate.
    this.sink?.releaseAll();
    this.setUnloadGuard(captured);
    for (const listener of this.captureListeners) listener(captured);
  }

  /**
   * While capturing, modifier keys are game controls (Ctrl = crouch by
   * default), but browsers do not let pages intercept Ctrl+W / Ctrl+T. Ask
   * before leaving instead of closing the game mid-match. Only installed
   * while captured: a permanent `beforeunload` listener would disable the
   * back/forward cache.
   */
  private setUnloadGuard(enabled: boolean): void {
    if (enabled) this.window.addEventListener('beforeunload', this.onBeforeUnload);
    else this.window.removeEventListener('beforeunload', this.onBeforeUnload);
  }

  private listen<E extends Event>(target: EventTarget, type: string, listener: Listener<E>): void {
    const handler = listener as EventListener;
    target.addEventListener(type, handler);
    this.removers.push(() => target.removeEventListener(type, handler));
  }

  private releaseAll(): void {
    this.sink?.releaseAll();
  }

  private readonly onClick = (): void => {
    if (this.captureOnClick && !this.syncCapture()) this.requestCapture();
  };

  private readonly onContextMenu = (event: Event): void => {
    // Right click is a gameplay button (aim); never open the context menu over the game view.
    event.preventDefault();
  };

  private readonly onPointerLockChange = (): void => {
    this.syncCapture();
  };

  private readonly onPointerLockError = (): void => {
    // Promise-based requests are reported (and retried) by their rejection handler.
    if (this.lockErrorsViaEvent) log.debug('Pointer lock request failed.');
  };

  private readonly onVisibilityChange = (): void => {
    if (this.document.visibilityState !== 'hidden') return;
    this.releaseAll();
    this.releaseCapture();
  };

  private readonly onBlur = (): void => {
    this.releaseAll();
    this.releaseCapture();
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!this.syncCapture() || event.isComposing || event.code === '') return;
    if (!PASSTHROUGH_KEY.test(event.code)) event.preventDefault();
    if (!event.repeat) this.sink?.keyDown(event.code);
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    if (META_KEYS.has(event.code)) {
      this.releaseAll();
      return;
    }
    if (!this.syncCapture() || event.isComposing || event.code === '') return;
    if (!PASSTHROUGH_KEY.test(event.code)) event.preventDefault();
    this.sink?.keyUp(event.code);
  };

  private readonly onMouseDown = (event: MouseEvent): void => {
    if (!this.syncCapture()) return;
    event.preventDefault();
    const button = MOUSE_BUTTONS[event.button];
    if (button) this.sink?.buttonDown(button);
  };

  private readonly onMouseUp = (event: MouseEvent): void => {
    if (!this.syncCapture()) return;
    // Also stops the back/forward mouse buttons from navigating away.
    event.preventDefault();
    const button = MOUSE_BUTTONS[event.button];
    if (button) this.sink?.buttonUp(button);
  };

  private readonly onMouseMove = (event: MouseEvent): void => {
    if (!this.syncCapture()) return;
    if (event.movementX !== 0 || event.movementY !== 0) this.sink?.move(event.movementX, event.movementY);
  };

  private readonly onBeforeUnload = (event: BeforeUnloadEvent): void => {
    event.preventDefault();
  };
}
