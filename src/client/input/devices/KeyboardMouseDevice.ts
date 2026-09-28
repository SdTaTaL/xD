/** Mouse buttons, named after `MouseEvent.button` indices 0–4. */
export type MouseButton = 'left' | 'middle' | 'right' | 'back' | 'forward';

/**
 * Receives raw keyboard and mouse input. Identifiers are physical (key
 * positions, buttons) and carry no gameplay meaning; mapping them to actions
 * is the adapter's job.
 */
export interface KeyboardMouseSink {
  /** A physical key went down (`KeyboardEvent.code` naming). Never called for auto-repeat. */
  keyDown(code: string): void;
  keyUp(code: string): void;
  buttonDown(button: MouseButton): void;
  buttonUp(button: MouseButton): void;
  /** Relative mouse motion in device counts; +x = right, +y = down. */
  move(dx: number, dy: number): void;
  /** Everything must be considered released (focus, visibility or capture lost). */
  releaseAll(): void;
}

export type CaptureListener = (captured: boolean) => void;

/**
 * A keyboard + mouse device. It forwards input only while captured (e.g.
 * pointer-locked), so gameplay never reacts to input meant for the page.
 */
export interface KeyboardMouseDevice {
  readonly captured: boolean;
  /** Starts forwarding input to `sink`. A device feeds a single sink. */
  connect(sink: KeyboardMouseSink): void;
  disconnect(): void;
  /** Asks to capture input. Browsers only honour this inside a user gesture. */
  requestCapture(): void;
  releaseCapture(): void;
  /** Calls `listener` on every capture change. Returns an unsubscribe function. */
  onCaptureChange(listener: CaptureListener): () => void;
  dispose(): void;
}
