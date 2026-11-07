import test from 'node:test';
import assert from 'node:assert/strict';
import { incomingTradeView } from '../src/game/ui/trade.ts';
import type { TradeOffer } from '../src/game/rules/state.ts';

const offer:TradeOffer={
 id:'x',
 proposer:'Player 1',
 targets:['Player 2'],
 give:{lumber:2,brick:0,wool:1,grain:0,ore:0},
 receive:{lumber:0,brick:1,wool:0,grain:0,ore:1},
};

test('incoming trade is expressed from the recipient perspective',()=>{
 assert.deepEqual(incomingTradeView(offer,'Player 2'),{
  proposer:'Player 1',
  receive:[{resource:'lumber',count:2},{resource:'wool',count:1}],
  give:[{resource:'brick',count:1},{resource:'ore',count:1}],
 });
 assert.equal(incomingTradeView(offer,'Player 1'),null);
 assert.equal(incomingTradeView(offer,'Player 3'),null);
});
