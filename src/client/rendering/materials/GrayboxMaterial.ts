import { Color, MeshStandardNodeMaterial, type ColorRepresentation, type Node } from 'three/webgpu';
import { abs, color, fract, fwidth, max, min, normalWorld, positionWorld, saturate, smoothstep } from 'three/tsl';

/** Minor grid spacing, in meters. */
const MINOR_CELL = 1;
/** Major grid spacing, in meters. */
const MAJOR_CELL = 4;

type ScalarNode = Node<'float'>;

/**
 * Anti-aliased coverage (0..1) of grid lines along one world axis.
 * Lines fade out where cells shrink to a few pixels, which avoids moiré at
 * distance and at grazing angles.
 */
function gridLineCoverage(coordinate: ScalarNode, cellSize: number, halfWidthPx: number): ScalarNode {
  const cells = coordinate.div(cellSize);
  const cellsPerPixel = max(fwidth(cells), 1e-5);
  const cellFraction = fract(cells);
  const pixelsToLine = min(cellFraction, cellFraction.oneMinus()).div(cellsPerPixel);
  const coverage = saturate(pixelsToLine.negate().add(halfWidthPx + 0.5));
  return coverage.mul(smoothstep(0.08, 0.3, cellsPerPixel).oneMinus());
}

/**
 * Grid coverage on axis-aligned faces: each face shows the grid of the two
 * world axes spanning it, so the pattern is in world units regardless of the
 * mesh's scale and needs no UVs.
 */
function worldGridCoverage(cellSize: number, halfWidthPx: number): ScalarNode {
  const x = gridLineCoverage(positionWorld.x, cellSize, halfWidthPx);
  const y = gridLineCoverage(positionWorld.y, cellSize, halfWidthPx);
  const z = gridLineCoverage(positionWorld.z, cellSize, halfWidthPx);
  const n = abs(normalWorld);
  return n.x.mul(max(y, z)).add(n.y.mul(max(x, z))).add(n.z.mul(max(x, y)));
}

/**
 * Procedural "dev texture" material for graybox geometry: a flat colour with
 * a 1 m / 4 m world-space grid, giving scale and depth cues without any
 * texture assets.
 */
export function createGrayboxMaterial(baseColor: ColorRepresentation): MeshStandardNodeMaterial {
  const minor = worldGridCoverage(MINOR_CELL, 0.5);
  const major = worldGridCoverage(MAJOR_CELL, 0.75);
  const shade = minor.mul(0.15).add(major.mul(0.3)).oneMinus();

  const material = new MeshStandardNodeMaterial({ roughness: 0.85, metalness: 0 });
  material.colorNode = color(new Color(baseColor)).mul(shade);
  return material;
}
