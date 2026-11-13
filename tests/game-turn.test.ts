import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, drawIndex, RESOURCES, type Hand } from '../src/game/rules/state.ts';
import { applyTurnCommand, produce, calculateDiceProduction } from '../src/game/rules/turn.ts';
import { createIslandBoard } from '../src/game/board/geometry.ts';
const zero = (): Hand => ({ lumber: 0, brick: 0, wool: 0, grain: 0, ore: 0 });

test('production handles city, robber and bank shortages', () => {
  const state = createGame(4, ['a','b','c']);
  const geometry = createIslandBoard();
  const assignment = state.board.hexes.find(hex => hex.token !== null)!;
  const hex = geometry.hexes.find(hex => hex.id === assignment.hexId)!;
  const resource = assignment.resource!;
  state.buildings[hex.vertexIds[0]] = { playerId: 'a', kind: 'city' };
  state.buildings[hex.vertexIds[3]] = { playerId: 'b', kind: 'settlement' };
  state.bank[resource] = 2;
  produce(state, assignment.token!); assert.equal(state.players[0].hand[resource], 0); assert.equal(state.players[1].hand[resource], 0);
  delete state.buildings[hex.vertexIds[3]];
  state.bank[resource] = 1; produce(state, assignment.token!); assert.equal(state.players[0].hand[resource], 1); assert.equal(state.bank[resource], 0);
  state.bank[resource] = 19; state.board = {...state.board, robberHexId: hex.id}; produce(state, assignment.token!); assert.equal(state.players[0].hand[resource], 1);
});

test('seven forces exact discards before robber movement and deterministic eligible theft', () => {
  let state = createGame(5, ['a','b','c']); state.currentSeat = 0; state.phase = 'roll';
  for (let seed = 0; ; seed++) { const first = drawIndex(seed,6), second = drawIndex(first.state,6); if (first.index + second.index + 2 === 7) { state.randomState = seed; break; } }
  state.players[1].hand.lumber = 8; state.bank.lumber -= 8;
  state = applyTurnCommand(state, {type:'roll',playerId:'a'}); assert.equal(state.phase,'discard'); assert.equal(state.discards.b,4);
  assert.throws(() => applyTurnCommand(state,{type:'move-robber',playerId:'a',hexId:state.board.hexes[0].hexId}));
  assert.throws(() => applyTurnCommand(state,{type:'discard',playerId:'b',cards:zero()}));
  const cards = zero(); cards.lumber = 4; state = applyTurnCommand(state,{type:'discard',playerId:'b',cards}); assert.equal(state.phase,'robber');
  assert.throws(() => applyTurnCommand(state,{type:'move-robber',playerId:'a',hexId:state.board.robberHexId}));
  const hex = createIslandBoard().hexes.find(hex => hex.id !== state.board.robberHexId)!;
  state.buildings[hex.vertexIds[0]] = { playerId:'b',kind:'settlement' };
  state = applyTurnCommand(state,{type:'move-robber',playerId:'a',hexId:hex.id}); assert.equal(state.phase,'steal'); assert.deepEqual(state.victims,['b']);
  assert.throws(() => applyTurnCommand(state,{type:'steal',playerId:'a',victimId:'c'}));
  const result = applyTurnCommand(state,{type:'steal',playerId:'a',victimId:'b'});
  assert.deepEqual(result,applyTurnCommand(state,{type:'steal',playerId:'a',victimId:'b'})); assert.equal(result.players[0].hand.lumber,1); assert.equal(result.players[1].hand.lumber,3); assert.equal(result.phase,'action');
  assert.equal(RESOURCES.reduce((sum,r)=>sum+result.players.reduce((s,p)=>s+p.hand[r],0)+result.bank[r],0),95);
  assert.throws(()=>applyTurnCommand(result,{type:'end-turn',playerId:'b'}));
  const next=applyTurnCommand(result,{type:'end-turn',playerId:'a'});assert.equal(next.currentSeat,1);assert.equal(next.phase,'roll');
});

test('moving robber with no eligible victims completes resolution', () => {
  const state=createGame(7,['a','b','c']);state.currentSeat=0;state.phase='robber';
  const id=state.board.hexes.find(h=>h.hexId!==state.board.robberHexId)!.hexId;
  const result=applyTurnCommand(state,{type:'move-robber',playerId:'a',hexId:id});assert.equal(result.phase,'action');assert.deepEqual(result.victims,[]);
});

test('public dice yields report exact resource types and amounts without private hand access',()=>{
 const state=createGame(41,['a','b','c']);
 const geometry=createIslandBoard();
 const hex=state.board.hexes.find(item=>item.resource&&item.token!==null&&item.hexId!==state.board.robberHexId)!;
 const corners=geometry.hexes.find(item=>item.id===hex.hexId)!.vertexIds;
 const resource=hex.resource!;
 state.buildings[corners[0]]={playerId:'a',kind:'city'};
 state.buildings[corners[3]]={playerId:'b',kind:'settlement'};
 const preBank=structuredClone(state.bank);
 const publicView={board:state.board,buildings:state.buildings,bank:preBank,players:state.players.map(({id})=>({id}))};
 const awards=calculateDiceProduction(publicView,hex.token!);
 const before=state.players.map(player=>structuredClone(player.hand));
 produce(state,hex.token!);
 for(const [index,player] of state.players.entries())for(const key of RESOURCES){
  assert.equal(player.hand[key]-before[index][key],awards[player.id][key]);
 }
 assert.equal(awards.a[resource],2);assert.equal(awards.b[resource],1);
 assert.ok(RESOURCES.every(key=>awards.c[key]===0));
 assert.deepEqual(preBank,publicView.bank); // pure public calculation does not change the bank
 assert.ok(!JSON.stringify(publicView).includes('"hand"'));
});
test('public dice yields respect the robber, seven and both bank shortage cases',()=>{
 const state=createGame(41,['a','b']);
 const hex=state.board.hexes.find(item=>item.resource&&item.token!==null&&item.hexId!==state.board.robberHexId)!;
 const geometry=createIslandBoard();
 const corners=geometry.hexes.find(item=>item.id===hex.hexId)!.vertexIds;
 const resource=hex.resource!;
 state.buildings[corners[0]]={playerId:'a',kind:'city'};
 state.buildings[corners[3]]={playerId:'b',kind:'settlement'};
 state.bank[resource]=2;
 const preview={board:state.board,buildings:state.buildings,bank:state.bank,players:state.players.map(({id})=>({id}))};
 assert.equal(calculateDiceProduction(preview,hex.token!).a[resource],0);
 assert.equal(calculateDiceProduction(preview,hex.token!).b[resource],0);
 delete state.buildings[corners[3]];state.bank[resource]=1;
 assert.equal(calculateDiceProduction(preview,hex.token!).a[resource],1);
 state.bank[resource]=19;state.board={...state.board,robberHexId:hex.hexId};preview.board=state.board;
 assert.equal(calculateDiceProduction(preview,hex.token!).a[resource],0);
 const onSeven=calculateDiceProduction(preview,7);
 assert.ok(Object.values(onSeven).every(hand=>RESOURCES.every(key=>hand[key]===0)));
});
