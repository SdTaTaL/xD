import type { CaptureListener, KeyboardMouseDevice, KeyboardMouseSink } from '../devices/KeyboardMouseDevice';

/** In-memory keyboard + mouse device for tests: drive `sink` directly. */
export class FakeKeyboardMouseDevice implements KeyboardMouseDevice {
  sink: KeyboardMouseSink | null = null;
  captured = false;
  disposed = false;
  private readonly listeners = new Set<CaptureListener>();

  connect(sink: KeyboardMouseSink): void {
    this.sink = sink;
  }

  disconnect(): void {
    this.sink = null;
  }

  requestCapture(): void {
    this.setCaptured(true);
  }

  releaseCapture(): void {
    this.setCaptured(false);
  }

  onCaptureChange(listener: CaptureListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    this.disposed = true;
    this.sink = null;
  }

  private setCaptured(captured: boolean): void {
    if (captured === this.captured) return;
    this.captured = captured;
    this.sink?.releaseAll();
    for (const listener of this.listeners) listener(captured);
  }
}
