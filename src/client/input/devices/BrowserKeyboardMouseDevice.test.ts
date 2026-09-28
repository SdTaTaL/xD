import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserKeyboardMouseDevice } from './BrowserKeyboardMouseDevice';
import type { KeyboardMouseSink } from './KeyboardMouseDevice';

/**
 * Minimal stand-ins for the DOM objects the device touches (Node provides
 * EventTarget/Event). Like real browsers, pointer lock changes are reported
 * asynchronously.
 */
class FakeDocument extends EventTarget {
  pointerLockElement: EventTarget | null = null;
  visibilityState: DocumentVisibilityState = 'visible';
  readonly exitPointerLock = vi.fn(() => {
    setTimeout(() => this.setLock(null), 0);
  });

  setLock(element: EventTarget | null): void {
    this.pointerLockElement = element;
    this.dispatchEvent(new Event('pointerlockchange'));
  }
}

class FakeElement extends EventTarget {
  private readonly doc: FakeDocument;

  constructor(doc: FakeDocument) {
    super();
    this.doc = doc;
  }

  readonly requestPointerLock = vi.fn((_options?: PointerLockOptions): Promise<void> => {
    setTimeout(() => this.doc.setLock(this), 0);
    return Promise.resolve();
  });
}

function keyEvent(type: 'keydown' | 'keyup', code: string, init: { repeat?: boolean; isComposing?: boolean } = {}): Event {
  return Object.assign(new Event(type, { cancelable: true }), { code, repeat: false, isComposing: false, ...init });
}

function mouseEvent(type: string, init: { button?: number; movementX?: number; movementY?: number } = {}): Event {
  return Object.assign(new Event(type, { cancelable: true }), { button: 0, movementX: 0, movementY: 0, ...init });
}

function recordingSink(): KeyboardMouseSink & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    keyDown: (code) => calls.push(`keyDown:${code}`),
    keyUp: (code) => calls.push(`keyUp:${code}`),
    buttonDown: (button) => calls.push(`buttonDown:${button}`),
    buttonUp: (button) => calls.push(`buttonUp:${button}`),
    move: (dx, dy) => calls.push(`move:${dx},${dy}`),
    releaseAll: () => calls.push('releaseAll'),
  };
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('BrowserKeyboardMouseDevice', () => {
  let doc: FakeDocument;
  let win: EventTarget;
  let element: FakeElement;
  let sink: ReturnType<typeof recordingSink>;
  let device: BrowserKeyboardMouseDevice;

  beforeEach(() => {
    doc = new FakeDocument();
    win = new EventTarget();
    element = new FakeElement(doc);
    sink = recordingSink();
    device = new BrowserKeyboardMouseDevice({
      element: element as unknown as HTMLElement,
      document: doc as unknown as Document,
      window: win as unknown as Window,
      captureOnClick: true,
      rawMouseInput: true,
    });
    device.connect(sink);
  });

  const capture = async (): Promise<void> => {
    element.dispatchEvent(new Event('click'));
    await flush();
    sink.calls.length = 0;
  };

  it('forwards nothing and blocks nothing while not captured', () => {
    const key = keyEvent('keydown', 'KeyW');
    win.dispatchEvent(key);
    doc.dispatchEvent(mouseEvent('mousedown'));
    doc.dispatchEvent(mouseEvent('mousemove', { movementX: 5 }));
    expect(sink.calls).toEqual([]);
    expect(key.defaultPrevented).toBe(false);
  });

  it('captures on click with raw mouse input and notifies listeners', async () => {
    const listener = vi.fn();
    device.onCaptureChange(listener);
    element.dispatchEvent(new Event('click'));
    await flush();

    expect(element.requestPointerLock).toHaveBeenCalledWith({ unadjustedMovement: true });
    expect(device.captured).toBe(true);
    expect(listener).toHaveBeenCalledWith(true);
    expect(sink.calls).toEqual(['releaseAll']);
  });

  it('falls back to accelerated pointer lock when raw input is not supported', async () => {
    element.requestPointerLock.mockImplementationOnce(() => Promise.reject(new DOMException('no raw input', 'NotSupportedError')));
    element.dispatchEvent(new Event('click'));
    await flush(); // rejection handled, retry issued
    await flush(); // retry granted

    expect(element.requestPointerLock).toHaveBeenCalledTimes(2);
    expect(element.requestPointerLock).toHaveBeenLastCalledWith();
    expect(device.captured).toBe(true);
  });

  it('does not retry the lock after being disposed', async () => {
    element.requestPointerLock.mockImplementationOnce(() => Promise.reject(new DOMException('no raw input', 'NotSupportedError')));
    element.dispatchEvent(new Event('click'));
    device.dispose();
    await flush();
    await flush();
    expect(element.requestPointerLock).toHaveBeenCalledTimes(1);
    expect(doc.pointerLockElement).toBeNull();
  });

  it('survives rejected and throwing pointer lock requests', async () => {
    element.requestPointerLock.mockImplementationOnce(() => Promise.reject(new DOMException('cooldown', 'SecurityError')));
    element.dispatchEvent(new Event('click'));
    await flush();
    expect(device.captured).toBe(false);

    element.requestPointerLock.mockImplementationOnce(() => {
      throw new Error('not allowed');
    });
    expect(() => element.dispatchEvent(new Event('click'))).not.toThrow();
    expect(device.captured).toBe(false);
  });

  it('forwards key transitions while captured, never auto-repeat', async () => {
    await capture();
    const down = keyEvent('keydown', 'KeyW');
    const repeat = keyEvent('keydown', 'KeyW', { repeat: true });
    const up = keyEvent('keyup', 'KeyW');
    win.dispatchEvent(down);
    win.dispatchEvent(repeat);
    win.dispatchEvent(up);

    expect(sink.calls).toEqual(['keyDown:KeyW', 'keyUp:KeyW']);
    expect(down.defaultPrevented && repeat.defaultPrevented && up.defaultPrevented).toBe(true);
  });

  it('keeps Escape and function keys working and ignores IME composition', async () => {
    await capture();
    const f5 = keyEvent('keydown', 'F5');
    const escape = keyEvent('keydown', 'Escape');
    win.dispatchEvent(f5);
    win.dispatchEvent(escape);
    win.dispatchEvent(keyEvent('keydown', 'KeyQ', { isComposing: true }));
    expect(f5.defaultPrevented).toBe(false);
    expect(escape.defaultPrevented).toBe(false);
    expect(sink.calls).toEqual(['keyDown:F5', 'keyDown:Escape']);
  });

  it('maps mouse buttons and forwards relative motion while captured', async () => {
    await capture();
    doc.dispatchEvent(mouseEvent('mousedown', { button: 0 }));
    doc.dispatchEvent(mouseEvent('mousedown', { button: 2 }));
    doc.dispatchEvent(mouseEvent('mousedown', { button: 1 }));
    doc.dispatchEvent(mouseEvent('mouseup', { button: 2 }));
    doc.dispatchEvent(mouseEvent('mousemove', { movementX: 3, movementY: -4 }));
    doc.dispatchEvent(mouseEvent('mousemove'));

    expect(sink.calls).toEqual(['buttonDown:left', 'buttonDown:right', 'buttonDown:middle', 'buttonUp:right', 'move:3,-4']);
  });

  it('forwards input as soon as the lock is active, before pointerlockchange is delivered', () => {
    const listener = vi.fn();
    device.onCaptureChange(listener);
    doc.pointerLockElement = element; // granted; the change event is still queued

    win.dispatchEvent(keyEvent('keydown', 'KeyW'));
    doc.dispatchEvent(new Event('pointerlockchange'));

    expect(sink.calls).toEqual(['releaseAll', 'keyDown:KeyW']);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(device.captured).toBe(true);
  });

  it('stops forwarding as soon as the lock is gone, before pointerlockchange is delivered', async () => {
    await capture();
    win.dispatchEvent(keyEvent('keydown', 'KeyW'));
    doc.pointerLockElement = null; // exited; the change event is still queued

    win.dispatchEvent(keyEvent('keydown', 'KeyA'));
    doc.dispatchEvent(mouseEvent('mousemove', { movementX: 4 }));
    expect(sink.calls).toEqual(['keyDown:KeyW', 'releaseAll']);
    expect(device.captured).toBe(false);
  });

  it('releases everything when pointer lock is lost (Esc)', async () => {
    const listener = vi.fn();
    device.onCaptureChange(listener);
    await capture();
    doc.setLock(null);

    expect(device.captured).toBe(false);
    expect(sink.calls).toEqual(['releaseAll']);
    expect(listener).toHaveBeenLastCalledWith(false);
  });

  it('releases everything immediately and the capture when the window loses focus', async () => {
    await capture();
    win.dispatchEvent(new Event('blur'));
    // Synchronously, before the browser reports the lock change.
    expect(sink.calls).toEqual(['releaseAll']);
    expect(doc.exitPointerLock).toHaveBeenCalled();
    await flush();
    expect(device.captured).toBe(false);
  });

  it('releases everything immediately and the capture when the tab is hidden', async () => {
    await capture();
    doc.visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(sink.calls).toEqual(['releaseAll']);
    await flush();
    expect(device.captured).toBe(false);
  });

  it('does nothing when the tab becomes visible again', () => {
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(sink.calls).toEqual([]);
  });

  it('releases everything when ⌘ is released (macOS drops the other keyups)', async () => {
    await capture();
    win.dispatchEvent(keyEvent('keydown', 'KeyW'));
    win.dispatchEvent(keyEvent('keyup', 'MetaLeft'));
    expect(sink.calls).toEqual(['keyDown:KeyW', 'releaseAll']);
  });

  it('asks before unloading only while captured', async () => {
    const before = new Event('beforeunload', { cancelable: true });
    win.dispatchEvent(before);
    expect(before.defaultPrevented).toBe(false);

    await capture();
    const during = new Event('beforeunload', { cancelable: true });
    win.dispatchEvent(during);
    expect(during.defaultPrevented).toBe(true);

    device.releaseCapture();
    await flush();
    const after = new Event('beforeunload', { cancelable: true });
    win.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
  });

  it('suppresses the context menu over the game view', () => {
    const event = new Event('contextmenu', { cancelable: true });
    element.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('stops listening, releases the capture and the sink on dispose', async () => {
    await capture();
    device.dispose();
    expect(doc.exitPointerLock).toHaveBeenCalled();
    expect(sink.calls).toContain('releaseAll');
    await flush();

    sink.calls.length = 0;
    doc.setLock(element);
    win.dispatchEvent(keyEvent('keydown', 'KeyW'));
    element.dispatchEvent(new Event('click'));
    await flush();
    expect(sink.calls).toEqual([]);
    expect(element.requestPointerLock).toHaveBeenCalledTimes(1);
  });
});
