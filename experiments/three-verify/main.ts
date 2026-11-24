import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createIslandBoard, type BoardLayout } from '../../src/game/board/geometry.ts';
import { generateBoardSetup } from '../../src/game/board/setup.ts';
import { renderIslandBoard } from '../../src/game/board/render.ts';
import '../../src/style.css';
import './proof.css';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const layout: BoardLayout = new URLSearchParams(location.search).get('layout') === 'expanded' ? 'expanded-5-6' : 'standard';
const topology = createIslandBoard(layout), setup = generateBoardSetup(24680, layout);
const original = JSON.stringify(setup), host = $('viewport');
$('topology').textContent = `${topology.hexes.length} hexes · ${topology.edges.length} edges · ${topology.vertices.length} vertices`;
let mode = 'initializing', lastPick: string | null = null, pickCount = 0, frameCount = 0, disposed = false;
let renderer: THREE.WebGLRenderer | null = null, controls: OrbitControls | null = null;
let frame: number | null = null, scene: THREE.Scene | null = null, camera: THREE.OrthographicCamera | null = null;
let device = '', reason = '', initializedAt = 0;
const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
const hitTargets: THREE.Object3D[] = [], centerPoints = new Map<string, THREE.Vector3>();
const worldBounds = new THREE.Box3(), defaultDirection = new THREE.Vector3(0, 13, 10).normalize();
const centerX = (Math.min(...topology.vertices.map(v => v.u)) + Math.max(...topology.vertices.map(v => v.u))) * Math.sqrt(3) / 4;
const centerZ = (Math.min(...topology.vertices.map(v => v.v)) + Math.max(...topology.vertices.map(v => v.v))) / 4;
const vertexPoint = (id: string) => {const v = topology.vertices.find(v => v.id === id)!; return new THREE.Vector3(v.u * Math.sqrt(3) / 2 - centerX, 0, v.v / 2 - centerZ);};
function choose(id: string) {lastPick = id; pickCount++; $('selected').textContent = `Selected ${id}`;}
function material(color: number) {const m = new THREE.MeshStandardMaterial({color, roughness: .88, metalness: 0, flatShading: true}); materials.add(m); return m;}
function mesh(geometry: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[], x: number, y: number, z: number, parent: THREE.Object3D) {
  geometries.add(geometry); const m = new THREE.Mesh(geometry, mat); m.position.set(x,y,z); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
}
function label(text: string, x: number, y: number, z: number, parent: THREE.Object3D) {
  const c = document.createElement('canvas'); c.width = c.height = 128; const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff9e4'; ctx.beginPath(); ctx.arc(64,64,55,0,Math.PI*2); ctx.fill(); ctx.strokeStyle = '#a8986f';ctx.lineWidth = 5;ctx.stroke();
  ctx.fillStyle = '#344b3d';ctx.font = 'bold 44px sans-serif';ctx.textAlign = 'center';ctx.textBaseline = 'middle';ctx.fillText(text,64,67);
  const texture = new THREE.CanvasTexture(c);texture.colorSpace = THREE.SRGBColorSpace;textures.add(texture);
  const mat = new THREE.SpriteMaterial({map:texture,depthTest:false});materials.add(mat);const sprite = new THREE.Sprite(mat);sprite.position.set(x,y,z);sprite.scale.set(.53,.53,1);sprite.renderOrder=10;parent.add(sprite);
}
function constructScene() {
  scene = new THREE.Scene();scene.background = new THREE.Color('#8ab9b7');
  scene.add(new THREE.HemisphereLight(0xfff3da,0x536f73,2.4));
  const sun = new THREE.DirectionalLight(0xfff6df,3);sun.position.set(-6,12,7);sun.castShadow=true;
  sun.shadow.mapSize.set(1024,1024);sun.shadow.camera.left=-11;sun.shadow.camera.right=11;sun.shadow.camera.top=11;sun.shadow.camera.bottom=-11;sun.shadow.normalBias=.04;scene.add(sun);
  const island = new THREE.Group();scene.add(island);
  const soil=material(0x87684f),wood=material(0x856648),trunk=material(0x6e5138),leaf=material(0x2f6249),rock=material(0x687783),clay=material(0xb85e40),wheat=material(0xe4bc51),white=material(0xece8d7);
  const colors: Record<string,number>={forest:0x65865b,hills:0xca8961,pasture:0xa0b674,fields:0xd7b65a,mountains:0x929a9b,desert:0xdfc589};
  for(const hex of setup.hexes) {
    const logical=topology.hexes.find(h=>h.id===hex.hexId)!;
    const x=(2*logical.q+logical.r)*Math.sqrt(3)/2-centerX,z=logical.r*1.5-centerZ;
    const tile=mesh(new THREE.CylinderGeometry(.972,.972,.24,6),[soil,material(colors[hex.terrain]),soil],x,0,z,island);tile.userData.hexId=hex.hexId;hitTargets.push(tile);centerPoints.set(hex.hexId,new THREE.Vector3(x,.14,z));
    const offsets=[[-.43,-.28],[.37,-.31],[.03,.45]];
    for(let i=0;i<offsets.length;i++) {
      const [dx,dz]=offsets[i];
      if(hex.terrain==='forest') {mesh(new THREE.CylinderGeometry(.035,.05,.25,6),trunk,x+dx,.24,z+dz,island);mesh(new THREE.ConeGeometry(.20,.54,7),leaf,x+dx,.55,z+dz,island);}
      if(hex.terrain==='mountains'||hex.terrain==='hills') {const stone=mesh(new THREE.DodecahedronGeometry(.24,0),hex.terrain==='mountains'?rock:clay,x+dx,.25,z+dz,island);stone.scale.set(1,hex.terrain==='mountains'?1.55:.6,.9);stone.rotation.y=i*.7;}
      if(hex.terrain==='fields') {for(let j=0;j<3;j++)mesh(new THREE.BoxGeometry(.055,.11,.31),wheat,x+dx+j*.1-.1,.19,z+dz,island);}
      if(hex.terrain==='pasture'&&i<2) {const sheep=mesh(new THREE.IcosahedronGeometry(.115,1),white,x+dx,.25,z+dz,island);sheep.scale.set(1.4,.85,.85);mesh(new THREE.BoxGeometry(.07,.08,.07),wood,x+dx+.14,.23,z+dz,island);}
      if(hex.terrain==='desert') {const dune=mesh(new THREE.SphereGeometry(.28,8,5),material(0xe6d29a),x+dx,.14,z+dz,island);dune.scale.y=.24;}
    }
    label(hex.token === null ? '—' : String(hex.token),x,.36,z,island);
  }
  const blue=material(0x2868b2),red=material(0xc74a42);
  for(const [i,v] of [topology.vertices[9],topology.vertices[27]].entries()) {
    const p=vertexPoint(v.id),color=i?red:blue;
    mesh(new THREE.BoxGeometry(.26,.25,.30),color,p.x,.26,p.z,island);
    const roof=mesh(new THREE.ConeGeometry(.25,.20,4),color,p.x,.48,p.z,island);roof.rotation.y=Math.PI/4;
  }
  for(const port of setup.ports) {
    const a=vertexPoint(port.vertexIds[0]),b=vertexPoint(port.vertexIds[1]),mid=a.clone().add(b).multiplyScalar(.5),out=mid.clone().normalize();
    const p=mid.clone().addScaledVector(out,.55),deck=mesh(new THREE.BoxGeometry(.62,.09,.33),wood,p.x,.02,p.z,island);deck.rotation.y=-Math.atan2(out.z,out.x);
    label(port.type==='generic'?'3:1':'2:1',p.x,.38,p.z,island);
  }
  worldBounds.setFromObject(island);
  const size=worldBounds.getSize(new THREE.Vector3()),radius=Math.max(size.x,size.z)*.60;
  const water=mesh(new THREE.CylinderGeometry(radius,radius,.12,64),material(0x6dabae),0,-.24,0,scene);water.receiveShadow=true;
  // Keep the fitting boundary stable and large enough to include ports and tallest decorative pieces.
  worldBounds.expandByScalar(.35);
}
function corners() {const a: THREE.Vector3[]=[];for(const x of [worldBounds.min.x,worldBounds.max.x])for(const y of [worldBounds.min.y,worldBounds.max.y])for(const z of [worldBounds.min.z,worldBounds.max.z])a.push(new THREE.Vector3(x,y,z));return a;}
function fitCamera() {
  if(!camera||!renderer)return;
  const w=Math.max(1,host.clientWidth),h=Math.max(1,host.clientHeight),aspect=w/h;
  renderer.setSize(w,h,false);camera.updateMatrixWorld(true);
  let half=.1;for(const point of corners()){point.applyMatrix4(camera.matrixWorldInverse);half=Math.max(half,Math.abs(point.y),Math.abs(point.x)/aspect);}
  half*=1.08;camera.left=-half*aspect;camera.right=half*aspect;camera.top=half;camera.bottom=-half;camera.updateProjectionMatrix();invalidate();
}
function resize() {
  const stage=document.querySelector<HTMLElement>('.proof-stage')!,shell=document.querySelector<HTMLElement>('.proof-shell')!;
  if(innerWidth>1100){const height=Math.max(180,innerHeight-stage.getBoundingClientRect().top-22),width=Math.min(shell.clientWidth-56,190+280+16+height*1.24);stage.style.setProperty('--proof-height',`${height}px`);stage.style.setProperty('--proof-width',`${width}px`);}
  else {stage.style.removeProperty('--proof-height');stage.style.removeProperty('--proof-width');}
  if(mode==='3d')fitCamera();
}
function invalidate() {if(frame!==null||mode!=='3d')return;frame=requestAnimationFrame(()=>{frame=null;if(renderer&&camera&&scene&&mode==='3d'){renderer.render(scene,camera);frameCount++;}});}
function resetView() {if(!camera||!controls)return;controls.target.set(0,0,0);camera.position.copy(defaultDirection).multiplyScalar(22);camera.zoom=1;controls.update();fitCamera();}
function destroy3D() {
  if(frame!==null){cancelAnimationFrame(frame);frame=null;}
  controls?.dispose();controls=null;
  geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());
  renderer?.dispose();renderer=null;scene=null;camera=null;disposed=true;
}
function fallback(message: string) {
  if(mode==='2d')return;mode='2d';reason=message;destroy3D();renderIslandBoard(host,setup);
  for(const node of Array.from(host.querySelectorAll<SVGGElement>('[data-hex-id]')))node.onclick=()=>choose(node.dataset.hexId!);
  $('mode').textContent='2D fallback';$('failure').textContent=message;document.body.dataset.mode=mode;
}
function initialize() {
  if(new URLSearchParams(location.search).get('fallback')==='1'){fallback('Requested compatibility mode. Same map seed and tile identities.');return;}
  const canvas=document.createElement('canvas'),gl=canvas.getContext('webgl2',{antialias:true,alpha:false});
  if(!gl){fallback('WebGL2 is unavailable. The existing SVG renderer remains usable.');return;}
  try {
    const ext=gl.getExtension('WEBGL_debug_renderer_info');device=ext?String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)):String(gl.getParameter(gl.RENDERER));
    renderer=new THREE.WebGLRenderer({canvas,context:gl,antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    constructScene();camera=new THREE.OrthographicCamera(-8,8,8,-8,.1,100);
    controls=new OrbitControls(camera,canvas);Object.assign(controls.mouseButtons,{LEFT:null,MIDDLE:THREE.MOUSE.ROTATE,RIGHT:null});controls.minPolarAngle=.1;controls.maxPolarAngle=Math.PI/3;controls.minZoom=.6;controls.maxZoom=2.5;controls.maxTargetRadius=2;controls.enableDamping=false;
    controls.addEventListener('change',invalidate);
    const touchPolicy=()=>{const touch=innerWidth<=1100;controls!.enabled=!touch||($<HTMLInputElement>('adjust-view').checked);canvas.style.touchAction=controls!.enabled?'none':'pan-y';};
    $('adjust-view').addEventListener('change',touchPolicy);window.addEventListener('resize',()=>{if(controls)touchPolicy();});touchPolicy();
    let down: {x:number;y:number}|null=null;
    canvas.addEventListener('pointerdown',event=>{if(event.button===0&&!$<HTMLInputElement>('adjust-view').checked)down={x:event.clientX,y:event.clientY};});
    canvas.addEventListener('pointerup',event=>{if(event.button!==0||!down)return;const click=down;down=null;if(Math.hypot(click.x-event.clientX,click.y-event.clientY)>5)return;const rect=canvas.getBoundingClientRect(),ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1),camera!);const hit=ray.intersectObjects(hitTargets,false)[0];if(hit)choose(String(hit.object.userData.hexId));});
    canvas.addEventListener('pointercancel',()=>{down=null;});
    canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();queueMicrotask(()=>fallback('3D context lost. Switched safely to the same SVG map.'));});
    host.replaceChildren(canvas);mode='3d';document.body.dataset.mode=mode;resetView();resize();invalidate();initializedAt=performance.now();$('mode').textContent=`Three.js r${THREE.REVISION} / WebGL2`;
  } catch(error) {fallback(`3D initialization failed: ${error instanceof Error?error.message:'unknown error'}`);}
}
$('reset-view').onclick=resetView;
window.addEventListener('resize',resize);
new ResizeObserver(()=>{if(mode==='3d')fitCamera();}).observe(host);
initialize();resize();
// Read-only diagnostics and a deliberate context-loss test hook: no game command API is exposed.
(window as unknown as Record<string,unknown>).__threeProof={
  inspect:()=>({mode,reason,three:THREE.REVISION,device,frameCount,pickCount,lastPick,disposed,initializedAt,hexCount:setup.hexes.length,sourceUnchanged:JSON.stringify(setup)===original,camera:camera?.position.toArray()??null,target:controls?.target.toArray()??null,zoom:camera?.zoom??null,triangles:renderer?.info.render.triangles??0,calls:renderer?.info.render.calls??0,fullyVisible:camera?corners().every(p=>{p.project(camera!);return Math.abs(p.x)<=1.001&&Math.abs(p.y)<=1.001&&p.z>=-1&&p.z<=1;}):true}),
  point:(id:string)=>{if(!camera)return null;const p=centerPoints.get(id)!.clone().project(camera),rect=host.getBoundingClientRect();return {x:rect.left+(p.x+1)*rect.width/2,y:rect.top+(1-p.y)*rect.height/2};},
  loseContext:()=>renderer?.getContext().getExtension('WEBGL_lose_context')?.loseContext()
};
