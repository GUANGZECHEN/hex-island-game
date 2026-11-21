import { makeTradeStation } from './trade-station-art.ts';
import * as THREE from 'three';
import { TargetFeedback, TARGET_COLORS } from '../target-feedback.ts';
import { resizeManualFrustum } from './camera-layout.ts';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ArtAssets, makeBoatPort, makeBuilding, makeTerrain } from './art.ts';
import { portBoatPlan, staticBoardKey, worldGeometry, type BoardSceneView } from './model.ts';
import { ART_REVISION, refineTerrain, makeOcean, inspectTerrainArt, disposeArtInstances } from './refinement.ts';
import { AMBIENT_FRAME_MS, OceanMotion, boatPose, decorationReaction, type DecorationKind } from './motion.ts';
import { BoardDiceScene, DICE_LANDING_MS, DICE_REDUCED_END_MS } from './roll-scene.ts';
import type { RollPresentation } from './roll-presentation.ts';

/** Local rendering preference; never sent to the host or put into game snapshots. */
export interface BoardCameraView {
  position: [number, number, number];
  target: [number, number, number];
  cursor: [number, number, number];
  zoom: number;
  frustum: { left: number; right: number; top: number; bottom: number };
  viewport: { width: number; height: number };
}

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
  private harborLabels = new THREE.Group();
  private targets = new THREE.Group();
  private targetMaterial = new THREE.MeshBasicMaterial({ color: TARGET_COLORS.legal, transparent: true, opacity: .8, depthTest: false, depthWrite: false });
  private activeTargetMaterial = new THREE.MeshBasicMaterial({ color: TARGET_COLORS.active, transparent: true, opacity: .94, depthTest: false, depthWrite: false });
  private preview = new TargetFeedback();
  private ray = new THREE.Raycaster();
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
  private motionFrame: number | null = null;
  private motionLastTick = 0;
  private oceanMotion: OceanMotion | null = null;
  private boats: { model: THREE.Group; x: number; z: number; index: number }[] = [];
  private decorations: THREE.Group[] = [];
  private reactions = new Map<THREE.Group, { started: number; kind: DecorationKind }>();
  private lastReactionKind: DecorationKind | null = null;
  private rollScene: BoardDiceScene | null = null;
  private rollStarted = 0;
  private rollTimeout: number | null = null;
  private lastDice: readonly [number,number] | null = null;
  private productionHexes: string[] = [];
  private reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  private withinViewport = true;
  private visibilityObserver: IntersectionObserver | null = null;
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
    this.canvas.setAttribute('aria-label', '3D island board. Click or tap a highlighted location. Use 2D view for keyboard placement.'); this.canvas.setAttribute('role', 'img');
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
    this.scene.add(this.map, this.pieces, this.targets, this.harborLabels);
    this.controls = new OrbitControls(this.camera, this.canvas);
    Object.assign(this.controls.mouseButtons, { LEFT: null, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: null });
    this.controls.minPolarAngle = .10; this.controls.maxPolarAngle = Math.PI / 3; this.controls.minZoom = .65; this.controls.maxZoom = 3;
    this.controls.maxTargetRadius = 2; this.controls.enableDamping = false;
    this.controls.addEventListener('change', this.invalidate);
    this.controls.addEventListener('start', () => { this.manualView = true; });
    this.controls.addEventListener('start', this.leaveTarget);
    const signal = this.abort.signal;
    this.canvas.addEventListener('pointerdown', event => {
      if (event.button === 1) event.preventDefault();
      if (event.isPrimary && event.button === 0 && !this.adjustTouch) { this.down = { x: event.clientX, y: event.clientY }; this.hover(event); }
    }, { signal });
    this.canvas.addEventListener('pointerup', this.pick, { signal });
    this.canvas.addEventListener('pointermove', this.hover, { signal });
    this.canvas.addEventListener('pointerleave', this.leaveTarget, { signal });
    this.canvas.addEventListener('pointercancel', this.leaveTarget, { signal });
    this.canvas.addEventListener('auxclick', event => { if (event.button === 1) event.preventDefault(); }, { signal });
    this.canvas.addEventListener('webglcontextlost', event => {
      event.preventDefault(); queueMicrotask(() => { if (!this.disposed) this.failed('3D connection to the graphics device was lost. Switched to 2D.'); });
    }, { signal });
    window.addEventListener('resize', this.resize, { passive: true, signal });
    document.addEventListener('visibilitychange', this.scheduleMotion, { signal });
    this.reducedMotion.addEventListener('change', this.onMotionPreferenceChange, { signal });
    this.observer = new ResizeObserver(this.resize); this.observer.observe(this.host);
    if (typeof IntersectionObserver !== 'undefined') {
      this.visibilityObserver = new IntersectionObserver(entries => {
        this.withinViewport = !!entries[0]?.isIntersecting;
        this.scheduleMotion();
      }, { threshold: .01 });
      this.visibilityObserver.observe(this.host);
    }
    host.replaceChildren(this.canvas); host.dataset.renderer = '3d';
    this.update(view); this.touchPolicy(); this.resize(); this.scheduleMotion();
  }
  private rebuildMap(): void {
    this.cancelRoll();
    this.mapBuilds++;this.harborLabels.clear();
    this.oceanMotion = null; this.boats = []; this.decorations = [];
    this.reactions.clear(); this.lastReactionKind = null;
    disposeArtInstances(this.map);
    this.map.clear(); this.pieces.clear(); this.targets.clear(); this.dimmed.forEach(m => m.dispose()); this.dimmed = [];
    this.assets.dispose(); this.assets = new ArtAssets(); this.tiles.clear(); this.robber = null; this.robberId = '';
    this.geometry = worldGeometry(this.view.board.layout);
    for (const hex of this.view.board.hexes) {
      const terrain = makeTerrain(this.assets, hex, this.geometry.hexes.get(hex.hexId)!);
      refineTerrain(this.assets, hex, terrain.root, terrain.token);
      this.tiles.set(hex.hexId, terrain); this.map.add(terrain.root);
      terrain.root.traverse(object => {
        if (object instanceof THREE.Group && ['tree','sheep','rock','brick','wheat'].includes(object.userData.decorative)) {
          this.decorations.push(object);
        }
      });
    }
    for (const [index, port] of this.view.board.ports.entries()) {
      const plan = portBoatPlan(port, this.geometry);
      const dock = makeBoatPort(this.assets, port.type, plan); dock.name = `port:${port.edgeId}`; this.map.add(dock);
      const model = dock.getObjectByName('port-boat');
      if (model instanceof THREE.Group) this.boats.push({ model, x: plan.center.x, z: plan.center.z, index });
    }
    this.map.updateMatrixWorld(true); this.worldBounds.setFromObject(this.map);
    this.worldBounds.max.y = Math.max(.9, this.worldBounds.max.y); this.worldBounds.expandByScalar(.20);
    const radius = Math.max(this.worldBounds.max.x, -this.worldBounds.min.x, this.worldBounds.max.z, -this.worldBounds.min.z) + .12;
    const ocean = makeOcean(this.assets, radius, this.geometry);
    this.map.add(ocean);
    this.oceanMotion = new OceanMotion(ocean);
    this.robber = this.assets.sprite(this.map, this.assets.label('', 'robber'), 0, .49, 0, .57);
    this.defaultTarget.copy(this.worldBounds.getCenter(new THREE.Vector3())); this.defaultTarget.y = .12;
    this.structureKey = ''; this.targetKey = '';
    // Only the very first board load gets a default perspective. A new map or
    // a fresh match is a game operation, not permission to reset the camera.
    if (this.mapBuilds === 1) this.resetView();
    else this.controls.update();
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
    const structureKey = JSON.stringify([view.roads, view.buildings, view.players, view.stations]);
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
      for(const [id] of Object.entries(view.stations??{})){
        const p=this.geometry.vertices.get(id);if(!p)continue;
        const station=makeTradeStation(this.assets);station.position.set(p.x,0,p.z);
        if(view.buildings[id])station.position.set(p.x+.23,.02,p.z-.18);
        station.name=`station:${id}`;station.userData={id,kind:'station'};this.pieces.add(station);
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
    this.preview.update(`${this.key}:${view.targetMode ?? ''}`, view.legalTargets);
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
          mesh = new THREE.Mesh(this.assets.geometry('vertex-hit', () => new THREE.CylinderGeometry(.22, .22, .10, 20)), this.targetMaterial); mesh.position.set(p.x, (view.targetMode === 'city' || view.targetMode === 'station' && !!view.buildings[id]) ? .72 : .20, p.z);
        }
        mesh.userData.id = id; mesh.renderOrder = 8; mesh.name = `legal:${id}`; this.targets.add(mesh);
      }
    }
    this.harborLabels.visible=!!view.harborPorts;
    if(view.harborPorts&&!this.harborLabels.children.length)for(const [index,port] of view.board.ports.entries()){
      const plan=portBoatPlan(port,this.geometry);this.assets.sprite(this.harborLabels,this.assets.label(`P${index+1}`,'token'),plan.center.x,.93,plan.center.z,.28);
    }
    this.paintTargets(); this.resize(); this.invalidate(); this.scheduleMotion();
  }
  /** Presentation-only highlight: never changes the camera, scene identity or game. */
  highlightTarget(id: string | null): void {
    this.preview.select(id); this.paintTargets();
  }
  private paintTargets(): void {
    let changed = false;
    for (const object of this.targets.children) {
      if (!(object instanceof THREE.Mesh)) continue;
      const active = object.userData.id === this.preview.active;
      const material = active ? this.activeTargetMaterial : this.targetMaterial;
      if (object.material !== material) { object.material = material; changed = true; }
      object.userData.highlighted = active; object.renderOrder = active ? 9 : 8;
    }
    if (changed) this.invalidate();
  }
  private targetAt(x: number, y: number): string | null {
    if (this.disposed || this.adjustTouch || !this.view.targetMode || document.body.classList.contains('network-resyncing')) return null;
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0 || x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return null;
    this.scene.updateMatrixWorld(true); this.camera.updateMatrixWorld(true);
    this.ray.setFromCamera(new THREE.Vector2((x - rect.left) / rect.width * 2 - 1, -(y - rect.top) / rect.height * 2 + 1), this.camera);
    const hit = this.ray.intersectObjects(this.targets.children, false)[0];
    const id = hit ? String(hit.object.userData.id) : null;
    return id && this.view.legalTargets.includes(id) ? id : null;
  }
  private hover = (event: PointerEvent): void => {
    if (!event.isPrimary) return;
    const dragging = (event.buttons & 6) !== 0 || !!this.down && Math.hypot(event.clientX - this.down.x, event.clientY - this.down.y) > 5;
    const id = dragging ? null : this.targetAt(event.clientX, event.clientY);
    const decorative = !dragging && !id ? this.decorationAt(event.clientX, event.clientY) : null;
    this.preview.hover(id); this.canvas.style.cursor = id || decorative ? 'pointer' : ''; this.paintTargets();
  };
  private leaveTarget = (): void => {
    this.down = null; this.preview.hover(null); this.canvas.style.cursor = ''; this.paintTargets();
  };
  /** Hit decorative models only when no gameplay target has been selected. */
  private decorationAt(x: number, y: number): THREE.Group | null {
    if (this.view.targetMode || this.adjustTouch || this.reducedMotion.matches || !this.decorations.length) return null;
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0 || x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return null;
    this.scene.updateMatrixWorld(true); this.camera.updateMatrixWorld(true);
    this.ray.setFromCamera(new THREE.Vector2((x - rect.left) / rect.width * 2 - 1, -(y - rect.top) / rect.height * 2 + 1), this.camera);
    const hit = this.ray.intersectObjects(this.decorations, true)[0];
    for (let object: THREE.Object3D | null = hit?.object ?? null; object; object = object.parent) {
      if (object instanceof THREE.Group && this.decorations.includes(object)) return object;
    }
    // Fine wheat stems are narrower than a finger. The resource tile surface
    // is a generous fallback tap target only when no game action is selected.
    const tileHit = this.ray.intersectObjects([...this.tiles.values()].map(tile => tile.root), true)
      .find(result => {
        for (let parent: THREE.Object3D | null = result.object; parent; parent = parent.parent) {
          if (parent instanceof THREE.Group && parent.userData.terrain === 'fields') return true;
        }
        return false;
      });
    if (tileHit) {
      for (let parent: THREE.Object3D | null = tileHit.object; parent; parent = parent.parent) {
        if (parent instanceof THREE.Group && parent.userData.terrain === 'fields') {
          return this.decorations.find(item => item.parent === parent && item.userData.decorative === 'wheat') ?? null;
        }
      }
    }
    return null;
  }
  private touchDecoration(object: THREE.Group): void {
    const kind = object.userData.decorative as DecorationKind;
    if (this.reducedMotion.matches) return;
    this.reactions.set(object, { started: performance.now(), kind });
    this.lastReactionKind = kind;
    this.scheduleMotion();
  }
  /** Accepts only the public, already-resolved outcome. Never rolls RNG. */
  playRoll(event: RollPresentation): void {
    if (this.disposed) return;
    this.cancelRoll();
    this.lastDice=[event.dice[0],event.dice[1]];
    this.productionHexes=[];
    this.rollScene=new BoardDiceScene(event,id=>this.geometry.vertices.get(id),
      id=>this.view.players.find(p=>p.id===id)?.color??'#537668');
    this.rollScene.setViewDirection(this.camera.position.clone().sub(this.controls.target));
    this.scene.add(this.rollScene.root);
    this.rollStarted=performance.now();
    if (this.reducedMotion.matches || document.hidden || !this.withinViewport) {
      const landed=this.rollScene.advance(DICE_LANDING_MS,true);
      if(landed)this.productionHexes=[...event.hexIds];
      this.rollTimeout=window.setTimeout(()=>this.cancelRoll(),DICE_REDUCED_END_MS);
      this.invalidate();
    } else {
      this.scheduleMotion();
      this.invalidate();
    }
  }
  private producePulse(hexIds:readonly string[]):void {
    this.productionHexes=[...hexIds];
    for(const hexId of hexIds){
      const root=this.tiles.get(hexId)?.root;
      root?.traverse(object=>{
        if(object instanceof THREE.Group && object.userData.decorative) this.touchDecoration(object);
      });
    }
  }
  stopRoll():void { this.cancelRoll();this.lastDice=null;this.productionHexes=[]; }
  private cancelRoll():void {
    if(this.rollTimeout!==null){window.clearTimeout(this.rollTimeout);this.rollTimeout=null;}
    this.rollScene?.dispose();this.rollScene=null;
    this.invalidate();
  }
  private motionEnabled(): boolean {
    return !this.disposed && !this.reducedMotion.matches && !document.hidden && this.withinViewport && this.width > 0 && this.height > 0;
  }
  private onMotionPreferenceChange = (): void => {
    // A media-query transition can occur while the page is restoring from a
    // full-page capture or background tab. Re-evaluate the host's actual
    // viewport intersection before restarting the animation loop.
    const rect = this.host.getBoundingClientRect();
    this.withinViewport = rect.width > 0 && rect.height > 0 &&
      rect.bottom > 0 && rect.right > 0 &&
      rect.top < window.innerHeight && rect.left < window.innerWidth;
    this.resize();
    this.scheduleMotion();
  };
  private scheduleMotion = (): void => {
    if (!this.motionEnabled()) {
      if (this.motionFrame !== null) cancelAnimationFrame(this.motionFrame);
      this.motionFrame = null;
      // Full-page screenshots, tab switches and scrolling can move the board
      // offscreen during a reaction. Never leave pieces frozen mid-hop; restore
      // every decorative model whenever ambient rendering is suspended.
      if (this.reactions.size) {
        for (const item of this.reactions.keys()) { item.position.y = 0; item.rotation.x = 0; item.rotation.z = 0; }
        this.reactions.clear(); this.invalidate();
      }
      return;
    }
    if (this.motionFrame === null) this.motionFrame = requestAnimationFrame(this.motionTick);
  };
  private motionTick = (now: number): void => {
    this.motionFrame = null;
    if (!this.motionEnabled()) return;
    if (this.rollScene) {
      const roll=this.rollScene;
      // Only the dice adjust their display orientation to reveal three faces;
      // the board camera and all gameplay geometry remain untouched.
      roll.setViewDirection(this.camera.position.clone().sub(this.controls.target));
      const landed=roll.advance(now-this.rollStarted);
      if(landed)this.producePulse(roll.event.hexIds);
      if(roll.complete)this.cancelRoll();
      this.invalidate(); // Smooth dice rotation; ambient waves stay capped at 20 FPS.
    }
    if (now - this.motionLastTick >= AMBIENT_FRAME_MS) {
      this.motionLastTick = now;
      const seconds = now * .001;
      this.oceanMotion?.update(seconds);
      for (const { model, x, z, index } of this.boats) {
        const pose = boatPose(seconds, index, x, z);
        model.position.y = pose.height;
        model.rotation.x = pose.pitch;
        model.rotation.z = pose.roll;
      }
      for (const [object, reaction] of this.reactions) {
        const pose = decorationReaction(reaction.kind, now - reaction.started);
        object.position.y = pose.y;
        object.rotation.x = pose.x;
        object.rotation.z = pose.z;
        if (pose.finished) this.reactions.delete(object);
      }
      this.invalidate();
    }
    this.scheduleMotion();
  };
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
  setTouchAdjustment(value: boolean): void { this.adjustTouch = value; this.leaveTarget(); this.touchPolicy(); }
  /** Camera survives 3D/2D switching and temporary teardown during room setup. */
  captureView(): BoardCameraView {
    return {
      position: this.camera.position.toArray() as [number, number, number],
      target: this.controls.target.toArray() as [number, number, number],
      cursor: this.controls.cursor.toArray() as [number, number, number],
      zoom: this.camera.zoom,
      frustum: { left: this.camera.left, right: this.camera.right, top: this.camera.top, bottom: this.camera.bottom },
      viewport: { width: this.width, height: this.height },
    };
  }
  restoreView(view: BoardCameraView): void {
    if (!Number.isFinite(view.zoom) || view.zoom <= 0) return;
    this.camera.position.fromArray(view.position);
    this.controls.target.fromArray(view.target);
    this.controls.cursor.fromArray(view.cursor);
    this.camera.zoom = view.zoom;
    const bounds = resizeManualFrustum(view.frustum, view.viewport, { width: this.width, height: this.height });
    if (bounds) Object.assign(this.camera, bounds);
    this.controls.update();
    this.camera.updateProjectionMatrix();
    this.manualView = true; this.invalidate();
  }
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
    const firstSize = this.width <= 0 || this.height <= 0;
    const preserved = !firstSize ? resizeManualFrustum(this.camera,
      { width: this.width, height: this.height }, { width: w, height: h }) : null;
    this.width = w; this.height = h; this.renderer.setSize(w, h, false);
    if (preserved) { Object.assign(this.camera, preserved); this.camera.updateProjectionMatrix(); }
    else if (firstSize) this.fit(); // Only a first render can automatically frame the board.
    else this.camera.updateProjectionMatrix(); // Never re-fit an established game view.
    this.invalidate(); this.scheduleMotion();
  };
  private pick = (event: PointerEvent): void => {
    const down = this.down; this.down = null;
    if (this.disposed || event.button !== 0 || !down || this.adjustTouch || document.body.classList.contains('network-resyncing') || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 5) return;
    const id = this.targetAt(event.clientX, event.clientY);
    if (id) { this.preview.hover(id); this.paintTargets(); this.pickCount++; this.choose(id); }
    else if (!this.view.targetMode) {
      const decorative = this.decorationAt(event.clientX, event.clientY);
      if (decorative) this.touchDecoration(decorative);
    }
    if (event.pointerType === 'touch') this.leaveTarget();
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
      camera: this.camera.position.toArray(), target: this.controls.target.toArray(), zoom: this.camera.zoom, stations:Object.keys(this.view.stations??{}), roads: Object.keys(this.view.roads), buildings: Object.entries(this.view.buildings), robber: this.robberId,
      targets: [...this.view.legalTargets], targetMode: this.view.targetMode, highlightedTarget: this.preview.active, selectedTarget: this.preview.selected,
      targetColors: this.targets.children.filter((o): o is THREE.Mesh => o instanceof THREE.Mesh).map(o => ({ id: o.userData.id, color: (o.material as THREE.MeshBasicMaterial).color.getHexString(), active: o.userData.highlighted })), triangles: this.renderer.info.render.triangles, calls: this.renderer.info.render.calls,
      artRevision: ART_REVISION, terrainArt: [...this.tiles.values()].map(tile => inspectTerrainArt(tile.root)),
      oceanLayers: this.map.getObjectByName('layered-ocean')?.children.map(child => child.name).filter(Boolean) ?? [],
      rollEffect: this.rollScene?.inspect() ?? null, lastDice: this.lastDice, productionHexes:this.productionHexes,
      ambientMotion: { enabled: this.motionEnabled(), waveSamples: this.oceanMotion?.sample() ?? [],
        waterNormalVersion: ((this.map.getObjectByName('depth-gradient-water') as THREE.Mesh | undefined)?.geometry.getAttribute('normal') as THREE.BufferAttribute | undefined)?.version ?? 0,
        waterReceivesShadow: (this.map.getObjectByName('depth-gradient-water') as THREE.Mesh | undefined)?.receiveShadow ?? null,
        oceanDepthFaces: (this.map.getObjectByName('ocean-depth') as THREE.Mesh | undefined)?.geometry.getIndex()?.count ?? 0,
        boats: this.boats.map(b => ({
          height: b.model.position.y, pitch: b.model.rotation.x, roll: b.model.rotation.z
        })), decorations: this.decorations.length, reacting: this.reactions.size, lastReactionKind: this.lastReactionKind },
      boats: this.view.board.ports.map(port => ({ edge: port.edgeId, type: port.type, ratio: port.type === 'generic' ? '3:1' : '2:1', ...portBoatPlan(port, this.geometry) })),
      deserts: this.view.board.hexes.filter(h => h.terrain === 'desert').map(h => ({ id: h.hexId, hasToken: !!this.tiles.get(h.hexId)?.token, duneMeshes: this.tiles.get(h.hexId)?.root.children.filter(c => c.userData.dunes).length, props: 0 })),
      fullyVisible: this.corners().every(p => { p.project(this.camera); return Math.abs(p.x) < 1.001 && Math.abs(p.y) < 1.001; }) };
  }
  targetPoint(id: string): { x: number; y: number } | null {
    const mesh = this.targets.children.find(c => c.userData.id === id); if (!mesh) return null;
    this.scene.updateMatrixWorld(true); const p = mesh.getWorldPosition(new THREE.Vector3()).project(this.camera), rect = this.canvas.getBoundingClientRect();
    return { x: rect.left + (p.x + 1) * rect.width / 2, y: rect.top + (1 - p.y) * rect.height / 2 };
  }
  /** QA-only projection of a visible decorative model; never invokes a gameplay command. */
  decorationPoint(kind: string): { x: number; y: number } | null {
    const group = this.decorations.find(o => o.userData.decorative === kind);
    if (!group) return null;
    const localHeight = kind === 'tree' ? .58 : kind === 'sheep' ? .31 : kind === 'wheat' ? .37 : .28;
    this.scene.updateMatrixWorld(true); this.camera.updateMatrixWorld(true);
    const point = group.localToWorld(new THREE.Vector3(0, localHeight, 0)).project(this.camera);
    const rect = this.canvas.getBoundingClientRect();
    return { x: rect.left + (point.x + 1) * rect.width / 2, y: rect.top + (1 - point.y) * rect.height / 2 };
  }
  simulateContextLoss(): void { this.renderer.getContext().getExtension('WEBGL_lose_context')?.loseContext(); }
  dispose(): void {
    if (this.disposed) return; this.disposed = true;
    this.cancelRoll();
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    if (this.motionFrame !== null) cancelAnimationFrame(this.motionFrame);
    this.motionFrame = null; this.visibilityObserver?.disconnect(); this.reactions.clear();
    this.observer.disconnect(); this.abort.abort(); this.controls.dispose(); disposeArtInstances(this.map); this.dimmed.forEach(m => m.dispose()); this.targetMaterial.dispose(); this.activeTargetMaterial.dispose(); this.assets.dispose();
    this.scene.traverse(o => { if (o instanceof THREE.DirectionalLight) o.shadow.dispose(); });
    this.renderer.dispose(); this.renderer.forceContextLoss(); this.canvas.remove();
  }
}
