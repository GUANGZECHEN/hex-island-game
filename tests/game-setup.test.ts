import test from 'node:test';
import assert from 'node:assert/strict';
import { createIslandBoard } from '../src/game/board/geometry.ts';
import { createGame, applySetupCommand, publicVictoryPoints, RESOURCES } from '../src/game/rules/state.ts';

for (const count of [2, 3, 4]) test(`${count}-player setup follows snake order with legal placement and conserved pieces/resources`, () => {
  let state = createGame(123, Array.from({ length: count }, (_, i) => `p${i}`));
  const initial = structuredClone(state), geometry = createIslandBoard(), order: number[] = [];
  assert.equal(state.deck.length, 25);
  assert.deepEqual(state.deck.reduce((m, x) => ({ ...m, [x]: (m[x] ?? 0) + 1 }), {} as Record<string, number>), { knight: 14, monopoly: 2, 'road-building': 2, invention: 2, 'victory-point': 5 });
  assert.throws(() => applySetupCommand(state, { type: 'place-road', playerId: state.players[state.currentSeat].id, edgeId: geometry.edges[0].id }));
  for (let step = 0; step < count * 2; step++) {
    order.push(state.currentSeat);
    const id = state.players[state.currentSeat].id;
    assert.throws(() => applySetupCommand(state, { type: 'place-settlement', playerId: 'impostor', vertexId: geometry.vertices[0].id }));
    const before = structuredClone(state);
    let placed = false;
    for (const vertex of geometry.vertices) {
      try { state = applySetupCommand(state, { type: 'place-settlement', playerId: id, vertexId: vertex.id }); placed = true; break; } catch {}
    }
    assert.ok(placed);
    for (const resource of RESOURCES) {
      const expected = step < count ? 0 : geometry.hexes.filter(hex => hex.vertexIds.includes(state.pendingSettlement!) && state.board.hexes.find(item => item.hexId === hex.id)!.resource === resource).length;
      assert.equal(state.players[state.currentSeat].hand[resource] - before.players[before.currentSeat].hand[resource], expected);
    }
    const unrelated = geometry.edges.find(edge => !edge.vertexIds.includes(state.pendingSettlement!))!;
    assert.throws(() => applySetupCommand(state, { type: 'place-road', playerId: id, edgeId: unrelated.id }));
    assert.throws(() => applySetupCommand(state, { type: 'place-settlement', playerId: id, vertexId: geometry.vertices[0].id }));
    const edge = geometry.edges.find(edge => edge.vertexIds.includes(state.pendingSettlement!) && !state.roads[edge.id])!;
    state = applySetupCommand(state, { type: 'place-road', playerId: id, edgeId: edge.id });
  }
  assert.deepEqual(order, [...Array(count)].map((_, i) => (initial.startingSeat + i) % count).concat([...Array(count)].map((_, i) => (initial.startingSeat + count - 1 - i) % count)));
  assert.equal(state.phase, 'roll'); assert.equal(state.currentSeat, initial.startingSeat);
  for (const player of state.players) { assert.equal(player.roads, 13); assert.equal(player.settlements, 3); assert.equal(publicVictoryPoints(state, player.id), 2); }
  for (const resource of RESOURCES) assert.equal(state.bank[resource] + state.players.reduce((sum, p) => sum + p.hand[resource], 0), 19);
  const positions = Object.keys(state.buildings);
  for (const edge of geometry.edges) assert.ok(!(positions.includes(edge.vertexIds[0]) && positions.includes(edge.vertexIds[1])));
  assert.deepEqual(createGame(123, initial.players.map(p => p.id)), initial);
});

test('game setup validates player counts and identity', () => {
  for (const ids of [[], ['a'], ['a', 'b', 'c', 'd', 'e'], ['a', 'a'], ['a', 'b', '']]) assert.throws(() => createGame(1, ids));
});


for (const count of [5,6]) test(`${count}-player expanded setup uses the 24-hex board and normal snake placement`,()=>{
 let state=createGame(321,Array.from({length:count},(_,i)=>`p${i}`),undefined,{boardLayout:'expanded-5-6'});
 const initial=structuredClone(state),geometry=createIslandBoard('expanded-5-6'),order:number[]=[];
 assert.equal(state.board.layout,'expanded-5-6');assert.equal(state.board.hexes.length,24);assert.equal(state.board.hexes.filter(hex=>hex.terrain==='desert').length,2);
 for(let step=0;step<count*2;step++){
  order.push(state.currentSeat);const id=state.players[state.currentSeat].id;
  const vertex=geometry.vertices.find(candidate=>{
   try{applySetupCommand(state,{type:'place-settlement',playerId:id,vertexId:candidate.id});return true;}catch{return false;}
  })!;
  state=applySetupCommand(state,{type:'place-settlement',playerId:id,vertexId:vertex.id});
  const edge=geometry.edges.find(candidate=>candidate.vertexIds.includes(state.pendingSettlement!)&&!state.roads[candidate.id])!;
  state=applySetupCommand(state,{type:'place-road',playerId:id,edgeId:edge.id});
 }
 assert.deepEqual(order,[...Array(count)].map((_,i)=>(initial.startingSeat+i)%count).concat([...Array(count)].map((_,i)=>(initial.startingSeat+count-1-i)%count)));
 assert.equal(state.phase,'roll');assert.equal(state.currentSeat,initial.startingSeat);
 for(const player of state.players){assert.equal(player.roads,13);assert.equal(player.settlements,3);assert.equal(publicVictoryPoints(state,player.id),2);}
});

test('expanded and standard player-count limits are enforced separately',()=>{
 assert.throws(()=>createGame(1,['a','b','c','d','e']));
 assert.throws(()=>createGame(1,['a','b','c','d'],undefined,{boardLayout:'expanded-5-6'}));
 assert.doesNotThrow(()=>createGame(1,['a','b','c','d','e'],undefined,{boardLayout:'expanded-5-6'}));
 assert.doesNotThrow(()=>createGame(1,['a','b','c','d','e','f'],undefined,{boardLayout:'expanded-5-6'}));
 assert.throws(()=>createGame(1,['a','b','c','d','e','f','g'],undefined,{boardLayout:'expanded-5-6'}));
});
