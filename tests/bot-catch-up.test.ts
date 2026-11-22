import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalRoomSettings } from '../src/game/ui/local-room.ts';
import { createGame, publicVictoryPoints, RESOURCES, type GameState, type Hand } from '../src/game/rules/state.ts';
import { createIslandBoard } from '../src/game/board/geometry.ts';
import { calculateDiceProduction } from '../src/game/rules/turn.ts';
import { chooseBotCommand } from '../src/game/bot/policy.ts';
import { applyBotCommand } from '../src/game/bot/runner.ts';

const handSize=(hand:Hand)=>RESOURCES.reduce((sum,resource)=>sum+hand[resource],0);

/** Synthetic public scores isolate the threshold and bot route, rather than reproducing a full game. */
function fixture(randomState:number,hand:Hand):GameState {
 const settings=createLocalRoomSettings(24680,4,3,'classic',{catchUp:true,ships:false});
 const s=createGame(settings.seed,settings.ids,undefined,{mode:settings.mode,rules:settings.rules,boardLayout:settings.boardLayout});
 assert.equal(settings.rules.catchUp,true);
 assert.equal(s.rules?.catchUp,true);
 s.phase='roll';s.turn=12;s.currentSeat=1;s.dice=null;s.randomState=randomState;
 const vertices=createIslandBoard(s.board.layout).vertices;
 let i=0;
 for(const [seat,score] of [6,3,8,6].entries()){
  for(let n=0;n<score;n++)s.buildings[vertices[i++].id]={playerId:settings.ids[seat],kind:'settlement'};
 }
 s.players[1].hand=hand;
 assert.deepEqual(s.players.map(player=>publicVictoryPoints(s,player.id)),[6,3,8,6]);
 return s;
}

function botStep(s:GameState){
 const before=structuredClone(s);
 const command=chooseBotCommand(s,'Bot 1');
 assert.ok(command);
 assert.deepEqual(s,before,'choosing a bot command must not mutate game state');
 return {command,state:applyBotCommand(s,command)};
}

const fourCards=():Hand=>({lumber:1,brick:1,wool:1,grain:1,ore:0});

test('local bot receives exactly two catch-up resources on its own normal roll',()=>{
 const before=fixture(1,fourCards());
 const {command,state:rolled}=botStep(before);
 assert.deepEqual(command,{type:'roll',playerId:'Bot 1'});
 assert.deepEqual(rolled.dice,[2,4]);
 assert.deepEqual(calculateDiceProduction(before,6)['Bot 1'],{lumber:0,brick:0,wool:0,grain:0,ore:0});
 assert.deepEqual(rolled.catchUpReward,{turn:12,playerId:'Bot 1',gains:{lumber:0,brick:1,wool:1,grain:0,ore:0}});
 assert.deepEqual(rolled.players[1].hand,{lumber:1,brick:2,wool:2,grain:1,ore:0});
 assert.equal(handSize(rolled.players[1].hand),6);
 assert.equal(rolled.bank.brick,before.bank.brick-1);
 assert.equal(rolled.bank.wool,before.bank.wool-1);
 assert.equal(rolled.rules?.catchUp,true);
 const next=botStep(rolled);
 assert.deepEqual(next.command,{type:'end-turn',playerId:'Bot 1'});
 assert.deepEqual(next.state.players[1].hand,rolled.players[1].hand,'ending the turn must not grant the award again');
 assert.equal(next.state.catchUpReward,undefined);
});

test('local bot seven grants catch-up after determining discard obligations',()=>{
 for(const count of [4,7,8]){
  const hand=count===4?fourCards():{lumber:count,brick:0,wool:0,grain:0,ore:0};
  const before=fixture(10,hand);
  const {command,state:rolled}=botStep(before);
  assert.deepEqual(command,{type:'roll',playerId:'Bot 1'});
  assert.deepEqual(rolled.dice,[6,1]);
  assert.deepEqual(rolled.catchUpReward,{turn:12,playerId:'Bot 1',gains:{lumber:1,brick:0,wool:0,grain:1,ore:0}});
  assert.equal(handSize(rolled.players[1].hand),count+2);
  assert.equal(rolled.discards['Bot 1'],count===8?4:undefined,`discard is based on ${count} cards before the award`);
  assert.equal(rolled.bank.lumber,before.bank.lumber-1);
  assert.equal(rolled.bank.grain,before.bank.grain-1);
  const next=botStep(rolled);
  if(count===8){
   assert.equal(next.command.type,'discard');
   assert.equal(handSize(next.state.players[1].hand),count+2-4);
  }else{
   assert.equal(next.command.type,'move-robber');
   assert.deepEqual(next.state.players[1].hand,rolled.players[1].hand);
  }
  assert.deepEqual(next.state.catchUpReward,rolled.catchUpReward,'subsequent bot actions must not redraw the award');
 }
});
