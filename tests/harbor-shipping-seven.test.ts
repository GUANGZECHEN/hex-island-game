import test from 'node:test';
import assert from 'node:assert/strict';
import { createIslandBoard } from '../src/game/board/geometry.ts';
import { createGame, RESOURCES, type GameState, type Hand } from '../src/game/rules/state.ts';
import { applyTurnCommand, calculateDiceProduction, diceProductionSummary } from '../src/game/rules/turn.ts';
import { applyEconomyCommand } from '../src/game/rules/economy.ts';
import { canShip, shippingRoute, applyHarborCommand, emptyCargo, validateHarborState } from '../src/game/rules/harbor.ts';
import { chooseBotCommand } from '../src/game/bot/policy.ts';
import { HostAuthority } from '../src/game/network/authority.ts';

const size=(hand:Hand)=>RESOURCES.reduce((n,r)=>n+hand[r],0);
function game(mode:'classic'|'harbor-coop'='harbor-coop'):GameState {
 const s=createGame(24680,['a','b'],undefined,{mode});
 s.startingSeat=s.currentSeat=0;s.turn=1;s.phase='roll';s.setupStep=4;
 s.pendingSettlement=null;return s;
}
function wallet(s:GameState,id:string,cards:Partial<Hand>):void {
 const p=s.players.find(p=>p.id===id)!;
 for(const r of RESOURCES){const next=cards[r]??0;s.bank[r]+=p.hand[r]-next;p.hand[r]=next;assert.ok(s.bank[r]>=0);}
}
function conserved(s:GameState):void {
 for(const r of RESOURCES){assert.ok(s.bank[r]>=0);assert.equal(s.bank[r]+s.players.reduce((n,p)=>n+p.hand[r],0)+(s.harbor?.orders.reduce((n,o)=>n+o.loaded[r],0)??0),19,r);}
}
function entropy(values:number[]){let calls=0;return {random:()=>{assert.ok(calls<values.length,'unexpected entropy draw');return values[calls++];},calls:()=>calls};}
function roll(s:GameState,values=[2,3,0,4]){return applyTurnCommand(s,{type:'roll',playerId:s.players[s.currentSeat].id},entropy(values).random);}
function routeFixture(){
 const s=game();s.phase='action';const port=s.board.ports[0],geometry=createIslandBoard();
 const start=geometry.vertices.find(v=>!port.vertexIds.includes(v.id)&&!geometry.edges.some(e=>e.vertexIds.includes(v.id)&&e.vertexIds.some(x=>port.vertexIds.includes(x))))!;
 s.buildings={[start.id]:{playerId:'a',kind:'settlement'}};
 const route=shippingRoute(s,'a',port.vertexIds);assert.ok(route.path.length>=2);
 for(const id of route.path)s.roads[id]='a';
 s.harbor!.orders[0].portId=port.edgeId;
 wallet(s,'a',{lumber:3,brick:3,wool:3,grain:3,ore:3});
 return {s,port,path:route.path,geometry,start:start.id};
}
function load(s:GameState){const order=s.harbor!.orders[0],r=RESOURCES.find(r=>order.demand[r]>order.loaded[r])!;return applyHarborCommand(s,{type:'harbor-load',playerId:'a',orderId:order.id,cards:{...emptyCargo(),[r]:1}});}

test('shipping: one borrowed road is rejected by the reducer, authority, hints and Bot',()=>{
 const {s,port,path}=routeFixture();assert.ok(canShip(s,'a',port.edgeId));
 s.roads[path[1]]='b';const original=structuredClone(s);
 assert.equal(canShip(s,'a',port.edgeId),false);
 const route=shippingRoute(s,'a',port.vertexIds);assert.ok(route.missing>0);
 assert.ok(route.path.every(id=>!s.roads[id]||s.roads[id]==='a'));
 assert.throws(()=>load(s),/only your own roads/);assert.deepEqual(s,original);
 assert.notEqual(chooseBotCommand(s,'a')?.type,'harbor-load');
 const host=new HostAuthority('ship-own',s,()=>0),order=s.harbor!.orders[0];
 const cards={...emptyCargo(),[RESOURCES.find(r=>order.demand[r])!]:1};
 assert.equal(host.receive('a',JSON.stringify({protocol:1,gameId:'ship-own',revision:0,commandId:'load',sender:'a',command:{type:'harbor-load',playerId:'a',orderId:order.id,cards}})).code,'illegal');
 assert.deepEqual(host.checkpoint().state,original);
});

test('shipping: completing a fully owned alternate route unlocks Load and preserves resources',()=>{
 const {s,port,path}=routeFixture();s.roads[path[1]]='b';
 const detour=shippingRoute(s,'a',port.vertexIds);assert.ok(Number.isFinite(detour.missing)&&detour.missing>0);
 for(const id of detour.path)if(!s.roads[id])s.roads[id]='a';
 assert.ok(canShip(s,'a',port.edgeId));assert.equal(shippingRoute(s,'a',port.vertexIds).missing,0);
 const done=load(s);assert.equal(size(done.harbor!.orders[0].loaded),1);conserved(done);
 assert.equal(chooseBotCommand(s,'a')?.type,'harbor-load');
});

test('shipping: station transfers do not grant borrowed-road access; receiver may use their own route',()=>{
 const {s,port,path,geometry,start}=routeFixture();const first=geometry.edges.find(e=>e.id===path[0])!;
 const junction=first.vertexIds.find(v=>v!==start)!;
 for(const id of path.slice(1))s.roads[id]='b';
 const other=geometry.edges.find(e=>e.id===path[1])!.vertexIds.find(v=>v!==junction)!;
 s.buildings[other]={playerId:'b',kind:'city'};
 s.harbor!.stations={[junction]:{vertexId:junction,builtBy:'a',lastSentTurns:{}}};
 assert.equal(canShip(s,'a',port.edgeId),false);assert.equal(canShip(s,'b',port.edgeId),true);
 const r=RESOURCES.find(r=>s.harbor!.orders[0].demand[r])!;
 let sent=applyHarborCommand(s,{type:'harbor-send',playerId:'a',recipient:'b',stationId:junction,cards:{...emptyCargo(),[r]:1}});
 assert.equal(canShip(sent,'a',port.edgeId),false);assert.throws(()=>load(sent),/own roads/);
 sent.currentSeat=1;sent.turn=2;
 const loaded=applyHarborCommand(sent,{type:'harbor-load',playerId:'b',orderId:sent.harbor!.orders[0].id,cards:{...emptyCargo(),[r]:1}});
 assert.equal(loaded.harbor!.orders[0].loaded[r],1);conserved(loaded);
});

test('shipping: own coastal house works without roads, partner house cannot be a starting point',()=>{
 const s=game(),port=s.board.ports[0];s.buildings={[port.vertexIds[0]]:{playerId:'b',kind:'city'}};
 assert.equal(canShip(s,'a',port.edgeId),false);assert.equal(canShip(s,'b',port.edgeId),true);
 s.buildings[port.vertexIds[1]]={playerId:'a',kind:'settlement'};
 assert.equal(canShip(s,'a',port.edgeId),true);assert.equal(canShip(s,'unknown',port.edgeId),false);
});

test('shipping: an enclosed harbor is unreachable, not a hint to build over the partner',()=>{
 const {s,port,geometry}=routeFixture();
 for(const e of geometry.edges)if(e.vertexIds.some(v=>port.vertexIds.includes(v)))s.roads[e.id]='b';
 assert.deepEqual(shippingRoute(s,'a',port.vertexIds),{missing:Infinity,path:[]});
 assert.equal(canShip(s,'a',port.edgeId),false);assert.notEqual(chooseBotCommand(s,'a')?.type,'harbor-load');
});

test('shipping: archived v1 retains the saved team-road behavior',()=>{
 const {s,port,path}=routeFixture();s.harbor!.version=1;for(const id of path)s.roads[id]='b';
 assert.equal(canShip(s,'a',port.edgeId),true);
 s.harbor!.version=2;assert.equal(canShip(s,'a',port.edgeId),false);
});

test('seven: both large hands gain one card, with no discard, no robber movement and immediate action phase',()=>{
 const s=game();wallet(s,'a',{lumber:9,grain:1});wallet(s,'b',{brick:10,ore:1});
 const original=structuredClone(s),next=roll(s);
 assert.deepEqual(next.dice,[3,4]);assert.equal(next.phase,'action');
 assert.deepEqual(next.discards,{});assert.deepEqual(next.victims,[]);assert.equal(next.resumePhase,null);
 assert.equal(next.board.robberHexId,s.board.robberHexId);assert.equal(next.currentSeat,s.currentSeat);
 for(let i=0;i<2;i++)assert.equal(size(next.players[i].hand),size(s.players[i].hand)+1);
 assert.deepEqual(next.harbor!.sevenReward!.gains,{a:{...emptyCargo(),lumber:1},b:{...emptyCargo(),ore:1}});
 assert.deepEqual(s,original);conserved(next);validateHarborState(next);
 assert.throws(()=>applyTurnCommand(next,{type:'move-robber',playerId:'a',hexId:next.board.hexes.find(h=>h.hexId!==next.board.robberHexId)!.hexId}));
 assert.throws(()=>applyTurnCommand(next,{type:'discard',playerId:'a',cards:{...emptyCargo(),lumber:5}}));
 assert.throws(()=>applyTurnCommand(next,{type:'roll',playerId:'a'}));
});

test('seven: rewards can match, and both seats follow the same rule when rolling',()=>{
 for(const currentSeat of [0,1]){
  const s=game();s.currentSeat=currentSeat;s.turn=currentSeat+1;
  const next=roll(s,[2,3,1,1]);
  for(const p of next.players){assert.equal(next.harbor!.sevenReward!.gains[p.id].brick,1);assert.equal(size(p.hand),5);}
  assert.equal(next.bank.brick,s.bank.brick-2);assert.equal(next.phase,'action');conserved(next);validateHarborState(next);
 }
});

test('seven: draw only stocked types, handle exhausted bank without negative cards or redraw loops',()=>{
 for(const stock of [0,1,2]){
  const s=game();s.currentSeat=1;s.turn=2;
  wallet(s,'b',{});wallet(s,'a',{lumber:19,brick:19,wool:19,grain:19,ore:19-stock});
  const next=roll(s,[2,3,...Array(stock).fill(0)]);
  assert.equal(size(next.harbor!.sevenReward!.gains.b),Math.min(stock,1));
  assert.equal(size(next.harbor!.sevenReward!.gains.a),stock===2?1:0);
  assert.equal(next.bank.ore,0);assert.equal(next.phase,'action');conserved(next);validateHarborState(next);
 }
});

test('seven: local seeded randomness is reproducible; non-seven production remains normal',()=>{
 let checked=false;
 for(let seed=0;seed<50;seed++){
  const s=game();s.randomState=seed;
  const a=applyTurnCommand(s,{type:'roll',playerId:'a'}),b=applyTurnCommand(s,{type:'roll',playerId:'a'});
  assert.deepEqual(a,b);conserved(a);
  if(a.dice![0]+a.dice![1]===7){checked=true;assert.equal(size(a.harbor!.sevenReward!.gains.a),1);assert.equal(a.phase,'action');}
  else{assert.equal(a.harbor!.sevenReward,undefined);assert.deepEqual(diceProductionSummary(s,a),calculateDiceProduction(s,a.dice![0]+a.dice![1]));}
 }
 assert.ok(checked);
});

test('seven: Classic and archived v1 still discard and move robber, never receive these rewards',()=>{
 for(const mode of ['classic','harbor-coop'] as const){
  const s=game(mode);if(s.harbor)s.harbor.version=1;
  wallet(s,'a',{lumber:9});wallet(s,'b',{brick:8});
  const e=entropy([2,3]),next=applyTurnCommand(s,{type:'roll',playerId:'a'},e.random);
  assert.equal(e.calls(),2);assert.equal(next.phase,'discard');assert.deepEqual(next.discards,{a:4,b:4});
  assert.deepEqual(next.players.map(p=>p.hand),s.players.map(p=>p.hand));assert.equal(next.harbor?.sevenReward,undefined);
 }
});

test('seven: Knight still moves robber but grants no reward, before or after the roll',()=>{
 let s=game();s.players[0].cards=[{type:'knight',boughtTurn:0}];
 const pre=applyEconomyCommand(s,{type:'play-card',playerId:'a',card:'knight'});
 assert.equal(pre.phase,'robber');assert.equal(pre.harbor!.sevenReward,undefined);assert.deepEqual(pre.players[0].hand,s.players[0].hand);
 const hex=s.board.hexes.find(h=>h.hexId!==s.board.robberHexId)!.hexId;
 const resumed=applyTurnCommand(pre,{type:'move-robber',playerId:'a',hexId:hex});assert.equal(resumed.phase,'roll');
 const seven=roll(resumed);assert.equal(seven.phase,'action');assert.equal(seven.board.robberHexId,hex);
 s=roll(s);const hands=s.players.map(p=>p.hand),bonus=structuredClone(s.harbor!.sevenReward);
 const post=applyEconomyCommand(s,{type:'play-card',playerId:'a',card:'knight'});
 assert.equal(post.phase,'robber');assert.deepEqual(post.players.map(p=>p.hand),hands);assert.deepEqual(post.harbor!.sevenReward,bonus);validateHarborState(post);
});

test('seven: public roll summary reflects only awarded cards and is copied, not recomputed from private hands',()=>{
 const s=game(),next=roll(s),host=new HostAuthority('public-bonus',next,()=>{throw Error('Must not draw');});
 const before=new HostAuthority('public-bonus',s,()=>0).spectatorSnapshot().public;
 for(const view of [host.snapshot('a'),host.snapshot('b'),host.spectatorSnapshot()]){
  assert.deepEqual(diceProductionSummary(before,view.public),next.harbor!.sevenReward!.gains);
  assert.ok(!('hand' in view.public.players[0]));assert.ok(!('randomState' in view.public));
 }
 assert.equal(host.spectatorSnapshot().private,null);
 const copied=diceProductionSummary(before,host.snapshot('a').public);copied.a.lumber=999;
 assert.equal(host.snapshot('a').public.harbor!.sevenReward!.gains.a.lumber,1);
});

test('seven: host grants exactly once and rejects replay, forged rewards and Undo; recovery never re-awards',()=>{
 const s=game(),e=entropy([2,3,0,4]),host=new HostAuthority('seven-once',s,e.random);
 const submit=(h:HostAuthority,revision:number,key:string,command:object={type:'roll'})=>h.receive('a',JSON.stringify({protocol:1,gameId:'seven-once',revision,commandId:key,sender:'a',command:{playerId:'a',...command}}));
 assert.equal(submit(host,0,'forged',{type:'roll',gains:{a:{ore:99}}}).code,'malformed');assert.equal(e.calls(),0);
 assert.equal(submit(host,0,'roll').ok,true);assert.equal(e.calls(),4);
 const saved=host.checkpoint();assert.equal(saved.state.phase,'action');assert.deepEqual(saved.pendingDiscards,{});
 assert.equal(submit(host,1,'roll').code,'duplicate');assert.equal(submit(host,0,'stale').code,'stale');
 assert.equal(submit(host,1,'second').code,'illegal');assert.equal(submit(host,1,'undo',{type:'undo'}).code,'illegal');assert.equal(e.calls(),4);
 const restored=HostAuthority.fromRecovery(saved,()=>{throw Error('Recovery must never draw rewards');});
 assert.deepEqual(restored.snapshot('a'),host.snapshot('a'));assert.deepEqual(restored.snapshot('b'),host.snapshot('b'));
 assert.equal(submit(restored,1,'after-reconnect').code,'illegal');assert.deepEqual(restored.checkpoint(),saved);
 const next=applyTurnCommand(saved.state,{type:'end-turn',playerId:'a'});assert.equal(next.harbor!.sevenReward,undefined);assert.equal(next.phase,'roll');validateHarborState(next);
});

test('seven: malformed persisted reward metadata is rejected; older snapshots without it remain recoverable',()=>{
 const next=roll(game()),saved=new HostAuthority('saved-reward',next,()=>0).checkpoint();
 for(const corrupt of [
  (s:GameState)=>{s.harbor!.sevenReward!.turn++;},
  (s:GameState)=>{s.harbor!.sevenReward!.gains.a.lumber=-1;},
  (s:GameState)=>{s.harbor!.sevenReward!.gains.a.lumber=2;},
  (s:GameState)=>{delete s.harbor!.sevenReward!.gains.b;},
  (s:GameState)=>{s.phase='discard';},
  (s:GameState)=>{s.dice=[1,1];},
 ]){const bad=structuredClone(saved);corrupt(bad.state);assert.throws(()=>HostAuthority.fromRecovery(bad,()=>0));}
 const old=structuredClone(saved);delete old.state.harbor!.sevenReward;assert.doesNotThrow(()=>HostAuthority.fromRecovery(old,()=>0));
});
