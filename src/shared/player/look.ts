import { clamp, wrapAngle } from '../math/scalar';

export interface ViewAngles {
  readonly yaw: number;
  readonly pitch: number;
}

/** Applies a tick's look input: yaw wraps freely, pitch is clamped to ±maxPitch. */
export function applyLook(yaw: number, pitch: number, lookX: number, lookY: number, maxPitch: number): ViewAngles {
  return {
    yaw: wrapAngle(yaw + lookX),
    pitch: clamp(pitch + lookY, -maxPitch, maxPitch),
  };
}
