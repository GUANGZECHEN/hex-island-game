import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { createIslandBoard } from '../src/game/board/geometry.ts';
import { createGame, RESOURCES, type GameState } from '../src/game/rules/state.ts';
import { applyTurnCommand, calculateDiceProduction } from '../src/game/rules/turn.ts';
import { describeRoll, isNewRoll } from '../src/game/board/three/roll-presentation.ts';
import { BoardDiceScene, DICE_END_MS, DICE_LANDING_MS, diceFlight, dieRestQuaternion, visibleTopFace, isometricDieQuaternion, visibleDieFaces, diceRestHeight } from '../src/game/board/three/roll-scene.ts';

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
  assert.equal(fx.root.getObjectByName('roll-die')?.children.length,7,'rounded cube with six recessed face panels');
  assert.equal(fx.root.children.filter(child=>child instanceof THREE.Mesh).length,0,'no board-obscuring tray, rim, disk, or platform meshes beneath the dice');
  assert.equal(fx.root.getObjectByName('raised-dice-tray'),undefined);
  assert.equal(fx.root.getObjectByName('dice-tray-rim'),undefined);
  const pips=(fx.root.getObjectByName('roll-die')?.children.flatMap(group=>group.children.filter(mesh=>mesh.name.startsWith('recessed-pip-')))??[]);
  assert.equal(pips.length,21,'all dice pips are actual recessed wells');
  assert.equal(fx.advance(DICE_LANDING_MS-1),false);
  assert.equal(fx.advance(DICE_LANDING_MS),true);
  assert.equal(fx.advance(DICE_LANDING_MS+40),false);
  assert.deepEqual(fx.inspect().top,pair);
  assert.equal(fx.inspect().top.reduce((a,b)=>a+b,0),first+second);
  for(const [index,value] of pair.entries()){
   const orientation=dieRestQuaternion(value,value*.15);
   assert.equal(visibleTopFace(orientation),value);
   const pos=diceFlight(DICE_LANDING_MS,index,value);
   assert.ok(Math.abs(pos.y-diceRestHeight(pos.rotation))<1e-8,'tilted die hovers above the board with no supporting mesh');
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

test('one building adjacent to two identically numbered different resources shows separate icons and counts',()=>{
 const s=createGame(13579,['Player 1','Player 2'],()=>0);
 const topology=createIslandBoard(s.board.layout);
 const tiles=new Map(s.board.hexes.map(tile=>[tile.hexId,tile]));
 const candidate=topology.vertices.flatMap(vertex=>{
  const hexes=topology.hexes.filter(hex=>hex.vertexIds.includes(vertex.id))
    .filter(hex=>tiles.get(hex.id)?.resource);
  return hexes.flatMap((a,i)=>hexes.slice(i+1).map(b=>({vertex,first:a,second:b})))
    .filter(({first,second})=>tiles.get(first.id)!.resource!==tiles.get(second.id)!.resource);
 })[0];
 assert.ok(candidate,'seed should give a shared corner with two distinct resource types');
 const {vertex,first,second}=candidate;
 const resourceA=tiles.get(first.id)!.resource!,resourceB=tiles.get(second.id)!.resource!;
 assert.notEqual(resourceA,resourceB);
 const total=9;
 tiles.get(first.id)!.token=total;
 tiles.get(second.id)!.token=total;
 s.buildings={[vertex.id]:{playerId:'Player 1',kind:'city'}};
 s.board.robberHexId=s.board.hexes.find(hex=>hex.terrain==='desert')!.hexId;
 const description=describeRoll(s,[4,5]);
 assert.ok(description.hexIds.includes(first.id)&&description.hexIds.includes(second.id));
 const items=description.gains.filter(g=>g.vertexId===vertex.id);
 assert.deepEqual(items.map(g=>[g.resource,g.count]).sort(),[[resourceA,2],[resourceB,2]].sort());
 assert.equal(items.reduce((sum,g)=>sum+g.count,0),4,'city receives both +2 separately');
 // Node's unit runner lacks Canvas/Path2D; the real Chromium QA checks the
 // actual multi-resource sprite above this same settlement/city case.

 // If both adjacent tiles yield the SAME resource, merge them into one +4 icon.
 tiles.get(second.id)!.resource=resourceA;
 const merged=describeRoll(s,[4,5]).gains.filter(g=>g.vertexId===vertex.id);
 assert.equal(merged.length,1);
 assert.equal(merged[0].resource,resourceA);
 assert.equal(merged[0].count,4);

 // A settlement touching the same two numbered tiles receives two independent
 // +1 resource icons, not one misleading "+2" with no item identification.
 tiles.get(second.id)!.resource=resourceB;
 s.buildings[vertex.id]={playerId:'Player 1',kind:'settlement'};
 const settlement=describeRoll(s,[4,5]).gains.filter(g=>g.vertexId===vertex.id);
 assert.deepEqual(settlement.map(g=>[g.resource,g.count]).sort(),[[resourceA,1],[resourceB,1]].sort());
});

test('Harbor Co-op special seven displays exact publicly awarded resource icons above partners',()=>{
 const s=createGame(24680,['Player 1','Player 2'],()=>0,{mode:'harbor-coop'});
 const vertices=createIslandBoard('standard').vertices;
 s.buildings={
  [vertices[0].id]:{playerId:'Player 1',kind:'settlement'},
  [vertices.at(-1)!.id]:{playerId:'Player 2',kind:'city'},
 };
 const reward={
  turn:4,
  gains:{
   'Player 1':{lumber:0,brick:1,wool:0,grain:0,ore:0},
   'Player 2':{lumber:0,brick:0,wool:1,grain:0,ore:0},
  },
 };
 const before=structuredClone(s);
 const after=structuredClone(s);
 after.turn=4;after.mode='harbor-coop';after.harbor!.sevenReward=reward;
 const event=describeRoll(before,[3,4],after);
 assert.deepEqual(event.hexIds,[]);
 assert.deepEqual(event.gains.map(g=>[g.playerId,g.resource,g.count]).sort(),[
  ['Player 1','brick',1],['Player 2','wool',1],
 ]);
 assert.deepEqual(describeRoll(before,[3,4]).gains,[],'without public reward metadata, show no invented gain');
});


test('each die is presented with its true top face and two visible side faces, including top camera mode',()=>{
  const directions=[
    new THREE.Vector3(0,13,10), // default board view
    new THREE.Vector3(0,24,2.5), // nearly top-down board view
    new THREE.Vector3(-9,13,7), // orbit left
    new THREE.Vector3(8,16,-11), // orbit right / behind
  ];
  for(const view of directions)for(let value=1;value<=6;value++)for(const dieIndex of [0,1]){
    const q=isometricDieQuaternion(value,dieIndex,view);
    assert.equal(visibleTopFace(q),value,'the real upward pip face never changes');
    const faces=visibleDieFaces(q,view);
    assert.equal(faces.length,3,`dice should show three faces for ${value} at ${view.toArray()}: ${faces}`);
    assert.ok(faces.includes(value),'upper face must remain visible');
    assert.ok(diceRestHeight(q)>.92+.265,'tilted die floats clear of the board at rest');
    const landing=diceFlight(DICE_LANDING_MS,dieIndex,value,view);
    assert.equal(visibleTopFace(landing.rotation),value);
    assert.deepEqual(visibleDieFaces(landing.rotation,view),faces);
  }
});

test('polished dice retain recessed red 1/4 and blue other pips with beveled light-catching edges',()=>{
  const effect=new BoardDiceScene({dice:[1,4],hexIds:[],gains:[]},()=>undefined,()=> '#2671aa');
  const dice=effect.root.children.filter(o=>o.name==='roll-die') as THREE.Group[];
  assert.equal(dice.length,2);
  for(const die of dice){
    const body=die.getObjectByName('rounded-ivory-beveled-body') as THREE.Mesh;
    assert.ok(body);
    assert.ok(body.material instanceof THREE.MeshPhysicalMaterial);
    assert.ok(body.material.clearcoat>.6,'round edges need a visible glossy reflection');
    assert.ok(body.material.roughness<.3);
    const faceNames=die.children.filter(o=>o.name==='die-face-1');
    assert.equal(faceNames.length,0,'face geometry must be nested on real local cube surfaces');
    for(let value=1;value<=6;value++){
      const panel=die.getObjectByName('die-face-'+value) as THREE.Mesh;
      assert.ok(panel, 'face geometry '+value);
      assert.ok(panel.geometry instanceof THREE.ShapeGeometry);
      assert.ok(die.getObjectByName('recessed-pip-'+value));
      assert.ok(die.getObjectByName('die-face-ivory-contour'));
    }
  }
  const first=dice[0].getObjectByName('recessed-pip-1') as THREE.Mesh;
  const fourth=dice[0].getObjectByName('recessed-pip-4') as THREE.Mesh;
  const blue=dice[0].getObjectByName('recessed-pip-3') as THREE.Mesh;
  assert.equal(first.material,fourth.material,'1 and 4 share red inset dot material');
  assert.notEqual(first.material,blue.material,'other die faces are blue');
  assert.ok(effect.root.getObjectByName('dice-warm-edge-key'));
  assert.ok(effect.root.getObjectByName('dice-cool-edge-fill'));
  effect.dispose();
});
