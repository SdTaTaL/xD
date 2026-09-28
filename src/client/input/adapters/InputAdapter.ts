/**
 * Translates one input device into device-independent input, written through
 * the {@link InputPort} it was created with. Keyboard + mouse today; touch
 * controls and gamepads later, without any change to gameplay code.
 */
export interface InputAdapter {
  /**
   * Called once per frame, before simulation. Only devices that must be
   * polled (e.g. the Gamepad API) need it; event-driven devices omit it.
   */
  poll?(): void;
  /** Releases the device and everything it holds. */
  dispose(): void;
}
