import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createGame, RESOURCES, applySetupCommand, type GameState, type Hand } from '../src/game/rules/state.ts';
import { applyTurnCommand } from '../src/game/rules/turn.ts';
import { applyBuildCommand } from '../src/game/rules/build.ts';
import { applyEconomyCommand } from '../src/game/rules/economy.ts';
import { applyHarborCommand, beginHarbor, advanceHarbor, shippingRoute, canShip, partnersConnected, emptyCargo, validateHarborState } from '../src/game/rules/harbor.ts';
import { createLocalRoomSettings } from '../src/game/ui/local-room.ts';
import { chooseBotCommand } from '../src/game/bot/policy.ts';
import { applyBotCommand } from '../src/game/bot/runner.ts';
import { HostAuthority } from '../src/game/network/authority.ts';
import { HostSession } from '../src/game/network/session.ts';
import { parseSessionRecovery } from '../src/game/network/recovery.ts';
import { createIslandBoard } from '../src/game/board/geometry.ts';

const give=(s:GameState,id:string,c:Partial<Hand>)=>{const p=s.players.find(p=>p.id===id)!;for(const r of RESOURCES){const n=c[r]??0;p.hand[r]+=n;s.bank[r]-=n;}};
// Archived v1 campaign fixtures explicitly verify saved-game compatibility.
function fixture(){
 const s=createGame(24680,['a','b'],undefined,{mode:'harbor-coop'});s.phase='action';s.turn=1;s.currentSeat=0;
 s.harbor={version:1,round:1,completed:0,missed:0,goal:6,maxMisses:3,nextOrder:0,orders:[],outcome:'playing',event:''};
 const ports=s.board.ports;s.buildings[ports[0].vertexIds[0]]={playerId:'a',kind:'settlement'};s.players[0].settlements--;
 s.buildings[ports[3].vertexIds[0]]={playerId:'b',kind:'settlement'};s.players[1].settlements--;beginHarbor(s);
 s.harbor!.orders[0].portId=ports[0].edgeId;return s;
}
function conserved(s:GameState){for(const r of RESOURCES)assert.equal(s.bank[r]+s.players.reduce((n,p)=>n+p.hand[r],0)+(s.harbor?.orders.reduce((n,o)=>n+o.loaded[r],0)??0),19,r);}

test('Harbor mode is explicitly two-player standard only; Classic and older local options remain intact',()=>{
 const a=createGame(7,['a','b']);assert.equal(a.harbor,undefined);assert.equal(a.deck.filter(x=>x==='victory-point').length,5);
 for(const n of [2,3,4])assert.equal(createGame(7,Array.from({length:n},(_,i)=>String(i))).players.length,n);
 const coop=createGame(7,['a','b'],undefined,{mode:'harbor-coop'});assert.equal(coop.harbor!.goal,10);assert.equal(coop.harbor!.orders.length,1);assert.equal(coop.deck.includes('victory-point'),false);conserved(coop);
 assert.throws(()=>createGame(7,['a','b','c'],undefined,{mode:'harbor-coop'}));assert.throws(()=>createGame(7,['a','b'],undefined,{mode:'harbor-coop',boardLayout:'expanded-5-6'}));
 assert.equal(createLocalRoomSettings(1,2,1,'harbor-coop').ids[1],'Bot');assert.equal(createLocalRoomSettings(1,2,0,'harbor-coop').totalPlayers,2);assert.throws(()=>createLocalRoomSettings(1,3,2,'harbor-coop'));
});
test('new order is visible at game start and setup does not advance its deadline',()=>{
 let state=createGame(21,['a','b'],undefined,{mode:'harbor-coop'});
 for(let i=0;i<8;i++){const c=chooseBotCommand(state,state.players[state.currentSeat].id);assert.ok(c);state=applyBotCommand(state,c);}
 assert.equal(state.phase,'roll');assert.equal(state.harbor!.orders.length,1);assert.equal(state.harbor!.round,1);assert.equal(state.harbor!.orders[0].dueRound,7);validateHarborState(state);conserved(state);
 const a=fixture(),b=fixture();assert.deepEqual(a.harbor,b.harbor);const entropy=a.randomState;advanceHarbor(a);assert.equal(a.randomState,entropy);
});
test('legacy v1: team roads connect cargo from either player; gifts require a real connected path',()=>{
 const s=fixture(),dest=s.board.ports[3];assert.equal(canShip(s,'a',dest.edgeId),false);assert.equal(partnersConnected(s,'a','b'),false);
 assert.throws(()=>applyHarborCommand(s,{type:'harbor-send',playerId:'a',recipient:'b',cards:{...emptyCargo(),lumber:1}}));
 const route=shippingRoute(s,'a',dest.vertexIds);for(const [i,e] of route.path.entries()){s.roads[e]=i%2?'a':'b';s.players[i%2?0:1].roads--;}
 assert.ok(canShip(s,'a',dest.edgeId));assert.ok(partnersConnected(s,'a','b'));
 const next=applyHarborCommand(s,{type:'harbor-send',playerId:'a',recipient:'b',cards:{...emptyCargo(),lumber:1}});assert.equal(next.players[1].hand.lumber,s.players[1].hand.lumber+1);assert.equal(s.players[0].hand.lumber,1);conserved(next);
});
test('legacy v1: partial own-hand cargo is public, conserves cards and completes/replaces one order',()=>{
 const s=fixture(),o=s.harbor!.orders[0];give(s,'a',o.demand);const resource=RESOURCES.find(r=>o.demand[r]>0)!;
 const partial=applyHarborCommand(s,{type:'harbor-load',playerId:'a',orderId:o.id,cards:{...emptyCargo(),[resource]:1}});
 assert.equal(partial.harbor!.orders[0].loaded[resource],1);assert.equal(s.harbor!.orders[0].loaded[resource],0);conserved(partial);
 const remain=Object.fromEntries(RESOURCES.map(r=>[r,o.demand[r]-partial.harbor!.orders[0].loaded[r]])) as Hand;
 const done=applyHarborCommand(partial,{type:'harbor-load',playerId:'a',orderId:o.id,cards:remain});assert.equal(done.harbor!.completed,1);assert.equal(done.harbor!.orders.length,2);assert.ok(!done.harbor!.orders.some(x=>x.id===o.id));conserved(done);
 assert.throws(()=>applyHarborCommand(s,{type:'harbor-load',playerId:'b',orderId:o.id,cards:{...emptyCargo(),grain:1}}));
 assert.throws(()=>applyHarborCommand(s,{type:'harbor-load',playerId:'a',orderId:o.id,cards:{...emptyCargo(),grain:999}}));
 assert.throws(()=>applyHarborCommand(s,{type:'harbor-load',playerId:'a',orderId:o.id,cards:{...emptyCargo(),grain:-1}}));
});
test('legacy v1: deadlines advance after a pair of turns; expiry returns cargo and 3 misses loses for both',()=>{
 let s=fixture();s.harbor!.orders[0].dueRound=1;s.harbor!.orders[1].dueRound=1;s.harbor!.missed=1;
 const o=s.harbor!.orders[0],r=RESOURCES.find(r=>o.demand[r]>0)!;give(s,'a',{[r]:1});s=applyHarborCommand(s,{type:'harbor-load',playerId:'a',orderId:o.id,cards:{...emptyCargo(),[r]:1}});
 s=applyTurnCommand(s,{type:'end-turn',playerId:'a'});assert.equal(s.harbor!.round,1);assert.equal(s.harbor!.missed,1);
 s.phase='action';s=applyTurnCommand(s,{type:'end-turn',playerId:'b'});assert.equal(s.harbor!.round,2);assert.equal(s.harbor!.missed,3);assert.equal(s.harbor!.outcome,'lost');assert.equal(s.phase,'finished');assert.equal(s.winner,null);conserved(s);
});
test('legacy v1: six supplied ships wins the team; no individual victory or teammate theft',()=>{
 const s=fixture();s.harbor!.completed=5;const o=s.harbor!.orders[0];give(s,'a',o.demand);
 const done=applyHarborCommand(s,{type:'harbor-load',playerId:'a',orderId:o.id,cards:o.demand});assert.equal(done.harbor!.outcome,'won');assert.equal(done.phase,'finished');assert.equal(done.winner,null);conserved(done);
 assert.throws(()=>applyEconomyCommand(s,{type:'claim-victory',playerId:'a'}));
 s.phase='robber';const hex=createIslandBoard().hexes.find(h=>h.id!==s.board.robberHexId)!;s.buildings[hex.vertexIds[0]]={playerId:'b',kind:'settlement'};
 const moved=applyTurnCommand(s,{type:'move-robber',playerId:'a',hexId:hex.id});assert.equal(moved.phase,'action');assert.deepEqual(moved.victims,[]);assert.deepEqual(moved.players[1].hand,s.players[1].hand);
 s.phase='action';s.turn=5;s.players[0].cards=[{type:'monopoly',boughtTurn:0}];const before=s.players[1].hand.grain;
 const card=applyEconomyCommand(s,{type:'play-card',playerId:'a',card:'monopoly',resource:'grain'});assert.equal(card.players[1].hand.grain,before);assert.equal(card.players[0].hand.grain,s.players[0].hand.grain+2);conserved(card);
});
test('network authority validates cargo ownership, serializes public orders without partner hands, and recovers',()=>{
 const s=fixture(),o=s.harbor!.orders[0];give(s,'a',o.demand);const host=new HostAuthority('harbor',s,()=>0);
 const r=RESOURCES.find(r=>o.demand[r]>0)!,cards={...emptyCargo(),[r]:1};
 const send=(sender:string,rev:number,key:string)=>host.receive(sender,JSON.stringify({protocol:1,gameId:'harbor',revision:rev,commandId:key,sender,command:{type:'harbor-load',playerId:sender,orderId:o.id,cards}}));
 assert.equal(send('b',0,'bad').ok,false);assert.equal(send('a',0,'load').ok,true);assert.equal(send('a',0,'stale').code,'stale');assert.equal(send('a',1,'load').code,'duplicate');
 const view=host.snapshot('b');assert.equal(view.public.mode,'harbor-coop');assert.ok(!('hand' in view.public.players[0]));assert.equal(host.spectatorSnapshot().private,null);
 assert.deepEqual(HostAuthority.fromRecovery(host.checkpoint(),()=>0).snapshot('b'),view);
 const saved=host.checkpoint();saved.state.harbor!.orders[0].loaded[r]=-1;assert.throws(()=>HostAuthority.fromRecovery(saved,()=>0));
});
test('host mode is lobby-synchronized, two-seat limited, and survives restart and checkpoint recovery',()=>{
 let serial=0;const messages=new Map<string,any[]>(),published:any[]=[];
 const out=(p:string,t:string)=>messages.set(p,[...(messages.get(p)??[]),JSON.parse(t)]),token=()=>String(++serial).padStart(43,'a');
 const host=new HostSession(out,x=>published.push(x),token,()=>0);
 host.setGameMode('harbor-coop');const send=(peer:string,msg:object)=>host.receive(peer,JSON.stringify({protocol:1,...msg}));
 send('b',{type:'hello'});send('c',{type:'hello'});assert.equal(host.lobby().length,2);assert.equal(host.spectatorCount(),1);
 assert.equal(messages.get('b')!.filter(m=>m.type==='lobby').at(-1).data.mode,'harbor-coop');
 host.setHostReady(true);send('b',{type:'ready',ready:true});host.start(7);assert.equal(host.recovery().authority.state.mode,'harbor-coop');
 const first=host.recovery();host.restart();assert.notEqual(host.recovery().authority.gameId,first.authority.gameId);assert.equal(host.recovery().authority.state.harbor!.completed,0);assert.equal(host.recovery().authority.state.mode,'harbor-coop');
 assert.equal(parseSessionRecovery(first).authority.state.mode,'harbor-coop');const restored=HostSession.fromRecovery(out,()=>{},token,()=>0,first);assert.equal(restored.recovery().authority.state.mode,'harbor-coop');
 send('c',{type:'command',command:'{}'});assert.equal(messages.get('c')!.at(-1).data.code,'spectator');
 assert.throws(()=>host.setGameMode('classic'));
});
test('cooperative bot ignores partner private resources and prioritizes loading its own available cargo',()=>{
 const s=fixture();const o=s.harbor!.orders[0];give(s,'a',o.demand);const move=chooseBotCommand(s,'a');assert.equal(move?.type,'harbor-load');
 const swapped=structuredClone(s);swapped.players[1].hand={lumber:10,brick:0,wool:0,grain:0,ore:0};assert.deepEqual(chooseBotCommand(swapped,'a'),move);
 const next=applyBotCommand(s,move!);assert.equal(next.harbor!.completed,1);conserved(next);
});
test('cooperative games run deterministically through setup, deadlines and an actual shared outcome',()=>{
 for(const seed of [17,42]){
  let s=createGame(seed,['a','b'],undefined,{mode:'harbor-coop'});let count=0;
  for(;count<350&&s.phase!=='finished';count++){
   const actor=Object.keys(s.discards)[0]??s.players[s.currentSeat].id,c=chooseBotCommand(s,actor);assert.ok(c,`no action in ${s.phase}`);s=applyBotCommand(s,c);conserved(s);
  }
  assert.equal(s.phase,'finished',`seed ${seed} stuck after ${count}`);assert.ok(['won','lost'].includes(s.harbor!.outcome));
 }
});
test('co-op controls do not replace classic or reintroduce coordinate selection',()=>{
 const html=readFileSync('index.html','utf8'),ui=readFileSync('src/game-ui.ts','utf8');
 for(const id of ['local-game-mode','room-game-mode','harbor-panel'])assert.ok(html.includes(`id="${id}"`));
 assert.ok(ui.includes('renderHarborPanel'));assert.ok(!ui.includes("select(targets,'Legal target'"));
});
