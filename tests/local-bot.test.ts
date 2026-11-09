import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../src/game/rules/state.ts';
import { chooseBotCommand } from '../src/game/bot/policy.ts';
import { applyBotCommand } from '../src/game/bot/runner.ts';

test('local bot deterministically completes the full snake setup through normal reducers',()=>{
 let state=createGame(23,['Player 1','Bot']);
 let steps=0;
 while((state.phase==='setup-settlement'||state.phase==='setup-road')&&steps<20){
  const actor=state.players[state.currentSeat].id;
  const command=chooseBotCommand(state,actor);
  assert.ok(command,'expected setup command for '+actor+' in '+state.phase);
  state=applyBotCommand(state,command);
  steps++;
 }
 assert.equal(state.phase,'roll');
 assert.equal(state.setupStep,4);
 assert.equal(Object.keys(state.buildings).length,4);
 assert.equal(Object.keys(state.roads).length,4);
});

test('local bot responds to domestic offers using card counts without needing UI state',()=>{
 const state=createGame(5,['Player 1','Bot']);state.phase='action';state.currentSeat=0;state.turn=3;
 state.players[0].hand={lumber:2,brick:0,wool:0,grain:0,ore:0};
 state.players[1].hand={lumber:0,brick:1,wool:1,grain:0,ore:0};
 state.offer={id:'fair',proposer:'Player 1',targets:['Bot'],give:{lumber:2,brick:0,wool:0,grain:0,ore:0},receive:{lumber:0,brick:1,wool:0,grain:0,ore:0}};
 assert.deepEqual(chooseBotCommand(state,'Bot'),{type:'accept-offer',playerId:'Bot',id:'fair'});
 state.offer={id:'unfair',proposer:'Player 1',targets:['Bot'],give:{lumber:1,brick:0,wool:0,grain:0,ore:0},receive:{lumber:0,brick:1,wool:1,grain:0,ore:0}};
 assert.deepEqual(chooseBotCommand(state,'Bot'),{type:'reject-offer',playerId:'Bot',id:'unfair'});
});

test('deterministic bot policy can drive repeated legal turns without a second human',()=>{
 let state=createGame(77,['Player 1','Bot']);
 let commands=0;
 while(commands<220&&state.phase!=='finished'&&state.turn<8){
  const pending=Object.keys(state.discards)[0];
  const actor=pending??state.players[state.currentSeat].id;
  const command=chooseBotCommand(state,actor);
  assert.ok(command,'bot policy stalled in '+state.phase+' for '+actor);
  state=applyBotCommand(state,command);
  commands++;
 }
 assert.ok(state.turn>=8||state.phase==='finished');
 assert.ok(commands<220);
});


test('two local bots can share a three-player snake setup and advance automatically',()=>{
 let state=createGame(31,['Player 1','Bot 1','Bot 2']);
 let steps=0;
 while((state.phase==='setup-settlement'||state.phase==='setup-road')&&steps<30){
  const actor=state.players[state.currentSeat].id;
  const command=chooseBotCommand(state,actor);
  assert.ok(command,'expected setup command for '+actor+' in '+state.phase);
  state=applyBotCommand(state,command);
  steps++;
 }
 assert.equal(state.phase,'roll');
 assert.equal(state.setupStep,6);
 assert.equal(Object.keys(state.buildings).length,6);
 assert.equal(Object.keys(state.roads).length,6);
 assert.equal(state.players.length,3);
 assert.deepEqual(state.players.map(player=>player.id),['Player 1','Bot 1','Bot 2']);
});

test('both bot identities can independently answer offers and take normal turns',()=>{
 let state=createGame(41,['Player 1','Bot 1','Bot 2']);
 state.phase='action';state.currentSeat=0;state.turn=4;
 state.players[0].hand={lumber:2,brick:0,wool:0,grain:0,ore:0};
 state.players[1].hand={lumber:0,brick:1,wool:0,grain:0,ore:0};
 state.players[2].hand={lumber:0,brick:0,wool:1,grain:0,ore:0};
 state.offer={id:'bot2-offer',proposer:'Player 1',targets:['Bot 2'],give:{lumber:1,brick:0,wool:0,grain:0,ore:0},receive:{lumber:0,brick:0,wool:1,grain:0,ore:0}};
 assert.deepEqual(chooseBotCommand(state,'Bot 2'),{type:'accept-offer',playerId:'Bot 2',id:'bot2-offer'});
 state.offer=null;state.currentSeat=1;state.phase='roll';
 assert.deepEqual(chooseBotCommand(state,'Bot 1'),{type:'roll',playerId:'Bot 1'});
 state.currentSeat=2;
 assert.deepEqual(chooseBotCommand(state,'Bot 2'),{type:'roll',playerId:'Bot 2'});
});
