import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, publicVictoryPoints, RESOURCES, type GameState } from '../src/game/rules/state.ts';
import { createIslandBoard } from '../src/game/board/geometry.ts';
import { applyTurnCommand } from '../src/game/rules/turn.ts';
import { applyBuildCommand, SHIP_COST, longestRoute, MAX_SHIPS_PER_PLAYER, shipsRemaining } from '../src/game/rules/build.ts';
import { shipActionAvailability } from '../src/game/ui/ship-action.ts';
import { legalTargetIds, bankTradeRate } from '../src/game/rules/legal.ts';
import { describeRoll } from '../src/game/board/three/roll-presentation.ts';
import { HostSession } from '../src/game/network/session.ts';

function catchUpGame(leader:number,actor=2): GameState {
 const s=createGame(24680,['leader','behind'],undefined,{rules:{catchUp:true,ships:false}});
 s.phase='roll';s.turn=7;s.currentSeat=1;s.dice=null;
 const vertices=createIslandBoard(s.board.layout).vertices;
 for(let i=0;i<leader;i++)s.buildings[vertices[i].id]={playerId:'leader',kind:'settlement'};
 for(let i=0;i<actor;i++)s.buildings[vertices[25+i].id]={playerId:'behind',kind:'settlement'};
 return s;
}

test('opt-in lagging bonus follows public VP thresholds and distributes distinct bank resources after roll',()=>{
 let s=catchUpGame(4);
 assert.equal(applyTurnCommand(s,{type:'roll',playerId:'behind'},()=>0).catchUpReward,undefined,'leader below five: no bonus');
 s=catchUpGame(5);
 let result=applyTurnCommand(s,{type:'roll',playerId:'behind'},()=>0);
 assert.equal(result.catchUpReward?.turn,s.turn);
 assert.equal(result.catchUpReward?.playerId,'behind');
 assert.deepEqual(RESOURCES.filter(r=>result.catchUpReward!.gains[r]>0),['lumber']);
 assert.ok(result.bank.lumber<=s.bank.lumber-1);
 let event=describeRoll(s,result.dice!,result);
 assert.ok(event.gains.some(g=>g.playerId==='behind'&&g.resource==='lumber'));
 s=catchUpGame(6);
 result=applyTurnCommand(s,{type:'roll',playerId:'behind'},()=>0);
 assert.deepEqual(RESOURCES.filter(r=>result.catchUpReward!.gains[r]>0),['lumber','brick']);
 assert.equal(RESOURCES.reduce((n,r)=>n+result.catchUpReward!.gains[r],0),2);
 event=describeRoll(s,result.dice!,result);
 assert.ok(event.gains.some(g=>g.playerId==='behind'&&g.resource==='brick'));
 s=catchUpGame(6,4);
 assert.equal(applyTurnCommand(s,{type:'roll',playerId:'behind'},()=>0).catchUpReward,undefined,'actor at four VP is not lagging');
 s=createGame(24680,['leader','behind']);s.phase='roll';s.currentSeat=1;
 assert.equal(applyTurnCommand(s,{type:'roll',playerId:'behind'},()=>0).catchUpReward,undefined,'default rule stays disabled');
});

test('catch-up handles depleted bank and seven without extra redraw RNG',()=>{
 const s=catchUpGame(6);
 for(const r of RESOURCES)s.bank[r]=0;
 s.bank.ore=1;
 const result=applyTurnCommand(s,{type:'roll',playerId:'behind'},()=>0);
 assert.equal(result.catchUpReward?.gains.ore,1);
 assert.equal(RESOURCES.reduce((sum,r)=>sum+(result.catchUpReward?.gains[r]??0),0),1);
 assert.equal(result.bank.ore,0);
 const seven=catchUpGame(5);
 const sequence=[0,5,0]; // 1 + 6 = 7, then the bonus from the bank.
 const after=applyTurnCommand(seven,{type:'roll',playerId:'behind'},()=>sequence.shift()??0);
 assert.equal(after.dice![0]+after.dice![1],7);
 assert.equal(after.catchUpReward?.gains.lumber,1);
 assert.equal(after.phase,'robber');
 assert.ok(describeRoll(seven,after.dice!,after).gains.some(g=>g.resource==='lumber'));
});

function shipGame():{s:GameState;target:string;home:string;edgeId:string} {
 const s=createGame(9001,['a','b'],undefined,{rules:{catchUp:false,ships:true}});
 s.currentSeat=0;s.phase='action';
 const topology=createIslandBoard('standard');
 const first=s.board.ports[0],home=first.vertexIds[0];
 s.buildings[home]={playerId:'a',kind:'settlement'};
 const candidate=s.board.ports.flatMap(port=>port.vertexIds).find(vertex=>
  vertex!==home&&!topology.edges.some(e=>e.vertexIds.includes(home)&&e.vertexIds.includes(vertex)));
 assert.ok(candidate);
 const target=candidate!;
 const edge=topology.edges.find(e=>e.vertexIds.includes(target)&&!e.vertexIds.includes(home))!;
 s.roads[edge.id]='a';
 s.players[0].hand={lumber:2,brick:2,wool:0,grain:0,ore:3};
 s.bank={lumber:17,brick:17,wool:19,grain:19,ore:16};
 return {s,target,home,edgeId:edge.id};
}
test('ship claims a remote harbor without any roads for exactly 2 wood, 2 brick, 3 ore and 1 VP',()=>{
 const {s,target,home}=shipGame();
 s.roads={}; // A ship can establish an independent remote port.
 assert.deepEqual(SHIP_COST,{lumber:2,brick:2,wool:0,grain:0,ore:3});
 assert.ok(legalTargetIds(s,'a','ship').includes(target));
 const before=publicVictoryPoints(s,'a');
 const next=applyBuildCommand(s,{type:'build-ship',playerId:'a',vertexId:target});
 assert.equal(next.buildings[target]?.kind,'ship');
 assert.equal(publicVictoryPoints(next,'a'),before+1);
 for(const r of ['lumber','brick','ore'] as const){
  assert.equal(next.players[0].hand[r],0,'paying the exact ship cost spends all materials');
  assert.equal(next.bank[r],19,'ship materials return to the bank');
 }
 const port=next.board.ports.find(p=>p.vertexIds.includes(target))!;
 if(port.type==='generic')assert.ok(bankTradeRate(next,'a','wool')<=3);
 else assert.equal(bankTradeRate(next,'a',port.type),2);
 assert.equal(next.board.ports.some(port=>port.vertexIds.includes(home)),true);
 assert.throws(()=>applyBuildCommand(s,{type:'build-ship',playerId:'a',vertexId:home}),/vacant/);
 const noPort=structuredClone(s);delete noPort.buildings[home];
 assert.throws(()=>applyBuildCommand(noPort,{type:'build-ship',playerId:'a',vertexId:target}),/Own a port/);
 const off=structuredClone(s);off.rules!.ships=false;
 assert.throws(()=>applyBuildCommand(off,{type:'build-ship',playerId:'a',vertexId:target}),/disabled/);
});
test('ship generates one resource, blocks neighboring settlements and never anchors road extension',()=>{
 const {s,target,edgeId}=shipGame();
 const ship=applyBuildCommand(s,{type:'build-ship',playerId:'a',vertexId:target});
 const hex=createIslandBoard(ship.board.layout).hexes.find(h=>h.vertexIds.includes(target)&&ship.board.hexes.some(p=>p.hexId===h.id&&p.token!==null))!;
 const tile=ship.board.hexes.find(h=>h.hexId===hex.id)!;
 const before=structuredClone(ship);before.board.robberHexId=before.board.hexes.find(t=>t.terrain==='desert')!.hexId;
 const dice:[number,number]=tile.token!<=7?[tile.token!-1,1]:[tile.token!-6,6];
 const event=describeRoll(before,dice);
 assert.equal(event.gains.find(g=>g.vertexId===target&&g.resource===tile.resource)?.count,1);
 const topology=createIslandBoard('standard'),adjacent=topology.edges.find(e=>e.vertexIds.includes(target))!.vertexIds.find(v=>v!==target)!;
 const gap=structuredClone(ship);gap.roads={};const nextEdge=topology.edges.find(e=>e.vertexIds.includes(target)&&e.id!==edgeId)!;
 assert.throws(()=>applyBuildCommand(gap,{type:'build-road',playerId:'a',edgeId:nextEdge.id}),/connect/);
 gap.roads[nextEdge.id]='a';gap.players[0].hand.wool=1;gap.players[0].hand.grain=1;
 assert.throws(()=>applyBuildCommand(gap,{type:'build-settlement',playerId:'a',vertexId:adjacent}),/distance/);
 assert.ok(longestRoute(gap,'a')<=1,'ship vertex blocks road route continuity');
});
test('host options are public before the room starts, require reready and survive recovery',()=>{
 const events:unknown[]=[];let id=0;
 const host=new HostSession(()=>{},item=>events.push(item),()=>String(++id).padStart(43,'a'),()=>0);
 host.receive('peer2',JSON.stringify({protocol:1,type:'hello',token:'',name:'Guest'}));
 // The same host-controlled option selector drives all published lobby views.
 host.setHostReady(true);
 host.setOptionalRules({catchUp:true,ships:true});
 const lobby=(events.filter((item:any)=>item?.type==='lobby').at(-1) as any).lobby;
 assert.deepEqual(lobby.rules,{catchUp:true,ships:true});
 assert.equal(host.lobby()[0].ready,false);
 const game=createGame(41,['a','b'],undefined,{rules:lobby.rules});
 assert.deepEqual(game.rules,lobby.rules);
 assert.throws(()=>createGame(41,['a','b'],undefined,{mode:'harbor-coop',rules:lobby.rules}),/Classic/);
 const noRules=createGame(41,['a','b']);
 assert.deepEqual(noRules.rules,{catchUp:false,ships:false});
});


test('every Classic player receives two ship pieces and a third build is prohibited by the reducer',()=>{
  const {s,home}=shipGame();
  assert.equal(MAX_SHIPS_PER_PLAYER,2);
  assert.equal(shipsRemaining(s,'a'),2);
  assert.equal(shipsRemaining(s,'b'),2);
  // Two pieces can be placed at legal port vertices with no roads at all.
  s.roads={};
  s.players[0].hand={lumber:10,brick:10,wool:0,grain:0,ore:10};
  s.bank={lumber:9,brick:9,wool:19,grain:19,ore:9};
  let valid=legalTargetIds(s,'a','ship');
  assert.ok(valid.length>=2,'at least two candidate port vertices should be accessible');
  let first=applyBuildCommand(s,{type:'build-ship',playerId:'a',vertexId:valid[0]});
  assert.equal(shipsRemaining(first,'a'),1);
  assert.equal(shipsRemaining(first,'b'),2,'another player retains their own two pieces');
  assert.equal(publicVictoryPoints(first,'a'),publicVictoryPoints(s,'a')+1);
  valid=legalTargetIds(first,'a','ship');
  assert.ok(valid.length>=1,'another suitably spaced port slot is available');
  const saved=structuredClone(first);
  const second=applyBuildCommand(first,{type:'build-ship',playerId:'a',vertexId:valid[0]});
  assert.equal(shipsRemaining(second,'a'),0);
  assert.equal(publicVictoryPoints(second,'a'),publicVictoryPoints(s,'a')+2);
  assert.deepEqual(legalTargetIds(second,'a','ship'),[]);
  const noMore=structuredClone(second);
  assert.throws(()=>applyBuildCommand(second,{type:'build-ship',playerId:'a',vertexId:home}),/Only two ships per player/);
  assert.deepEqual(second,noMore,'rejected attempts cannot change state or pay a third ship cost');
  assert.equal(shipsRemaining(saved,'a'),1,'undo/recovery from before second build restores one available ship');
  const restart=createGame(9001,['a','b'],undefined,{rules:{catchUp:false,ships:true}});
  assert.equal(shipsRemaining(restart,'a'),2,'fresh game restores both ship pieces');
});

test('Classic ship action stays discoverable when resources are present but a harbor prerequisite is missing',()=>{
  const {s,home,target}=shipGame();
  assert.equal(s.mode,undefined,'Classic uses an implicit default mode in saved game state');
  const ready=shipActionAvailability(s,'a');
  assert.deepEqual(ready,{remaining:2,enabled:true,reason:null});
  const withoutPort=structuredClone(s);delete withoutPort.buildings[home];
  const portStatus=shipActionAvailability(withoutPort,'a');
  assert.equal(portStatus.enabled,false);
  assert.match(portStatus.reason!,/port first/);
  assert.equal(portStatus.remaining,2);
  const withoutRoad=structuredClone(s);withoutRoad.roads={};
  assert.deepEqual(shipActionAvailability(withoutRoad,'a'),{remaining:2,enabled:true,reason:null});
  assert.ok(legalTargetIds(withoutRoad,'a','ship').includes(target),'remote legal ship targets need no road');
  for(const [resource,count] of [['lumber',1],['brick',1],['ore',2]] as const){
    const short=structuredClone(s);short.players[0].hand[resource]=count;
    assert.equal(shipActionAvailability(short,'a').enabled,false);
    assert.match(shipActionAvailability(short,'a').reason!,/2 wood, 2 brick and 3 ore/);
    assert.throws(()=>applyBuildCommand(short,{type:'build-ship',playerId:'a',vertexId:target}),/Insufficient resources/);
  }
  const disabledRule=structuredClone(s);disabledRule.rules!.ships=false;
  assert.equal(shipActionAvailability(disabledRule,'a').enabled,false);
  assert.match(shipActionAvailability(disabledRule,'a').reason!,/lobby/);
  const unavailablePhase=structuredClone(s);unavailablePhase.phase='roll';
  assert.equal(shipActionAvailability(unavailablePhase,'a').enabled,false);
  const alreadyBuilt=structuredClone(s);
  for(const vertex of alreadyBuilt.board.ports.flatMap(port=>port.vertexIds)){
    if(alreadyBuilt.buildings[vertex])continue;
    alreadyBuilt.buildings[vertex]={playerId:'a',kind:'ship'};
    if(shipsRemaining(alreadyBuilt,'a')===0)break;
  }
  assert.equal(shipActionAvailability(alreadyBuilt,'a').remaining,0);
  assert.match(shipActionAvailability(alreadyBuilt,'a').reason!,/Both of your ships/);
});
