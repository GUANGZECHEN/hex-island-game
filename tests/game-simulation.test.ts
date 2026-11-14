import test from 'node:test';
import assert from 'node:assert/strict';
import { createIslandBoard } from '../src/game/board/geometry.ts';
import { applySetupCommand, createGame, RESOURCES, type GameState, type Hand } from '../src/game/rules/state.ts';
import { applyTurnCommand } from '../src/game/rules/turn.ts';
const geometry=createIslandBoard();
function check(s:GameState){
 for(const r of RESOURCES){assert.ok(s.bank[r]>=0);for(const p of s.players)assert.ok(p.hand[r]>=0);assert.equal(s.bank[r]+s.players.reduce((n,p)=>n+p.hand[r],0),19);}
 for(const p of s.players){assert.equal(p.roads+Object.values(s.roads).filter(x=>x===p.id).length,15);assert.equal(p.settlements+Object.values(s.buildings).filter(x=>x.playerId===p.id&&x.kind==='settlement').length,5);assert.equal(p.cities+Object.values(s.buildings).filter(x=>x.playerId===p.id&&x.kind==='city').length,4);}
 for(const e of geometry.edges)assert.ok(!(s.buildings[e.vertexIds[0]]&&s.buildings[e.vertexIds[1]]));
 assert.ok(geometry.hexes.some(h=>h.id===s.board.robberHexId));
 assert.equal(s.deck.length+s.players.reduce((n,p)=>n+p.cards.length,0)+s.playedCards.length,25);
}
function simulate(seed:number,n:number):GameState{
 let s=createGame(seed,Array.from({length:n},(_,i)=>`p${i}`));
 for(let step=0;step<2*n;step++){
  const actor=s.players[s.currentSeat].id;let next:GameState|undefined;
  for(const vertex of geometry.vertices){try{next=applySetupCommand(s,{type:'place-settlement',playerId:actor,vertexId:vertex.id});break;}catch{}}
  assert.ok(next);s=next;const edge=geometry.edges.find(e=>e.vertexIds.includes(s.pendingSettlement!)&&!s.roads[e.id])!;s=applySetupCommand(s,{type:'place-road',playerId:actor,edgeId:edge.id});check(s);
 }
 for(let turn=0;turn<8;turn++){
  const actor=s.players[s.currentSeat].id;assert.equal(s.phase,'roll');s=applyTurnCommand(s,{type:'roll',playerId:actor});
  if(s.phase==='discard')for(const [id,required] of Object.entries(s.discards)){const hand=s.players.find(p=>p.id===id)!.hand,cards:Hand={lumber:0,brick:0,wool:0,grain:0,ore:0};let remaining=required;for(const r of RESOURCES){cards[r]=Math.min(remaining,hand[r]);remaining-=cards[r];}s=applyTurnCommand(s,{type:'discard',playerId:id,cards});}
  if(s.phase==='robber'){const target=geometry.hexes.find(h=>h.id!==s.board.robberHexId)!;s=applyTurnCommand(s,{type:'move-robber',playerId:actor,hexId:target.id});}
  if(s.phase==='steal')s=applyTurnCommand(s,{type:'steal',playerId:actor,victimId:s.victims[0]});
  assert.equal(s.phase,'action');check(s);s=applyTurnCommand(s,{type:'end-turn',playerId:actor});check(s);
 }
 return s;
}
test('deterministic partial games preserve resources, pieces, distance and robber invariants',()=>{
 for(const count of [3,4])for(let seed=0;seed<25;seed++){const result=simulate(seed,count);assert.deepEqual(simulate(seed,count),result);}
});

test('production, construction and bank trade preserve resources and piece counts',async()=>{
 const { produce }=await import('../src/game/rules/turn.ts');
 const { applyBuildCommand }=await import('../src/game/rules/build.ts');
 const { applyEconomyCommand }=await import('../src/game/rules/economy.ts');
 let s=createGame(19,['p0','p1','p2']);s.currentSeat=0;s.phase='action';s.turn=1;
 const terrain=s.board.hexes.find(h=>h.resource==='lumber')!,hex=geometry.hexes.find(h=>h.id===terrain.hexId)!;
 s.board={...s.board,robberHexId:s.board.hexes.find(h=>h.hexId!==hex.id)!.hexId};
 const vertex=hex.vertexIds[0];s.buildings[vertex]={playerId:'p0',kind:'city'};s.players[0].cities--;
 produce(s,terrain.token!);produce(s,terrain.token!);assert.equal(s.players[0].hand.lumber,4);check(s);
 s=applyEconomyCommand(s,{type:'bank-trade',playerId:'p0',give:'lumber',receive:'brick',rate:4});assert.equal(s.players[0].hand.brick,1);check(s);
 produce(s,terrain.token!);const edge=geometry.edges.find(e=>e.vertexIds.includes(vertex))!;
 s=applyBuildCommand(s,{type:'build-road',playerId:'p0',edgeId:edge.id});assert.equal(s.roads[edge.id],'p0');check(s);
});
