import test from 'node:test';
import assert from 'node:assert/strict';
import { HostAuthority } from '../src/game/network/authority.ts';
import { createGame } from '../src/game/rules/state.ts';

test('accepted domestic trade broadcasts only participant ids and card counts',()=>{
 const state=createGame(17,['Player 1','Player 2']);
 state.phase='action';state.currentSeat=0;state.turn=2;
 state.players[0].hand={lumber:2,brick:0,wool:0,grain:0,ore:0};
 state.players[1].hand={lumber:0,brick:1,wool:0,grain:0,ore:0};
 state.offer={
  id:'offer1',
  proposer:'Player 1',
  targets:['Player 2'],
  give:{lumber:2,brick:0,wool:0,grain:0,ore:0},
  receive:{lumber:0,brick:1,wool:0,grain:0,ore:0},
 };
 const authority=new HostAuthority('game',state,()=>0);
 const command=JSON.stringify({
  protocol:1,gameId:'game',revision:0,commandId:'accept',sender:'Player 2',
  command:{type:'accept-offer',playerId:'Player 2',id:'offer1'},
 });
 assert.equal(authority.receive('Player 2',command).ok,true);
 const summary=authority.spectatorSnapshot().public.tradeSummary;
 assert.deepEqual(summary,{revision:1,proposer:'Player 1',accepter:'Player 2',giveCount:2,receiveCount:1});
 const serialized=JSON.stringify(summary);
 assert.ok(!/lumber|brick|wool|grain|ore/.test(serialized));
 assert.equal(authority.spectatorSnapshot().public.offer,null);
});
