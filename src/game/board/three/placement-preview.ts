import * as THREE from 'three';
import { adjacentPlacementHexes, isPlacement, type PlacementKind } from '../target-feedback.ts';
import { ArtAssets, makeBuilding } from './art.ts';
import { makeTradeStation } from './trade-station-art.ts';
import type { BoardSceneView, worldGeometry } from './model.ts';

/** Local-only scene layer; its objects are never included in target raycasts. */
export class PlacementPreview {
  readonly root = new THREE.Group();
  kind: PlacementKind | null = null;
  target: string | null = null;
  private owner = '';
  private models = new Map<string, THREE.Group>();
  private materials = new Map<THREE.Material, THREE.Material>();
  private quietMaterials = new Map<THREE.Material, THREE.Material>();
  private originals = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
  private readonly paper = new THREE.Color('#c4bdab');

  update(id: string | null, view: BoardSceneView, geometry: ReturnType<typeof worldGeometry>, tiles: ReadonlyMap<string, { root: THREE.Group }>, assets: ArtAssets): boolean {
    const kind = isPlacement(view.targetMode) ? view.targetMode : null;
    const player = view.players.find(player => player.id === view.placementPlayerId);
    if (!id || !kind || !player) {
      if (!this.target) return false;
      this.clear(); return true;
    }
    if (this.target === id && this.kind === kind && this.owner === player.id) return false;
    this.clear();
    const key = `${kind}:${player.id}:${player.color}`;
    let model = this.models.get(key);
    if (!model) {
      model = new THREE.Group();
      if (kind === 'road') assets.box(model, player.color, [1, .115, .13], 0, .195, 0);
      else model.add(kind === 'station' ? makeTradeStation(assets) : makeBuilding(assets, kind, player.color, player.seat));
      model.traverse(part => {
        if (!(part instanceof THREE.Mesh || part instanceof THREE.Sprite)) return;
        if (part instanceof THREE.Sprite) part.material = this.ghostMaterial(part.material);
        else part.material = Array.isArray(part.material) ? part.material.map(material => this.ghostMaterial(material)) : this.ghostMaterial(part.material);
        part.castShadow = false; part.renderOrder = 12;
      });
      this.models.set(key, model);
    }
    if (kind === 'road') {
      const edge = geometry.edges.get(id); if (!edge) return false;
      model.position.set((edge.a.x + edge.b.x) / 2, .07, (edge.a.z + edge.b.z) / 2);
      model.scale.x = Math.hypot(edge.b.x - edge.a.x, edge.b.z - edge.a.z) * .88;
      model.rotation.y = -Math.atan2(edge.b.z - edge.a.z, edge.b.x - edge.a.x);
    } else {
      const point = geometry.vertices.get(id); if (!point) return false;
      const besideBuilding = kind === 'station' && !!view.buildings[id];
      model.position.set(point.x + (besideBuilding ? .23 : 0), .07, point.z - (besideBuilding ? .18 : 0));
    }
    this.target = id; this.kind = kind; this.owner = player.id; this.root.add(model);
    for (const hex of adjacentPlacementHexes(geometry.topology, kind, id)) {
      tiles.get(hex)?.root.traverse(group => {
        if (!group.userData.decorative) return;
        group.traverse(mesh => {
          if (!(mesh instanceof THREE.Mesh) || this.originals.has(mesh)) return;
          this.originals.set(mesh, mesh.material);
          mesh.material = Array.isArray(mesh.material) ? mesh.material.map(this.quiet) : this.quiet(mesh.material);
        });
      });
    }
    return true;
  }

  private ghostMaterial<T extends THREE.Material>(original: T): T {
    let material = this.materials.get(original);
    if (!material) {
      material = original.clone();
      material.opacity *= .8; material.transparent = true; material.depthWrite = false;
      this.materials.set(original, material);
    }
    return material as T;
  }

  private quiet = (original: THREE.Material): THREE.Material => {
    if (!(original instanceof THREE.MeshStandardMaterial)) return original;
    let material = this.quietMaterials.get(original);
    if (!material) {
      const copy = original.clone(); copy.color.lerp(this.paper, .32);
      this.quietMaterials.set(original, copy); material = copy;
    }
    return material;
  };

  clear(): void {
    for (const [mesh, original] of this.originals) mesh.material = original;
    this.originals.clear(); this.root.clear(); this.target = null; this.kind = null; this.owner = '';
  }
  reset(): void {
    this.clear(); this.models.clear();
    for (const material of this.materials.values()) material.dispose();
    this.materials.clear();
    for (const material of this.quietMaterials.values()) material.dispose();
    this.quietMaterials.clear();
  }
}
