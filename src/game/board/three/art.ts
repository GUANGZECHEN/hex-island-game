import * as THREE from 'three';
import { RESOURCE_PATHS } from '../../ui/icons.ts';
import type { Resource } from '../../rules/state.ts';
import type { HexSetup, PortType } from '../setup.ts';
import { duneHeight, type GroundPoint, type PortBoatPlan } from './model.ts';

/** Shared GPU resources have one owner and a bounded lifetime. */
export class ArtAssets {
  private geometries = new Map<string, THREE.BufferGeometry>();
  private materials = new Map<string, THREE.MeshStandardMaterial>();
  private labels = new Map<string, THREE.SpriteMaterial>();
  private textures = new Set<THREE.Texture>();
  private extras = new Set<THREE.Material>();
  geometry(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
    let g = this.geometries.get(key); if (!g) { g = make(); this.geometries.set(key, g); } return g;
  }
  material(color: string | number): THREE.MeshStandardMaterial {
    const key = String(color); let m = this.materials.get(key);
    if (!m) { m = new THREE.MeshStandardMaterial({ color, roughness: .88, metalness: 0, flatShading: true }); this.materials.set(key, m); }
    return m;
  }
  extra<T extends THREE.Material>(m: T): T { this.extras.add(m); return m; }
  mesh(parent: THREE.Object3D, g: THREE.BufferGeometry, m: THREE.Material | THREE.Material[], x = 0, y = 0, z = 0): THREE.Mesh {
    const mesh = new THREE.Mesh(g, m); mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
  }
  box(parent: THREE.Object3D, color: string | number, size: [number, number, number], x: number, y: number, z: number): THREE.Mesh {
    const g = this.geometry('cube', () => new THREE.BoxGeometry(1, 1, 1));
    const m = this.mesh(parent, g, this.material(color), x, y, z); m.scale.set(...size); return m;
  }
  label(text: string, kind: 'token' | 'sail' | 'robber', resource: Resource | null = null): THREE.SpriteMaterial {
    const key = `${kind}:${text}:${resource}`; const existing = this.labels.get(key); if (existing) return existing;
    const c = document.createElement('canvas'); c.width = 256; c.height = 256;
    const ctx = c.getContext('2d'); if (!ctx) throw new Error('Canvas text rendering unavailable.');
    if (kind === 'token' || kind === 'robber') {
      ctx.fillStyle = '#fff8dc'; ctx.strokeStyle = kind === 'robber' ? '#c3382f' : '#a49368'; ctx.lineWidth = kind === 'robber' ? 16 : 7;
      ctx.beginPath(); ctx.arc(128, 128, 109, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      if (kind === 'robber') { ctx.beginPath(); ctx.moveTo(53, 53); ctx.lineTo(203, 203); ctx.stroke(); }
      else {
        ctx.fillStyle = text === '6' || text === '8' ? '#b93b32' : '#314b3f';
        ctx.font = 'bold 102px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, 128, 116);
        const count = 6 - Math.abs(7 - Number(text)); for (let i = 0; i < count; i++) { ctx.beginPath(); ctx.arc(128 + (i - (count - 1) / 2) * 20, 184, 6, 0, Math.PI * 2); ctx.fill(); }
      }
    } else {
      ctx.fillStyle = '#fff1cb'; ctx.strokeStyle = '#8d6a40'; ctx.lineWidth = 6;
      ctx.beginPath(); ctx.moveTo(28, 25); ctx.lineTo(226, 38); ctx.quadraticCurveTo(205, 125, 226, 220); ctx.lineTo(28, 227); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#423b2f'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '900 91px system-ui, sans-serif'; ctx.fillText(text, 128, resource ? 96 : 130);
      if (resource) {
        ctx.save(); ctx.translate(94, 151); ctx.scale(2.85, 2.85); ctx.lineWidth = 1.9; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.strokeStyle = ({ lumber: '#25553c', brick: '#9c4735', wool: '#6f7a47', grain: '#9c711c', ore: '#4b5b68' })[resource];
        ctx.stroke(new Path2D(RESOURCE_PATHS[resource])); ctx.restore();
      }
    }
    const texture = new THREE.CanvasTexture(c); texture.colorSpace = THREE.SRGBColorSpace; this.textures.add(texture);
    const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false, toneMapped: false });
    this.labels.set(key, mat); return mat;
  }
  sprite(parent: THREE.Object3D, material: THREE.SpriteMaterial, x: number, y: number, z: number, size: number): THREE.Sprite {
    const s = new THREE.Sprite(material); s.position.set(x, y, z); s.scale.set(size, size, 1); s.renderOrder = 10; parent.add(s); return s;
  }
  dispose(): void {
    this.geometries.forEach(g => g.dispose()); this.materials.forEach(m => m.dispose()); this.labels.forEach(m => m.dispose()); this.extras.forEach(m => m.dispose()); this.textures.forEach(t => t.dispose());
    this.geometries.clear(); this.materials.clear(); this.labels.clear(); this.textures.clear(); this.extras.clear();
  }
}
const TOP_COLORS = { forest: '#65865b', hills: '#cc8960', pasture: '#9fb774', fields: '#d7b65a', mountains: '#929b9d', desert: '#e1c98e' };
export function makeTerrain(assets: ArtAssets, hex: HexSetup, p: GroundPoint): { root: THREE.Group; token: THREE.Sprite | null } {
  const root = new THREE.Group(); root.position.set(p.x, 0, p.z); root.userData = { hexId: hex.hexId, terrain: hex.terrain }; root.name = `terrain:${hex.hexId}`;
  const base = assets.geometry('hex-base', () => new THREE.CylinderGeometry(.986, .986, .24, 6));
  assets.mesh(root, base, [assets.material('#85694d'), assets.material(TOP_COLORS[hex.terrain]), assets.material('#71513c')]);
  const offsets = [[-.43, -.29], [.38, -.30], [.05, .45]];
  if (hex.terrain === 'desert') {
    const dunes = assets.geometry('continuous-dunes', () => {
      const positions: number[] = [0, duneHeight(0, 0, 0), 0], colors: number[] = [], index: number[] = [];
      const sectors = 48, rings = 8;
      for (let r = 1; r <= rings; r++) for (let n = 0; n < sectors; n++) {
        const edge = Math.floor(n / 8), t = (n % 8) / 8, a = edge * Math.PI / 3, b = (edge + 1) * Math.PI / 3;
        const x = (Math.sin(a) * (1 - t) + Math.sin(b) * t) * .98 * r / rings;
        const z = (Math.cos(a) * (1 - t) + Math.cos(b) * t) * .98 * r / rings;
        positions.push(x, duneHeight(x, z, r / rings), z);
      }
      for (let n = 0; n < sectors; n++) index.push(0, 1 + n, 1 + (n + 1) % sectors);
      for (let r = 1; r < rings; r++) for (let n = 0; n < sectors; n++) {
        const a = 1 + (r - 1) * sectors + n, b = 1 + (r - 1) * sectors + (n + 1) % sectors, c = 1 + r * sectors + n, d = 1 + r * sectors + (n + 1) % sectors;
        index.push(a, c, d, a, d, b);
      }
      for (let i = 0; i < positions.length; i += 3) { const color = new THREE.Color('#ddc28a').lerp(new THREE.Color('#f1dda4'), Math.min(1, (positions[i + 1] - .12) * 4)); colors.push(color.r, color.g, color.b); }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); g.setIndex(index); g.computeVertexNormals(); return g;
    });
    const mat = assets.extra(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide }));
    assets.mesh(root, dunes, mat).userData.dunes = true;
    return { root, token: null };
  }
  offsets.forEach(([x, z], i) => {
    if (hex.terrain === 'forest') {
      assets.mesh(root, assets.geometry('tree-trunk', () => new THREE.CylinderGeometry(.036, .05, .27, 6)), assets.material('#705135'), x, .25, z);
      const tree = assets.mesh(root, assets.geometry('tree-crown', () => new THREE.ConeGeometry(.21, .59, 7)), assets.material(i % 2 ? '#3d7250' : '#2d6246'), x, .55, z); tree.rotation.y = i * .6;
    } else if (hex.terrain === 'mountains' || hex.terrain === 'hills') {
      const rock = assets.mesh(root, assets.geometry('rock', () => new THREE.DodecahedronGeometry(.24, 0)), assets.material(hex.terrain === 'mountains' ? (i % 2 ? '#74838b' : '#63717d') : (i % 2 ? '#bd6647' : '#ab5138')), x, .26, z);
      rock.scale.set(1, hex.terrain === 'mountains' ? 1.25 : .58, .9); rock.rotation.y = i * .7;
      if (hex.terrain === 'hills' && i === 2) for (let j = 0; j < 3; j++) assets.box(root, '#d68b61', [.13, .075, .13], x + (j - 1) * .16, .19, z + .12);
    } else if (hex.terrain === 'fields') {
      for (let j = 0; j < 3; j++) assets.box(root, j % 2 ? '#e2bd54' : '#efd471', [.06, .11, .34], x + (j - 1) * .10, .18, z);
    } else if (hex.terrain === 'pasture' && i < 2) {
      const sheep = assets.mesh(root, assets.geometry('sheep', () => new THREE.IcosahedronGeometry(.12, 1)), assets.material('#f4f0df'), x, .25, z); sheep.scale.set(1.4, .85, .85);
      assets.box(root, '#665341', [.07, .08, .07], x + .14, .23, z);
      assets.box(root, '#6b604d', [.15, .07, .08], x, .16, z);
    }
  });
  const token = assets.sprite(root, assets.label(String(hex.token), 'token'), 0, .48, 0, .54);
  return { root, token };
}
export function makeBoatPort(assets: ArtAssets, type: PortType, plan: PortBoatPlan): THREE.Group {
  const root = new THREE.Group(); root.userData = { type, boat: true, decks: plan.decks };
  for (const deck of plan.decks) {
    const dx = deck.end.x - deck.start.x, dz = deck.end.z - deck.start.z, len = Math.hypot(dx, dz);
    const pier = new THREE.Group(); pier.name = `deck:${deck.vertexId}`; pier.userData.vertexId = deck.vertexId;
    pier.position.set((deck.start.x + deck.end.x) / 2, .11, (deck.start.z + deck.end.z) / 2); pier.rotation.y = -Math.atan2(dz, dx);
    assets.box(pier, '#a88658', [len, .065, .18], 0, 0, 0);
    for (const t of [-.32, .32]) assets.box(pier, '#775b3e', [.055, .27, .21], len * t, -.12, 0);
    const points: THREE.Vector3[] = []; for (let x = -len / 2 + .10; x < len / 2; x += .13) points.push(new THREE.Vector3(x, .035, -.08), new THREE.Vector3(x, .035, .08));
    const lines = assets.geometry(`pier-planks:${len.toFixed(6)}`, () => new THREE.BufferGeometry().setFromPoints(points));
    pier.add(new THREE.LineSegments(lines, assets.extra(new THREE.LineBasicMaterial({ color: '#6c5137', transparent: true, opacity: .6 })))); root.add(pier);
  }
  const boat = new THREE.Group(); boat.position.set(plan.center.x, 0, plan.center.z); boat.rotation.y = -Math.atan2(plan.tangent.z, plan.tangent.x); boat.name = 'port-boat';
  const hull = assets.geometry('boat-hull', () => {
    const shape = new THREE.Shape(); shape.moveTo(-.53, -.22); shape.lineTo(.35, -.25); shape.quadraticCurveTo(.58, -.18, .67, 0); shape.quadraticCurveTo(.58, .18, .35, .25); shape.lineTo(-.53, .22); shape.quadraticCurveTo(-.68, 0, -.53, -.22);
    const g = new THREE.ExtrudeGeometry(shape, { depth: .18, bevelEnabled: true, bevelThickness: .024, bevelSize: .025, bevelSegments: 1, steps: 1, curveSegments: 6 }); g.rotateX(-Math.PI / 2); return g;
  });
  assets.mesh(boat, hull, assets.material('#795139'), 0, -.10, 0);
  assets.box(boat, '#ceb37c', [.86, .028, .36], -.06, .10, 0);
  assets.box(boat, '#906642', [.88, .07, .045], -.04, .14, -.215); assets.box(boat, '#906642', [.88, .07, .045], -.04, .14, .215);
  for (const x of [-.35, .18]) assets.box(boat, '#b39667', [.06, .035, .34], x, .135, 0);
  assets.box(boat, '#715039', [.035, .60, .035], -.06, .40, .04);
  const sail = assets.sprite(boat, assets.label(type === 'generic' ? '3:1' : '2:1', 'sail', type === 'generic' ? null : type), .03, .54, 0, .60);
  sail.name = 'boat-ratio'; sail.userData = { ratio: type === 'generic' ? '3:1' : '2:1', resource: type === 'generic' ? null : type };
  root.add(boat); return root;
}
export function makeBuilding(assets: ArtAssets, kind: 'settlement' | 'city', color: string): THREE.Group {
  const g = new THREE.Group(); g.userData.kind = kind;
  assets.box(g, color, kind === 'city' ? [.43, .27, .34] : [.27, .25, .29], 0, .265, 0);
  const roof = assets.geometry('house-roof', () => { const geo = new THREE.ConeGeometry(.245, .20, 4); geo.rotateY(Math.PI / 4); return geo; });
  assets.mesh(g, roof, assets.material(color), kind === 'city' ? -.12 : 0, .47, 0);
  if (kind === 'city') { assets.box(g, color, [.20, .47, .25], .16, .37, .04); assets.box(g, color, [.25, .065, .30], .16, .63, .04); }
  assets.box(g, '#f4ebd2', [.065, .09, .01], -.06, .285, .151);
  assets.box(g, '#574a3b', [.068, .14, .012], .065, .22, .153);
  return g;
}
