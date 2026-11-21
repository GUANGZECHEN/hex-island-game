import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { ArtAssets, makeBuilding } from '../src/game/board/three/art.ts';

test('upgraded 3D city is visibly wider and taller than a settlement and has a distinct fortified silhouette', () => {
 const assets = new ArtAssets();
 try {
  const settlement = makeBuilding(assets, 'settlement', '#2868b2');
  const city = makeBuilding(assets, 'city', '#2868b2');
  const small = new THREE.Box3().setFromObject(settlement), large = new THREE.Box3().setFromObject(city);
  assert.ok(large.max.y > small.max.y + .15);
  assert.ok(large.getSize(new THREE.Vector3()).x > small.getSize(new THREE.Vector3()).x * 1.04);
  for(const name of ['city-foundation', 'city-hall', 'city-hall-roof', 'city-keep', 'city-keep-cap', 'city-door', 'city-stairs']) {
   assert.ok(city.getObjectByName(name), name);
   assert.equal(settlement.getObjectByName(name), undefined);
  }
  const battlements=city.children.filter(m => m.name==='city-battlement');
  const lights=city.children.filter(m => m.name==='city-window');
  assert.equal(battlements.length,4);
  assert.equal(lights.length,1);
  assert.ok(city.scale.x < .82,'city is now intentionally more compact');
  assert.equal(city.getObjectByName('city-keep-window'),undefined,'removed elongated keep window');
  assert.equal(city.userData.kind,'city');
  assert.equal(settlement.userData.kind,'settlement');
  assert.ok(city.children.length < 32, 'keep rendering lightweight on mobile');
 } finally { assets.dispose(); }
});

test('all player colors stay recognizable on upgraded city walls without changing settlement art',()=>{
 const assets=new ArtAssets();
 try {
  for(const color of ['#2868b2','#c74a42','#4f8b51','#8b55a1','#d48826','#2b9295']){
   const city=makeBuilding(assets,'city',color);
   const hall=city.getObjectByName('city-hall') as THREE.Mesh;
   assert.ok(hall.material instanceof THREE.MeshStandardMaterial);
   assert.equal(hall.material.color.getHexString(),new THREE.Color(color).getHexString());
   assert.ok(city.children.some(m=>m.name==='city-hall-roof'));
  }
 }finally{assets.dispose();}
});

test('camera is never auto-fitted by an in-game action, a map refresh or a canvas resize',()=>{
 const renderer=readFileSync('src/game/board/three/renderer.ts','utf8');
 const controller=readFileSync('src/game/board/three/controller.ts','utf8');
 const ui=readFileSync('src/game-ui.ts','utf8');
 assert.ok(renderer.includes('if (this.mapBuilds === 1) this.resetView()'));
 assert.ok(renderer.includes('const preserved = !firstSize ? resizeManualFrustum'));
 assert.ok(renderer.includes('else if (firstSize) this.fit()'));
 assert.ok(renderer.includes('captureView(): BoardCameraView'));
 assert.ok(renderer.includes('restoreView(view: BoardCameraView)'));
 assert.ok(controller.includes('if (this.rememberedCamera) this.instance.restoreView(this.rememberedCamera)'));
 assert.ok(controller.includes('if (this.instance) this.rememberedCamera = this.instance.captureView()'));
 assert.ok(ui.includes('boardRenderer.update({board:setup,roads:{},buildings:{},players:[]'),'lobby now retains the live Three.js renderer and camera');
 assert.ok(!ui.includes('boardRenderer?.dispose();boardRenderer=null;'),'lobby changes must not destroy the camera');
 assert.ok(ui.includes('id=>attempt(()=>moveTarget(id)),rememberedBoardCamera'));
});
