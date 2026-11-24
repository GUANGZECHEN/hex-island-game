import test from 'node:test';
import assert from 'node:assert/strict';
import type { GameState } from '../src/game/rules/state.ts';
import { logRollPayout, ownPayoutLabel, type GameLogEntry } from '../src/game/ui/roll-payout.ts';

test('a roll logs the authoritative gain for every seat once across pass, redraw and reconnect',()=>{
 const players=[{id:'a'},{id:'b'},{id:'c'}];
 const names:Record<string,string>={a:'Ada',b:'Bea',c:'Cam'};
 const receipt:NonNullable<GameState['lastRollPayout']>={turn:4,playerId:'a',dice:[3,5],gains:{a:0,b:2,c:1}};
 const log:GameLogEntry[]=[];
 const record=(p:typeof receipt|null)=>logRollPayout(log,p,players,id=>names[id]);
 record(null);record(receipt);record(structuredClone(receipt));
 assert.deepEqual(log,[{rollTurn:4,text:'Turn 4 · Roll 8 · Ada +0, Bea +2, Cam +1'}]);
 assert.equal(ownPayoutLabel(receipt,'a'),'Roll 8 · You gained 0 resources.');
 assert.equal(ownPayoutLabel(receipt,'b'),'Roll 8 · You gained 2 resources.');
 assert.equal(ownPayoutLabel(receipt,'c'),'Roll 8 · You gained 1 resource.');
 record({...receipt,turn:5,playerId:'b'});
 assert.equal(log.length,2,'the same dice pair rolled on another turn has its own entry');
});
