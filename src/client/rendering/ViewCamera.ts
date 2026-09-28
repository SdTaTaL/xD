import { MathUtils, PerspectiveCamera } from 'three/webgpu';

export interface ViewCameraSettings {
  /** Horizontal field of view in degrees, defined at the 16:9 reference aspect ratio. */
  readonly horizontalFovDegrees: number;
  /** Near clip plane, in meters. */
  readonly near: number;
  /** Far clip plane, in meters. */
  readonly far: number;
}

const REFERENCE_ASPECT = 16 / 9;

/** Converts a horizontal FOV at `aspect` into the vertical FOV used by Three.js cameras. */
export function horizontalToVerticalFov(horizontalDegrees: number, aspect: number): number {
  const horizontal = MathUtils.degToRad(horizontalDegrees);
  return MathUtils.radToDeg(2 * Math.atan(Math.tan(horizontal / 2) / aspect));
}

/**
 * Creates the main view camera.
 *
 * The vertical FOV stays fixed for every aspect ratio ("Hor+"): wider screens
 * see more to the sides and never less vertically, so the configured FOV
 * means the same thing on every 16:9 display.
 */
export function createViewCamera(settings: ViewCameraSettings): PerspectiveCamera {
  const verticalFov = horizontalToVerticalFov(settings.horizontalFovDegrees, REFERENCE_ASPECT);
  return new PerspectiveCamera(verticalFov, REFERENCE_ASPECT, settings.near, settings.far);
}

export function setCameraAspect(camera: PerspectiveCamera, aspect: number): void {
  camera.aspect = aspect;
  camera.updateProjectionMatrix();
}
