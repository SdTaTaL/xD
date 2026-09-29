import { Color, InstancedMesh, MeshStandardNodeMaterial, Object3D, PlaneGeometry, Vector3 } from 'three/webgpu';
import { color, float, length, smoothstep, uv } from 'three/tsl';
import type { ShotOutcome } from '@shared/combat/targets';
import type { GameSystem } from '../core/GameSystem';

export interface ImpactMarksOptions {
  /** Resolved shots (see TrainingRange.onShotResolved): only bullets that reached the map leave a mark. */
  readonly source: { onShotResolved(listener: (outcome: ShotOutcome) => void): () => void };
  /** Marks kept; the oldest is reused when full. */
  readonly capacity?: number;
}

const DEFAULT_CAPACITY = 128;
/** Diameter of a mark, meters. */
const MARK_SIZE = 0.045;
/** Lift off the surface, meters: enough to never z-fight at play distances. */
const SURFACE_OFFSET = 0.0015;
const GOLDEN_ANGLE = 2.399963229728653;
const FACE_NORMAL = new Vector3(0, 0, 1);

/**
 * Bullet holes where shots hit the map (not where a target stopped the
 * bullet first): one instanced quad per hit, oriented by the surface normal,
 * in a fixed ring buffer (a single draw call however many marks there are).
 * Presentation only.
 */
export class ImpactMarks implements GameSystem {
  readonly name = 'impact-marks';
  readonly mesh: InstancedMesh;

  private readonly geometry = new PlaneGeometry(1, 1);
  private readonly material: MeshStandardNodeMaterial;
  private readonly capacity: number;
  private readonly placer = new Object3D();
  private readonly normal = new Vector3();
  private readonly unsubscribe: () => void;
  private next = 0;
  private count = 0;

  constructor(options: ImpactMarksOptions) {
    this.capacity = options.capacity ?? DEFAULT_CAPACITY;

    // A dark, soft-edged disc.
    const distance = length(uv().sub(0.5)).mul(2);
    this.material = new MeshStandardNodeMaterial({ roughness: 1, metalness: 0, transparent: true, depthWrite: false });
    this.material.colorNode = color(new Color(0x14110f));
    this.material.opacityNode = float(1).sub(smoothstep(0.55, 1, distance)).mul(0.92);

    this.mesh = new InstancedMesh(this.geometry, this.material, this.capacity);
    this.mesh.name = 'impact-marks';
    this.mesh.count = 0;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;

    this.unsubscribe = options.source.onShotResolved(({ shot, target }) => {
      if (shot.hit && !target) this.add(shot.hit.point, shot.hit.normal, shot.tick);
    });
  }

  /** Marks currently shown. */
  get size(): number {
    return this.count;
  }

  dispose(): void {
    this.unsubscribe();
    this.mesh.removeFromParent();
    this.mesh.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }

  private add(point: { x: number; y: number; z: number }, normal: { x: number; y: number; z: number }, seed: number): void {
    this.normal.set(normal.x, normal.y, normal.z);
    this.placer.position.set(point.x, point.y, point.z).addScaledVector(this.normal, SURFACE_OFFSET);
    this.placer.quaternion.setFromUnitVectors(FACE_NORMAL, this.normal);
    this.placer.rotateZ((seed * GOLDEN_ANGLE) % (Math.PI * 2));
    this.placer.scale.setScalar(MARK_SIZE * (0.85 + ((seed * 0.61) % 0.3)));
    this.placer.updateMatrix();

    this.mesh.setMatrixAt(this.next, this.placer.matrix);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.next = (this.next + 1) % this.capacity;
    this.count = Math.min(this.count + 1, this.capacity);
    this.mesh.count = this.count;
  }
}
