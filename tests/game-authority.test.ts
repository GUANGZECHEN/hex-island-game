import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../src/game/rules/state.ts';
import { HostAuthority, projectSpectatorState, projectState } from '../src/game/network/authority.ts';
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


test('authority checkpoint round-trips full private state and revision',()=>{
 const state=createGame(17,['a','b','c']);state.phase='action';state.currentSeat=0;state.turn=5;state.players[0].hand.brick=3;state.players[1].cards=[{type:'knight',boughtTurn:2}];
 const host=new HostAuthority('recover1',state,()=>7,12);
 const saved=host.checkpoint();
 const restored=HostAuthority.fromRecovery(saved,()=>9);
 assert.equal(restored.currentRevision(),12);
 assert.deepEqual(restored.checkpoint(),saved);
 assert.equal(restored.snapshot('a').private.hand.brick,3);
 assert.equal(restored.snapshot('b').private.cards[0].type,'knight');
 assert.equal(restored.snapshot('c').revision,12);
});


test('spectator projection is public-only and hides private trade details',()=>{
 const state=createGame(23,['a','b']);
 state.players[0].hand.brick=2;state.players[0].cards=[{type:'monopoly',boughtTurn:1}];
 state.offer={id:'offer1',proposer:'a',targets:['b'],give:{lumber:0,brick:1,wool:0,grain:0,ore:0},receive:{lumber:1,brick:0,wool:0,grain:0,ore:0}};
 const view=projectSpectatorState(state,4,'spectate1');
 assert.equal(view.private,null);
 assert.equal(view.public.offer,null);
 assert.equal(view.public.players[0].resources,2);
 const text=JSON.stringify(view);
 assert.ok(!text.includes('monopoly'));
 assert.ok(!text.includes('randomState'));
 assert.ok(!text.includes('"brick":2'));
});

test('standard authority supports two-player games',()=>{
 const state=createGame(29,['a','b']);
 assert.equal(state.players.length,2);
 const host=new HostAuthority('twoplayer',state,()=>0);
 assert.equal(host.snapshot('a').public.players.length,2);
});

test('players may submit roll-seven discards concurrently from the same authoritative snapshot',()=>{
 const state=createGame(29,['a','b','c']);state.phase='roll';state.currentSeat=0;state.turn=3;
 state.players[1].hand.lumber=8;state.players[2].hand.brick=9;state.bank.lumber-=8;state.bank.brick-=9;
 const entropy=[2,3];const host=new HostAuthority('discard-race',state,()=>entropy.shift()??0);
 const send=(sender:string,revision:number,commandId:string,command:Record<string,unknown>)=>host.receive(sender,JSON.stringify({protocol:1,gameId:'discard-race',revision,commandId,sender,command}));
 assert.equal(send('a',0,'roll7',{type:'roll',playerId:'a'}).ok,true);
 const afterRoll=host.snapshot('a');assert.equal(afterRoll.revision,1);assert.equal(afterRoll.public.phase,'discard');assert.equal(afterRoll.public.discards.b,4);assert.equal(afterRoll.public.discards.c,4);
 const bCards={lumber:4,brick:0,wool:0,grain:0,ore:0},cCards={lumber:0,brick:4,wool:0,grain:0,ore:0};
 assert.equal(send('b',1,'discard-b',{type:'discard',playerId:'b',cards:bCards}).ok,true);
 const cResult=send('c',1,'discard-c',{type:'discard',playerId:'c',cards:cCards});
 assert.equal(cResult.ok,true);assert.equal(cResult.revision,3);
 const done=host.snapshot('a');assert.equal(done.public.phase,'robber');assert.deepEqual(done.public.discards,{});
});
