import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame, RESOURCES, type GameState} from '../src/game/rules/state.ts';
import {createIslandBoard} from '../src/game/board/geometry.ts';
import {applyBuildCommand} from '../src/game/rules/build.ts';
import {applyEconomyCommand} from '../src/game/rules/economy.ts';
import {legalTargetIds} from '../src/game/rules/legal.ts';
import {applyHarborCommand} from '../src/game/rules/harbor.ts';
import {chooseBotCommand} from '../src/game/bot/policy.ts';
import {applyBotCommand} from '../src/game/bot/runner.ts';
import {HostAuthority} from '../src/game/network/authority.ts';

const geometry=createIslandBoard();
const junction=geometry.vertices.find(v=>geometry.edges.filter(e=>e.vertexIds.includes(v.id)).length===3)!;
const edges=geometry.edges.filter(e=>e.vertexIds.includes(junction.id));
function fixture():GameState {
 const s=createGame(42,['a','b'],()=>0,{mode:'harbor-coop'});
 s.phase='action';s.turn=1;s.currentSeat=0;
 for(const r of RESOURCES){s.bank[r]+=s.players[0].hand[r]-4;s.players[0].hand[r]=4;}
 return s;
}
const build=(s:GameState)=>applyBuildCommand(s,{type:'build-road',playerId:'a',edgeId:edges[1].id});

test('teammate roads or buildings alone never support a paid road in Harbor v2',()=>{
 for(const anchor of ['road','settlement','city'] as const){
  const s=fixture();if(anchor==='road')s.roads[edges[0].id]='b';else s.buildings[junction.id]={playerId:'b',kind:anchor};
  const before=structuredClone(s);assert.throws(()=>build(s),/own road or building/);
  assert.ok(!legalTargetIds(s,'a','road').includes(edges[1].id));assert.deepEqual(s,before);
 }
});

test('Harbor v2 settlements require your own road even when a partner road touches the vertex',()=>{
 for(const [seat,actor,partner] of [[0,'a','b'],[1,'b','a']] as const){
  const s=fixture();s.currentSeat=seat;s.turn=seat+1;s.roads[edges[0].id]=partner;
  const before=structuredClone(s);
  assert.throws(()=>applyBuildCommand(s,{type:'build-settlement',playerId:actor,vertexId:junction.id}),/Settlement is not connected/);
  assert.ok(!legalTargetIds(s,actor,'settlement').includes(junction.id));
  assert.deepEqual(s,before);
  s.roads[edges[1].id]=actor;
  assert.ok(legalTargetIds(s,actor,'settlement').includes(junction.id));
  const next=applyBuildCommand(s,{type:'build-settlement',playerId:actor,vertexId:junction.id});
  assert.deepEqual(next.buildings[junction.id],{playerId:actor,kind:'settlement'});
  for(const r of ['lumber','brick','wool','grain'] as const)assert.equal(next.players[seat].hand[r],s.players[seat].hand[r]-1);
 }
});
test('Host rejects forged partner-road settlements without spending cards or advancing revision',()=>{
 const s=fixture();s.roads[edges[0].id]='b';
 const host=new HostAuthority('own-settlement-test',s,()=>0),before=host.snapshot('a');
 const result=host.receive('a',JSON.stringify({protocol:1,gameId:'own-settlement-test',revision:0,commandId:'foreign-settlement',sender:'a',command:{type:'build-settlement',playerId:'a',vertexId:junction.id}}));
 assert.equal(result.code,'illegal');assert.equal(result.revision,0);assert.deepEqual(host.snapshot('a'),before);
});
test('Classic settlements require own roads while archived Harbor v1 retains shared-road support',()=>{
 const s=fixture();s.roads[edges[0].id]='b';
 const classic=structuredClone(s);classic.mode='classic';delete classic.harbor;
 assert.throws(()=>applyBuildCommand(classic,{type:'build-settlement',playerId:'a',vertexId:junction.id}),/Settlement is not connected/);
 const legacy=structuredClone(s);legacy.harbor!.version=1;
 assert.equal(applyBuildCommand(legacy,{type:'build-settlement',playerId:'a',vertexId:junction.id}).buildings[junction.id].playerId,'a');
});

test('owned road or owned settlement/city permits construction and spends exactly its cost',()=>{
 for(const anchor of ['road','settlement','city'] as const){
  const s=fixture();if(anchor==='road')s.roads[edges[0].id]='a';else s.buildings[junction.id]={playerId:'a',kind:anchor};
  assert.ok(legalTargetIds(s,'a','road').includes(edges[1].id));const next=build(s);
  assert.equal(next.roads[edges[1].id],'a');assert.equal(next.players[0].roads,s.players[0].roads-1);
  assert.equal(next.players[0].hand.lumber,s.players[0].hand.lumber-1);assert.equal(next.players[0].hand.brick,s.players[0].hand.brick-1);
 }
});
test('partner building blocks continuation at that endpoint but another own endpoint can support the road',()=>{
 const s=fixture();s.roads[edges[0].id]='a';s.buildings[junction.id]={playerId:'b',kind:'city'};
 assert.throws(()=>build(s),/own road or building/);
 const far=edges[1].vertexIds.find(v=>v!==junction.id)!;s.buildings[far]={playerId:'a',kind:'settlement'};
 assert.equal(build(s).roads[edges[1].id],'a');
});
test('Road Building applies the same owned connection test to both consecutive free roads',()=>{
 const s=fixture();s.phase='free-road';s.resumePhase='action';s.freeRoads=2;s.roads[edges[0].id]='b';
 assert.throws(()=>applyEconomyCommand(s,{type:'free-road',playerId:'a',edgeId:edges[1].id}),/own road or building/);
 assert.ok(!legalTargetIds(s,'a','road').includes(edges[1].id));s.roads[edges[0].id]='a';
 const before=structuredClone(s.players[0].hand);
 const first=applyEconomyCommand(s,{type:'free-road',playerId:'a',edgeId:edges[1].id});
 const second=applyEconomyCommand(first,{type:'free-road',playerId:'a',edgeId:edges[2].id});
 assert.equal(second.phase,'action');assert.deepEqual(second.players[0].hand,before);
 assert.equal(second.roads[edges[1].id],'a');assert.equal(second.roads[edges[2].id],'a');
});
test('road junction and station preserve personal anchors rather than lending the partner network',()=>{
 let s=fixture();s.roads[edges[0].id]='a';s.roads[edges[1].id]='b';
 s=applyHarborCommand(s,{type:'harbor-build-station',playerId:'a',vertexId:junction.id});
 assert.ok(legalTargetIds(s,'a','road').includes(edges[2].id));
 s.phase='action';s.currentSeat=1;s.turn=2;
 assert.ok(legalTargetIds(s,'b','road').includes(edges[2].id)); // Own road meets at same vertex.
 const far=edges[1].vertexIds.find(v=>v!==junction.id)!;
 const remote=geometry.edges.find(e=>e.id!==edges[1].id&&e.vertexIds.includes(far))!;
 s.currentSeat=0;s.turn=3;
 assert.throws(()=>applyBuildCommand(s,{type:'build-road',playerId:'a',edgeId:remote.id}),/own road or building/);
 assert.ok(!legalTargetIds(s,'a','road').includes(remote.id));
 const noOwn=structuredClone(s);delete noOwn.roads[edges[0].id];
 assert.ok(!legalTargetIds(noOwn,'a','road').includes(edges[2].id));
});
test('host refuses a forged partner-supported road with no revision or private resource change',()=>{
 const s=fixture();s.roads[edges[0].id]='b';const host=new HostAuthority('own-road-test',s,()=>0),before=host.snapshot('a');
 const result=host.receive('a',JSON.stringify({protocol:1,gameId:'own-road-test',revision:0,commandId:'foreign-road',sender:'a',command:{type:'build-road',playerId:'a',edgeId:edges[1].id}}));
 assert.equal(result.code,'illegal');assert.equal(result.revision,0);assert.deepEqual(host.snapshot('a'),before);
});
test('teammate Bot uses owned-road legal targets and cannot exploit a partner city',()=>{
 const s=fixture();s.phase='free-road';s.resumePhase='action';s.freeRoads=2;s.buildings[junction.id]={playerId:'b',kind:'city'};
 assert.equal(chooseBotCommand(s,'a')?.type,'stop-free-roads');
 s.buildings[junction.id]={playerId:'a',kind:'city'};
 const command=chooseBotCommand(s,'a');assert.equal(command?.type,'free-road');
 assert.doesNotThrow(()=>applyBotCommand(s,command!));
});
test('Classic retains owner-only construction and recorded Harbor v1 retains its old support rule',()=>{
 const s=fixture();s.roads[edges[0].id]='b';s.mode='classic';delete s.harbor;
 assert.throws(()=>build(s),/own road or building/);
 const legacy=fixture();legacy.harbor!.version=1;legacy.roads[edges[0].id]='b';
 assert.equal(build(legacy).roads[edges[1].id],'a');
});
