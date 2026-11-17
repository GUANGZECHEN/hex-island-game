import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ArtAssets, makeTerrain, makeBoatPort } from '../src/game/board/three/art.ts';
import { refineTerrain, makeOcean } from '../src/game/board/three/refinement.ts';
import { generateBoardSetup } from '../src/game/board/setup.ts';
import { portBoatPlan, worldGeometry } from '../src/game/board/three/model.ts';
import { AMBIENT_FRAME_MS, OceanMotion, boatPose, decorationReaction, oceanWaveHeight, REACTION_DURATION_MS } from '../src/game/board/three/motion.ts';

class GeometryAssets extends ArtAssets {
 override label(): THREE.SpriteMaterial { return this.extra(new THREE.SpriteMaterial()); }
}

test('gentle wave and boat motions vary over time without corrupting gameplay coordinates',()=>{
 const a=oceanWaveHeight(1.25,-2.3,0),b=oceanWaveHeight(1.25,-2.3,1);
 assert.notEqual(a,b);assert.ok(Math.abs(a)<=.025&&Math.abs(b)<=.025);
 const p=boatPose(.12,0,1.2,3.5),q=boatPose(2.1,0,1.2,3.5);
 assert.notEqual(p.height,q.height);
 for(const pose of [p,q]){
  assert.ok(Math.abs(pose.height)<.04);
  assert.ok(Math.abs(pose.pitch)<.02);
  assert.ok(Math.abs(pose.roll)<.028);
 }
 assert.ok(AMBIENT_FRAME_MS>=40);
});

test('water animation moves existing buffers but does not recreate them or move a dock',()=>{
 const assets=new GeometryAssets();
 try{
  const geometry=worldGeometry('standard'),ocean=makeOcean(assets,8,geometry),animate=new OceanMotion(ocean);
  const water=ocean.getObjectByName('depth-gradient-water') as THREE.Mesh;
  const skirt=ocean.getObjectByName('ocean-depth') as THREE.Mesh;
  const foam=ocean.getObjectByName('shore-foam') as THREE.LineSegments;
  const buffer=water.geometry.getAttribute('position');
  const normals=water.geometry.getAttribute('normal') as THREE.BufferAttribute;
  const originalNormals=Float32Array.from(normals.array);
  const positionsBefore=Float32Array.from(buffer.array);
  const foamPositions=Float32Array.from(foam.geometry.getAttribute('position').array);
  const indices=water.geometry.getIndex();
  const old=animate.sample();
  animate.update(1.2);
  const moved=animate.sample();
  assert.notDeepEqual(old,moved);
  animate.update(2.1);
  assert.notDeepEqual(moved,animate.sample());
  assert.equal(water.geometry.getAttribute('position'),buffer);
  assert.equal(water.geometry.getIndex(),indices);
  assert.equal(water.receiveShadow,false,'sunlight can shade the waves without dark cast-shadow patches');
  assert.equal(skirt.receiveShadow,false);
  assert.equal(ocean.children.length,3);
  assert.ok(normals.version>0, 'the physical mesh normals must be recomputed each frame');
  assert.ok(Array.from(normals.array).some((value,index)=>Math.abs(value-originalNormals[index])>1e-4), 'actual slopes must respond to changing wave height');
  assert.equal(skirt.geometry.getAttribute('position').count,256, '128 open sidewall segments, no opaque top disk');
  assert.equal(skirt.geometry.getIndex()?.count,128*6,'sidewall has only vertical walls');
  const rim=skirt.geometry.getAttribute('position');
  const segments=rim.count/2, rings=(buffer.count-1)/segments;
  for(let i=0;i<segments;i++){
   const outer=1+(rings-1)*segments+i;
   assert.ok(Math.abs(rim.getY(i*2)-buffer.getY(outer))<2e-6,'top of skirt follows the actual wave surface');
   assert.ok(Math.abs(rim.getX(i*2)-buffer.getX(outer))<2e-5);
   assert.ok(Math.abs(rim.getZ(i*2)-buffer.getZ(outer))<2e-5);
   assert.ok(Math.abs(rim.getY(i*2+1)+.36)<1e-5,'seabed wall stays below the water');
  }
  assert.equal(ocean.getObjectByName('sea-ripples'),undefined, 'remove visible wandering line waves');
  assert.equal((foam.geometry.getAttribute('position') as THREE.BufferAttribute).version,0,'subtle shoreline foam stays still');
  assert.deepEqual(Float32Array.from(foam.geometry.getAttribute('position').array),foamPositions);
  for(let i=0;i<buffer.count;i++){
   assert.equal(buffer.getX(i),positionsBefore[i*3],'water X never drifts');
   assert.equal(buffer.getZ(i),positionsBefore[i*3+2],'water Z never drifts');
   assert.ok(Math.abs(buffer.getY(i)-positionsBefore[i*3+1])<=.025,'only shallow vertical relief');
  }
  const port=generateBoardSetup(24680).ports[0],dock=makeBoatPort(assets,port.type,portBoatPlan(port,geometry));
  const fixedDecks=dock.children.filter(child=>child.name.startsWith('deck:')).map(child=>child.position.toArray());
  const boat=dock.getObjectByName('port-boat') as THREE.Group;
  const pose=boatPose(3.2,0,boat.position.x,boat.position.z);
  boat.position.y=pose.height;boat.rotation.x=pose.pitch;boat.rotation.z=pose.roll;
  assert.deepEqual(dock.children.filter(child=>child.name.startsWith('deck:')).map(child=>child.position.toArray()),fixedDecks);
 }finally{assets.dispose();}
});

test('tree, sheep, brick, mountain rock and wheat are tappable independent decorative roots',()=>{
 const assets=new GeometryAssets(),board=generateBoardSetup(48);
 try{
  for(const terrain of ['forest','pasture','hills','mountains','fields'] as const){
   const hex=board.hexes.find(h=>h.terrain===terrain)!;
   const tile=makeTerrain(assets,hex,{x:0,z:0});
   refineTerrain(assets,hex,tile.root,tile.token);
   const roots:THREE.Group[]=[];
   tile.root.traverse(o=>{if(o instanceof THREE.Group&&o.userData.decorative)roots.push(o);});
   assert.equal(roots.length,terrain==='fields'?1:3,terrain);
   assert.ok(roots.every(o=>o.userData.decorative===({forest:'tree',pasture:'sheep',hills:'brick',mountains:'rock',fields:'wheat'}[terrain])));
   assert.ok(roots.every(o=>o.children.length>0));
  }
 }finally{assets.dispose();}
});

test('clicked props bounce or sway and return exactly to their resting position',()=>{
 for(const kind of ['tree','sheep','brick','rock','wheat'] as const){
  const start=decorationReaction(kind,0);
  const mid=decorationReaction(kind,REACTION_DURATION_MS/3);
  const final=decorationReaction(kind,REACTION_DURATION_MS+10);
  assert.deepEqual(start,{x:0,y:0,z:0,finished:false});
  assert.equal(mid.finished,false);
  assert.ok(Math.abs(mid.x)+Math.abs(mid.y)+Math.abs(mid.z)>0,kind);
  assert.deepEqual(final,{x:0,y:0,z:0,finished:true});
 }
});
