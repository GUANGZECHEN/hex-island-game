import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame,applySetupCommand,RESOURCES,type GameState,type Hand} from '../src/game/rules/state.ts';
import {applyTurnCommand} from '../src/game/rules/turn.ts';
import {applyEconomyCommand} from '../src/game/rules/economy.ts';
import {applyBuildCommand} from '../src/game/rules/build.ts';
import {applyHarborCommand,advanceHarbor,emptyCargo,harborOrderDifficulty,validateHarborState,shippingRoute} from '../src/game/rules/harbor.ts';
import {STATION_COST,tradeStationIds,availableTradeStations} from '../src/game/rules/trade-stations.ts';
import {legalTargetIds} from '../src/game/rules/legal.ts';
import {createIslandBoard} from '../src/game/board/geometry.ts';
import {chooseBotCommand} from '../src/game/bot/policy.ts';
import {applyBotCommand} from '../src/game/bot/runner.ts';
import {HostAuthority} from '../src/game/network/authority.ts';

function conserved(s:GameState){for(const r of RESOURCES)assert.equal(s.bank[r]+s.players.reduce((n,p)=>n+p.hand[r],0)+(s.harbor?.orders.reduce((n,o)=>n+o.loaded[r],0)??0),19,r);}
function add(s:GameState,id:string,hand:Partial<Hand>){const p=s.players.find(p=>p.id===id)!;for(const r of RESOURCES){const n=hand[r]??0;p.hand[r]+=n;s.bank[r]-=n;}}
function game(seed=19){return createGame(seed,['a','b'],()=>0,{mode:'harbor-coop'});}
function finishSetup(s:GameState){for(let i=0;s.phase.startsWith('setup')&&i<20;i++){const c=chooseBotCommand(s,s.players[s.currentSeat].id);assert.ok(c);s=applyBotCommand(s,c);conserved(s);}return s;}
function junctions(){const b=createIslandBoard();return b.vertices.filter(v=>b.edges.filter(e=>e.vertexIds.includes(v.id)).length===3).slice(0,2);}
function stationFixture(){const s=game();s.phase='action';s.turn=1;s.currentSeat=0;const b=createIslandBoard();
 for(const v of junctions()){const edges=b.edges.filter(e=>e.vertexIds.includes(v.id));s.roads[edges[0].id]='a';s.roads[edges[1].id]='b';s.buildings[edges[0].vertexIds.find(id=>id!==v.id)!]={playerId:'a',kind:'settlement'};s.buildings[edges[1].vertexIds.find(id=>id!==v.id)!]={playerId:'b',kind:'city'};}
 add(s,'a',{lumber:3,brick:3,wool:3,grain:3});return s;
}

test('v2 setup is 2 settlements and 4 roads for seat 1, 2 cities and no roads for seat 2, regardless of first mover',()=>{
 for(const seed of [1,2,3,4,5,6]){
  const initial=createGame(seed,['a','b'],undefined,{mode:'harbor-coop'}),before=structuredClone(initial.harbor);
  const s=finishSetup(initial);assert.equal(s.phase,'roll');assert.equal(s.setupStep,4);assert.equal(s.turn,1);assert.deepEqual(s.harbor,before);
  assert.equal(Object.values(s.buildings).filter(p=>p.playerId==='a'&&p.kind==='settlement').length,2);
  assert.equal(Object.values(s.buildings).filter(p=>p.playerId==='b'&&p.kind==='city').length,2);
  assert.equal(Object.values(s.roads).filter(id=>id==='a').length,4);assert.equal(Object.values(s.roads).filter(id=>id==='b').length,0);
  assert.equal(s.players[0].settlements,3);assert.equal(s.players[0].roads,11);assert.equal(s.players[1].cities,2);assert.equal(s.players[1].settlements,5);
  validateHarborState(s);conserved(s);
 }
});
test('setup roads remain attached to the current settlement and first road; wrong city/settlement commands are rejected',()=>{
 let s=game();const v=legalTargetIds(s,'a','settlement')[0];s=applySetupCommand(s,{type:'place-settlement',playerId:'a',vertexId:v});
 const e=legalTargetIds(s,'a','road')[0];s=applySetupCommand(s,{type:'place-road',playerId:'a',edgeId:e});assert.equal(s.phase,'setup-road');assert.equal(s.setupStep,0);
 const invalid=createIslandBoard().edges.find(e=>!legalTargetIds(s,'a','road').includes(e.id))!.id;assert.throws(()=>applySetupCommand(s,{type:'place-road',playerId:'a',edgeId:invalid}));
 s=applySetupCommand(s,{type:'place-road',playerId:'a',edgeId:legalTargetIds(s,'a','road')[0]});assert.equal(s.phase,'setup-city');
 const city=legalTargetIds(s,'b','city')[0];assert.throws(()=>applySetupCommand(s,{type:'place-settlement',playerId:'b',vertexId:city}));
 s=applySetupCommand(s,{type:'place-city',playerId:'b',vertexId:city});assert.equal(s.phase,'setup-city');assert.equal(s.currentSeat,1);
});
test('a station requires both road colors at the exact vertex, costs settlement cards, may coexist with a building and grants no production/VP piece',()=>{
 let s=stationFixture();const v=junctions()[0].id;assert.ok(tradeStationIds(s).includes(v));
 const bad=createIslandBoard().vertices.find(x=>!tradeStationIds(s).includes(x.id))!.id;
 assert.throws(()=>applyHarborCommand(s,{type:'harbor-build-station',playerId:'a',vertexId:bad}));
 s.buildings[v]={playerId:'a',kind:'settlement'};const before=structuredClone(s);s=applyHarborCommand(s,{type:'harbor-build-station',playerId:'a',vertexId:v});
 for(const r of RESOURCES)assert.equal(s.players[0].hand[r],before.players[0].hand[r]-STATION_COST[r]);
 assert.deepEqual(s.buildings,before.buildings);assert.equal(s.players[0].settlements,before.players[0].settlements);assert.ok(s.harbor!.stations![v]);conserved(s);
 assert.throws(()=>applyHarborCommand(s,{type:'harbor-build-station',playerId:'a',vertexId:v}));
 assert.throws(()=>applyHarborCommand(s,{type:'harbor-build-station',playerId:'b',vertexId:junctions()[1].id}));
});
test('station send is exactly one card, per station per player per own turn; quota survives recovery and cannot be bypassed by offers',()=>{
 let s=stationFixture();for(const v of junctions())s=applyHarborCommand(s,{type:'harbor-build-station',playerId:'a',vertexId:v.id});
 const [v,w]=junctions().map(v=>v.id),card={...emptyCargo(),lumber:1};
 const send=(state:GameState,id='a',stationId=v,cards=card)=>applyHarborCommand(state,{type:'harbor-send',playerId:id,recipient:id==='a'?'b':'a',stationId,cards});
 assert.throws(()=>send(s,'a',v,{...card,lumber:2}));assert.throws(()=>send(s,'a','bad'));assert.throws(()=>send(s,'b'));
 s=send(s);assert.equal(availableTradeStations(s,'a').length,1);assert.throws(()=>send(s));s=send(s,'a',w);assert.equal(availableTradeStations(s,'a').length,0);conserved(s);
 const authority=new HostAuthority('station-save',s,()=>0);const restored=HostAuthority.fromRecovery(authority.checkpoint(),()=>0).checkpoint().state;assert.throws(()=>send(restored));
 assert.throws(()=>applyEconomyCommand(s,{type:'offer',playerId:'a',id:'offer',targets:['b'],give:card,receive:{...emptyCargo(),grain:1}}));
 s=applyTurnCommand(s,{type:'end-turn',playerId:'a'});s.phase='action';assert.equal(availableTradeStations(s,'b').length,2);s=send(s,'b');conserved(s);
 s=applyTurnCommand(s,{type:'end-turn',playerId:'b'});s.phase='action';assert.equal(availableTradeStations(s,'a').length,2);s=send(s);conserved(s);
});
test('authoritative station commands enforce schemas/revisions, safe station Undo, private hands and non-undoable transfers',()=>{
 const s=stationFixture(),v=junctions()[0].id,host=new HostAuthority('stations-net',s,()=>0);
 const send=(id:string,revision:number,command:any)=>host.receive('a',JSON.stringify({protocol:1,gameId:'stations-net',revision,commandId:id,sender:'a',command:{playerId:'a',...command}}));
 assert.equal(send('build',0,{type:'harbor-build-station',vertexId:v}).ok,true);assert.equal(host.snapshot('a').public.undoPlayerId,'a');
 assert.equal(send('undo',1,{type:'undo'}).ok,true);assert.deepEqual(host.snapshot('a').public.harbor!.stations,{});
 assert.equal(send('again',2,{type:'harbor-build-station',vertexId:v}).ok,true);
 const c={type:'harbor-send',recipient:'b',stationId:v,cards:{...emptyCargo(),grain:1}};
 assert.equal(send('send',3,c).ok,true);assert.equal(send('send',4,c).code,'duplicate');assert.equal(send('race',3,c).code,'stale');assert.equal(send('over',4,c).code,'illegal');assert.equal(send('undo-send',4,{type:'undo'}).ok,false);
 assert.equal(host.snapshot('b').public.undoPlayerId,null);assert.equal(host.spectatorSnapshot().private,null);assert.ok(!('hand' in host.snapshot('b').public.players[0]));
 assert.deepEqual(HostAuthority.fromRecovery(host.checkpoint(),()=>0).snapshot('a'),host.snapshot('a'));
});
test('first order is present during setup, needs two distinct resources, and deadlines/cadence use complete team rounds',()=>{
 let s=finishSetup(game());const order=s.harbor!.orders[0];assert.equal(order.arrivalRound,1);assert.equal(order.dueRound,7);assert.equal(RESOURCES.filter(r=>order.demand[r]>0).length,2);assert.equal(RESOURCES.reduce((n,r)=>n+order.demand[r],0),2);
 for(let turn=1;turn<=14;turn++){s.phase='action';s=applyTurnCommand(s,{type:'end-turn',playerId:s.players[s.currentSeat].id});const round=Math.floor(turn/2)+1;assert.equal(s.harbor!.round,round);assert.equal(s.harbor!.nextOrder,Math.floor((round-1)/3)+1);if(round<=7)assert.ok(s.harbor!.orders.some(o=>o.id===order.id));validateHarborState(s);}
 assert.equal(s.harbor!.round,8);assert.equal(s.harbor!.missed,1);assert.ok(!s.harbor!.orders.some(o=>o.id===order.id));
});
test('early delivery does not spawn a replacement; all 12 orders escalate, stop spawning, and 10 deliveries out of 12 wins',()=>{
 let s=finishSetup(game());s.phase='action';let lastQuantity=0,lastDeadline=Infinity;
 for(let n=0;n<12;n++){
  const d=harborOrderDifficulty(n);s.turn=(d.arrivalRound-1)*2+1;s.currentSeat=0;s.phase='action';advanceHarbor(s);
  const o=s.harbor!.orders.find(o=>o.id===`ship-${n+1}`)!;assert.ok(o);assert.equal(s.harbor!.nextOrder,n+1);assert.ok(d.quantity>lastQuantity);assert.ok(d.deadlineRounds<=lastDeadline);lastQuantity=d.quantity;lastDeadline=d.deadlineRounds;
  // Let the first two contracts depart; fulfill the remaining ten.
  if(n<2){for(const r of RESOURCES)s.bank[r]+=o.loaded[r];s.harbor!.orders=s.harbor!.orders.filter(x=>x.id!==o.id);s.harbor!.missed++;}
  else{const v=s.board.ports.find(p=>p.edgeId===o.portId)!.vertexIds[0];s.buildings[v]={playerId:'a',kind:'settlement'};add(s,'a',Object.fromEntries(RESOURCES.map(r=>[r,Math.max(0,o.demand[r]-s.players[0].hand[r])])));s=applyHarborCommand(s,{type:'harbor-load',playerId:'a',orderId:o.id,cards:o.demand});}
  assert.equal(s.harbor!.nextOrder,n+1);validateHarborState(s);conserved(s);
 }
 assert.equal(s.harbor!.completed,10);assert.equal(s.harbor!.outcome,'won');assert.equal(s.harbor!.nextOrder,12);advanceHarbor(s);assert.equal(s.harbor!.nextOrder,12);
});
test('third expired order loses; terminal save and old v1 save are recoverable',()=>{
 let s=finishSetup(game());for(let i=0;i<35&&s.phase!=='finished';i++){s.phase='action';s=applyTurnCommand(s,{type:'end-turn',playerId:s.players[s.currentSeat].id});}
 assert.equal(s.harbor!.outcome,'lost');assert.equal(s.harbor!.missed,3);validateHarborState(s);
 assert.doesNotThrow(()=>HostAuthority.fromRecovery(new HostAuthority('lost-stations',s,()=>0).checkpoint(),()=>0));
});
test('teammate bot builds a junction station and sends only legal spare cards without reading partner hands',()=>{
 let s=stationFixture();s.harbor!.orders=[];
 let c=chooseBotCommand(s,'a');assert.equal(c?.type,'harbor-build-station');s=applyBotCommand(s,c!);
 c=chooseBotCommand(s,'a');assert.equal(c?.type,'harbor-send');
 const privateChange=structuredClone(s);privateChange.players[1].hand={lumber:0,brick:12,wool:2,grain:0,ore:0};assert.deepEqual(chooseBotCommand(privateChange,'a'),c);
 s=applyBotCommand(s,c!);assert.equal(availableTradeStations(s,'a').length,0);
});
test('an in-progress second setup road survives the private checkpoint and public self projection',()=>{
 let s=game();s=applySetupCommand(s,{type:'place-settlement',playerId:'a',vertexId:legalTargetIds(s,'a','settlement')[0]});s=applySetupCommand(s,{type:'place-road',playerId:'a',edgeId:legalTargetIds(s,'a','road')[0]});
 const host=new HostAuthority('setup-pair',s,()=>0),saved=host.checkpoint(),restored=HostAuthority.fromRecovery(saved,()=>0);
 assert.deepEqual(restored.snapshot('a').public.setupRoadEdges,s.setupRoadEdges);
 const malformed=structuredClone(saved);delete malformed.state.setupRoadEdges;assert.throws(()=>HostAuthority.fromRecovery(malformed,()=>0));
});
