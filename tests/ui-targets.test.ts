import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, applySetupCommand } from '../src/game/rules/state.ts';
import { createIslandBoard } from '../src/game/board/geometry.ts';
import { legalTargetIds } from '../src/game/ui/targets.ts';

test('legal target helper mirrors setup reducers without mutating state',()=>{
 const state=createGame(17,['a','b','c']);
 const player=state.players[state.currentSeat].id;
 const before=JSON.stringify(state);
 const settlements=legalTargetIds(state,player,'settlement');
 assert.ok(settlements.length>0);
 assert.equal(JSON.stringify(state),before);
 const placed=applySetupCommand(state,{type:'place-settlement',playerId:player,vertexId:settlements[0]});
 const roads=legalTargetIds(placed,player,'road');
 assert.ok(roads.length>0);
 for(const edgeId of roads)assert.doesNotThrow(()=>applySetupCommand(placed,{type:'place-road',playerId:player,edgeId}));
});

test('robber target highlighting excludes the occupied robber hex',()=>{
 const state=createGame(9,['a','b','c']);
 const player=state.players[state.currentSeat].id;
 state.phase='robber';
 const targets=legalTargetIds(state,player,'robber');
 assert.equal(targets.length,18);
 assert.ok(!targets.includes(state.board.robberHexId));
});

test('city target highlighting selects an owned settlement when affordable',()=>{
 const state=createGame(23,['a','b','c']);
 state.currentSeat=0;state.phase='action';
 const player=state.players[0],vertex=createIslandBoard().vertices[0].id;
 state.buildings[vertex]={playerId:player.id,kind:'settlement'};player.settlements--;
 player.hand.grain=2;player.hand.ore=3;state.bank.grain-=2;state.bank.ore-=3;
 const targets=legalTargetIds(state,player.id,'city');
 assert.ok(targets.includes(vertex));
});
