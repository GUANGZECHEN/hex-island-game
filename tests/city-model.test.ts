import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ArtAssets, makeBuilding } from '../src/game/board/three/art.ts';
import { CITY_MODEL_REVISION } from '../src/game/board/three/city-model.ts';

const colors=['#d44b40','#3979b8','#e4b448','#6d9c57','#9163b3','#e18746'];
const bounds=(object:THREE.Object3D)=>new THREE.Box3().setFromObject(object);
for(const color of colors)test(`city silhouette and ownership stay legible for ${color}`,()=>{
 const assets=new ArtAssets();
 try{
  const house=makeBuilding(assets,'settlement',color),city=makeBuilding(assets,'city',color);
  const h=bounds(house).getSize(new THREE.Vector3()),c=bounds(city).getSize(new THREE.Vector3());
  assert.equal(city.userData.kind,'city');assert.equal(city.userData.artRevision,CITY_MODEL_REVISION);
  assert.ok(c.x/h.x>1.35&&c.x/h.x<1.45,`width ratio ${c.x/h.x}`);
  assert.ok(c.y/h.y>1.15&&c.y/h.y<1.25,`height ratio ${c.y/h.y}`);
  assert.ok(c.z/h.z<1.25);assert.ok(bounds(city).max.y<.66);
  assert.ok(Math.abs(bounds(city).getCenter(new THREE.Vector3()).x)<1e-6);
  for(const name of ['city-hall','city-wing:-1','city-wing:1']){
   const mesh=city.getObjectByName(name) as THREE.Mesh;
   assert.ok(mesh instanceof THREE.Mesh);assert.equal((mesh.material as THREE.MeshStandardMaterial).color.getHexString(),new THREE.Color(color).getHexString());
  }
  assert.ok(city.getObjectByName('city-main-roof'));assert.ok(city.getObjectByName('city-door'));
  assert.ok(city.getObjectByName('city-wing-roof:-1'));assert.ok(city.getObjectByName('city-wing-roof:1'));
  let triangles=0,meshes=0;
  city.traverse(object=>{if(object instanceof THREE.Mesh){meshes++;const g=object.geometry;triangles+=(g.index?.count??g.attributes.position.count)/3;for(const key of ['position','normal'])assert.ok(Array.from(g.attributes[key].array).every(Number.isFinite));}});
  assert.ok(meshes<=26&&triangles<900,`${meshes} meshes, ${triangles} triangles`);
  assert.equal(house.children.length,4);assert.equal(house.children[0].position.y,.265);
  assert.ok(Math.abs(bounds(house).max.y-.57)<1e-6);
 }finally{assets.dispose();}
});
test('city pieces share cached resources and disposal releases them exactly once',()=>{
 const assets=new ArtAssets(),a=makeBuilding(assets,'city',colors[0]),b=makeBuilding(assets,'city',colors[0]);
 assert.equal((a.getObjectByName('city-main-roof') as THREE.Mesh).geometry,(b.getObjectByName('city-main-roof') as THREE.Mesh).geometry);
 const resources=new Set<THREE.BufferGeometry|THREE.Material>();
 a.traverse(o=>{if(o instanceof THREE.Mesh){resources.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material])resources.add(m);}});
 let disposed=0;for(const resource of resources)resource.addEventListener('dispose',()=>disposed++);
 assets.dispose();assert.equal(disposed,resources.size);assets.dispose();assert.equal(disposed,resources.size);
});
