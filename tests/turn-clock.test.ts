import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createGame } from '../src/game/rules/state.ts';
import { HostAuthority } from '../src/game/network/authority.ts';
import { ACTION_WINDOW_MS, clockParticipants, remainingClockSeconds, timeoutCommand } from '../src/game/rules/turn-clock.ts';

test('30s host clock resets on a timed player action and ignores other players',()=>{
 let now=1000;
 const game=createGame(23,['Player 1','Player 2']);game.currentSeat=0;game.phase='action';game.turn=3;
 const host=new HostAuthority('timer-game',game,()=>0,0,()=>now);
 assert.deepEqual(host.clockStatus(),{playerId:'Player 1',remainingMs:30000});
 now+=15_000;
 assert.deepEqual(host.clockStatus(),{playerId:'Player 1',remainingMs:15000});
 assert.equal(host.touchClock('Player 2'),false,'another player cannot extend the active timer');
 assert.equal(host.touchClock('Player 1'),true);
 assert.deepEqual(host.clockStatus(),{playerId:'Player 1',remainingMs:30000});
 now+=29_999;
 assert.equal(host.advanceTimeout().handled,false);
 now+=1;
 assert.equal(host.touchClock('Player 1'),false,'expired clicks cannot delay forced progress');
 assert.deepEqual(host.advanceTimeout(),{handled:true,pending:false,playerId:'Player 1'});
 assert.equal(host.snapshot('Player 1').public.phase,'roll');
 assert.equal(host.snapshot('Player 1').public.currentSeat,1);
 assert.deepEqual(host.clockStatus(),{playerId:'Player 2',remainingMs:30000});
 assert.equal(host.currentRevision(),1);
 assert.equal(host.advanceTimeout().handled,false,'one timed-out turn advances only once');
});

test('an accepted host action refreshes 30 seconds without changing underlying game rules',()=>{
 let now=0;
 const game=createGame(23,['Player 1','Player 2']);game.currentSeat=0;game.phase='action';game.turn=1;
 const host=new HostAuthority('timer-game-two',game,()=>0,0,()=>now);
 now=27_000;
 const command={protocol:1,gameId:'timer-game-two',revision:0,commandId:'manual-1',sender:'Player 1',command:{type:'end-turn',playerId:'Player 1'}};
 assert.equal(host.receive('Player 1',JSON.stringify(command)).ok,true);
 assert.deepEqual(host.clockStatus(),{playerId:'Player 2',remainingMs:30000});
 assert.equal(host.snapshot('Player 1').revision,1);
 now=58_000;
 assert.deepEqual(host.advanceTimeout(),{handled:true,pending:false,playerId:'Player 2'});
 assert.equal(host.snapshot('Player 1').public.phase,'action','the absent roller is automatically rolled using the host reducer');
 assert.deepEqual(host.clockStatus(),{playerId:'Player 2',remainingMs:30000});
});

test('simultaneous seven discards each receive independent timers and keep hands private',()=>{
 let now=100;
 const game=createGame(4,['Player 1','Player 2']);game.phase='discard';game.currentSeat=0;game.turn=7;
 game.players[0].hand={lumber:4,brick:0,wool:0,grain:0,ore:0};
 game.players[1].hand={lumber:0,brick:4,wool:0,grain:0,ore:0};
 game.discards={'Player 1':2,'Player 2':2};
 const host=new HostAuthority('timer-discard',game,()=>0,0,()=>now);
 assert.deepEqual(clockParticipants(game),['Player 1','Player 2']);
 assert.deepEqual(host.clockStatus(),{playerId:'Player 1',remainingMs:30000});
 now+=15_000;
 assert.equal(host.touchClock('Player 1'),true);
 assert.equal(host.clockStatus()?.playerId,'Player 2','the earlier other deadline remains unchanged');
 now+=15_000;
 assert.deepEqual(host.advanceTimeout(),{handled:true,pending:true,playerId:'Player 2'});
 assert.equal(host.hasPendingDiscard('Player 2'),true);
 assert.equal(host.snapshot('Player 1').revision,0);
 assert.equal(host.clockStatus()?.playerId,'Player 1');
 now+=15_000;
 assert.deepEqual(host.advanceTimeout(),{handled:true,pending:false,playerId:'Player 1'});
 assert.equal(host.snapshot('Player 1').public.phase,'robber');
 assert.equal(host.snapshot('Player 1').revision,1);
 assert.equal(host.snapshot('Player 1').private.hand.lumber,2);
 assert.equal(host.snapshot('Player 2').private.hand.brick,2);
 assert.equal(host.spectatorSnapshot().private,null);
});

test('timeout commands progress setup, dice, robber, stealing and action phases',()=>{
 const state=createGame(8,['Player 1','Player 2']);state.currentSeat=0;
 state.phase='setup-settlement';
 assert.equal(timeoutCommand(state,'Player 1')?.type,'place-settlement');
 assert.equal(timeoutCommand(state,'Player 2'),null);
 const setup=timeoutCommand(state,'Player 1');
 assert.ok(setup&&'vertexId' in setup);
 state.phase='setup-road';
 state.pendingSettlement=setup.vertexId;
 state.buildings[setup.vertexId]={playerId:'Player 1',kind:'settlement'};
 // The road must genuinely connect to the auto-placed starting building.
 assert.equal(timeoutCommand(state,'Player 1')?.type,'place-road');
 state.phase='roll';assert.equal(timeoutCommand(state,'Player 1')?.type,'roll');
 state.phase='robber';assert.equal(timeoutCommand(state,'Player 1')?.type,'move-robber');
 state.phase='steal';state.victims=['Player 2'];
 assert.deepEqual(timeoutCommand(state,'Player 1'),{type:'steal',playerId:'Player 1',victimId:'Player 2'});
 state.phase='free-road';assert.equal(timeoutCommand(state,'Player 1')?.type,'stop-free-roads');
 state.phase='action';assert.equal(timeoutCommand(state,'Player 1')?.type,'end-turn');
 state.phase='finished';assert.deepEqual(clockParticipants(state),[]);
 assert.equal(timeoutCommand(state,'Player 1'),null);
 assert.equal(remainingClockSeconds(30_000),30);
 assert.equal(remainingClockSeconds(100),1);
 assert.equal(remainingClockSeconds(0),0);
 assert.equal(ACTION_WINDOW_MS,30_000);
});

test('the timer is on the upper-right board surface and game interactions reset it',()=>{
 const page=readFileSync('index.html','utf8'),styles=readFileSync('src/style.css','utf8');
 const ui=readFileSync('src/game-ui.ts','utf8'),session=readFileSync('src/game/network/session.ts','utf8');
 assert.ok(page.includes('id="turn-action-clock"'));
 assert.ok(page.indexOf('id="turn-action-clock"')>page.indexOf('id="board"'));
 assert.ok(styles.includes('.board-workspace .turn-action-clock{'));
 assert.ok(styles.includes('position:absolute;top:.42rem;right:.58rem'));
 assert.ok(styles.includes('pointer-events:none'));
 assert.ok(ui.includes("addEventListener('pointerdown',touchActionClock"));
 assert.ok(ui.includes("addEventListener('wheel',touchActionClock"));
 assert.ok(ui.includes("addEventListener('input',touchActionClock"));
 assert.ok(ui.includes('window.setInterval(()=>{localTimedAction();actionClockDisplay();},200)'));
 assert.ok(session.includes("if(msg.type==='activity'&&seat"));
 assert.ok(session.includes('advanceTimeout()'));
});
