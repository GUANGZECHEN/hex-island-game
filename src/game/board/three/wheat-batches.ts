import * as THREE from 'three';
import type { ArtAssets } from './art.ts';
import { GRAIN_FADE_OPACITY, WHEAT_PATCHES } from '../grain-clearance.ts';

interface Batch {
  solid: THREE.InstancedMesh;
  faded: THREE.InstancedMesh;
  original: Float32Array;
  perPatch: number;
}
const fields = new WeakMap<THREE.Group, { mask: number; batches: Batch[] }>();

/** Keep one solid and one translucent instance batch per material, regardless of stalk count. */
export function prepareWheat(root: THREE.Group, field: THREE.Group, meshes: THREE.InstancedMesh[], assets: ArtAssets): void {
  const batches = meshes.map(solid => {
    const material = assets.extra((solid.material as THREE.MeshStandardMaterial).clone());
    material.transparent = true; material.opacity = GRAIN_FADE_OPACITY; material.depthWrite = false;
    const faded = new THREE.InstancedMesh(solid.geometry, material, solid.count);
    faded.name = `faded-${solid.name}`;
    faded.visible = false; faded.count = 0; faded.castShadow = false; faded.receiveShadow = true;
    // Repartitioning instances never moves them beyond their original, full-field bounds.
    faded.boundingBox = solid.boundingBox?.clone() ?? null;
    faded.boundingSphere = solid.boundingSphere?.clone() ?? null;
    field.add(faded);
    return { solid, faded, original: new Float32Array(solid.instanceMatrix.array), perPatch: solid.count / WHEAT_PATCHES.length };
  });
  fields.set(root, { mask: 0, batches });
}

export function setWheatClearance(root: THREE.Group, mask: number): void {
  const field = fields.get(root);
  if (!field || field.mask === mask) return;
  field.mask = mask;
  for (const { solid, faded, original, perPatch } of field.batches) {
    solid.count = 0; faded.count = 0;
    const floats = perPatch * 16;
    for (let patch = 0; patch < WHEAT_PATCHES.length; patch++) {
      const batch = mask & (1 << patch) ? faded : solid;
      batch.instanceMatrix.array.set(original.subarray(patch * floats, (patch + 1) * floats), batch.count * 16);
      batch.count += perPatch;
    }
    for (const batch of [solid, faded]) {
      batch.visible = batch.count > 0; batch.instanceMatrix.needsUpdate = true;
    }
  }
}
