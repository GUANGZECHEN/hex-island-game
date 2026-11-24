import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, RESOURCES, type Hand } from '../src/game/rules/state.ts';
import { legalTargetIds, bankTradeRate } from '../src/game/rules/legal.ts';
import { applyEconomyCommand } from '../src/game/rules/economy.ts';
import { getActionAvailability as availability, createActionAvailabilityReader } from '../src/game/ui/action-availability.ts';
import { createIslandBoard } from '../src/game/board/geometry.ts';
import { shipActionAvailability, shipActionLabel } from '../src/game/ui/ship-action.ts';
const hand=(h:Partial<Hand>={}):Hand=>({lumber:0,brick:0,wool:0,grain:0,ore:0,...h});
const game=()=>{const s=createGame(3,['a','b','c']);s.currentSeat=0;s.phase='action';s.turn=2;s.players[0].hand=hand({lumber:5,brick:5,wool:5,grain:5,ore:5});return s;};

test('targets agree with existing legality; pieces, phase and pause disable actions',()=>{
 const s=game(), v=createIslandBoard().vertices[0].id;s.buildings[v]={playerId:'a',kind:'settlement'};
 for(const mode of ['road','settlement','city'] as const) assert.equal(availability(s,'a')[mode].enabled,legalTargetIds(s,'a',mode).length>0);
 assert.equal(availability(s,'b').road.enabled,false);
 assert.equal(availability(s,'a',{paused:true}).road.enabled,false);
 s.players[0].roads=0;assert.equal(availability(s,'a').road.enabled,false);
 s.phase='finished';assert.equal(availability(s,'a',{canUndo:true}).undo.enabled,false);
 assert.equal(availability(s,'a').roll.visible,true);
});
test('all bank pairs match reducer, rate and stock',()=>{
 const s=game(),port=s.board.ports.find(p=>p.type==='lumber')!;s.buildings[port.vertexIds[0]]={playerId:'a',kind:'settlement'};s.bank.ore=0;
 const a=availability(s,'a');assert.equal(Object.keys(a.bankTrades).length,20);
 for(const give of RESOURCES)for(const receive of RESOURCES)if(give!==receive){let legal=true;try{applyEconomyCommand(s,{type:'bank-trade',playerId:'a',give,receive,rate:bankTradeRate(s,'a',give)});}catch{legal=false;}assert.equal(a.bankTrades[`${give}:${receive}`].enabled,legal);}
});
test('development phases, ownership, purchase age, and invention bank stock',()=>{
 const s=game();s.players[0].cards=[{type:'knight',boughtTurn:1},{type:'road-building',boughtTurn:2},{type:'monopoly',boughtTurn:1},{type:'invention',boughtTurn:1}];
 assert.equal(availability(s,'a',{deckCount:0}).buyDevelopment.enabled,false);
 assert.equal(availability(s,'a',{deckCount:1}).buyDevelopment.enabled,true);
 assert.equal(availability(s,'a').knight.enabled,true);assert.equal(availability(s,'a').roadBuilding.enabled,false);
 s.bank.ore=1;assert.equal(availability(s,'a',{invention:['ore','ore']}).yearOfPlenty.enabled,false);
 assert.equal(availability(s,'a',{invention:['ore','brick']}).yearOfPlenty.enabled,true);
 s.playedDevelopment=true;assert.equal(availability(s,'a').monopoly.enabled,false);
 s.playedDevelopment=false;s.phase='roll';assert.equal(availability(s,'a').knight.enabled,true);s.phase='robber';assert.equal(availability(s,'a').knight.enabled,false);
});
test('draft discard and responses honor own holdings and off-turn exception',()=>{
 const s=game();s.phase='discard';s.discards.b=2;s.players[1].hand=hand({ore:2});
 assert.equal(availability(s,'b',{discard:hand({ore:1})}).discard.enabled,false);
 assert.equal(availability(s,'b',{discard:hand({ore:2})}).discard.enabled,true);
 assert.equal(availability(s,'b',{discard:hand({ore:2}),discardSubmitted:true}).discard.enabled,false);
 s.phase='action';s.offer={id:'x',proposer:'a',targets:['b'],give:hand({brick:1}),receive:hand({ore:2})};
 assert.equal(availability(s,'b').acceptOffer.enabled,true);assert.equal(availability(s,'b').rejectOffer.enabled,true);
 s.players[1].hand.ore=1;assert.equal(availability(s,'b').acceptOffer.enabled,false);assert.equal(availability(s,'b').rejectOffer.enabled,true);
 s.currentSeat=2;assert.equal(availability(s,'b').rejectOffer.enabled,false);
});
test('offer drafts, mode visibility and public-only queries',()=>{
 const s=game(),draft={targets:['b'],give:hand({brick:1}),receive:hand({ore:1})};
 assert.equal(availability(s,'a',{offer:draft}).offer.enabled,true);
 assert.equal(availability(s,'a',{offer:{...draft,give:hand({brick:6})}}).offer.enabled,false);
 Object.defineProperty(s.players[1],'hand',{get(){throw Error('private hand read');}});Object.defineProperty(s.players[1],'cards',{get(){throw Error('private cards read');}});
 assert.doesNotThrow(()=>availability(s,'a',{offer:draft}));
 const h=createGame(4,['a','b'],undefined,{mode:'harbor-coop'});h.currentSeat=0;h.phase='action';h.turn=2;
 let a=availability(h,'a');assert.equal(a.station.visible,true);assert.equal(a.offer.visible,false);assert.equal(a.knight.visible,false);assert.equal(a.robber.visible,false);
 h.harbor!.version=2;a=availability(h,'a');assert.equal(a.station.visible,true);assert.equal(a.knight.visible,true);assert.equal(a.robber.visible,true);
 h.harbor!.version=1;a=availability(h,'a');assert.equal(a.station.visible,false);assert.equal(a.offer.visible,true);
});

test('setup and free-road actions track available targets without paying',()=>{
 const s=game();s.phase='setup-settlement';s.players[0].hand=hand();
 assert.equal(availability(s,'a').settlement.enabled,legalTargetIds(s,'a','settlement').length>0);
 const vertex=legalTargetIds(s,'a','settlement')[0];s.buildings[vertex]={playerId:'a',kind:'settlement'};s.pendingSettlement=vertex;s.phase='setup-road';
 assert.equal(availability(s,'a').road.enabled,legalTargetIds(s,'a','road').length>0);
 s.phase='free-road';s.resumePhase='action';s.freeRoads=2;
 assert.equal(availability(s,'a').road.enabled,legalTargetIds(s,'a','road').length>0);
 assert.equal(availability(s,'a').finishFreeRoads.enabled,true);
 s.players[0].roads=0;assert.equal(availability(s,'a').road.enabled,false);assert.equal(availability(s,'a').finishFreeRoads.enabled,true);
});

test('availability calculation preserves state and undo follows context',()=>{
 const s=game(),before=structuredClone(s);
 assert.equal(availability(s,'a',{canUndo:true}).undo.enabled,true);
 assert.equal(availability(s,'a',{canUndo:true,paused:true}).undo.enabled,false);
 assert.deepEqual(s,before);
});

test('cheap phase, cost and supply gates preserve target results',()=>{
 const s=game(),v=createIslandBoard().vertices[0].id;s.buildings[v]={playerId:'a',kind:'settlement'};
 for(const phase of ['roll','discard','robber','steal','action','free-road','setup-settlement','setup-road','setup-city'] as const){
  s.phase=phase;s.freeRoads=2;s.resumePhase='action';s.pendingSettlement=v;
  for(const mode of ['road','settlement','city'] as const)assert.equal(availability(s,'a')[mode].enabled,legalTargetIds(s,'a',mode).length>0,`${phase} ${mode}`);
 }
 s.phase='action';s.players[0].hand=hand();
 for(const mode of ['road','settlement','city'] as const)assert.equal(availability(s,'a')[mode].enabled,legalTargetIds(s,'a',mode).length>0);
});

test('archived Harbor retains discard but never offers steal; undo authority can outlive turn',()=>{
 const s=createGame(4,['a','b'],undefined,{mode:'harbor-coop'});s.harbor!.version=2;s.currentSeat=0;s.phase='discard';s.discards.b=1;s.players[1].hand=hand({ore:1});
 const b=availability(s,'b',{discard:hand({ore:1}),canUndo:true});
 assert.equal(b.discard.visible,true);assert.equal(b.discard.enabled,true);assert.equal(b.steal.visible,false);assert.equal(b.undo.enabled,true);
 s.harbor!.version=1;assert.equal(availability(s,'a').steal.visible,false);
});


test('reader matches one-off queries through draft transitions and new readers see new state',()=>{
 const s=game();s.players[0].cards=[{type:'invention',boughtTurn:1}];
 const read=createActionAvailabilityReader(s,'a',{invention:['ore','ore']});
 assert.deepEqual(read(),availability(s,'a',{invention:['ore','ore']}));
 const drafts=[{offer:{targets:['b'],give:hand({brick:1}),receive:hand({ore:1})}},{offer:{targets:['b'],give:hand({brick:6}),receive:hand({ore:1})}},{invention:['ore','brick'] as const}];
 for(const draft of drafts){const selection={...draft,invention:draft.invention?[...draft.invention]:undefined};assert.deepEqual(read(selection),availability(s,'a',{invention:['ore','ore'],...selection}));}
 const next=structuredClone(s);next.phase='roll';const nextRead=createActionAvailabilityReader(next,'a');
 assert.equal(read().endTurn.enabled,true);assert.equal(nextRead().endTurn.enabled,false);assert.equal(nextRead().roll.enabled,true);
});

test('the reader reuses legal target IDs for availability and board highlights',()=>{
 const s=game();s.phase='setup-settlement';
 const read=createActionAvailabilityReader(s,'a');
 const ids=read.targetIds('settlement');
 assert.ok(ids.length>0);
 assert.deepEqual(ids,legalTargetIds(s,'a','settlement'));
 assert.equal(read().settlement.enabled,true);
 assert.strictEqual(read.targetIds('settlement'),ids);
 assert.deepEqual(createActionAvailabilityReader(s,'a',{paused:true}).targetIds('settlement'),[]);
 assert.deepEqual(createActionAvailabilityReader(s,'b').targetIds('settlement'),[]);
 const next=structuredClone(s);next.phase='robber';
 const nextRead=createActionAvailabilityReader(next,'a');
 assert.deepEqual(nextRead.targetIds('settlement'),[]);
 assert.deepEqual(nextRead.targetIds('robber'),legalTargetIds(next,'a','robber'));
});

test('Twin Capes exposes pirate moves and unlimited ships through the UI helpers',()=>{
 const s=createGame(3,['a','b','c'],undefined,{boardLayout:'twin-capes'});
 s.currentSeat=0;s.phase='action';
 s.players[0].hand=hand({lumber:2,brick:2,ore:2});
 const owned=s.board.ports[0];
 s.buildings[owned.vertexIds[0]]={playerId:'a',kind:'settlement'};
 const ship=shipActionAvailability(s,'a');
 assert.equal(ship.remaining,Infinity);
 assert.equal(ship.enabled,true);
 assert.equal(availability(s,'a').ship.enabled,true);
 assert.match(shipActionLabel(s,'a'),/^Build ship · Unlimited supply · 1 VP/);

 const occupied=s.board.ports[1].edgeId;
 s.board={...s.board,piratePortEdgeId:occupied};
 s.phase='pirate';s.resumePhase='action';
 const read=createActionAvailabilityReader(s,'a');
 assert.deepEqual(read.targetIds('pirate'),legalTargetIds(s,'a','pirate'));
 assert.ok(read.targetIds('pirate').length>0);
 assert.ok(!read.targetIds('pirate').includes(occupied));
 assert.deepEqual(read().pirate,{visible:true,enabled:true});
 assert.equal(read().robber.visible,false);
 assert.equal(read().steal.visible,false);
 assert.equal(read().ship.enabled,false);
 assert.equal(availability(s,'b').pirate.enabled,false);
 assert.equal(availability(s,'a',{paused:true}).pirate.enabled,false);
 assert.equal(availability(game(),'a').pirate.visible,false);
});

test('the pirate only removes the occupied port rate from trade availability',()=>{
 const s=createGame(3,['a','b','c'],undefined,{boardLayout:'twin-capes'});
 s.currentSeat=0;s.phase='action';
 const owned=s.board.ports.find(port=>port.type!=='generic');
 assert.ok(owned&&owned.type!=='generic');
 const give=owned.type;
 const receive=RESOURCES.find(resource=>resource!==give)!;
 s.players[0].hand=hand({[give]:2});
 s.buildings[owned.vertexIds[0]]={playerId:'a',kind:'settlement'};
 s.board={...s.board,piratePortEdgeId:owned.edgeId};
 assert.equal(availability(s,'a').bankTrades[`${give}:${receive}`].enabled,false);
 s.board={...s.board,piratePortEdgeId:s.board.ports.find(port=>port.edgeId!==owned.edgeId)!.edgeId};
 assert.equal(availability(s,'a').bankTrades[`${give}:${receive}`].enabled,true);
});
