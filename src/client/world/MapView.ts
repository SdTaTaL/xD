import { BoxGeometry, Group, Mesh, type Material } from 'three/webgpu';
import type { MapDefinition, SolidKind } from '@shared/maps/MapDefinition';
import { createGrayboxMaterial } from '../rendering/materials/GrayboxMaterial';

/** Graybox colour coding per level-design role. */
const GRAYBOX_COLORS: Readonly<Record<SolidKind, number>> = {
  floor: 0x8a8d91,
  wall: 0xb9bcc0,
  cover: 0xc9803f,
};

/**
 * Scene-graph representation of a map's static geometry.
 *
 * Every solid is a scaled instance of a single unit cube, so the whole map
 * shares one geometry buffer and one material per solid kind.
 */
export class MapView {
  readonly root = new Group();

  private readonly geometry = new BoxGeometry(1, 1, 1);
  private readonly materials: Readonly<Record<SolidKind, Material>>;

  constructor(map: MapDefinition) {
    this.root.name = `map:${map.id}`;
    this.materials = {
      floor: createGrayboxMaterial(GRAYBOX_COLORS.floor),
      wall: createGrayboxMaterial(GRAYBOX_COLORS.wall),
      cover: createGrayboxMaterial(GRAYBOX_COLORS.cover),
    };

    map.solids.forEach((solid, index) => {
      const mesh = new Mesh(this.geometry, this.materials[solid.kind]);
      mesh.name = `${map.id}:${solid.kind}:${index}`;
      mesh.position.set(solid.center.x, solid.center.y, solid.center.z);
      mesh.scale.set(solid.size.x, solid.size.y, solid.size.z);
      // The floor slab has nothing below it to shadow.
      mesh.castShadow = solid.kind !== 'floor';
      mesh.receiveShadow = true;
      // Static geometry: compute the local matrix once.
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      this.root.add(mesh);
    });
  }

  dispose(): void {
    this.root.removeFromParent();
    this.root.clear();
    this.geometry.dispose();
    for (const material of Object.values(this.materials)) material.dispose();
  }
}
