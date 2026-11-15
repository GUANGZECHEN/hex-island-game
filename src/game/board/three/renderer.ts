import * as THREE from 'three';
import { resizeManualFrustum } from './camera-layout.ts';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ArtAssets, makeBoatPort, makeBuilding, makeTerrain } from './art.ts';
import { portBoatPlan, staticBoardKey, worldGeometry, type BoardSceneView } from './model.ts';
import { ART_REVISION, refineTerrain, makeOcean, inspectTerrainArt, disposeArtInstances } from './refinement.ts';

/** Persistent public-only scene. Camera events never issue game commands or rebuild inputs. */
export class ThreeBoardRenderer {
  readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-9, 9, 9, -9, .1, 100);
  private controls: OrbitControls;
  private assets = new ArtAssets();
  private map = new THREE.Group();
  private pieces = new THREE.Group();
  private targets = new THREE.Group();
  private targetMaterial = new THREE.MeshBasicMaterial({ color: '#fff3a0', transparent: true, opacity: .8, depthTest: false, depthWrite: false });
  private geometry: ReturnType<typeof worldGeometry>;
  private view: BoardSceneView;
  private key = '';
  private structureKey = '';
  private targetKey = '';
  private tiles = new Map<string, { root: THREE.Group; token: THREE.Sprite | null }>();
  private dimmed: THREE.Material[] = [];
  private robber: THREE.Sprite | null = null;
  private robberId = '';
  private worldBounds = new THREE.Box3();
  private defaultTarget = new THREE.Vector3();
  private frame: number | null = null;
  private frameCount = 0;
  private down: { x: number; y: number } | null = null;
  private abort = new AbortController();
  private observer: ResizeObserver;
  private disposed = false;
  private width = 0;
  private height = 0;
  private manualView = false;
  private mapBuilds = 0;
  private adjustTouch = false;
  private device = '';
  private pickCount = 0;
  private static instances = 0;
  private instanceId = ++ThreeBoardRenderer.instances;

  constructor(private host: HTMLElement, view: BoardSceneView, private choose: (id: string) => void, private failed: (reason: string) => void) {
    this.view = view; this.geometry = worldGeometry(view.board.layout);
    this.canvas = document.createElement('canvas'); this.canvas.className = 'three-island-board';
    this.canvas.setAttribute('aria-label', '3D island board. Use the legal-target selector for keyboard placement.'); this.canvas.setAttribute('role', 'img');
    const gl = this.canvas.getContext('webgl2', { antialias: true, alpha: false });
    if (!gl) throw new Error('WebGL2 is unavailable');
    const ext = gl.getExtension('WEBGL_debug_renderer_info'); this.device = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, context: gl, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, window.innerWidth <= 1100 ? 1.25 : 1.5));
    this.renderer.shadowMap.enabled = window.innerWidth > 600; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene.background = new THREE.Color('#84b9c4');
    this.scene.add(new THREE.HemisphereLight(0xfff3da, 0x536f73, 2.4));
    const sun = new THREE.DirectionalLight(0xfff6df, 3); sun.position.set(-6, 12, 7); sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024); sun.shadow.camera.left = -12; sun.shadow.camera.right = 12; sun.shadow.camera.top = 12; sun.shadow.camera.bottom = -12; sun.shadow.normalBias = .04; this.scene.add(sun);
    this.scene.add(this.map, this.pieces, this.targets);
    this.controls = new OrbitControls(this.camera, this.canvas);
    Object.assign(this.controls.mouseButtons, { LEFT: null, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: null });
    this.controls.minPolarAngle = .10; this.controls.maxPolarAngle = Math.PI / 3; this.controls.minZoom = .65; this.controls.maxZoom = 3;
    this.controls.maxTargetRadius = 2; this.controls.enableDamping = false;
    this.controls.addEventListener('change', this.invalidate);
    this.controls.addEventListener('start', () => { this.manualView = true; });
    const signal = this.abort.signal;
    this.canvas.addEventListener('pointerdown', event => {
      if (event.button === 1) event.preventDefault();
      if (event.isPrimary && event.button === 0 && !this.adjustTouch) this.down = { x: event.clientX, y: event.clientY };
    }, { signal });
    this.canvas.addEventListener('pointerup', this.pick, { signal });
    this.canvas.addEventListener('pointercancel', () => { this.down = null; }, { signal });
    this.canvas.addEventListener('auxclick', event => { if (event.button === 1) event.preventDefault(); }, { signal });
    this.canvas.addEventListener('webglcontextlost', event => {
      event.preventDefault(); queueMicrotask(() => { if (!this.disposed) this.failed('3D connection to the graphics device was lost. Switched to 2D.'); });
    }, { signal });
    window.addEventListener('resize', this.resize, { passive: true, signal });
    this.observer = new ResizeObserver(this.resize); this.observer.observe(this.host);
    host.replaceChildren(this.canvas); host.dataset.renderer = '3d';
    this.update(view); this.touchPolicy(); this.resize();
  }
  private rebuildMap(): void {
    this.mapBuilds++;
    disposeArtInstances(this.map);
    this.map.clear(); this.pieces.clear(); this.targets.clear(); this.dimmed.forEach(m => m.dispose()); this.dimmed = [];
    this.assets.dispose(); this.assets = new ArtAssets(); this.tiles.clear(); this.robber = null; this.robberId = '';
    this.geometry = worldGeometry(this.view.board.layout);
    for (const hex of this.view.board.hexes) {
      const terrain = makeTerrain(this.assets, hex, this.geometry.hexes.get(hex.hexId)!);
      refineTerrain(this.assets, hex, terrain.root, terrain.token);
      this.tiles.set(hex.hexId, terrain); this.map.add(terrain.root);
    }
    for (const port of this.view.board.ports) {
      const boat = makeBoatPort(this.assets, port.type, portBoatPlan(port, this.geometry)); boat.name = `port:${port.edgeId}`; this.map.add(boat);
    }
    this.map.updateMatrixWorld(true); this.worldBounds.setFromObject(this.map);
    this.worldBounds.max.y = Math.max(.9, this.worldBounds.max.y); this.worldBounds.expandByScalar(.20);
    const radius = Math.max(this.worldBounds.max.x, -this.worldBounds.min.x, this.worldBounds.max.z, -this.worldBounds.min.z) + .12;
    this.map.add(makeOcean(this.assets, radius, this.geometry));
    this.robber = this.assets.sprite(this.map, this.assets.label('', 'robber'), 0, .49, 0, .57);
    this.defaultTarget.copy(this.worldBounds.getCenter(new THREE.Vector3())); this.defaultTarget.y = .12;
    this.structureKey = ''; this.targetKey = ''; this.resetView();
    const corners = this.corners().map(p => p.applyMatrix4(this.camera.matrixWorldInverse));
    const w = Math.max(...corners.map(p => p.x)) - Math.min(...corners.map(p => p.x));
    const h = Math.max(...corners.map(p => p.y)) - Math.min(...corners.map(p => p.y));
    this.canvas.dataset.boardAspect = String(w / h);
    this.host.dispatchEvent(new Event('board-layout-ready'));
    this.describe();
  }
  private describe(): void {
    this.host.querySelector('.three-accessible-map')?.remove();
    const list = document.createElement('ul'); list.className = 'sr-only three-accessible-map'; list.setAttribute('aria-label', 'Island terrain and number tokens');
    for (const hex of this.view.board.hexes) { const li = document.createElement('li'); li.textContent = `${hex.hexId}: ${hex.terrain}${hex.token ? `, ${hex.token}` : ', sand dunes'}`; list.append(li); }
    this.host.append(list);
  }
  update(view: BoardSceneView): void {
    if (this.disposed) return;
    this.view = view;
    const key = staticBoardKey(view.board); if (key !== this.key) { this.key = key; this.rebuildMap(); }
    const structureKey = JSON.stringify([view.roads, view.buildings, view.players]);
    if (structureKey !== this.structureKey) {
      this.structureKey = structureKey; this.pieces.clear();
      const color = (id: string) => view.players.find(p => p.id === id)?.color || '#6f7c80';
      for (const [id, owner] of Object.entries(view.roads)) {
        const e = this.geometry.edges.get(id); if (!e) continue;
        const length = Math.hypot(e.b.x - e.a.x, e.b.z - e.a.z) * .88;
        const road = this.assets.box(this.pieces, color(owner), [length, .115, .13], (e.a.x + e.b.x) / 2, .195, (e.a.z + e.b.z) / 2);
        road.rotation.y = -Math.atan2(e.b.z - e.a.z, e.b.x - e.a.x); road.name = `road:${id}`; road.userData = { id, owner, kind: 'road' };
      }
      for (const [id, building] of Object.entries(view.buildings)) {
        const p = this.geometry.vertices.get(id); if (!p) continue;
        const piece = makeBuilding(this.assets, building.kind, color(building.playerId)); piece.position.set(p.x, 0, p.z); piece.name = `building:${id}`; piece.userData = { id, owner: building.playerId, kind: building.kind }; this.pieces.add(piece);
      }
    }
    if (this.robberId !== view.board.robberHexId) {
      if (this.robberId) this.tiles.get(this.robberId)?.root.traverse(object => {
        if (object instanceof THREE.Mesh && object.userData.originalMaterial) { object.material = object.userData.originalMaterial; delete object.userData.originalMaterial; }
      });
      for (const tile of this.tiles.values()) if (tile.token) tile.token.visible = true;
      this.dimmed.forEach(m => m.dispose()); this.dimmed = [];
      this.robberId = view.board.robberHexId;
      const occupied = this.tiles.get(this.robberId); if (occupied?.token) occupied.token.visible = false;
      occupied?.root.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return;
        object.userData.originalMaterial = object.material;
        const dim = (m: THREE.Material) => { const copy = m.clone(); if (copy instanceof THREE.MeshStandardMaterial) copy.color.multiplyScalar(.68); this.dimmed.push(copy); return copy; };
        object.material = Array.isArray(object.material) ? object.material.map(dim) : dim(object.material);
      });
      const p = this.geometry.hexes.get(this.robberId); if (this.robber && p) this.robber.position.set(p.x, .51, p.z);
    }
    const targetKey = JSON.stringify([view.targetMode, view.legalTargets]);
    if (targetKey !== this.targetKey) {
      this.targetKey = targetKey; this.targets.clear();
      for (const id of view.legalTargets) {
        let mesh: THREE.Mesh;
        if (view.targetMode === 'road') {
          const e = this.geometry.edges.get(id); if (!e) continue;
          mesh = new THREE.Mesh(this.assets.geometry('road-hit', () => new THREE.BoxGeometry(.95, .12, .29)), this.targetMaterial);
          mesh.position.set((e.a.x + e.b.x) / 2, .24, (e.a.z + e.b.z) / 2); mesh.rotation.y = -Math.atan2(e.b.z - e.a.z, e.b.x - e.a.x);
        } else if (view.targetMode === 'robber') {
          const p = this.geometry.hexes.get(id); if (!p) continue;
          mesh = new THREE.Mesh(this.assets.geometry('hex-hit', () => new THREE.CylinderGeometry(.94, .94, .025, 6)), this.targetMaterial); mesh.position.set(p.x, .16, p.z);
        } else {
          const p = this.geometry.vertices.get(id); if (!p) continue;
          mesh = new THREE.Mesh(this.assets.geometry('vertex-hit', () => new THREE.CylinderGeometry(.22, .22, .10, 20)), this.targetMaterial); mesh.position.set(p.x, view.targetMode === 'city' ? .72 : .20, p.z);
        }
        mesh.userData.id = id; mesh.renderOrder = 8; mesh.name = `legal:${id}`; this.targets.add(mesh);
      }
    }
    this.resize(); this.invalidate();
  }
  private corners(): THREE.Vector3[] {
    const points: THREE.Vector3[] = [];
    for (const x of [this.worldBounds.min.x, this.worldBounds.max.x]) for (const y of [this.worldBounds.min.y, this.worldBounds.max.y]) for (const z of [this.worldBounds.min.z, this.worldBounds.max.z]) points.push(new THREE.Vector3(x, y, z));
    return points;
  }
  private fit(): void {
    this.camera.updateMatrixWorld(true);
    const aspect = Math.max(.1, this.width / Math.max(1, this.height)); let half = 1;
    for (const p of this.corners()) { p.applyMatrix4(this.camera.matrixWorldInverse); half = Math.max(half, Math.abs(p.y), Math.abs(p.x) / aspect); }
    half *= 1.07; this.camera.left = -half * aspect; this.camera.right = half * aspect; this.camera.top = half; this.camera.bottom = -half; this.camera.updateProjectionMatrix();
  }
  private touchPolicy(): void {
    this.controls.enabled = window.innerWidth > 1100 || this.adjustTouch;
    this.canvas.style.touchAction = this.controls.enabled ? 'none' : 'pan-y';
  }
  setTouchAdjustment(value: boolean): void { this.adjustTouch = value; this.down = null; this.touchPolicy(); }
  resetView(): void {
    this.manualView = false;
    this.camera.zoom = 1; this.controls.target.copy(this.defaultTarget); this.controls.cursor.copy(this.defaultTarget);
    this.camera.position.copy(this.defaultTarget).add(new THREE.Vector3(0, 13, 10).normalize().multiplyScalar(24)); this.controls.update(); this.fit(); this.invalidate();
  }
  topView(): void {
    this.manualView = false;
    this.camera.position.copy(this.controls.target).add(new THREE.Vector3(0, 24, 2.5)); this.camera.zoom = 1; this.controls.update(); this.fit(); this.invalidate();
  }
  private resize = (): void => {
    if (this.disposed) return; this.touchPolicy();
    const w = Math.floor(this.host.clientWidth), h = Math.floor(this.host.clientHeight);
    if (w < 1 || h < 1 || (w === this.width && h === this.height)) return;
    // Card notices, hand rows and target controls may resize the surrounding UI.
    // Resizing the canvas must not refit a view that the player deliberately adjusted.
    const preserved = this.manualView ? resizeManualFrustum(this.camera,
      { width: this.width, height: this.height }, { width: w, height: h }) : null;
    this.width = w; this.height = h; this.renderer.setSize(w, h, false);
    if (preserved) { Object.assign(this.camera, preserved); this.camera.updateProjectionMatrix(); }
    else this.fit();
    this.invalidate();
  };
  private pick = (event: PointerEvent): void => {
    const down = this.down; this.down = null;
    if (this.disposed || event.button !== 0 || !down || this.adjustTouch || document.body.classList.contains('network-resyncing') || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 5) return;
    const rect = this.canvas.getBoundingClientRect(), ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), this.camera);
    this.scene.updateMatrixWorld(true);
    const hit = ray.intersectObjects(this.targets.children, false)[0];
    if (hit && this.view.legalTargets.includes(String(hit.object.userData.id))) { this.pickCount++; this.choose(String(hit.object.userData.id)); }
  };
  private invalidate = (): void => {
    if (this.disposed || this.frame !== null) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null; if (this.disposed || this.width < 1 || this.height < 1) return;
      try { this.renderer.render(this.scene, this.camera); this.frameCount++; } catch (error) { this.failed(`3D rendering failed: ${String(error)}`); }
    });
  };
  /** Public diagnostics, available through a QA-only facade. No game-state write API. */
  inspect() {
    return { frustum: [this.camera.left, this.camera.right, this.camera.top, this.camera.bottom], projection: this.camera.projectionMatrix.toArray(), quaternion: this.camera.quaternion.toArray(), canvasSize: [this.width, this.height], staticKey: this.key, manualView: this.manualView, mapBuilds: this.mapBuilds, instanceId: this.instanceId, mode: '3d', device: this.device, frames: this.frameCount, picks: this.pickCount, hexCount: this.tiles.size, portCount: this.view.board.ports.length,
      camera: this.camera.position.toArray(), target: this.controls.target.toArray(), zoom: this.camera.zoom, roads: Object.keys(this.view.roads), buildings: Object.entries(this.view.buildings), robber: this.robberId,
      targets: [...this.view.legalTargets], targetMode: this.view.targetMode, triangles: this.renderer.info.render.triangles, calls: this.renderer.info.render.calls,
      artRevision: ART_REVISION, terrainArt: [...this.tiles.values()].map(tile => inspectTerrainArt(tile.root)),
      oceanLayers: this.map.getObjectByName('layered-ocean')?.children.map(child => child.name).filter(Boolean) ?? [],
      boats: this.view.board.ports.map(port => ({ edge: port.edgeId, type: port.type, ratio: port.type === 'generic' ? '3:1' : '2:1', ...portBoatPlan(port, this.geometry) })),
      deserts: this.view.board.hexes.filter(h => h.terrain === 'desert').map(h => ({ id: h.hexId, hasToken: !!this.tiles.get(h.hexId)?.token, duneMeshes: this.tiles.get(h.hexId)?.root.children.filter(c => c.userData.dunes).length, props: 0 })),
      fullyVisible: this.corners().every(p => { p.project(this.camera); return Math.abs(p.x) < 1.001 && Math.abs(p.y) < 1.001; }) };
  }
  targetPoint(id: string): { x: number; y: number } | null {
    const mesh = this.targets.children.find(c => c.userData.id === id); if (!mesh) return null;
    this.scene.updateMatrixWorld(true); const p = mesh.getWorldPosition(new THREE.Vector3()).project(this.camera), rect = this.canvas.getBoundingClientRect();
    return { x: rect.left + (p.x + 1) * rect.width / 2, y: rect.top + (1 - p.y) * rect.height / 2 };
  }
  simulateContextLoss(): void { this.renderer.getContext().getExtension('WEBGL_lose_context')?.loseContext(); }
  dispose(): void {
    if (this.disposed) return; this.disposed = true;
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.observer.disconnect(); this.abort.abort(); this.controls.dispose(); disposeArtInstances(this.map); this.dimmed.forEach(m => m.dispose()); this.targetMaterial.dispose(); this.assets.dispose();
    this.scene.traverse(o => { if (o instanceof THREE.DirectionalLight) o.shadow.dispose(); });
    this.renderer.dispose(); this.renderer.forceContextLoss(); this.canvas.remove();
  }
}
