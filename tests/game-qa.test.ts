import test from 'node:test';
import assert from 'node:assert/strict';
import { isTwoPlayerQa } from '../src/game/network/qa.ts';
import { createGame } from '../src/game/rules/state.ts';
test('two player mode is explicitly opted in and isolated from standard games',()=>{
 for(const value of ['', '?qaPlayers=3','?qaPlayers=2&qaPlayers=2','?qaPlayers=02']) assert.equal(isTwoPlayerQa(value),false);
 assert.equal(isTwoPlayerQa('?qaPlayers=2'),true);assert.throws(()=>createGame(1,['a','b']));
 assert.equal(createGame(1,['a','b'],undefined,{qaTwoPlayers:true}).players.length,2);
 assert.throws(()=>createGame(1,['a','b','c'],undefined,{qaTwoPlayers:true}));
 for(const ids of [['a','b','c'],['a','b','c','d']])assert.equal(createGame(1,ids).players.length,ids.length);
});
