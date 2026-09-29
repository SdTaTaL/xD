import { Color, InstancedMesh, MeshBasicNodeMaterial, Object3D, PlaneGeometry, type Camera } from 'three/webgpu';
import { color, float, length, smoothstep, uv } from 'three/tsl';
import type { ShotOutcome } from '@shared/combat/targets';
import type { FrameContext, GameSystem } from '../core/GameSystem';

export interface BloodPuffsOptions {
  readonly range: { onShotResolved(listener: (outcome: ShotOutcome) => void): () => void };
  /** The view camera: puffs face it. */
  readonly camera: Camera;
}

const CAPACITY = 24;
/** Lifetime of a puff, seconds. */
const LIFETIME = 0.25;
/** Diameter at its largest, meters (headshots are bigger). */
const BODY_SIZE = 0.3;
const HEAD_SIZE = 0.4;

interface Puff {
  x: number;
  y: number;
  z: number;
  size: number;
  age: number;
  /** Drawn at least once: a puff starts ageing only after its first frame, however long that frame is. */
  shown: boolean;
}

/**
 * A short puff of blood where a bullet hits a target: a camera-facing quad
 * that swells and shrinks within a quarter of a second. All puffs are one
 * instanced mesh (one draw call). Presentation only.
 *
 * Register it after the camera: puffs are turned towards its final pose.
 */
export class BloodPuffs implements GameSystem {
  readonly name = 'blood-puffs';
  readonly mesh: InstancedMesh;

  private readonly camera: Camera;
  private readonly geometry = new PlaneGeometry(1, 1);
  private readonly material: MeshBasicNodeMaterial;
  private readonly puffs: Puff[] = [];
  private readonly placer = new Object3D();
  private readonly unsubscribe: () => void;
  private disposed = false;

  constructor(options: BloodPuffsOptions) {
    this.camera = options.camera;
    const distance = length(uv().sub(0.5)).mul(2);
    this.material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
    this.material.colorNode = color(new Color(0xb3150f));
    this.material.opacityNode = float(1).sub(smoothstep(0.25, 1, distance)).mul(0.85);

    this.mesh = new InstancedMesh(this.geometry, this.material, CAPACITY);
    this.mesh.name = 'blood-puffs';
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;

    this.unsubscribe = options.range.onShotResolved((outcome) => {
      const hit = outcome.target;
      if (!hit) return;
      if (this.puffs.length === CAPACITY) this.puffs.shift();
      this.puffs.push({ ...hit.point, size: hit.group === 'head' ? HEAD_SIZE : BODY_SIZE, age: 0, shown: false });
    });
  }

  /** Puffs currently shown. */
  get size(): number {
    return this.puffs.length;
  }

  update(frame: FrameContext): void {
    for (const puff of this.puffs) {
      if (puff.shown) puff.age += frame.deltaSeconds;
      puff.shown = true;
    }
    while (this.puffs.length > 0 && (this.puffs[0] as Puff).age >= LIFETIME) this.puffs.shift();

    this.placer.quaternion.copy(this.camera.quaternion);
    this.puffs.forEach((puff, index) => {
      const progress = puff.age / LIFETIME;
      this.placer.position.set(puff.x, puff.y, puff.z);
      this.placer.scale.setScalar(puff.size * Math.sin(Math.PI * Math.min(1, 0.15 + progress)));
      this.placer.updateMatrix();
      this.mesh.setMatrixAt(index, this.placer.matrix);
    });
    this.mesh.count = this.puffs.length;
    if (this.puffs.length > 0) this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** Idempotent. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe();
    this.mesh.removeFromParent();
    this.mesh.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }
}
