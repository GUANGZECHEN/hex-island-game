import test from 'node:test';
import assert from 'node:assert/strict';
import { createIslandBoard } from '../src/game/board/geometry.ts';
import { createGame, publicVictoryPoints, RESOURCES } from '../src/game/rules/state.ts';
import { applyBuildCommand, longestRoute, updateLongestRoute } from '../src/game/rules/build.ts';

const geometry = createIslandBoard();
const stateFor = () => { const s=createGame(2,['a','b','c']);s.currentSeat=0;s.phase='action';return s; };

test('longest route supports cycles, branches, blocked vertices, ties and transfers', () => {
  const state=stateFor(), hex=geometry.hexes.find(h=>h.id==='h:0,0')!;
  for(const edge of hex.edgeIds) state.roads[edge]='a';
  assert.equal(longestRoute(state,'a'),6); updateLongestRoute(state); assert.equal(state.longestHolder,'a');
  const branch=geometry.edges.find(e=>!hex.edgeIds.includes(e.id)&&e.vertexIds.includes(hex.vertexIds[0]))!;
  state.roads[branch.id]='a';assert.equal(longestRoute(state,'a'),7);
  state.buildings[hex.vertexIds[0]]={playerId:'b',kind:'settlement'};
  state.buildings[hex.vertexIds[3]]={playerId:'b',kind:'settlement'};
  assert.equal(longestRoute(state,'a'),3);updateLongestRoute(state);assert.equal(state.longestHolder,null);
  state.roads={}; state.buildings={};
  const forkVertex=geometry.vertices.find(v=>geometry.edges.filter(e=>e.vertexIds.includes(v.id)).length===3)!;
  const fork=geometry.edges.filter(e=>e.vertexIds.includes(forkVertex.id));for(const edge of fork)state.roads[edge.id]='a';assert.equal(longestRoute(state,'a'),2);
  state.roads={};
  const first=geometry.hexes[0], second=geometry.hexes[geometry.hexes.length-1];
  for(const id of first.edgeIds)state.roads[id]='a';for(const id of second.edgeIds)state.roads[id]='b';
  updateLongestRoute(state);assert.equal(state.longestHolder,null);
  state.longestHolder='a';updateLongestRoute(state);assert.equal(state.longestHolder,'a');
  delete state.roads[first.edgeIds[0]];updateLongestRoute(state);assert.equal(state.longestHolder,'b');
});

test('building pays bank, uses supplies, connects and respects opponents', () => {
  let s=stateFor();const hex=geometry.hexes.find(h=>h.id==='h:0,0')!,vertex=hex.vertexIds[0], edge=geometry.edges.find(e=>e.vertexIds.includes(vertex))!;
  s.buildings[vertex]={playerId:'a',kind:'settlement'};s.players[0].settlements--;
  for(const r of RESOURCES){s.players[0].hand[r]=5;s.bank[r]-=5;}
  assert.throws(()=>applyBuildCommand(s,{type:'build-road',playerId:'a',edgeId:edge.id,free:true}));
  s=applyBuildCommand(s,{type:'build-road',playerId:'a',edgeId:edge.id});assert.equal(s.players[0].roads,14);assert.equal(s.players[0].hand.brick,4);
  const next=edge.vertexIds.find(v=>v!==vertex)!;
  assert.throws(()=>applyBuildCommand(s,{type:'build-settlement',playerId:'a',vertexId:next}));
  s=applyBuildCommand(s,{type:'build-city',playerId:'a',vertexId:vertex});assert.equal(s.players[0].cities,3);assert.equal(s.players[0].settlements,5);assert.equal(publicVictoryPoints(s,'a'),2);
  for(const r of RESOURCES)assert.equal(s.bank[r]+s.players.reduce((sum,p)=>sum+p.hand[r],0),19);
  const empty=geometry.edges.find(e=>e.vertexIds.includes(next)&&e.id!==edge.id)!;
  s.buildings[next]={playerId:'b',kind:'settlement'};
  assert.throws(()=>applyBuildCommand(s,{type:'build-road',playerId:'a',edgeId:empty.id}));
});
