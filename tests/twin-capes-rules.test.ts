import test from 'node:test';
import assert from 'node:assert/strict';
import { createIslandBoard } from '../src/game/board/geometry.ts';
import { applyBuildCommand, shipsRemaining, usesHarborShips } from '../src/game/rules/build.ts';
import { applyEconomyCommand } from '../src/game/rules/economy.ts';
import { bankTradeRate, legalTargetIds } from '../src/game/rules/legal.ts';
import { createGame, publicVictoryPoints, type Hand } from '../src/game/rules/state.ts';
import { applyTurnCommand, calculateDiceProduction } from '../src/game/rules/turn.ts';
import { clockParticipants, timeoutCommand } from '../src/game/rules/turn-clock.ts';

const empty = ():Hand => ({lumber:0,brick:0,wool:0,grain:0,ore:0});
const twin = () => createGame(71,['a','b'],undefined,{boardLayout:'twin-capes'});
const rollSeven = (state:ReturnType<typeof twin>) => {
  const dice=[0,5];
  return applyTurnCommand(state,{type:'roll',playerId:'a'},()=>dice.shift()!);
};

test('Twin Capes supports two through six Classic players and forces ships on',()=>{
  const ids=['a','b','c','d','e','f','g'];
  for(const count of [2,3,4,5,6]){
    const state=createGame(71,ids.slice(0,count),undefined,{boardLayout:'twin-capes',rules:{catchUp:true,ships:false}});
    assert.deepEqual(state.rules,{catchUp:true,ships:true});
    assert.equal(state.board.robberHexId,'');
    assert.ok(state.board.ports.some(port=>port.edgeId===state.board.piratePortEdgeId));
    assert.equal(shipsRemaining(state,'a'),Infinity);
  }
  for(const count of [1,7]){
    assert.throws(()=>createGame(71,ids.slice(0,count),undefined,{boardLayout:'twin-capes'}),/two to six/);
  }
  assert.throws(()=>createGame(71,ids.slice(0,2),undefined,{boardLayout:'twin-capes',mode:'harbor-coop'}),/standard board/);
});

test('seven preserves normal discards, then the active player moves the pirate without theft',()=>{
  const before=twin();
  before.currentSeat=0;before.phase='roll';
  before.players[0].hand.lumber=8;
  before.players[1].hand.ore=9;
  const rolled=rollSeven(before);
  assert.equal(rolled.phase,'discard');
  assert.deepEqual(rolled.discards,{a:4,b:4});
  const start=rolled.board.piratePortEdgeId!;
  const destinations=rolled.board.ports.filter(port=>port.edgeId!==start);
  assert.deepEqual(legalTargetIds(rolled,'a','pirate'),[]);
  assert.throws(()=>applyTurnCommand(rolled,{type:'move-pirate',playerId:'a',edgeId:destinations[0].edgeId}));
  const first=applyTurnCommand(rolled,{type:'discard',playerId:'a',cards:{...empty(),lumber:4}});
  assert.equal(first.phase,'discard');
  const ready=applyTurnCommand(first,{type:'discard',playerId:'b',cards:{...empty(),ore:4}});
  assert.equal(ready.phase,'pirate');
  assert.deepEqual(clockParticipants(ready),['a']);
  assert.deepEqual(legalTargetIds(ready,'a','pirate'),destinations.map(port=>port.edgeId));
  assert.deepEqual(legalTargetIds(ready,'b','pirate'),[]);
  assert.throws(()=>applyTurnCommand(ready,{type:'move-pirate',playerId:'a',edgeId:start}));
  assert.throws(()=>applyTurnCommand(ready,{type:'move-pirate',playerId:'a',edgeId:'invalid'}));
  assert.throws(()=>applyTurnCommand(ready,{type:'move-pirate',playerId:'b',edgeId:destinations[0].edgeId}));
  assert.throws(()=>applyTurnCommand(ready,{type:'move-robber',playerId:'a',hexId:ready.board.hexes[0].hexId}));
  const fallback=timeoutCommand(ready,'a');
  assert.deepEqual(fallback,{type:'move-pirate',playerId:'a',edgeId:destinations[0].edgeId});
  if(fallback?.type!=='move-pirate')throw new Error('Expected pirate timeout movement.');
  const moved=applyTurnCommand(ready,fallback);
  assert.equal(moved.phase,'action');
  assert.equal(moved.board.piratePortEdgeId,destinations[0].edgeId);
  assert.equal(ready.board.piratePortEdgeId,start);
  assert.deepEqual(moved.players,ready.players);
  assert.deepEqual(moved.bank,ready.bank);
  assert.deepEqual(moved.victims,[]);
  assert.throws(()=>applyTurnCommand(moved,{type:'steal',playerId:'a',victimId:'b'}));

  const noDiscards=twin();
  noDiscards.currentSeat=0;noDiscards.phase='roll';
  assert.equal(rollSeven(noDiscards).phase,'pirate');
});

test('Twin Capes Knight resumes the current turn phase after pirate movement',()=>{
  for(const phase of ['roll','action'] as const){
    const before=twin();
    before.currentSeat=0;before.phase=phase;before.turn=2;
    before.players[0].cards=[{type:'knight',boughtTurn:1}];
    const played=applyEconomyCommand(before,{type:'play-card',card:'knight',playerId:'a'});
    assert.equal(played.phase,'pirate');
    assert.equal(played.players[0].knights,1);
    assert.equal(played.playedDevelopment,true);
    const [edgeId]=legalTargetIds(played,'a','pirate');
    const moved=applyTurnCommand(played,{type:'move-pirate',playerId:'a',edgeId});
    assert.equal(moved.phase,phase);
    assert.equal(moved.resumePhase,null);
    assert.deepEqual(moved.victims,[]);
  }
});

test('the pirate disables maritime discounts at either endpoint only',()=>{
  const template=twin();
  const specific=template.board.ports.find(port=>port.type!=='generic')!;
  const generic=template.board.ports.find(port=>port.type==='generic')!;
  if(specific.type==='generic')throw new Error('Expected a resource harbor.');
  const resource=specific.type;
  const received=resource==='grain'?'wool':'grain';
  for(const endpoint of specific.vertexIds){
    const state=twin();
    state.phase='action';state.currentSeat=0;
    state.board.piratePortEdgeId=specific.edgeId;
    state.buildings[endpoint]={kind:'settlement',playerId:'a'};
    state.players[0].hand[resource]=8;
    state.players[1].hand[received]=1;
    const trade=(rate:2|3|4)=>applyEconomyCommand(state,{type:'bank-trade',playerId:'a',give:resource,receive:received,rate});
    assert.equal(bankTradeRate(state,'a',resource),4);
    assert.throws(()=>trade(2),/Port unavailable/);
    assert.equal(trade(4).players[0].hand[received],1);
    state.buildings[generic.vertexIds[0]]={kind:'settlement',playerId:'a'};
    assert.equal(bankTradeRate(state,'a',resource),3,'another port still gives its ordinary discount');
    assert.equal(trade(3).players[0].hand[received],1);
    state.board.piratePortEdgeId=generic.edgeId;
    assert.throws(()=>trade(3),/Port unavailable/);
    assert.equal(bankTradeRate(state,'a',resource),2,'moving the pirate restores the original discount');
    assert.equal(trade(2).players[0].hand[received],1);

    const offered=applyEconomyCommand(state,{type:'offer',playerId:'a',id:'trade',targets:['b'],
      give:{...empty(),[resource]:1},receive:{...empty(),[received]:1}});
    const accepted=applyEconomyCommand(offered,{type:'accept-offer',playerId:'b',id:'trade'});
    assert.equal(accepted.players[0].hand[received],1,'domestic trade remains available');
  }
});

test('the pirate leaves production intact and the occupied harbor can anchor ship eligibility',()=>{
  let state=twin();
  state.currentSeat=0;state.phase='action';
  state.players[0].hand={...empty(),lumber:6,brick:6,ore:6};
  const startingPort=state.board.ports.find(port=>port.edgeId===state.board.piratePortEdgeId)!;
  assert.ok(usesHarborShips(state));
  assert.deepEqual(legalTargetIds(state,'a','ship'),[]);
  const blockedEndpoint=startingPort.vertexIds[0];
  state.buildings[blockedEndpoint]={playerId:'a',kind:'settlement'};
  const geometry=createIslandBoard(state.board.layout);
  const coast=geometry.edges.find(edge=>edge.id===startingPort.edgeId)!;
  const coastalHex=state.board.hexes.find(hex=>hex.hexId===coast.hexIds[0])!;
  assert.ok(coastalHex.resource&&coastalHex.token!==null);
  assert.ok(calculateDiceProduction(state,coastalHex.token).a[coastalHex.resource]>0);
  for(let index=0;index<3;index++){
    const legal=legalTargetIds(state,'a','ship');
    assert.ok(legal.length);
    assert.ok(!legal.includes(startingPort.vertexIds[1]),'ship spacing still applies');
    state=applyBuildCommand(state,{type:'build-ship',playerId:'a',vertexId:legal[0]});
  }
  assert.equal(Object.values(state.buildings).filter(building=>building.kind==='ship').length,3);
  assert.equal(publicVictoryPoints(state,'a'),4);
  assert.equal(shipsRemaining(state,'a'),Infinity);
  assert.deepEqual(state.players[0].hand,empty());
  assert.deepEqual(state.roads,{});
});
