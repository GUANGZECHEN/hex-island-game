import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../src/game/rules/state.ts';
import { bankTradeRate, playableDevelopmentTypes } from '../src/game/ui/interactions.ts';

test('development play choices include only owned cards from earlier turns',()=>{
 const state=createGame(41,['A','B','C']);state.turn=3;
 state.players[0].cards=[{type:'knight',boughtTurn:2},{type:'road-building',boughtTurn:3},{type:'victory-point',boughtTurn:1},{type:'monopoly',boughtTurn:2}];
 assert.deepEqual(playableDevelopmentTypes(state,'A'),['knight','monopoly']);
 assert.deepEqual(playableDevelopmentTypes(state,'missing'),[]);
});
test('bank trade UI derives the best legal port rate automatically',()=>{
 const state=createGame(42,['A','B','C']);assert.equal(bankTradeRate(state,'A','lumber'),4);
 const generic=state.board.ports.find(port=>port.type==='generic');assert.ok(generic);state.buildings[generic.vertexIds[0]]={playerId:'A',kind:'settlement'};assert.equal(bankTradeRate(state,'A','lumber'),3);
 const lumber=state.board.ports.find(port=>port.type==='lumber');assert.ok(lumber);state.buildings[lumber.vertexIds[0]]={playerId:'A',kind:'settlement'};assert.equal(bankTradeRate(state,'A','lumber'),2);
});
