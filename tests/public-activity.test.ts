import test from 'node:test';
import assert from 'node:assert/strict';
import { derivePublicActivity, turnAnnouncement, type PublicActivityState } from '../src/game/ui/activity.ts';

const base=():PublicActivityState=>({
  players:[{id:'Player 1',resources:4},{id:'Player 2',resources:5},{id:'Player 3',resources:3}],
  currentSeat:0,turn:3,phase:'roll',dice:null,victims:[],
  board:{robberHexId:'h0'},roads:{},buildings:{},playedCards:[],
});

test('public activity announces dice, robber and theft without revealing resource identity',()=>{
  const a=base();
  const rolled={...a,phase:'robber',dice:[1,2] as [number,number]};
  assert.equal(derivePublicActivity(a,rolled),'Player 1 rolled dice: 1 + 2 = 3.');

  const moved={...rolled,phase:'steal',victims:['Player 2'],board:{robberHexId:'h1'}};
  assert.equal(derivePublicActivity(rolled,moved),'Player 1 moved the robber.');

  const stolen={...moved,phase:'action',victims:[],players:[{id:'Player 1',resources:5},{id:'Player 2',resources:4},{id:'Player 3',resources:3}]};
  assert.equal(derivePublicActivity(moved,stolen),'Player 1 stole 1 card from Player 2.');
  assert.ok(!derivePublicActivity(moved,stolen)!.match(/lumber|brick|wool|grain|ore/));
});

test('public activity announces builds and normal turn end',()=>{
  const a={...base(),phase:'action'};
  const road={...a,roads:{e1:'Player 1'}};
  assert.equal(derivePublicActivity(a,road),'Player 1 built a road.');

  const settlement={...road,buildings:{v1:{playerId:'Player 1',kind:'settlement' as const}}};
  assert.equal(derivePublicActivity(road,settlement),'Player 1 built a settlement.');

  const city={...settlement,buildings:{v1:{playerId:'Player 1',kind:'city' as const}}};
  assert.equal(derivePublicActivity(settlement,city),'Player 1 upgraded a settlement to a city.');

  const next={...a,currentSeat:1,turn:4,phase:'roll'};
  assert.equal(derivePublicActivity(a,next),'Player 1 ended the turn.');
  assert.equal(turnAnnouncement(next),'It’s Player 2’s turn.');
});
