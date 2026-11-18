import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { createIslandBoard } from '../src/game/board/geometry.ts';
import { createGame, RESOURCES, type GameState } from '../src/game/rules/state.ts';
import { applyTurnCommand, calculateDiceProduction } from '../src/game/rules/turn.ts';
import { describeRoll, isNewRoll } from '../src/game/board/three/roll-presentation.ts';
import { BoardDiceScene, DICE_END_MS, DICE_LANDING_MS, diceFlight, dieRestQuaternion, visibleTopFace } from '../src/game/board/three/roll-scene.ts';

function setup():{s:GameState;total:number;hexId:string;vertexIds:readonly string[];resource:Exclude<typeof RESOURCES[number],never>} {
 const s=createGame(24680,['Player 1','Player 2','Player 3'],()=>0);
 s.phase='roll';s.turn=3;s.currentSeat=0;s.dice=null;
 const target=s.board.hexes.find(hex=>hex.resource!==null && hex.token!==null)!;
 const boardHex=createIslandBoard(s.board.layout).hexes.find(h=>h.id===target.hexId)!;
 const total=target.token!;
 s.buildings[boardHex.vertexIds[0]]={playerId:'Player 1',kind:'city'};
 s.buildings[boardHex.vertexIds[2]]={playerId:'Player 2',kind:'settlement'};
 return {s,total,hexId:target.hexId,vertexIds:boardHex.vertexIds,resource:target.resource!};
}
function pair(total:number):[number,number] {
 for(let first=1;first<=6;first++)if(total-first>=1&&total-first<=6)return [first,total-first];
 throw Error('Impossible dice total');
}
test('all six real 3D pip faces settle with the exact authoritative upward values',()=>{
 for(let first=1;first<=6;first++)for(let second=1;second<=6;second++){
  const pair=[first,second] as const;
  const fx=new BoardDiceScene({dice:pair,hexIds:[],gains:[]},()=>undefined,()=> '#2965a6');
  const initial=fx.inspect();
  assert.deepEqual(initial.dice,pair);
  assert.equal(fx.root.getObjectByName('roll-die')?.children.length,22,'one rounded box plus 21 pip meshes');
  assert.equal(fx.advance(DICE_LANDING_MS-1),false);
  assert.equal(fx.advance(DICE_LANDING_MS),true);
  assert.equal(fx.advance(DICE_LANDING_MS+40),false);
  assert.deepEqual(fx.inspect().top,pair);
  assert.equal(fx.inspect().top.reduce((a,b)=>a+b,0),first+second);
  for(const [index,value] of pair.entries()){
   const orientation=dieRestQuaternion(value,value*.15);
   assert.equal(visibleTopFace(orientation),value);
   const pos=diceFlight(DICE_LANDING_MS,index,value);
   assert.ok(Math.abs(pos.y-.43)<1e-8);
   const p=new THREE.Vector3(0,1,0);
   assert.ok(Math.abs(p.clone().applyQuaternion(pos.rotation).length()-1)<1e-8);
  }
  assert.equal(fx.advance(DICE_END_MS+1),false);
  assert.equal(fx.complete,true);fx.dispose();
 }
});
test('a valid roll shows only matching unblocked hexes and actual settled/city awards',()=>{
 const {s,total,hexId,resource,vertexIds}=setup();
 const report=describeRoll(s,pair(total));
 assert.ok(report.hexIds.includes(hexId));
 assert.equal(report.gains.find(g=>g.vertexId===vertexIds[0])?.count,2);
 assert.equal(report.gains.find(g=>g.vertexId===vertexIds[2])?.count,1);
 assert.equal(report.gains.find(g=>g.vertexId===vertexIds[0])?.resource,resource);
 for(const hexId of report.hexIds){
  const hex=s.board.hexes.find(h=>h.hexId===hexId)!;
  assert.equal(hex.token,total);assert.notEqual(hex.resource,null);assert.notEqual(hex.hexId,s.board.robberHexId);
 }
 s.board={...s.board,robberHexId:hexId};
 const blocked=describeRoll(s,pair(total));
 assert.ok(!blocked.hexIds.includes(hexId));
 assert.ok(!blocked.gains.some(g=>g.vertexId===vertexIds[0]||g.vertexId===vertexIds[2]));
});
test('building labels never invent gains when the bank cannot pay and match actual reducer awards',()=>{
 const {s,total,resource}=setup();
 s.bank[resource]=2; // owes two players 3 cards; full resource is withheld.
 let report=describeRoll(s,pair(total));
 assert.equal(report.gains.filter(g=>g.resource===resource).length,0);
 s.bank[resource]=3;
 report=describeRoll(s,pair(total));
 const gains=calculateDiceProduction(s,total);
 for(const player of s.players)for(const r of RESOURCES){
  const visual=report.gains.filter(g=>g.playerId===player.id&&g.resource===r).reduce((sum,g)=>sum+g.count,0);
  assert.equal(visual,gains[player.id][r],`visual ${player.id}/${r} must match authoritative public production`);
 }
 // A single recipient is awarded partial stock; labels must not say +2.
 for(const key of Object.keys(s.buildings))s.buildings[key].playerId='Player 1';
 s.bank[resource]=1;
 const limited=describeRoll(s,pair(total));
 assert.equal(limited.gains.reduce((n,g)=>n+(g.resource===resource?g.count:0),0),1);
});
test('all dice totals, seven and roll detection stay consistent with gameplay rules',()=>{
 const {s}=setup();
 for(let total=2;total<=12;total++){
  const report=describeRoll(s,pair(total));
  assert.equal(report.dice[0]+report.dice[1],total);
  const expected=calculateDiceProduction(s,total);
  for(const player of s.players)for(const resource of RESOURCES)
   assert.equal(report.gains.filter(g=>g.playerId===player.id&&g.resource===resource).reduce((sum,g)=>sum+g.count,0),expected[player.id][resource]);
  if(total===7){assert.deepEqual(report.hexIds,[]);assert.deepEqual(report.gains,[]);}
 }
 assert.equal(isNewRoll({dice:null,turn:3},{dice:[3,4],turn:3}),true);
 assert.equal(isNewRoll(null,{dice:[3,4],turn:3}),false);
 assert.equal(isNewRoll({dice:[3,4],turn:3},{dice:[3,4],turn:3}),false);
 assert.equal(isNewRoll({dice:null,turn:3},{dice:[3,4],turn:4}),false);
 const before=structuredClone(s);
 // The host still rolls using exactly the old rule engine.
 const after=applyTurnCommand(s,{type:'roll',playerId:s.players[0].id});
 assert.ok(after.dice);
 assert.equal(isNewRoll(before,after),true);
 const event=describeRoll(before,after.dice!);
 assert.deepEqual(event.dice,after.dice);
 assert.equal(before.dice,null);
});
test('view-only dice animation does not add new gameplay commands or camera mutations',()=>{
 const renderer=readFileSync('src/game/board/three/renderer.ts','utf8');
 const ui=readFileSync('src/game-ui.ts','utf8');
 const scene=readFileSync('src/game/board/three/roll-scene.ts','utf8');
 assert.ok(renderer.includes('this.rollScene.advance')||renderer.includes('roll.advance('));
 assert.ok(renderer.includes('this.producePulse(roll.event.hexIds)'));
 assert.ok(!scene.includes('WebSocket'));assert.ok(!scene.includes('applyTurnCommand'));
 assert.ok(!scene.includes('resetView('));assert.ok(!scene.includes('this.camera'));
 assert.ok(ui.includes('pendingRollPresentation=describeRoll('));
 assert.ok(!ui.includes("kind==='dice'?'DICE ROLL'"));
 assert.ok(!ui.includes("alert.append(productionSummary("));
});
