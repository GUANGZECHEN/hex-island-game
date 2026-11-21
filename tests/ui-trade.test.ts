import test from 'node:test';
import assert from 'node:assert/strict';
import { ALL_OTHER_PLAYERS, incomingTradeView, tradeTargetsForSelection } from '../src/game/ui/trade.ts';
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
  isBroadcast:false,
  recipientCount:1,
 });
 assert.equal(incomingTradeView(offer,'Player 1'),null);
 assert.equal(incomingTradeView(offer,'Player 3'),null);
});

test('all-other-player selection expands to every opponent and named offers remain targeted',()=>{
 const players=['Player 1','Player 2','Player 3','Player 4'];
 assert.deepEqual(tradeTargetsForSelection(ALL_OTHER_PLAYERS,players,'Player 1'),['Player 2','Player 3','Player 4']);
 assert.deepEqual(tradeTargetsForSelection('Player 3',players,'Player 1'),['Player 3']);
 assert.deepEqual(tradeTargetsForSelection('Player 1',players,'Player 1'),[]);
 assert.deepEqual(tradeTargetsForSelection('Unknown',players,'Player 1'),[]);
});
test('broadcast incoming offers tell every recipient that the first acceptance wins',()=>{
 const broadcast={...offer,targets:['Player 2','Player 3','Player 4']};
 const view=incomingTradeView(broadcast,'Player 3');
 assert.ok(view);
 assert.equal(view.isBroadcast,true);
 assert.equal(view.recipientCount,3);
 assert.equal(incomingTradeView(broadcast,'Player 1'),null);
});
