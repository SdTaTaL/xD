import {
  BufferAttribute,
  BufferGeometry,
  CapsuleGeometry,
  Color,
  Group,
  Matrix4,
  Mesh,
  MeshStandardNodeMaterial,
  Quaternion,
  Vector3,
} from 'three/webgpu';
import { STANDING_HITBOXES, type Hitbox } from '@shared/combat/hitboxes';
import { isStanding, type ShotOutcome, type TargetState } from '@shared/combat/targets';
import type { FrameContext, GameSystem } from '../core/GameSystem';

export interface TargetViewOptions {
  readonly range: {
    readonly states: readonly TargetState[];
    onShotResolved(listener: (outcome: ShotOutcome) => void): () => void;
  };
  readonly hitboxes?: readonly Hitbox[];
}

const BODY_COLOR = 0x5a6878;
const HEAD_COLOR = 0x3f4650;
/** Red flash on a hit, seconds. */
const FLASH_SECONDS = 0.12;
const FLASH_COLOR = new Color(0.9, 0.06, 0.04);
/** Time to fall flat when knocked down, seconds. */
const FALL_SECONDS = 0.4;
const UP = new Vector3(0, 1, 0);
const MERGED_ATTRIBUTES = ['position', 'normal', 'uv'] as const;

interface Dummy {
  /** Pivot at the feet: rotates to fall backwards. */
  readonly body: Group;
  readonly materials: readonly MeshStandardNodeMaterial[];
  sinceHit: number;
  /** A hit landed since the last frame: show the flash at full strength once, however long the frame. */
  freshHit: boolean;
  downTime: number;
}

/** A capsule mesh for each hitbox, placed from a to b and merged into one geometry (one draw call). */
function capsuleGeometry(hitboxes: readonly Hitbox[]): BufferGeometry {
  const parts = hitboxes.map((box) => {
    const axis = new Vector3(box.b.x - box.a.x, box.b.y - box.a.y, box.b.z - box.a.z);
    const part = new CapsuleGeometry(box.radius, axis.length(), 6, 12);
    part.applyMatrix4(
      new Matrix4().compose(
        new Vector3((box.a.x + box.b.x) / 2, (box.a.y + box.b.y) / 2, (box.a.z + box.b.z) / 2),
        new Quaternion().setFromUnitVectors(UP, axis.normalize()),
        new Vector3(1, 1, 1),
      ),
    );
    return part;
  });

  const merged = new BufferGeometry();
  for (const name of MERGED_ATTRIBUTES) {
    const itemSize = parts[0]?.getAttribute(name).itemSize ?? 3;
    const values = new Float32Array(parts.reduce((sum, part) => sum + part.getAttribute(name).array.length, 0));
    let offset = 0;
    for (const part of parts) {
      const array = part.getAttribute(name).array;
      values.set(array, offset);
      offset += array.length;
    }
    merged.setAttribute(name, new BufferAttribute(values, itemSize));
  }
  const indices: number[] = [];
  let base = 0;
  for (const part of parts) {
    const index = part.getIndex();
    if (index) for (let i = 0; i < index.count; i++) indices.push(index.getX(i) + base);
    base += part.getAttribute('position').count;
    part.dispose();
  }
  merged.setIndex(indices);
  merged.computeBoundingSphere();
  return merged;
}

/**
 * Training dummies drawn from their hitboxes: every capsule the simulation
 * tests has a mesh of exactly its shape, so what you see is what you hit.
 * Each dummy is two meshes (body, head) sharing geometry with the others.
 * A hit flashes the dummy red; knocked down, it falls backwards, and it
 * stands up again when the range respawns it. Presentation only.
 */
export class TargetView implements GameSystem {
  readonly name = 'target-view';
  readonly root = new Group();

  private readonly range: TargetViewOptions['range'];
  private readonly bodyGeometry: BufferGeometry;
  private readonly headGeometry: BufferGeometry;
  private readonly dummies: Dummy[] = [];
  private readonly unsubscribe: () => void;
  private disposed = false;

  constructor(options: TargetViewOptions) {
    this.range = options.range;
    this.root.name = 'training-targets';
    const hitboxes = options.hitboxes ?? STANDING_HITBOXES;
    this.bodyGeometry = capsuleGeometry(hitboxes.filter((box) => box.group !== 'head'));
    this.headGeometry = capsuleGeometry(hitboxes.filter((box) => box.group === 'head'));

    for (const state of this.range.states) this.dummies.push(this.build(state));

    this.unsubscribe = this.range.onShotResolved((outcome) => {
      const dummy = outcome.target ? this.dummies[outcome.target.target] : undefined;
      if (dummy) dummy.freshHit = true;
    });
  }

  update(frame: FrameContext): void {
    const states = this.range.states;
    this.dummies.forEach((dummy, index) => {
      const state = states[index];
      if (!state) return;

      if (dummy.freshHit) {
        dummy.freshHit = false;
        dummy.sinceHit = 0;
      } else {
        dummy.sinceHit += frame.deltaSeconds;
      }
      const flash = Math.max(0, 1 - dummy.sinceHit / FLASH_SECONDS);
      for (const material of dummy.materials) material.emissive.copy(FLASH_COLOR).multiplyScalar(flash);

      if (isStanding(state)) {
        dummy.downTime = 0;
        dummy.body.rotation.x = 0;
      } else {
        dummy.downTime += frame.deltaSeconds;
        const t = Math.min(1, dummy.downTime / FALL_SECONDS);
        dummy.body.rotation.x = (Math.PI / 2) * t * t; // accelerating, like a fall
      }
    });
  }

  /** Idempotent. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe();
    this.root.removeFromParent();
    this.root.clear();
    this.bodyGeometry.dispose();
    this.headGeometry.dispose();
    for (const dummy of this.dummies) for (const material of dummy.materials) material.dispose();
  }

  private build(state: TargetState): Dummy {
    const bodyMaterial = new MeshStandardNodeMaterial({ color: BODY_COLOR, roughness: 0.8, metalness: 0 });
    const headMaterial = new MeshStandardNodeMaterial({ color: HEAD_COLOR, roughness: 0.6, metalness: 0 });
    const root = new Group();
    const body = new Group();
    const { position, yaw } = state.spawn;
    root.position.set(position.x, position.y, position.z);
    root.rotation.y = -yaw;

    for (const mesh of [new Mesh(this.bodyGeometry, bodyMaterial), new Mesh(this.headGeometry, headMaterial)]) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      body.add(mesh);
    }
    root.add(body);
    this.root.add(root);
    return { body, materials: [bodyMaterial, headMaterial], sinceHit: Infinity, freshHit: false, downTime: 0 };
  }
}
