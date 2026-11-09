import test from 'node:test';
import assert from 'node:assert/strict';
import { derivePublicActivity, turnAnnouncement, type PublicActivityState } from '../src/game/ui/activity.ts';

const base=():PublicActivityState=>({
  players:[{id:'Player 1',resources:4,developmentCards:0},{id:'Player 2',resources:5,developmentCards:0},{id:'Player 3',resources:3,developmentCards:0}],
  currentSeat:0,turn:3,phase:'roll',dice:null,victims:[],
  board:{robberHexId:'h0'},roads:{},buildings:{},playedCards:[],bank:{lumber:19,brick:19,wool:19,grain:19,ore:19},deckCount:25,offer:null,
});

test('public activity announces dice, robber and theft without revealing resource identity',()=>{
  const a=base();
  const rolled={...a,phase:'robber',dice:[1,2] as [number,number]};
  assert.equal(derivePublicActivity(a,rolled),'Player 1 rolled dice: 1 + 2 = 3.');

  const moved={...rolled,phase:'steal',victims:['Player 2'],board:{robberHexId:'h1'}};
  assert.equal(derivePublicActivity(rolled,moved),'Player 1 moved the robber.');

  const stolen={...moved,phase:'action',victims:[],players:[{id:'Player 1',resources:5,developmentCards:0},{id:'Player 2',resources:4,developmentCards:0},{id:'Player 3',resources:3,developmentCards:0}]};
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


test('public activity uses nicknames while rule ownership stays on stable player IDs',()=>{
  const a={...base(),players:[
    {id:'Player 1',name:'Alice',resources:4,developmentCards:0},
    {id:'Player 2',name:'Bob',resources:5,developmentCards:0},
    {id:'Player 3',name:'Carol',resources:3,developmentCards:0},
  ]};
  const rolled={...a,phase:'robber',dice:[3,4] as [number,number]};
  assert.equal(derivePublicActivity(a,rolled),'Alice rolled dice: 3 + 4 = 7.');
  const moved={...rolled,phase:'steal',victims:['Player 2'],board:{robberHexId:'h1'}};
  const stolen={...moved,phase:'action',victims:[],players:[
    {id:'Player 1',name:'Alice',resources:5,developmentCards:0},
    {id:'Player 2',name:'Bob',resources:4,developmentCards:0},
    {id:'Player 3',name:'Carol',resources:3,developmentCards:0},
  ]};
  assert.equal(derivePublicActivity(moved,stolen),'Alice stole 1 card from Bob.');
  assert.equal(turnAnnouncement({...a,currentSeat:1}),'It’s Bob’s turn.');
  assert.equal(derivePublicActivity(a,{...a,roads:{e1:'Player 1'}}),'Alice built a road.');
});


test('public activity announces development-card purchases without exposing the card type',()=>{
  const a={...base(),phase:'action',players:[
    {id:'Player 1',resources:6,developmentCards:1},
    {id:'Player 2',resources:5,developmentCards:0},
    {id:'Player 3',resources:3,developmentCards:0},
  ],deckCount:20};
  const next={...a,players:[
    {id:'Player 1',resources:3,developmentCards:2},
    {id:'Player 2',resources:5,developmentCards:0},
    {id:'Player 3',resources:3,developmentCards:0},
  ],bank:{...a.bank,wool:20,grain:20,ore:20},deckCount:19};
  assert.equal(derivePublicActivity(a,next),'Player 1 bought a development card.');
  assert.ok(!derivePublicActivity(a,next)!.match(/knight|monopoly|victory|road building|year of plenty/i));
});

test('public activity reports only bank or port trade ratio',()=>{
  const a={...base(),phase:'action',players:[
    {id:'Player 1',resources:8,developmentCards:0},
    {id:'Player 2',resources:5,developmentCards:0},
    {id:'Player 3',resources:3,developmentCards:0},
  ]};
  const four={...a,players:[{id:'Player 1',resources:5,developmentCards:0},...a.players.slice(1)],bank:{...a.bank,lumber:23,ore:18}};
  assert.equal(derivePublicActivity(a,four),'Player 1 traded 4:1 with the bank.');

  const threeStart={...a,players:[{id:'Player 1',resources:7,developmentCards:0},...a.players.slice(1)]};
  const three={...threeStart,players:[{id:'Player 1',resources:5,developmentCards:0},...a.players.slice(1)],bank:{...a.bank,brick:22,grain:18}};
  assert.equal(derivePublicActivity(threeStart,three),'Player 1 traded 3:1 at a generic port.');

  const twoStart={...a,players:[{id:'Player 1',resources:6,developmentCards:0},...a.players.slice(1)]};
  const two={...twoStart,players:[{id:'Player 1',resources:5,developmentCards:0},...a.players.slice(1)],bank:{...a.bank,wool:21,grain:18}};
  assert.equal(derivePublicActivity(twoStart,two),'Player 1 traded 2:1 at a resource port.');

  for(const message of [derivePublicActivity(a,four),derivePublicActivity(threeStart,three),derivePublicActivity(twoStart,two)]){
    assert.ok(message);
    assert.ok(!message!.match(/lumber|brick|wool|grain|ore/));
  }
});


test('public domestic trade activity exposes card counts but no resource identities',()=>{
 const a={...base(),phase:'action',offer:{proposer:'Player 1',targets:['Player 2'],giveCount:2,receiveCount:1}};
 const next={...a,offer:null,players:[
  {id:'Player 1',resources:3,developmentCards:0},
  {id:'Player 2',resources:6,developmentCards:0},
  {id:'Player 3',resources:3,developmentCards:0},
 ]};
 const message=derivePublicActivity(a,next);
 assert.equal(message,'Player 1 traded 2 cards for 1 card with Player 2.');
 assert.ok(!message!.match(/lumber|brick|wool|grain|ore/));
});
