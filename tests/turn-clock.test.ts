import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../src/game/rules/state.ts';
import { HostAuthority } from '../src/game/network/authority.ts';
import { ACTION_WINDOW_MS, clockParticipants, effectiveActionResetActors, remainingClockSeconds, timeoutCommand } from '../src/game/rules/turn-clock.ts';

function send(host:HostAuthority,gameId:string,playerId:string,revision:number,id:string,command:Record<string,unknown>){
 return host.receive(playerId,JSON.stringify({protocol:1,gameId,revision,commandId:id,sender:playerId,command:{...command,playerId}}));
}

test('effective actions reset the 45-second deadline; stale and illegal commands do not',()=>{
 let now=1000;const state=createGame(23,['Player 1','Player 2']);state.phase='roll';state.currentSeat=0;
 const host=new HostAuthority('clock',state,()=>0,0,()=>now);
 now+=10_000;
 assert.equal(send(host,'clock','Player 1',1,'stale',{type:'roll'}).code,'stale');
 assert.equal(send(host,'clock','Player 1',0,'illegal',{type:'end-turn'}).code,'illegal');
 assert.equal(host.clockStatus()?.remainingMs,35_000);
 assert.equal(send(host,'clock','Player 1',0,'roll',{type:'roll'}).ok,true);
 assert.deepEqual(host.clockStatus(),{playerId:'Player 1',remainingMs:45_000,paused:false});
 now+=4_000;
 assert.equal(send(host,'clock','Player 1',1,'roll',{type:'roll'}).code,'duplicate');
 assert.equal(host.clockStatus()?.remainingMs,41_000);
});

test('pause freezes all deadlines and rejects commands and timeouts through recovery',()=>{
 let now=100;const state=createGame(4,['Player 1','Player 2']);state.phase='discard';state.currentSeat=0;
 state.players[0].hand={lumber:4,brick:0,wool:0,grain:0,ore:0};state.players[1].hand={lumber:0,brick:4,wool:0,grain:0,ore:0};state.discards={'Player 1':2,'Player 2':2};
 const host=new HostAuthority('pause',state,()=>0,0,()=>now);now+=12_345;
 assert.equal(host.setPaused(true),true);assert.equal(host.snapshot('Player 1').public.paused,true);
 now+=900_000;assert.equal(host.clockStatus()?.remainingMs,32_655);assert.equal(host.advanceTimeout().handled,false);
 assert.equal(send(host,'pause','Player 1',0,'blocked',{type:'discard',cards:{lumber:2,brick:0,wool:0,grain:0,ore:0}}).code,'paused');
 const saved=host.checkpoint();const recovered=HostAuthority.fromRecovery(saved,()=>0,()=>now);
 assert.equal(recovered.clockStatus()?.remainingMs,32_655);assert.equal(recovered.setPaused(false),true);
 now+=32_654;assert.equal(recovered.advanceTimeout().handled,false);now++;
 assert.deepEqual(recovered.advanceTimeout(),{handled:true,pending:true,playerId:'Player 1'});
 assert.equal(recovered.clockStatus()?.remainingMs,0,'the second discard retains its own deadline');
 assert.deepEqual(recovered.advanceTimeout(),{handled:true,pending:false,playerId:'Player 2'});
 assert.equal(recovered.clockStatus()?.remainingMs,45_000);
 assert.equal(recovered.snapshot('Player 1').private.hand.lumber,2);
 assert.equal(recovered.snapshot('Player 2').private.hand.brick,2);
 assert.equal(recovered.spectatorSnapshot().private,null);
});

test('trade proposals and undo do not reset clocks while completed trades reset the proposer',()=>{
 let now=0;const state=createGame(23,['Player 1','Player 2']);state.phase='action';state.currentSeat=0;state.turn=3;
 state.players[0].hand.lumber=3;state.players[1].hand.brick=3;
 const host=new HostAuthority('trade',state,()=>0,0,()=>now);now=10_000;
 const offer={type:'offer',id:'offer1',targets:['Player 2'],give:{lumber:1,brick:0,wool:0,grain:0,ore:0},receive:{lumber:0,brick:1,wool:0,grain:0,ore:0}};
 assert.equal(send(host,'trade','Player 1',0,'offer',offer).ok,true);assert.equal(host.clockStatus()?.remainingMs,35_000);
 now=20_000;assert.equal(send(host,'trade','Player 2',1,'accept',{type:'accept-offer',id:'offer1'}).ok,true);
 assert.equal(host.clockStatus()?.remainingMs,45_000);
 assert.deepEqual(effectiveActionResetActors(state,{type:'undo',playerId:'Player 1'}),[]);
});

test('timeout choices and clock bounds',()=>{
 const state=createGame(8,['Player 1','Player 2']);state.currentSeat=0;state.phase='roll';
 assert.equal(timeoutCommand(state,'Player 1')?.type,'roll');assert.equal(timeoutCommand(state,'Player 2'),null);
 state.phase='finished';assert.deepEqual(clockParticipants(state),[]);assert.equal(timeoutCommand(state,'Player 1'),null);
 const host=new HostAuthority('finished',state,()=>0);assert.equal(host.setPaused(true),false);
 assert.equal(remainingClockSeconds(99_000),45);assert.equal(remainingClockSeconds(100),1);assert.equal(ACTION_WINDOW_MS,45_000);
});

test('cancel and rejection do not extend clocks; bank trade resets and undo restores prior deadline',()=>{
 let now=0;const state=createGame(23,['Player 1','Player 2']);state.phase='action';state.currentSeat=0;state.turn=3;state.players[0].hand.lumber=8;
 const host=new HostAuthority('undo-clock',state,()=>0,0,()=>now);
 const offer={type:'offer',id:'o',targets:['Player 2'],give:{lumber:1,brick:0,wool:0,grain:0,ore:0},receive:{lumber:0,brick:1,wool:0,grain:0,ore:0}};
 now=5_000;assert.equal(send(host,'undo-clock','Player 1',0,'o1',offer).ok,true);
 now=10_000;assert.equal(send(host,'undo-clock','Player 2',1,'reject',{type:'reject-offer',id:'o'}).ok,true);
 now=15_000;assert.equal(send(host,'undo-clock','Player 1',2,'o2',offer).ok,true);
 now=20_000;assert.equal(send(host,'undo-clock','Player 1',3,'cancel',{type:'cancel-offer',id:'o'}).ok,true);assert.equal(host.clockStatus()?.remainingMs,25_000);
 now=25_000;assert.equal(send(host,'undo-clock','Player 1',4,'bank',{type:'bank-trade',give:'lumber',receive:'ore',rate:4}).ok,true);assert.equal(host.clockStatus()?.remainingMs,45_000);
 now=30_000;assert.equal(send(host,'undo-clock','Player 1',5,'undo',{type:'undo'}).ok,true);assert.equal(host.clockStatus()?.remainingMs,15_000);
});

test('repeated pause cycles preserve exact remaining time',()=>{
 let now=0;const state=createGame(4,['Player 1','Player 2']);state.phase='action';state.currentSeat=0;
 const host=new HostAuthority('repeat',state,()=>0,0,()=>now);
 now=1001;assert.equal(host.setPaused(true),true);now=90_000;assert.equal(host.setPaused(false),true);
 now+=777;assert.equal(host.setPaused(true),true);now+=200_000;assert.equal(host.clockStatus()?.remainingMs,43_222);
 assert.equal(host.setPaused(false),true);assert.equal(host.clockStatus()?.remainingMs,43_222);
});

test('timeout choices cover setup, robber, steal and free roads',()=>{
 const state=createGame(8,['Player 1','Player 2']);state.currentSeat=0;state.phase='setup-settlement';
 const setup=timeoutCommand(state,'Player 1');assert.ok(setup&&'vertexId' in setup);assert.equal(setup.type,'place-settlement');
 state.phase='setup-road';state.pendingSettlement=setup.vertexId;state.buildings[setup.vertexId]={playerId:'Player 1',kind:'settlement'};
 assert.equal(timeoutCommand(state,'Player 1')?.type,'place-road');state.phase='setup-city';assert.equal(timeoutCommand(state,'Player 2'),null);
 state.phase='robber';assert.equal(timeoutCommand(state,'Player 1')?.type,'move-robber');state.phase='steal';state.victims=['Player 2'];
 assert.deepEqual(timeoutCommand(state,'Player 1'),{type:'steal',playerId:'Player 1',victimId:'Player 2'});
 state.phase='free-road';assert.equal(timeoutCommand(state,'Player 1')?.type,'stop-free-roads');state.phase='action';assert.equal(timeoutCommand(state,'Player 1')?.type,'end-turn');
});

test('successful setup placement resets time, undo restores time before placement',()=>{
 let now=0;const state=createGame(8,['Player 1','Player 2']);state.currentSeat=0;state.phase='setup-settlement';
 const host=new HostAuthority('setup-clock',state,()=>0,0,()=>now),command=timeoutCommand(state,'Player 1');assert.ok(command&&'vertexId' in command);
 now=10_000;assert.equal(send(host,'setup-clock','Player 1',0,'build',command).ok,true);assert.equal(host.clockStatus()?.remainingMs,45_000);
 now=20_000;assert.equal(send(host,'setup-clock','Player 1',1,'undo',{type:'undo'}).ok,true);assert.equal(host.clockStatus()?.remainingMs,25_000);
});
