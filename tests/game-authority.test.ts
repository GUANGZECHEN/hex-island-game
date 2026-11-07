import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../src/game/rules/state.ts';
import { HostAuthority, projectState } from '../src/game/network/authority.ts';
import { createIslandBoard } from '../src/game/board/geometry.ts';

test('projections hide other hands, shuffled deck and random state',()=>{
 const state=createGame(9,['a','b','c'],()=>123456);state.players[0].hand.brick=7;state.players[0].cards=[{type:'monopoly',boughtTurn:1}];
 const other=projectState(state,'b',0,'game1');const text=JSON.stringify(other);assert.ok(!text.includes('monopoly'));assert.ok(!text.includes('randomState'));assert.ok(!('deck' in other.public));assert.equal(other.public.players[0].resources,7);
 assert.equal(projectState(state,'a',0,'game1').private.cards[0].type,'monopoly');
 assert.notDeepEqual(createGame(9,['a','b','c'],()=>123456).deck,createGame(9,['a','b','c'],()=>123457).deck);
});
test('host rejects stale, duplicate, spoofed, malformed and oversized commands',()=>{
 const state=createGame(7,['a','b','c']);const active=state.players[state.currentSeat].id;const host=new HostAuthority('game1',state,()=>42);
 const vertex=createIslandBoard().vertices[0].id;
 const message={protocol:1,gameId:'game1',revision:0,commandId:'one',sender:active,command:{type:'place-settlement',playerId:active,vertexId:vertex}};
 const send=(body:unknown,peer=active)=>host.receive(peer,JSON.stringify(body));
 assert.equal(send({...message,sender:'not-player'}).code,'unauthorized');assert.equal(send({...message,revision:1}).code,'stale');
 assert.equal(send({...message,command:{type:'toString',playerId:active}}).code,'malformed');
 assert.equal(host.receive(active,'x'.repeat(20000)).code,'malformed');
 assert.equal(send(message).ok,true);assert.equal(send(message).code,'duplicate');
 assert.equal(send({...message,commandId:'two'}).code,'stale');
 const snapshot=host.snapshot(active);assert.equal(snapshot.revision,1);assert.equal(snapshot.public.phase,'setup-road');
});
test('victory is projected and commands after finish are rejected',()=>{
 const state=createGame(1,['a','b','c']);state.phase='action';state.currentSeat=0;state.players[0].cards=Array.from({length:10},()=>({type:'victory-point' as const,boughtTurn:1}));const host=new HostAuthority('endgame',state,()=>0);
 const msg={protocol:1,gameId:'endgame',revision:0,commandId:'win',sender:'a',command:{type:'claim-victory',playerId:'a'}};
 assert.equal(host.receive('a',JSON.stringify(msg)).ok,true);assert.equal(host.snapshot('b').public.winner,'a');assert.equal(host.snapshot('b').public.phase,'finished');
 assert.equal(host.receive('a',JSON.stringify({...msg,revision:1,commandId:'late'})).code,'illegal');
});
test('an authoritative roll and end-turn advance public revision and player',()=>{
 const state=createGame(5,['a','b','c']);state.phase='roll';state.currentSeat=0;state.turn=1;const host=new HostAuthority('turn',state,()=>0);
 const message=(revision:number,id:string,type:string)=>JSON.stringify({protocol:1,gameId:'turn',revision,commandId:id,sender:'a',command:{type,playerId:'a'}});
 assert.equal(host.receive('a',message(0,'roll','roll')).ok,true);assert.deepEqual(host.snapshot('b').public.dice,[1,1]);
 assert.equal(host.receive('a',message(1,'end','end-turn')).ok,true);assert.equal(host.snapshot('c').public.currentSeat,1);assert.equal(host.snapshot('c').revision,2);
});
