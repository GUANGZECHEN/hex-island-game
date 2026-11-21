import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame, RESOURCES, type GameState, type Hand} from '../src/game/rules/state.ts';
import {createIslandBoard} from '../src/game/board/geometry.ts';
import {applyHarborCommand, emptyCargo, validateHarborState} from '../src/game/rules/harbor.ts';
import {applyEconomyCommand, usesDevelopmentCards} from '../src/game/rules/economy.ts';
import {stationCost, STATION_COST} from '../src/game/rules/trade-stations.ts';
import {applyTurnCommand, diceProductionSummary} from '../src/game/rules/turn.ts';
import {HostAuthority} from '../src/game/network/authority.ts';

const size=(h:Hand)=>RESOURCES.reduce((n,r)=>n+h[r],0);
function game():GameState {const s=createGame(12,['a','b'],()=>0,{mode:'harbor-coop'});s.startingSeat=s.currentSeat=0;s.turn=1;s.phase='roll';s.setupStep=4;return s;}
function stationGame():{s:GameState;vertex:string}{
 const s=game();s.phase='action';const board=createIslandBoard();const v=board.vertices.find(x=>board.edges.filter(e=>e.vertexIds.includes(x.id)).length===3)!;
 const edges=board.edges.filter(e=>e.vertexIds.includes(v.id));s.roads[edges[0].id]='a';s.roads[edges[1].id]='b';return {s,vertex:v.id};
}
test('v3 starts with no development cards and rejects buying, playing, or impossible card state; Classic and v2 retain cards',()=>{
 const s=game();assert.equal(s.harbor!.version,3);assert.deepEqual(s.deck,[]);assert.equal(usesDevelopmentCards(s),false);validateHarborState(s);
 s.phase='action';assert.throws(()=>applyEconomyCommand(s,{type:'buy-card',playerId:'a'}),/unavailable/);
 s.players[0].cards.push({type:'knight',boughtTurn:0});assert.throws(()=>applyEconomyCommand(s,{type:'play-card',playerId:'a',card:'knight'}),/unavailable/);assert.throws(()=>validateHarborState(s),/development card/);
 for(const mutate of [(x:GameState)=>{x.phase='robber';},(x:GameState)=>{x.phase='discard';},(x:GameState)=>{x.phase='steal';},(x:GameState)=>{x.discards.a=1;},(x:GameState)=>{x.victims=['b'];},(x:GameState)=>x.deck.push('knight'),(x:GameState)=>x.playedCards.push('knight'),(x:GameState)=>{x.playedDevelopment=true;},(x:GameState)=>{x.players[0].knights=1;}]){const bad=game();mutate(bad);assert.throws(()=>validateHarborState(bad),/development card/);}
 for(const [phase,command] of [['discard',{type:'discard',playerId:'a',cards:emptyCargo()}],['robber',{type:'move-robber',playerId:'a',hexId:'bad'}],['steal',{type:'steal',playerId:'a',victimId:'b'}]] as const){const bad=game();bad.phase=phase;assert.throws(()=>applyTurnCommand(bad,command),/unavailable/);}
 const v2=game();v2.harbor!.version=2;v2.deck=['knight'];assert.equal(usesDevelopmentCards(v2),true);validateHarborState(v2);
 const classic=createGame(12,['a','b']);assert.equal(usesDevelopmentCards(classic),true);assert.equal(classic.deck.length,25);
});
test('v3 station requires exactly wool, grain and ore and v2 preserves the archived price',()=>{
 const {s,vertex}=stationGame();const p=s.players[0];p.hand={...emptyCargo(),wool:1,grain:1};assert.throws(()=>applyHarborCommand(s,{type:'harbor-build-station',playerId:'a',vertexId:vertex}),/wool, grain and ore/);
 p.hand.ore=1;const built=applyHarborCommand(s,{type:'harbor-build-station',playerId:'a',vertexId:vertex});assert.deepEqual(built.players[0].hand,emptyCargo());assert.deepEqual(stationCost(s),STATION_COST);
 const v2=stationGame();v2.s.harbor!.version=2;v2.s.players[0].hand={...emptyCargo(),lumber:1,brick:1,wool:1,grain:1};assert.equal(stationCost(v2.s).ore,0);assert.doesNotThrow(()=>applyHarborCommand(v2.s,{type:'harbor-build-station',playerId:'a',vertexId:v2.vertex}));
});
test('v3 authoritative seven awards distinct stocked types, publishes the result, and recovers without another award',()=>{
 const s=game();const draws=[2,3,0,0,0,0];let i=0;const host=new HostAuthority('v3-seven',s,()=>draws[i++],0,()=>1000);
 const result=host.receive('a',JSON.stringify({protocol:1,gameId:'v3-seven',revision:0,commandId:'roll',sender:'a',command:{type:'roll',playerId:'a'}}));assert.equal(result.ok,true);assert.equal(i,6);
 const replay=host.receive('a',JSON.stringify({protocol:1,gameId:'v3-seven',revision:1,commandId:'roll',sender:'a',command:{type:'roll',playerId:'a'}}));assert.equal(replay.code,'duplicate');assert.equal(i,6);
 const saved=host.checkpoint(),after=saved.state;assert.equal(after.phase,'action');for(const p of after.players){const gain=after.harbor!.sevenReward!.gains[p.id];assert.equal(size(gain),2);assert.equal(RESOURCES.filter(r=>gain[r]===1).length,2);}
 assert.deepEqual(diceProductionSummary(s,host.snapshot('a').public),after.harbor!.sevenReward!.gains);
 const restored=HostAuthority.fromRecovery(saved,()=>{throw new Error('recovery drew entropy');});assert.deepEqual(restored.checkpoint().state,after);
 const bad=structuredClone(saved);bad.state.harbor!.sevenReward!.gains.a.lumber=2;assert.throws(()=>HostAuthority.fromRecovery(bad,()=>0));
});
test('v3 shortage picks at most one of a type per player and prioritizes the roller',()=>{
 for(const seat of [0,1]){const s=game();s.currentSeat=seat;s.startingSeat=seat;for(const r of RESOURCES)s.bank[r]=0;s.bank.lumber=2;s.bank.brick=1;
 const values=[2,3,0,0,0];let i=0;const next=applyTurnCommand(s,{type:'roll',playerId:s.players[seat].id},()=>values[i++]);
 const first=next.harbor!.sevenReward!.gains[s.players[seat].id],second=next.harbor!.sevenReward!.gains[s.players[1-seat].id];assert.equal(size(first),2);assert.equal(size(second),1);assert.equal(first.lumber,1);assert.equal(first.brick,1);assert.equal(second.lumber,1);assert.ok(RESOURCES.every(r=>next.bank[r]>=0));validateHarborState(next);
 }
 const s=game();for(const r of RESOURCES)s.bank[r]=0;s.bank.ore=5;const v=[2,3,0,0];let i=0;const next=applyTurnCommand(s,{type:'roll',playerId:'a'},()=>v[i++]);assert.equal(size(next.harbor!.sevenReward!.gains.a),1);assert.equal(size(next.harbor!.sevenReward!.gains.b),1);assert.equal(next.bank.ore,3);
});
