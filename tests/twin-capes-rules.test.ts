import test from 'node:test';
import assert from 'node:assert/strict';
import { createIslandBoard } from '../src/game/board/geometry.ts';
import { GENERATOR_VERSION, generateBoardSetup } from '../src/game/board/setup.ts';
import { applyBuildCommand, shipsRemaining, usesHarborShips } from '../src/game/rules/build.ts';
import { applyEconomyCommand } from '../src/game/rules/economy.ts';
import { bankTradeRate, legalTargetIds } from '../src/game/rules/legal.ts';
import { createGame, publicVictoryPoints, usesHarborPirate, type Hand } from '../src/game/rules/state.ts';
import { applyTurnCommand, calculateDiceProduction } from '../src/game/rules/turn.ts';
import { clockParticipants, timeoutCommand } from '../src/game/rules/turn-clock.ts';

const empty = ():Hand => ({lumber:0,brick:0,wool:0,grain:0,ore:0});
const twin = () => createGame(71,['a','b'],undefined,{boardLayout:'twin-capes'});
const legacyTwin = () => {
  const state=twin();
  state.board=generateBoardSetup(71,'twin-capes',GENERATOR_VERSION);
  return state;
};
const rollSeven = (state:ReturnType<typeof twin>) => {
  const dice=[0,5];
  return applyTurnCommand(state,{type:'roll',playerId:'a'},()=>dice.shift()!);
};

test('Twin Capes supports two through six Classic players and forces ships on',()=>{
  const ids=['a','b','c','d','e','f','g'];
  for(const count of [2,3,4,5,6]){
    const state=createGame(71,ids.slice(0,count),undefined,{boardLayout:'twin-capes',rules:{catchUp:true,ships:false}});
    assert.deepEqual(state.rules,{catchUp:true,ships:true});
    assert.equal(state.board.hexes.find(hex=>hex.hexId===state.board.robberHexId)?.terrain,'desert');
    assert.equal(state.board.piratePortEdgeId,undefined);
    assert.equal(usesHarborPirate(state),false);
    assert.equal(shipsRemaining(state,'a'),Infinity);
  }
  for(const count of [1,7]){
    assert.throws(()=>createGame(71,ids.slice(0,count),undefined,{boardLayout:'twin-capes'}),/two to six/);
  }
  assert.throws(()=>createGame(71,ids.slice(0,2),undefined,{boardLayout:'twin-capes',mode:'harbor-coop'}),/standard board/);
});

test('legacy Twin Capes keeps its original pirate blockade after normal discards',()=>{
  const before=legacyTwin();
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

  const noDiscards=legacyTwin();
  noDiscards.currentSeat=0;noDiscards.phase='roll';
  assert.equal(rollSeven(noDiscards).phase,'pirate');
});

test('legacy Twin Capes Knight resumes the current turn phase after pirate movement',()=>{
  for(const phase of ['roll','action'] as const){
    const before=legacyTwin();
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
  const template=legacyTwin();
  const specific=template.board.ports.find(port=>port.type!=='generic')!;
  const generic=template.board.ports.find(port=>port.type==='generic')!;
  if(specific.type==='generic')throw new Error('Expected a resource harbor.');
  const resource=specific.type;
  const received=resource==='grain'?'wool':'grain';
  for(const endpoint of specific.vertexIds){
    const state=legacyTwin();
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
  let state=legacyTwin();
  state.currentSeat=0;state.phase='action';
  state.players[0].hand={...empty(),lumber:6,brick:6,ore:6};
  const startingPort=state.board.ports.find(port=>port.edgeId===state.board.piratePortEdgeId)!;
  assert.ok(usesHarborShips(state));
  assert.deepEqual(legalTargetIds(state,'a','ship'),[]);
  const blockedEndpoint=startingPort.vertexIds[0];
  state.buildings[blockedEndpoint]={playerId:'a',kind:'settlement'};
  const geometry=createIslandBoard(state.board.layout,state.board.version);
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

test('redesigned Twin Capes uses the land robber, ordinary discards and mandatory theft on seven or Knight',()=>{
  for(const trigger of ['seven','roll-knight','action-knight'] as const){
    let state=twin();
    state.currentSeat=0;state.turn=2;state.phase=trigger==='action-knight'?'action':'roll';
    const tile=state.board.hexes.find(hex=>hex.terrain!=='desert')!;
    const geometry=createIslandBoard(state.board.layout,state.board.version);
    const site=geometry.hexes.find(hex=>hex.id===tile.hexId)!.vertexIds[0];
    state.buildings[site]={kind:'settlement',playerId:'b'};
    state.players[1].hand.grain=8;
    if(trigger==='seven'){
      state=rollSeven(state);
      assert.deepEqual(state.discards,{b:4});
      state=applyTurnCommand(state,{type:'discard',playerId:'b',cards:{...empty(),grain:4}});
    }else{
      state.players[0].cards=[{type:'knight',boughtTurn:1}];
      state=applyEconomyCommand(state,{type:'play-card',playerId:'a',card:'knight'});
    }
    assert.equal(state.phase,'robber');
    assert.deepEqual(legalTargetIds(state,'a','pirate'),[]);
    assert.throws(()=>applyTurnCommand(state,{type:'move-pirate',playerId:'a',edgeId:state.board.ports[0].edgeId}));
    state=applyTurnCommand(state,{type:'move-robber',playerId:'a',hexId:tile.hexId});
    assert.equal(state.phase,'steal');
    assert.deepEqual(state.victims,['b']);
    assert.deepEqual(timeoutCommand(state,'a'),{type:'steal',playerId:'a',victimId:'b'});
    assert.throws(()=>applyTurnCommand(state,{type:'end-turn',playerId:'a'}));
    state=applyTurnCommand(state,{type:'steal',playerId:'a',victimId:'b'},()=>0);
    assert.equal(state.players[0].hand.grain,1);
    assert.equal(state.phase,trigger==='roll-knight'?'roll':'action');
    assert.equal(state.board.robberHexId,tile.hexId);
  }
});

test('Twin Capes dice receipts match actual city, settlement and bank transfers, including every zero',()=>{
  const state=createGame(71,['a','b','c'],undefined,{boardLayout:'twin-capes'});
  state.currentSeat=0;state.phase='roll';state.turn=3;
  // No 6/8 neighbors share an edge, so only the selected tile can match at each of its vertices.
  const tile=state.board.hexes.find(hex=>hex.token===6)!;
  const resource=tile.resource!;
  const hex=createIslandBoard(state.board.layout,state.board.version).hexes.find(hex=>hex.id===tile.hexId)!;
  state.buildings[hex.vertexIds[0]]={kind:'settlement',playerId:'a'};
  state.buildings[hex.vertexIds[3]]={kind:'city',playerId:'b'};
  const rollSix=()=>{
    const dice=[0,4];return applyTurnCommand(state,{type:'roll',playerId:'a'},()=>dice.shift()!);
  };
  const check=(next:typeof state,a:number,b:number)=>{
    assert.deepEqual(next.lastRollPayout,{turn:3,playerId:'a',dice:[1,5],gains:{a,b,c:0}});
    assert.equal(next.players[0].hand[resource]-state.players[0].hand[resource],a);
    assert.equal(next.players[1].hand[resource]-state.players[1].hand[resource],b);
    assert.equal(state.bank[resource]-next.bank[resource],a+b);
  };
  const rolled=rollSix();
  check(rolled,1,2);
  assert.equal(state.lastRollPayout,undefined);
  const ended=applyTurnCommand(rolled,{type:'end-turn',playerId:'a'});
  assert.deepEqual(ended.lastRollPayout,rolled.lastRollPayout);
  const seven=[0,5];
  const after=applyTurnCommand(ended,{type:'roll',playerId:'b'},()=>seven.shift()!);
  assert.deepEqual(after.lastRollPayout,{turn:4,playerId:'b',dice:[1,6],gains:{a:0,b:0,c:0}});

  state.bank[resource]=2;
  check(rollSix(),1,2);
  delete state.buildings[hex.vertexIds[0]];
  state.bank[resource]=1;
  check(rollSix(),0,2);
  state.board.robberHexId=tile.hexId;
  check(rollSix(),0,0);
});

test('the receipt includes actual catch-up and cooperative seven rewards',()=>{
  const classic=createGame(71,['a','b'],undefined,{rules:{catchUp:true,ships:false}});
  classic.currentSeat=0;classic.phase='roll';classic.turn=1;
  const vertices=createIslandBoard(classic.board.layout,classic.board.version).vertices;
  for(const site of vertices.slice(0,3))classic.buildings[site.id]={kind:'city',playerId:'b'};
  const entropy=[0,5,0];
  const caughtUp=applyTurnCommand(classic,{type:'roll',playerId:'a'},()=>entropy.shift()!);
  assert.deepEqual(caughtUp.lastRollPayout?.gains,{a:1,b:0});
  assert.equal(Object.values(caughtUp.players[0].hand).reduce((total,n)=>total+n,0),1);
  const coop=createGame(71,['a','b'],undefined,{mode:'harbor-coop'});
  coop.currentSeat=0;coop.turn=1;coop.phase='roll';
  const rewards=[0,5,0,0,0,0];
  const paid=applyTurnCommand(coop,{type:'roll',playerId:'a'},()=>rewards.shift()!);
  assert.deepEqual(paid.lastRollPayout?.gains,{a:2,b:2});
  for(const [i,player] of paid.players.entries()){
    const total=(hand:Hand)=>Object.values(hand).reduce((sum,n)=>sum+n,0);
    assert.equal(total(player.hand)-total(coop.players[i].hand),2);
  }
});

test('25-hex Twin Capes keeps unlimited harbor ships and active maritime trade',()=>{
  let state=twin();
  state.currentSeat=0;state.phase='action';
  const port=state.board.ports.find(port=>port.type!=='generic')!;
  if(port.type==='generic')throw new Error('Expected a resource harbor.');
  state.buildings[port.vertexIds[0]]={playerId:'a',kind:'settlement'};
  assert.equal(bankTradeRate(state,'a',port.type),2);
  state.players[0].hand={...empty(),lumber:6,brick:6,ore:6};
  for(let i=0;i<3;i++){
    const [vertexId]=legalTargetIds(state,'a','ship');
    assert.ok(vertexId);
    state=applyBuildCommand(state,{type:'build-ship',playerId:'a',vertexId});
  }
  assert.equal(shipsRemaining(state,'a'),Infinity);
  assert.equal(publicVictoryPoints(state,'a'),4);
  assert.deepEqual(state.players[0].hand,empty());
});
