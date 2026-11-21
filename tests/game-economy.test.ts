import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, type Hand } from '../src/game/rules/state.ts';
import { applyEconomyCommand } from '../src/game/rules/economy.ts';
import { applyTurnCommand } from '../src/game/rules/turn.ts';
import { createIslandBoard } from '../src/game/board/geometry.ts';
const hand=(r:Partial<Hand>={}):Hand=>({lumber:0,brick:0,wool:0,grain:0,ore:0,...r});
const game=()=>{const s=createGame(3,['a','b','c']);s.currentSeat=0;s.phase='action';s.turn=2;for(const p of s.players)p.hand=hand({brick:5,lumber:5,wool:5,grain:5,ore:5});return s;};

test('bank and owned port ratios, and unavailable bank resources',()=>{
 let s=game();s=applyEconomyCommand(s,{type:'bank-trade',playerId:'a',give:'brick',receive:'ore',rate:4});assert.equal(s.players[0].hand.brick,1);
 assert.throws(()=>applyEconomyCommand(s,{type:'bank-trade',playerId:'a',give:'wool',receive:'ore',rate:2}));
 const port=s.board.ports.find(p=>p.type==='wool')!;s.buildings[port.vertexIds[0]]={playerId:'a',kind:'settlement'};
 s=applyEconomyCommand(s,{type:'bank-trade',playerId:'a',give:'wool',receive:'ore',rate:2});assert.equal(s.players[0].hand.wool,3);
 const generic=s.board.ports.find(p=>p.type==='generic')!;s.buildings[generic.vertexIds[0]]={playerId:'a',kind:'settlement'};
 s=applyEconomyCommand(s,{type:'bank-trade',playerId:'a',give:'grain',receive:'ore',rate:3});assert.equal(s.players[0].hand.grain,2);
 s.bank.ore=0;assert.throws(()=>applyEconomyCommand(s,{type:'bank-trade',playerId:'a',give:'wool',receive:'ore',rate:2}));
});
test('domestic offers validate participants and holdings at acceptance',()=>{
 let s=game();s=applyEconomyCommand(s,{type:'offer',playerId:'a',id:'x',targets:['b','c'],give:hand({brick:2}),receive:hand({ore:1})});
 assert.throws(()=>applyEconomyCommand(s,{type:'accept-offer',playerId:'a',id:'x'}));
 assert.throws(()=>applyEconomyCommand(s,{type:'accept-offer',playerId:'b',id:'old'}));
 s.players[1].hand.ore=0;assert.throws(()=>applyEconomyCommand(s,{type:'accept-offer',playerId:'b',id:'x'}));
 s=applyEconomyCommand(s,{type:'reject-offer',playerId:'b',id:'x'});assert.deepEqual(s.offer!.targets,['c']);
 s=applyEconomyCommand(s,{type:'accept-offer',playerId:'c',id:'x'});assert.equal(s.offer,null);assert.equal(s.players[0].hand.brick,3);assert.equal(s.players[2].hand.ore,4);
});
test('card restrictions, invention, monopoly, knight, army and victory',()=>{
 let s=game();s.players[0].cards=[{type:'invention',boughtTurn:2},{type:'monopoly',boughtTurn:1},{type:'knight',boughtTurn:1}];
 assert.throws(()=>applyEconomyCommand(s,{type:'play-card',playerId:'a',card:'invention',resources:['ore','ore']}));
 s=applyEconomyCommand(s,{type:'play-card',playerId:'a',card:'monopoly',resource:'brick'});assert.equal(s.players[0].hand.brick,15);
 assert.throws(()=>applyEconomyCommand(s,{type:'play-card',playerId:'a',card:'knight'}));
 s.playedDevelopment=false;s.players[0].knights=2;s=applyEconomyCommand(s,{type:'play-card',playerId:'a',card:'knight'});assert.equal(s.armyHolder,'a');assert.equal(s.phase,'robber');
 const dest=s.board.hexes.find(h=>h.hexId!==s.board.robberHexId)!.hexId;s=applyTurnCommand(s,{type:'move-robber',playerId:'a',hexId:dest});assert.equal(s.phase,'action');
 s.playedDevelopment=false;s.turn=3;s=applyEconomyCommand(s,{type:'play-card',playerId:'a',card:'invention',resources:['ore','ore']});assert.equal(s.players[0].hand.ore,7);
 s.players[0].cards.push(...Array(8).fill(null).map(()=>({type:'victory-point' as const,boughtTurn:3})));s=applyEconomyCommand(s,{type:'claim-victory',playerId:'a'});assert.equal(s.winner,'a');assert.throws(()=>applyEconomyCommand(s,{type:'buy-card',playerId:'a'}));
});
test('development purchase and free roads enforce costs and action limits',()=>{
 let s=game();s.deck=['road-building'];s=applyEconomyCommand(s,{type:'buy-card',playerId:'a'});assert.equal(s.deck.length,0);assert.throws(()=>applyEconomyCommand(s,{type:'play-card',playerId:'a',card:'road-building'}));
 s.turn++;const vertex=createIslandBoard().vertices[0].id;s.buildings[vertex]={playerId:'a',kind:'settlement'};
 s=applyEconomyCommand(s,{type:'play-card',playerId:'a',card:'road-building'});const edge=createIslandBoard().edges.find(e=>e.vertexIds.includes(vertex))!;
 s=applyEconomyCommand(s,{type:'free-road',playerId:'a',edgeId:edge.id});assert.equal(s.players[0].roads,14);s=applyEconomyCommand(s,{type:'stop-free-roads',playerId:'a'});assert.equal(s.phase,'action');
});
test('largest army retains ties and transfers to a unique leader',()=>{
 let s=game();s.armyHolder='a';s.players[0].knights=3;s.players[1].knights=2;s.currentSeat=1;s.players[1].cards=[{type:'knight',boughtTurn:1},{type:'knight',boughtTurn:1}];
 s=applyEconomyCommand(s,{type:'play-card',playerId:'b',card:'knight'});assert.equal(s.armyHolder,'a');
 s.phase='action';s.resumePhase=null;s.playedDevelopment=false;s=applyEconomyCommand(s,{type:'play-card',playerId:'b',card:'knight'});assert.equal(s.armyHolder,'b');
});

test('trade offer IDs are safe strings and survive serialization for accept and cancel',()=>{
 const base=game();const offer=(id:unknown)=>({type:'offer' as const,playerId:'a',id:id as string,targets:['b'],give:hand({brick:1}),receive:hand({ore:1})});
 for(const id of [{}, [], '', 'x'.repeat(81), 'has space', 'bad!', 'bad.id', '\n']) assert.throws(()=>applyEconomyCommand(base,offer(id)),/Invalid offer/);
 for(const id of ['a','x'.repeat(80),'valid_1-A']) {
  const proposed=applyEconomyCommand(base,offer(id));
  const cloned=JSON.parse(JSON.stringify(proposed));
  assert.equal(applyEconomyCommand(cloned,{type:'accept-offer',playerId:'b',id}).offer,null);
  assert.equal(applyEconomyCommand(cloned,{type:'cancel-offer',playerId:'a',id}).offer,null);
 }
});
