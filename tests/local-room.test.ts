import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalRoomSettings } from '../src/game/ui/local-room.ts';
import { createGame } from '../src/game/rules/state.ts';

test('local lobby maps seat/bot choice to standard or expanded board',()=>{
 for(let count=2;count<=6;count++){
  const settings=createLocalRoomSettings(24680,count,0);
  assert.equal(settings.totalPlayers,count);
  assert.equal(settings.boardLayout,count>=5?'expanded-5-6':'standard');
  assert.deepEqual(settings.ids,Array.from({length:count},(_,i)=>`Player ${i+1}`));
  assert.equal(createGame(settings.seed,settings.ids,undefined,{boardLayout:settings.boardLayout}).board.hexes.length,count>=5?24:19);
 }
 for(let botCount=1;botCount<=5;botCount++){
  const settings=createLocalRoomSettings(13579,2,botCount);
  assert.equal(settings.totalPlayers,botCount+1);
  assert.equal(settings.ids.length,botCount+1);
  assert.equal(settings.ids[0],'Player 1');
  assert.equal(settings.ids[1],botCount===1?'Bot':'Bot 1');
  assert.equal(settings.boardLayout,botCount>=4?'expanded-5-6':'standard');
 }
});
test('local room validates seed and player settings before starting',()=>{
 for(const seed of [-1,2**32,NaN,1.5])assert.throws(()=>createLocalRoomSettings(seed,3,0),/seed/i);
 for(const playerCount of [0,1,7,3.5])assert.throws(()=>createLocalRoomSettings(1,playerCount,0),/players/);
 for(const bots of [-1,6,1.5])assert.throws(()=>createLocalRoomSettings(1,3,bots),/bots/);
});
test('new local round can recreate clean initial state on same map with identical participants',()=>{
 const settings=createLocalRoomSettings(81234,5,2);
 const first=createGame(settings.seed,settings.ids,undefined,{boardLayout:settings.boardLayout});
 first.players[0].hand.brick=3;
 first.buildings['v-test']={playerId:'Player 1',kind:'settlement'};
 first.turn=8;
 const next=createGame(settings.seed,settings.ids,undefined,{boardLayout:settings.boardLayout});
 assert.deepEqual(next.board,first.board);
 assert.deepEqual(next.players.map(p=>p.id),settings.ids);
 assert.equal(next.phase,'setup-settlement');
 assert.equal(next.turn,0);
 assert.deepEqual(next.buildings,{});
 assert.equal(next.players[0].hand.brick,0);
});
