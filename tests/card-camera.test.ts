import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { OrthographicCamera } from 'three';
import { resizeManualFrustum } from '../src/game/board/three/camera-layout.ts';
import { createGame } from '../src/game/rules/state.ts';
import { applyEconomyCommand } from '../src/game/rules/economy.ts';
import { staticBoardKey } from '../src/game/board/three/model.ts';

test('manual projection preserves world-per-pixel scale and center through card-layout resize', () => {
 const f={left:-7,right:9,top:6,bottom:-4},previous={width:800,height:500},next={width:760,height:540};
 const result=resizeManualFrustum(f,previous,next)!;
 assert.ok(Math.abs((result.right-result.left)/next.width-(f.right-f.left)/previous.width)<1e-12);
 assert.ok(Math.abs((result.top-result.bottom)/next.height-(f.top-f.bottom)/previous.height)<1e-12);
 assert.equal((result.left+result.right)/2,1);assert.equal((result.top+result.bottom)/2,1);
 assert.deepEqual(f,{left:-7,right:9,top:6,bottom:-4});
 const restored=resizeManualFrustum(result,next,previous)!;
 for(const key of ['left','right','top','bottom'] as const)assert.ok(Math.abs(restored[key]-f[key])<1e-12);
});
test('a real Three camera retains its transform and zoom when only the frustum changes',()=>{
 const camera=new OrthographicCamera(-7,9,6,-4,.1,100);camera.position.set(2,13,10);camera.zoom=1.6;camera.lookAt(1,0,1);camera.updateProjectionMatrix();
 const position=camera.position.toArray(),rotation=camera.quaternion.toArray();
 const result=resizeManualFrustum(camera,{width:800,height:500},{width:760,height:540});assert.ok(result);
 Object.assign(camera,result);camera.updateProjectionMatrix();
 assert.equal(camera.zoom,1.6);assert.deepEqual(camera.position.toArray(),position);assert.deepEqual(camera.quaternion.toArray(),rotation);
 assert.ok(Math.abs((camera.right-camera.left)/760-16/800)<1e-12);
});
test('hidden or invalid dimensions never corrupt a saved manual projection',()=>{
 const f={left:-4,right:4,top:3,bottom:-3},size={width:800,height:600};
 for(const v of [0,-1,NaN,Infinity]){
  assert.equal(resizeManualFrustum(f,{width:v,height:600},size),null);
  assert.equal(resizeManualFrustum(f,size,{width:800,height:v}),null);
 }
 assert.deepEqual(resizeManualFrustum(f,size,size),f);
});
test('all playable development cards retain the static scene identity and board assignments',()=>{
 for(const card of ['road-building','knight','monopoly','invention'] as const){
  const state=createGame(24680,['a','b','c'],()=>0);state.phase='action';state.currentSeat=0;state.turn=10;
  state.players[0].cards=[{type:card,boughtTurn:0}];
  const before=structuredClone(state.board),key=staticBoardKey(before);
  const result=applyEconomyCommand(state,{type:'play-card',playerId:'a',card,resource:'lumber',resources:['grain','ore']});
  assert.deepEqual(result.board,before);assert.equal(staticBoardKey(result.board),key);
 }
});
test('renderer separates explicit auto-fit from manual projection preservation',()=>{
 const source=readFileSync('src/game/board/three/renderer.ts','utf8');
 assert.ok(source.includes("this.controls.addEventListener('start', () => { this.manualView = true; });"));
 assert.ok(source.includes('resizeManualFrustum(this.camera'));
 assert.ok(source.includes('if (preserved) { Object.assign(this.camera, preserved); this.camera.updateProjectionMatrix(); }'));
 assert.ok(source.includes('this.manualView = false;'));
});
