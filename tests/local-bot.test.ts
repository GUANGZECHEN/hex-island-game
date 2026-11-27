import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, applySetupCommand } from '../src/game/rules/state.ts';
import { chooseBotCommand } from '../src/game/bot/policy.ts';
import { applyBotCommand } from '../src/game/bot/runner.ts';
import { monopolyResource, rankExpansionTargets, settlementScore, chooseInventionResources } from '../src/game/bot/strategy.ts';
import { createLocalRoomSettings } from '../src/game/ui/local-room.ts';
import { legalTargetIds } from '../src/game/rules/legal.ts';
import { createIslandBoard } from '../src/game/board/geometry.ts';
import { generateBoardSetup, GENERATOR_VERSION } from '../src/game/board/setup.ts';

test('local bot deterministically completes the full snake setup through normal reducers',()=>{
 let state=createGame(23,['Player 1','Bot']);
 let steps=0;
 while((state.phase==='setup-settlement'||state.phase==='setup-road')&&steps<20){
  const actor=state.players[state.currentSeat].id;
  const command=chooseBotCommand(state,actor);
  assert.ok(command,'expected setup command for '+actor+' in '+state.phase);
  state=applyBotCommand(state,command);
  steps++;
 }
 assert.equal(state.phase,'roll');
 assert.equal(state.setupStep,4);
 assert.equal(Object.keys(state.buildings).length,4);
 assert.equal(Object.keys(state.roads).length,4);
});

test('local bot responds to domestic offers using card counts without needing UI state',()=>{
 const state=createGame(5,['Player 1','Bot']);state.phase='action';state.currentSeat=0;state.turn=3;
 state.players[0].hand={lumber:2,brick:0,wool:0,grain:0,ore:0};
 state.players[1].hand={lumber:0,brick:1,wool:1,grain:0,ore:0};
 state.offer={id:'fair',proposer:'Player 1',targets:['Bot'],give:{lumber:2,brick:0,wool:0,grain:0,ore:0},receive:{lumber:0,brick:1,wool:0,grain:0,ore:0}};
 assert.deepEqual(chooseBotCommand(state,'Bot'),{type:'accept-offer',playerId:'Bot',id:'fair'});
 state.offer={id:'unfair',proposer:'Player 1',targets:['Bot'],give:{lumber:1,brick:0,wool:0,grain:0,ore:0},receive:{lumber:0,brick:1,wool:1,grain:0,ore:0}};
 assert.deepEqual(chooseBotCommand(state,'Bot'),{type:'reject-offer',playerId:'Bot',id:'unfair'});
});

test('deterministic bot policy can drive repeated legal turns without a second human',()=>{
 let state=createGame(77,['Player 1','Bot']);
 let commands=0;
 while(commands<220&&state.phase!=='finished'&&state.turn<8){
  const pending=Object.keys(state.discards)[0];
  const actor=pending??state.players[state.currentSeat].id;
  const command=chooseBotCommand(state,actor);
  assert.ok(command,'bot policy stalled in '+state.phase+' for '+actor);
  state=applyBotCommand(state,command);
  commands++;
 }
 assert.ok(state.turn>=8||state.phase==='finished');
 assert.ok(commands<220);
});


test('two local bots can share a three-player snake setup and advance automatically',()=>{
 let state=createGame(31,['Player 1','Bot 1','Bot 2']);
 let steps=0;
 while((state.phase==='setup-settlement'||state.phase==='setup-road')&&steps<30){
  const actor=state.players[state.currentSeat].id;
  const command=chooseBotCommand(state,actor);
  assert.ok(command,'expected setup command for '+actor+' in '+state.phase);
  state=applyBotCommand(state,command);
  steps++;
 }
 assert.equal(state.phase,'roll');
 assert.equal(state.setupStep,6);
 assert.equal(Object.keys(state.buildings).length,6);
 assert.equal(Object.keys(state.roads).length,6);
 assert.equal(state.players.length,3);
 assert.deepEqual(state.players.map(player=>player.id),['Player 1','Bot 1','Bot 2']);
});



test('four and five local bots are compatible with the expanded 5–6 player board setup',()=>{
 for(const botCount of [4,5]){
  const ids=['Player 1',...Array.from({length:botCount},(_,i)=>`Bot ${i+1}`)];
  let state=createGame(700+botCount,ids,undefined,{boardLayout:'expanded-5-6'});
  let steps=0;
  while((state.phase==='setup-settlement'||state.phase==='setup-road')&&steps<40){
   const actor=state.players[state.currentSeat].id;
   const command=chooseBotCommand(state,actor);
   assert.ok(command,`expected setup command for ${actor} in ${state.phase}`);
   state=applyBotCommand(state,command);
   steps++;
  }
  assert.equal(state.phase,'roll');
  assert.equal(state.players.length,botCount+1);
  assert.equal(state.board.layout,'expanded-5-6');
  assert.equal(state.board.hexes.length,24);
  assert.equal(state.setupStep,2*(botCount+1));
  assert.equal(Object.keys(state.buildings).length,2*(botCount+1));
  assert.equal(Object.keys(state.roads).length,2*(botCount+1));
 }
});

test('both bot identities can independently answer offers and take normal turns',()=>{
 let state=createGame(41,['Player 1','Bot 1','Bot 2']);
 state.phase='action';state.currentSeat=0;state.turn=4;
 state.players[0].hand={lumber:2,brick:0,wool:0,grain:0,ore:0};
 state.players[1].hand={lumber:0,brick:1,wool:0,grain:0,ore:0};
 state.players[2].hand={lumber:0,brick:0,wool:1,grain:0,ore:0};
 state.offer={id:'bot2-offer',proposer:'Player 1',targets:['Bot 2'],give:{lumber:1,brick:0,wool:0,grain:0,ore:0},receive:{lumber:0,brick:0,wool:1,grain:0,ore:0}};
 assert.deepEqual(chooseBotCommand(state,'Bot 2'),{type:'accept-offer',playerId:'Bot 2',id:'bot2-offer'});
 state.offer=null;state.currentSeat=1;state.phase='roll';
 assert.deepEqual(chooseBotCommand(state,'Bot 1'),{type:'roll',playerId:'Bot 1'});
 state.currentSeat=2;
 assert.deepEqual(chooseBotCommand(state,'Bot 2'),{type:'roll',playerId:'Bot 2'});
});


test('strategy values a high-production grain/ore opening above a weak wool opening',()=>{
 let state=createGame(99,['Player 1','Bot']);
 const board=createIslandBoard(),vertices=board.vertices.filter(vertex=>board.hexes.filter(hex=>hex.vertexIds.includes(vertex.id)).length===3);
 let pair:[string,string]|null=null;
 for(const a of vertices)for(const b of vertices){
  const ah=new Set(board.hexes.filter(hex=>hex.vertexIds.includes(a.id)).map(hex=>hex.id));
  const bh=board.hexes.filter(hex=>hex.vertexIds.includes(b.id)).map(hex=>hex.id);
  if(a.id!==b.id&&bh.every(id=>!ah.has(id))){pair=[a.id,b.id];break;}
 }
 assert.ok(pair);
 const [strong,weak]=pair!;
 const strongHexes=new Set(board.hexes.filter(hex=>hex.vertexIds.includes(strong)).map(hex=>hex.id));
 state.board={...state.board,hexes:state.board.hexes.map(hex=>strongHexes.has(hex.hexId)
  ? {...hex,terrain:hex.hexId===Array.from(strongHexes)[0]?'fields':'mountains',resource:hex.hexId===Array.from(strongHexes)[0]?'grain':'ore',token:hex.hexId===Array.from(strongHexes)[0]?6:8}
  : {...hex,terrain:'pasture',resource:'wool',token:2})};
 assert.ok(settlementScore(state,'Bot',strong)>settlementScore(state,'Bot',weak)+8);
});

test('monopoly choice uses public bank depletion instead of peeking at individual hidden hands',()=>{
 const state=createGame(12,['Player 1','Bot']);state.phase='action';state.currentSeat=1;state.turn=3;
 state.players[0].hand.ore=4;state.bank.ore=15;
 const choice=monopolyResource(state,'Bot');
 assert.deepEqual(choice,{resource:'ore',count:4});
 state.players[1].cards=[{type:'monopoly',boughtTurn:1}];
 assert.deepEqual(chooseBotCommand(state,'Bot'),{type:'play-card',playerId:'Bot',card:'monopoly',resource:'ore'});
});

test('strategy saves a knight when it does not improve army position, unblock production, or attack a leader',()=>{
 const state=createGame(13,['Player 1','Bot']);state.phase='action';state.currentSeat=1;state.turn=3;
 state.players[1].cards=[{type:'knight',boughtTurn:1}];
 const command=chooseBotCommand(state,'Bot');
 assert.notEqual(command?.type,'play-card');
 assert.equal(command?.type,'end-turn');
});


test('bot preserves a near-complete settlement instead of spending its wool and grain on a development card',()=>{
 const state=createGame(51,['Player 1','Bot']),board=createIslandBoard();
 state.phase='action';state.currentSeat=1;state.turn=5;
 const first=board.edges[0],shared=first.vertexIds[1];
 const second=board.edges.find(edge=>edge.id!==first.id&&edge.vertexIds.includes(shared))!;
 const home=first.vertexIds[0],target=second.vertexIds[0]===shared?second.vertexIds[1]:second.vertexIds[0];
 state.buildings={[home]:{playerId:'Bot',kind:'settlement'}};
 state.roads={[first.id]:'Bot',[second.id]:'Bot'};
 state.players[1].hand={lumber:1,brick:0,wool:1,grain:1,ore:1};
 assert.ok(settlementScore(state,'Bot',target)>0);
 assert.deepEqual(chooseBotCommand(state,'Bot'),{type:'end-turn',playerId:'Bot'});
 state.players[1].hand={lumber:1,brick:0,wool:1,grain:1,ore:4};state.bank.ore=15;state.bank.brick=-2;
 assert.deepEqual(chooseBotCommand(state,'Bot'),{type:'bank-trade',playerId:'Bot',give:'ore',receive:'brick',rate:4});
 state.players[1].hand={lumber:1,brick:1,wool:1,grain:1,ore:1};
 const command=chooseBotCommand(state,'Bot');
 assert.equal(command?.type,'build-settlement');
 assert.equal(command&&'vertexId' in command?command.vertexId:null,target);
});


test('building-first bot chooses a settlement over roads or development cards when both are affordable',()=>{
 const state=createGame(61,['Player 1','Bot']),board=createIslandBoard();
 state.phase='action';state.currentSeat=1;state.turn=6;
 const first=board.edges[0],v0=first.vertexIds[0],v1=first.vertexIds[1];
 const second=board.edges.find(edge=>edge.id!==first.id&&edge.vertexIds.includes(v1))!;
 const v2=second.vertexIds[0]===v1?second.vertexIds[1]:second.vertexIds[0];
 state.buildings={[v0]:{playerId:'Bot',kind:'settlement'}};
 state.roads={[first.id]:'Bot',[second.id]:'Bot'};
 state.players[1].hand={lumber:3,brick:3,wool:2,grain:3,ore:3};
 state.players[1].cards=[];state.deck=[{type:'knight'} as any];
 const command=chooseBotCommand(state,'Bot');
 assert.equal(command?.type,'build-settlement');
 assert.equal(command&&'vertexId' in command?command.vertexId:null,v2);
});

test('building-first bot upgrades a city when it is ready and the next settlement is still far away',()=>{
 const state=createGame(62,['Player 1','Bot']),board=createIslandBoard();
 state.phase='action';state.currentSeat=1;state.turn=6;
 const first=board.edges[0],v0=first.vertexIds[0],v1=first.vertexIds[1];
 const second=board.edges.find(edge=>edge.id!==first.id&&edge.vertexIds.includes(v1))!;
 state.buildings={[v0]:{playerId:'Bot',kind:'settlement'}};
 state.roads={[first.id]:'Bot',[second.id]:'Bot'};
 state.players[1].hand={lumber:0,brick:0,wool:0,grain:2,ore:3};
 const command=chooseBotCommand(state,'Bot');
 assert.deepEqual(command,{type:'build-city',playerId:'Bot',vertexId:v0});
});

test('bot builds roads toward the highest-ranked settlement target before saving settlement resources',()=>{
 const state=createGame(63,['Player 1','Bot']),board=createIslandBoard();
 state.phase='action';state.currentSeat=1;state.turn=6;
 const first=board.edges[0],home=first.vertexIds[0];
 state.buildings={[home]:{playerId:'Bot',kind:'city'}};
 state.roads={[first.id]:'Bot'};
 state.players[1].hand={lumber:3,brick:3,wool:0,grain:0,ore:0};
 const targets=rankExpansionTargets(state,'Bot');
 assert.ok(targets.length>=2);
 assert.ok(targets[0].priority>=targets[1].priority);
 assert.ok(targets[0].roadDistance>0);
 assert.ok(targets[0].nextRoadId);
 const command=chooseBotCommand(state,'Bot');
 assert.deepEqual(command,{type:'build-road',playerId:'Bot',edgeId:targets[0].nextRoadId!});
});

test('once the planned target is connected, bot stops extending roads and starts saving for that settlement',()=>{
 const state=createGame(64,['Player 1','Bot']),board=createIslandBoard();
 state.phase='action';state.currentSeat=1;state.turn=6;
 const first=board.edges[0],home=first.vertexIds[0];
 state.buildings={[home]:{playerId:'Bot',kind:'city'}};
 state.roads={[first.id]:'Bot'};
 const target=rankExpansionTargets(state,'Bot').find(item=>item.roadDistance>0&&item.pathEdgeIds.length>0);
 assert.ok(target);
 for(const edgeId of target!.pathEdgeIds)state.roads[edgeId]='Bot';
 state.players[1].hand={lumber:3,brick:3,wool:0,grain:0,ore:0};
 const connected=rankExpansionTargets(state,'Bot').find(item=>item.vertexId===target!.vertexId);
 assert.ok(connected);
 assert.equal(connected!.roadDistance,0);
 const command=chooseBotCommand(state,'Bot');
 assert.deepEqual(command,{type:'end-turn',playerId:'Bot'});
});

test('expansion planner drops a blocked target and switches to the next ranked candidate',()=>{
 const state=createGame(65,['Player 1','Bot']),board=createIslandBoard();
 state.phase='action';state.currentSeat=1;state.turn=6;
 const first=board.edges[0],home=first.vertexIds[0];
 state.buildings={[home]:{playerId:'Bot',kind:'city'}};
 state.roads={[first.id]:'Bot'};
 const before=rankExpansionTargets(state,'Bot');
 assert.ok(before.length>=2);
 const blocked=before[0].vertexId;
 state.buildings[blocked]={playerId:'Player 1',kind:'settlement'};
 const after=rankExpansionTargets(state,'Bot');
 assert.ok(after.length>0);
 assert.notEqual(after[0].vertexId,blocked);
 assert.ok(!after.some(target=>target.vertexId===blocked));
});


test('co-op human receives both cities and the bot receives both settlements and four roads for either starting seat',()=>{
 const seen=new Set<number>();
 for(let seed=1;seed<100&&seen.size<2;seed++){
  const settings=createLocalRoomSettings(seed,2,1,'harbor-coop');
  let state=createGame(seed,settings.ids,undefined,{boardLayout:settings.boardLayout,mode:settings.mode});
  if(seen.has(state.startingSeat))continue;
  seen.add(state.startingSeat);
  let steps=0;
  while(state.phase.startsWith('setup')&&steps++<20){
   const actor=state.players[state.currentSeat].id;
   if(settings.botIds.includes(actor)){
    const command=chooseBotCommand(state,actor);assert.ok(command);state=applyBotCommand(state,command);
   }else{
    assert.equal(actor,settings.humanId);assert.equal(state.phase,'setup-city');
    const target=legalTargetIds(state,actor,'city')[0];assert.ok(target);
    state=applySetupCommand(state,{type:'place-city',playerId:actor,vertexId:target});
   }
  }
  assert.equal(state.phase,'roll');
  assert.equal(Object.values(state.buildings).filter(b=>b.playerId===settings.humanId&&b.kind==='city').length,2);
  assert.equal(Object.values(state.buildings).filter(b=>b.playerId===settings.botIds[0]&&b.kind==='settlement').length,2);
  assert.equal(Object.values(state.roads).filter(id=>id===settings.botIds[0]).length,4);
  assert.equal(Object.values(state.roads).filter(id=>id===settings.humanId).length,0);
 }
 assert.deepEqual([...seen].sort(),[0,1]);
});

test('archived Twin Capes bot uses Knight to reopen its port then moves the pirate to another player’s port',()=>{
 const state=createGame(3,['Player 1','Bot'],undefined,{boardLayout:'twin-capes'});
 state.board=generateBoardSetup(3,'twin-capes',GENERATOR_VERSION);
 state.currentSeat=1;state.phase='action';state.turn=3;
 const own=state.board.ports[0];
 const rival=state.board.ports.find(port=>port.vertexIds.every(vertex=>!own.vertexIds.includes(vertex)))!;
 state.buildings[own.vertexIds[0]]={playerId:'Bot',kind:'settlement'};
 state.buildings[rival.vertexIds[0]]={playerId:'Player 1',kind:'settlement'};
 state.board={...state.board,piratePortEdgeId:own.edgeId};
 state.players[1].cards=[{type:'knight',boughtTurn:1}];
 const knight=chooseBotCommand(state,'Bot');
 assert.deepEqual(knight,{type:'play-card',playerId:'Bot',card:'knight'});
 const choosing=applyBotCommand(state,knight!);
 assert.equal(choosing.phase,'pirate');
 const move=chooseBotCommand(choosing,'Bot');
 assert.deepEqual(move,{type:'move-pirate',playerId:'Bot',edgeId:rival.edgeId});
 const moved=applyBotCommand(choosing,move!);
 assert.equal(moved.phase,'action');
 assert.equal(moved.board.piratePortEdgeId,rival.edgeId);
 assert.deepEqual(moved.players.map(player=>player.hand),choosing.players.map(player=>player.hand));
});

test('Twin Capes bot moves the land robber and steals from the adjacent opponent',()=>{
 const state=createGame(3,['Player 1','Bot'],undefined,{boardLayout:'twin-capes'});
 state.currentSeat=1;state.phase='robber';state.resumePhase='action';state.turn=3;
 const high=state.board.hexes.find(tile=>tile.token===6)!;
 const geometry=createIslandBoard(state.board.layout,state.board.version);
 const tile=geometry.hexes.find(hex=>hex.id===high.hexId)!;
 state.buildings[tile.vertexIds[0]]={playerId:'Player 1',kind:'settlement'};
 state.players[0].hand.wool=1;state.bank.wool--;
 const move=chooseBotCommand(state,'Bot');assert.ok(move?.type==='move-robber');
 const moved=applyBotCommand(state,move);assert.equal(moved.phase,'steal');
 const steal=chooseBotCommand(moved,'Bot');assert.ok(steal?.type==='steal');
 assert.equal(steal.victimId,'Player 1');
 const next=applyBotCommand(moved,steal);assert.equal(next.players[1].hand.wool,1);
});

test('Twin Capes bot can build a third legal ship through the usual reducer',()=>{
 let state=createGame(3,['Player 1','Bot'],undefined,{boardLayout:'twin-capes'});
 state.currentSeat=1;state.phase='action';state.turn=3;
 const player=state.players[1];
 player.settlements=0;
 for(const resource of ['lumber','brick','ore'] as const){
  player.hand[resource]=6;
  state.bank[resource]-=6;
 }
 const home=state.board.ports[0].vertexIds[0];
 state.buildings[home]={playerId:'Bot',kind:'settlement'};
 for(let count=0;count<3;count++){
  const command=chooseBotCommand(state,'Bot');
  assert.ok(command?.type==='build-ship');
  assert.ok(legalTargetIds(state,'Bot','ship').includes(command.vertexId));
  state=applyBotCommand(state,command);
 }
 assert.equal(Object.values(state.buildings).filter(piece=>piece.playerId==='Bot'&&piece.kind==='ship').length,3);
});


test('bot chooses Year of Plenty resources when every bank ledger is empty',()=>{
 const s=createGame(51,['Player 1','Bot']),board=createIslandBoard();s.phase='action';s.currentSeat=1;s.turn=5;
 const first=board.edges[0],shared=first.vertexIds[1];const second=board.edges.find(e=>e.id!==first.id&&e.vertexIds.includes(shared))!;
 s.buildings={[first.vertexIds[0]]:{playerId:'Bot',kind:'settlement'}};s.roads={[first.id]:'Bot',[second.id]:'Bot'};
 s.players[1].hand={lumber:1,brick:0,wool:1,grain:1,ore:1};for(const r of ['lumber','brick','wool','grain','ore'] as const)s.bank[r]=-2;
 const resources=chooseInventionResources(s,'Bot');assert.equal(resources?.length,2);assert.ok(resources?.includes('brick'));
});
