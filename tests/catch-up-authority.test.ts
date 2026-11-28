import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame, RESOURCES, type GameState, type Hand} from '../src/game/rules/state.ts';
import {createIslandBoard} from '../src/game/board/geometry.ts';
import {HostAuthority} from '../src/game/network/authority.ts';
import {parseSessionRecovery, type SessionRecovery} from '../src/game/network/recovery.ts';

const empty=():Hand=>({lumber:0,brick:0,wool:0,grain:0,ore:0});
const size=(hand:Hand)=>RESOURCES.reduce((sum,r)=>sum+hand[r],0);
function game(rollerCards=0):GameState {
 const s=createGame(12,['a','b','c'],()=>0,{mode:'classic',rules:{catchUp:true,ships:false}});
 s.currentSeat=0;s.startingSeat=0;s.turn=5;s.phase='roll';s.setupStep=6;
 // Four publicly visible cities give b eight points without relying on private VP cards.
 for(const v of createIslandBoard().vertices.slice(0,4))s.buildings[v.id]={playerId:'b',kind:'city'};
 s.players[0].hand.lumber=rollerCards;s.bank.lumber-=rollerCards;
 return s;
}
function send(host:HostAuthority,revision:number,commandId:string,command:Record<string,unknown>={type:'roll'}) {
 return host.receive('a',JSON.stringify({protocol:1,gameId:'catch-up',revision,commandId,sender:'a',command:{...command,playerId:'a'}}));
}

test('host owns supplement entropy, publishes actual gains without revealing hands, and never repeats an award',()=>{
 const s=game(),draws=[2,3,0,0];let calls=0;
 const host=new HostAuthority('catch-up',s,()=>{assert.ok(calls<draws.length,'unexpected entropy draw');return draws[calls++];},0,()=>1000);
 assert.equal(send(host,0,'forged',{type:'roll',gains:{ore:99}}).code,'malformed');assert.equal(calls,0);
 assert.equal(send(host,0,'roll').ok,true);assert.equal(calls,4);
 const saved=host.checkpoint(),reward=saved.state.catchUpReward!;
 assert.equal(reward.playerId,'a');assert.equal(reward.turn,s.turn);assert.equal(size(reward.gains),2);
 assert.equal(RESOURCES.filter(r=>reward.gains[r]===1).length,2);
 for(const resource of RESOURCES){assert.equal(saved.state.players[0].hand[resource]-s.players[0].hand[resource],reward.gains[resource]);assert.equal(s.bank[resource]-saved.state.bank[resource],reward.gains[resource]);}
 for(const id of ['a','b','c']){
  const view=host.snapshot(id);assert.deepEqual(view.public.catchUpReward,reward);
  assert.deepEqual(view.private!.hand,saved.state.players.find(p=>p.id===id)!.hand);
  for(const p of view.public.players){assert.ok(!('hand' in p));assert.ok(!('cards' in p));}
  assert.ok(!('randomState' in view.public));assert.ok(!('deck' in view.public));
 }
 const spectator=host.spectatorSnapshot();assert.equal(spectator.private,null);assert.deepEqual(spectator.public.catchUpReward,reward);
 // A caller may mutate their local copy without changing future public projections.
 spectator.public.catchUpReward!.gains.ore=99;assert.deepEqual(host.spectatorSnapshot().public.catchUpReward,reward);
 assert.equal(send(host,1,'roll').code,'duplicate');assert.equal(send(host,0,'stale').code,'stale');
 assert.equal(send(host,1,'again').code,'illegal');assert.equal(calls,4);assert.deepEqual(host.checkpoint(),saved);
 const restored=HostAuthority.fromRecovery(saved,()=>{throw Error('Recovery drew entropy');},()=>1000);
 assert.deepEqual(restored.snapshot('a'),host.snapshot('a'));assert.deepEqual(restored.spectatorSnapshot(),host.spectatorSnapshot());
 assert.equal(send(restored,1,'after-reconnect').code,'illegal');assert.deepEqual(restored.checkpoint(),saved);
});

test('seven locks simultaneous discard obligations to pre-supplement hands and preserves independent clocks',()=>{
 const s=game(7);s.players[1].hand.brick=8;s.bank.brick-=8;s.players[2].hand.wool=9;s.bank.wool-=9;
 const draws=[2,3,0,0];let calls=0,now=1000;
 const host=new HostAuthority('catch-up',s,()=>draws[calls++],0,()=>now);
 assert.equal(send(host,0,'roll').ok,true);
 const after=host.checkpoint();assert.equal(after.state.phase,'discard');assert.deepEqual(after.state.discards,{b:4,c:4});
 assert.equal(size(after.state.players[0].hand),9);assert.equal(calls,4);
 assert.deepEqual(Object.keys(after.clock!.remaining).sort(),['b','c']);
 now+=1000;const before=host.checkpoint();
 const cards={...empty(),brick:4};
 const submission={protocol:1,gameId:'catch-up',revision:1,commandId:'b-discard',sender:'b',command:{type:'discard',playerId:'b',cards}};
 assert.equal(host.receive('b',JSON.stringify(submission)).pending,true);
 const pending=host.checkpoint();assert.equal(pending.revision,1);assert.equal(pending.clock!.remaining.c,before.clock!.remaining.c);assert.equal('b' in pending.clock!.remaining,false);assert.deepEqual(pending.state,before.state);
 assert.equal(host.receive('b',JSON.stringify(submission)).code,'duplicate');assert.deepEqual(host.checkpoint(),pending);
 const restored=HostAuthority.fromRecovery(pending,()=>{throw Error('Recovery drew entropy');},()=>now);
 assert.deepEqual(restored.checkpoint(),pending);assert.deepEqual(restored.spectatorSnapshot().public.catchUpReward,after.state.catchUpReward);
 assert.equal(calls,4);
});


test('session recovery validates public reward metadata while accepting older saves and later legal phases',()=>{
 const s=game(),draws=[2,3,0,0];let calls=0;
 const host=new HostAuthority('catch-up',s,()=>draws[calls++]);assert.equal(send(host,0,'roll').ok,true);
 const saved:SessionRecovery={version:1,authority:host.checkpoint(),seats:[{id:'a',token:''},{id:'b',token:'a'.repeat(43)},{id:'c',token:'b'.repeat(43)}],qaTwoPlayers:false,boardLayout:'standard'};
 assert.deepEqual(parseSessionRecovery(saved),saved);
 const old=structuredClone(saved);delete old.authority.state.catchUpReward;assert.doesNotThrow(()=>parseSessionRecovery(old));
 // Post-roll game actions may alter the visible VP lead, so it cannot be re-evaluated here.
 const later=structuredClone(saved);later.authority.state.buildings={};later.authority.state.phase='free-road';assert.doesNotThrow(()=>parseSessionRecovery(later));
 const invalid:Array<(s:GameState)=>void>=[
  s=>{s.catchUpReward!.gains.lumber=-1;},s=>{s.catchUpReward!.gains.lumber=2;},
  s=>{s.catchUpReward!.gains=empty();},s=>{delete (s.catchUpReward!.gains as Partial<Hand>).ore;},
  s=>{(s.catchUpReward!.gains as Hand & {extra:number}).extra=1;},
  s=>{s.catchUpReward!.gains={lumber:1,brick:1,wool:1,grain:0,ore:0};},
  s=>{s.catchUpReward!.playerId='b';},s=>{s.catchUpReward!.turn++;},
  s=>{s.dice=null;},s=>{s.dice=[1,7];},s=>{s.phase='roll';},s=>{s.rules.catchUp=false;},
 ];
 for(const corrupt of invalid){const bad=structuredClone(saved);corrupt(bad.authority.state);assert.throws(()=>parseSessionRecovery(bad),/Invalid saved catch-up award/);}
});
