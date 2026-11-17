import * as THREE from 'three';
import type { ArtAssets } from './art.ts';
import type { HexSetup } from '../setup.ts';
import type { GroundPoint, worldGeometry } from './model.ts';

/** Deterministic, display-only art. No game entropy, state changes or animation loop. */
export const ART_REVISION = 'refinement-1';
const PALETTES: Record<HexSetup['terrain'], readonly [string, string]> = {
  forest: ['#2e6246', '#80ad72'], hills: ['#a85b3e', '#dfa47c'],
  pasture: ['#6e9855', '#b8d58c'], fields: ['#b88630', '#efd17b'],
  mountains: ['#63747e', '#b5bfc0'], desert: ['#c4a56a', '#f0dba5'],
};
const OFFSETS = [[-.43, -.29], [.39, -.30], [.05, .49]] as const;
const clamp = (n: number) => Math.max(0, Math.min(1, n));

function topGradient(assets: ArtAssets, root: THREE.Group, hex: HexSetup): void {
  const base = root.children[0];
  if (!(base instanceof THREE.Mesh)) throw new Error('Terrain base is missing.');
  base.geometry = assets.geometry(`gradient-base:${hex.terrain}`, () => {
    const geometry = base.geometry.clone();
    const positions = geometry.getAttribute('position'), normals = geometry.getAttribute('normal');
    const colors: number[] = [], [low, high] = PALETTES[hex.terrain];
    const dark = new THREE.Color(low), light = new THREE.Color(high);
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i), z = positions.getZ(i);
      const value = .52 - .22 * x - .21 * z + .16 * (1 - Math.min(1, Math.hypot(x, z)));
      // Color attributes are linear RGB. Wall and underside groups keep their existing materials.
      const color = normals.getY(i) > .9 ? dark.clone().lerp(light, clamp(value)) : new THREE.Color(0xffffff);
      colors.push(color.r, color.g, color.b);
    }
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    return geometry;
  });
  const materials = Array.isArray(base.material) ? [...base.material] : [base.material, base.material, base.material];
  materials[1] = assets.extra(new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, roughness: .94 }));
  base.material = materials; base.name = 'gradient-terrain-base';
}

function addSheep(assets: ArtAssets, root: THREE.Group): void {
  OFFSETS.forEach(([x, z], index) => {
    const sheep = new THREE.Group(); sheep.name = `sheep:${index}`; sheep.userData = { animal: 'sheep', decorative: 'sheep' };
    sheep.position.set(x, 0, z); sheep.rotation.y = [.30, -1.1, 2.15][index]; root.add(sheep);
    const body = assets.mesh(sheep, assets.geometry('wool-body', () => new THREE.IcosahedronGeometry(.13, 1)), assets.material('#f7f3df'), 0, .29, 0);
    body.scale.set(1.35, .94, .94);
    const head = assets.mesh(sheep, assets.geometry('sheep-head', () => new THREE.IcosahedronGeometry(.063, 0)), assets.material('#655b48'), .18, .285, 0);
    head.scale.set(.85, 1.1, .9);
    assets.box(sheep, '#73634c', [.045, .026, .17], .15, .33, 0);
    const legs = new THREE.InstancedMesh(assets.geometry('sheep-leg', () => new THREE.BoxGeometry(.027, .10, .027)), assets.material('#655943'), 4);
    const matrix = new THREE.Matrix4(); let k = 0;
    for (const lx of [-.095, .095]) for (const lz of [-.065, .065]) legs.setMatrixAt(k++, matrix.makeTranslation(lx, .18, lz));
    legs.instanceMatrix.needsUpdate = true; legs.castShadow = true; legs.receiveShadow = true; sheep.add(legs);
  });
}

function addBricks(assets: ArtAssets, root: THREE.Group): void {
  OFFSETS.forEach(([x, z], index) => {
    const pile = new THREE.Group(); pile.name = `brick-pile:${index}`; pile.userData.decorative = 'brick'; pile.position.set(x, 0, z); pile.rotation.y = [.08, -.32, .22][index]; root.add(pile);
    for (let j = 0; j < 3; j++) {
      // Two on the bottom, one crossing their joint. All are true rectangular cuboids.
      const brick = assets.box(pile, ['#c26b48', '#d68b5a', '#b85e40'][j], [.235, .095, .125], j < 2 ? (j - .5) * .25 : 0, .169 + (j === 2 ? .10 : 0), 0);
      brick.name = 'rectangular-brick'; brick.userData.brick = true;
    }
  });
}

function addWheat(assets: ArtAssets, root: THREE.Group): void {
  const field = new THREE.Group(); field.name = 'wheat-field'; field.userData.decorative = 'wheat'; root.add(field);
  const count = OFFSETS.length * 5;
  const stems = new THREE.InstancedMesh(assets.geometry('upright-wheat-stem', () => new THREE.CylinderGeometry(.008, .011, 1, 5)), assets.material('#b18c35'), count);
  const kernels = new THREE.InstancedMesh(assets.geometry('wheat-kernel', () => new THREE.IcosahedronGeometry(.032, 0)), assets.material('#efce62'), count * 7);
  stems.name = 'upright-wheat-stems'; kernels.name = 'wheat-ears';
  const transform = new THREE.Object3D(); let stem = 0, grain = 0;
  OFFSETS.forEach(([x, z], patch) => {
    for (let row = 0; row < 5; row++) {
      const sx = x + (row % 3 - 1) * .095, sz = z + (row < 3 ? -.065 : .065);
      const height = .29 + .035 * ((row + patch) % 3);
      transform.position.set(sx, .123 + height / 2, sz); transform.rotation.set(0, 0, 0); transform.scale.set(1, height, 1); transform.updateMatrix();
      stems.setMatrixAt(stem++, transform.matrix);
      for (let pair = 0; pair < 3; pair++) for (const side of [-1, 1]) {
        transform.position.set(sx + side * .022, .123 + height - .075 + pair * .045, sz);
        transform.rotation.set(0, patch * .3, side * -.43); transform.scale.set(.63, 1.18, .62); transform.updateMatrix(); kernels.setMatrixAt(grain++, transform.matrix);
      }
      transform.position.set(sx, .123 + height + .055, sz); transform.rotation.set(0, 0, 0); transform.scale.set(.60, 1.4, .60); transform.updateMatrix(); kernels.setMatrixAt(grain++, transform.matrix);
    }
  });
  for (const mesh of [stems, kernels]) { mesh.instanceMatrix.needsUpdate = true; mesh.castShadow = true; mesh.receiveShadow = true; mesh.computeBoundingBox(); mesh.computeBoundingSphere(); field.add(mesh); }
}

/** Refines only visible terrain. The original boats, tokens and logical IDs are untouched. */
export function refineTerrain(assets: ArtAssets, hex: HexSetup, root: THREE.Group, token: THREE.Sprite | null): void {
  topGradient(assets, root, hex);
  if (hex.terrain === 'desert') {
    const sand = root.children.find(child => child.userData.dunes);
    if (!(sand instanceof THREE.Mesh)) throw new Error('Continuous sand surface is missing.');
    sand.geometry = assets.geometry('raised-continuous-dunes', () => {
      const geometry = sand.geometry.clone(), positions = geometry.getAttribute('position');
      const colors: number[] = [], low = new THREE.Color('#c7a86e'), high = new THREE.Color('#f5dfac');
      for (let i = 0; i < positions.count; i++) {
        const y = .123 + (positions.getY(i) - .123) * 1.65;
        positions.setY(i, y);
        const mix = clamp(.25 + (y - .123) * 2.3 - positions.getX(i) * .09);
        const color = low.clone().lerp(high, mix); colors.push(color.r, color.g, color.b);
      }
      positions.needsUpdate = true; geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      geometry.computeVertexNormals(); geometry.computeBoundingBox(); geometry.computeBoundingSphere(); return geometry;
    });
  } else if (['hills', 'pasture', 'fields'].includes(hex.terrain)) {
    const base = root.children[0];
    for (const child of [...root.children]) if (child !== base && child !== token) root.remove(child);
    if (hex.terrain === 'hills') addBricks(assets, root);
    if (hex.terrain === 'pasture') addSheep(assets, root);
    if (hex.terrain === 'fields') addWheat(assets, root);
  }
  root.userData.artRevision = ART_REVISION;
}

type World = ReturnType<typeof worldGeometry>;
export interface CoastSegment { a: GroundPoint; b: GroundPoint; outward: GroundPoint }
export function coastline(geometry: World): CoastSegment[] {
  return geometry.topology.edges.filter(edge => edge.hexIds.length === 1).map(edge => {
    const { a, b } = geometry.edges.get(edge.id)!, hex = geometry.hexes.get(edge.hexIds[0])!;
    const dx = (a.x + b.x) / 2 - hex.x, dz = (a.z + b.z) / 2 - hex.z, length = Math.hypot(dx, dz);
    return { a, b, outward: { x: dx / length, z: dz / length } };
  });
}
export function coastDistance(x: number, z: number, coast: readonly CoastSegment[]): number {
  let best = Infinity;
  for (const { a, b } of coast) {
    const dx = b.x - a.x, dz = b.z - a.z, t = clamp(((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz));
    best = Math.min(best, Math.hypot(x - a.x - t * dx, z - a.z - t * dz));
  }
  return best;
}
/** Calm graded water surface; only its height moves in the separate motion layer. */
export function makeOcean(assets: ArtAssets, radius: number, geometry: World): THREE.Group {
  const root = new THREE.Group(); root.name = 'layered-ocean'; root.userData.artRevision = ART_REVISION;
  const coast = coastline(geometry), segments = 128, rings = 48;
  const surface = assets.geometry('ocean-surface', () => {
    const positions: number[] = [], colors: number[] = [], indices: number[] = [];
    const deep = new THREE.Color('#216d89'), mid = new THREE.Color('#328fa8'), shallow = new THREE.Color('#7acbd0');
    const add = (x: number, z: number) => {
      const distance = coastDistance(x, z, coast);
      const wave = Math.sin(x * 1.05 + z * .35) * Math.cos(z * .85 - x * .25);
      positions.push(x, -.178 + wave * .001, z);
      const color = deep.clone().lerp(mid, Math.exp(-distance * .56));
      color.lerp(shallow, .86 * Math.exp(-distance * distance / .23));
      color.multiplyScalar(1 + .012 * wave); colors.push(color.r, color.g, color.b);
    };
    add(0, 0);
    for (let r = 1; r <= rings; r++) for (let s = 0; s < segments; s++) {
      const angle = s * Math.PI * 2 / segments; add(Math.sin(angle) * radius * r / rings, Math.cos(angle) * radius * r / rings);
    }
    for (let s = 0; s < segments; s++) indices.push(0, 1 + s, 1 + (s + 1) % segments);
    for (let r = 1; r < rings; r++) for (let s = 0; s < segments; s++) {
      const a = 1 + (r - 1) * segments + s, b = 1 + (r - 1) * segments + (s + 1) % segments, c = 1 + r * segments + s, d = 1 + r * segments + (s + 1) % segments;
      indices.push(a, c, d, a, d, b);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); g.setIndex(indices); g.computeVertexNormals(); return g;
  });
  const side = assets.mesh(root, assets.geometry('ocean-depth', () => new THREE.CylinderGeometry(radius, radius, .11, 96)), assets.material('#276d81'), 0, -.24, 0); side.castShadow = false;
  const water = assets.mesh(root, surface, assets.extra(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .48, metalness: .06, side: THREE.DoubleSide })));
  water.name = 'depth-gradient-water'; water.castShadow = false;
  const foamPoints: THREE.Vector3[] = [];
  for (const edge of coast) for (let i = 0; i < 18; i++) {
    const point = (t: number) => {
      const phase = edge.a.x * 3.7 + edge.a.z * 2.4;
      const offset = .065 + .017 * Math.sin(t * Math.PI * 2 + phase);
      return new THREE.Vector3(edge.a.x + (edge.b.x - edge.a.x) * t + edge.outward.x * offset, -.169, edge.a.z + (edge.b.z - edge.a.z) * t + edge.outward.z * offset);
    };
    if (i % 7 !== 0) foamPoints.push(point(.035 + .93 * i / 18), point(.035 + .93 * (i + 1) / 18));
  }
  const foam = new THREE.LineSegments(assets.geometry('shore-foam', () => new THREE.BufferGeometry().setFromPoints(foamPoints)), assets.extra(new THREE.LineBasicMaterial({ color: '#d4f3e9', transparent: true, opacity: .22, depthWrite: false })));
  foam.name = 'shore-foam'; root.add(foam);
  return root;
}

/** Instance attributes have their own GPU lifetime, separate from shared geometry/materials. */
export function disposeArtInstances(root: THREE.Object3D): void {
  root.traverse(object => { if (object instanceof THREE.InstancedMesh) object.dispose(); });
}

/** Read-only diagnostics extracted from actual geometry rather than advertised counts. */
export function inspectTerrainArt(root: THREE.Group) {
  const base = root.children[0] as THREE.Mesh, colors = base.geometry.getAttribute('color');
  const distinct = new Set<string>();
  if (colors) for (let i = 0; i < colors.count; i++) distinct.add([colors.getX(i), colors.getY(i), colors.getZ(i)].map(n => n.toFixed(4)).join(','));
  let sheep = 0, bricks = 0, stems = 0, upward = true, cuboids = true, minDune = Infinity, maxDune = -Infinity;
  root.traverse(object => {
    if (object.userData.animal === 'sheep') sheep++;
    if (object instanceof THREE.Mesh && object.userData.brick) { bricks++; cuboids &&= object.geometry.type === 'BoxGeometry' && object.scale.x > object.scale.z && object.scale.z > object.scale.y; }
    if (object instanceof THREE.InstancedMesh && object.name === 'upright-wheat-stems') {
      stems += object.count; const matrix = new THREE.Matrix4();
      for (let i = 0; i < object.count; i++) { object.getMatrixAt(i, matrix); const up = new THREE.Vector3(0, 1, 0).transformDirection(matrix); upward &&= up.y > .99; }
    }
    if (object instanceof THREE.Mesh && object.userData.dunes) {
      const positions = object.geometry.getAttribute('position');
      for (let i = 0; i < positions.count; i++) { minDune = Math.min(minDune, positions.getY(i)); maxDune = Math.max(maxDune, positions.getY(i)); }
    }
  });
  return { id: root.userData.hexId, terrain: root.userData.terrain, revision: root.userData.artRevision,
    gradientColors: distinct.size, sheep, bricks, cuboids, stems, upward,
    duneMin: Number.isFinite(minDune) ? minDune : null, duneMax: Number.isFinite(maxDune) ? maxDune : null };
}
