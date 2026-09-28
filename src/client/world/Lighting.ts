import { DirectionalLight, Group, HemisphereLight, Vector3 } from 'three/webgpu';
import type { Bounds3 } from '@shared/maps/MapDefinition';

export interface LightingOptions {
  /** World bounds the sun's shadow frustum must cover. */
  readonly bounds: Bounds3;
  readonly shadows: boolean;
}

const SUN_DIRECTION = new Vector3(0.45, 1, 0.3).normalize();
const SHADOW_MAP_SIZE = 2048;

/**
 * Baseline outdoor lighting: hemisphere sky/ground fill plus a directional
 * sun whose shadow frustum is fitted to the given bounds.
 */
export class Lighting {
  readonly root = new Group();

  private readonly hemisphere: HemisphereLight;
  private readonly sun: DirectionalLight;

  constructor({ bounds, shadows }: LightingOptions) {
    this.root.name = 'lighting';

    this.hemisphere = new HemisphereLight(0xcfe3f5, 0x4d463d, 1.1);

    const center = new Vector3(
      (bounds.min.x + bounds.max.x) / 2,
      (bounds.min.y + bounds.max.y) / 2,
      (bounds.min.z + bounds.max.z) / 2,
    );
    const radius = center.distanceTo(new Vector3(bounds.max.x, bounds.max.y, bounds.max.z));

    this.sun = new DirectionalLight(0xfff1dc, 2.6);
    this.sun.position.copy(center).addScaledVector(SUN_DIRECTION, radius * 2);
    this.sun.target.position.copy(center);
    this.sun.castShadow = shadows;

    const shadowCamera = this.sun.shadow.camera;
    shadowCamera.left = -radius;
    shadowCamera.right = radius;
    shadowCamera.top = radius;
    shadowCamera.bottom = -radius;
    shadowCamera.near = radius;
    shadowCamera.far = radius * 3;
    shadowCamera.updateProjectionMatrix();
    this.sun.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.02;

    this.root.add(this.hemisphere, this.sun, this.sun.target);
  }

  dispose(): void {
    this.root.removeFromParent();
    this.hemisphere.dispose();
    this.sun.dispose();
  }
}
