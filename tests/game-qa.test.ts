import test from 'node:test';
import assert from 'node:assert/strict';
import { isTwoPlayerQa } from '../src/game/network/qa.ts';
import { createGame } from '../src/game/rules/state.ts';

test('two-player QA query selects the automated scenario while standard games support 2-4 players',()=>{
 for(const value of ['', '?qaPlayers=3','?qaPlayers=2&qaPlayers=2','?qaPlayers=02']) assert.equal(isTwoPlayerQa(value),false);
 assert.equal(isTwoPlayerQa('?qaPlayers=2'),true);
 for(const ids of [['a','b'],['a','b','c'],['a','b','c','d']])assert.equal(createGame(1,ids).players.length,ids.length);
 assert.equal(createGame(1,['a','b'],undefined,{qaTwoPlayers:true}).players.length,2);
});
