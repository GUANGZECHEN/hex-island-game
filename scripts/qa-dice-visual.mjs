import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const root=process.env.GAME_SOURCE_ROOT||process.cwd();
const html='__dice-roll-fixture.html',source='src/__dice-roll-fixture.ts';
const htmlPath=join(root,html),sourcePath=join(root,source);
const url='http://127.0.0.1:4182/hex-island-game/'+html+'?qa3d=1';
const evidence=process.env.DICE_EVIDENCE||'dice-evidence';
await mkdir(evidence,{recursive:true});
const fixture=`
import {drawIndex as fixtureDraw} from './game/rules/state.ts';
(window as any).__diceFixture={
 load(variant:'normal'|'blocked'|'seven'|'multiple'='normal'){
  clearBotTimer();boardRenderer?.clearRoll();remote=null;projection=null;networkRevision=0;localBotIds=new Set();
  targetMode=null;localUndoState=null;localUndoPlayerId='';localUndoDeadlines=null;pendingLocalUndo=null;pendingRollPresentation=null;
  localPaused=false;localPauseAt=0;localActionDeadlines.clear();pendingClockCommand=null;
  const next=createGame(24680,['Player 1','Player 2'],()=>0);
  const tile=next.board.hexes.find(h=>h.token===(variant==='multiple'?9:8)&&h.resource!==null)!;
  const hex=createIslandBoard(next.board.layout).hexes.find(h=>h.id===tile.hexId)!;
  let verts=[hex.vertexIds[0],hex.vertexIds[2]];
  let secondResource=null;
  if(variant==='multiple'){
   const neighbor=hex.neighborIds.map(id=>({
    geometry:createIslandBoard(next.board.layout).hexes.find(h=>h.id===id),
    tile:next.board.hexes.find(h=>h.hexId===id)
   })).find(p=>p.tile?.resource&&p.tile.resource!==tile.resource);
   if(!neighbor)throw new Error('No neighboring second resource type in fixture');
   const shared=hex.vertexIds.find(v=>neighbor.geometry.vertexIds.includes(v));
   if(!shared)throw new Error('Tiles are not adjacent');
   verts=[shared,hex.vertexIds.find(v=>v!==shared&&!neighbor.geometry.vertexIds.includes(v))||hex.vertexIds[2]];
   neighbor.tile.token=tile.token;
   secondResource=neighbor.tile.resource;
  }
  next.buildings[verts[0]]={playerId:'Player 1',kind:'city'};
  next.buildings[verts[1]]={playerId:'Player 2',kind:'settlement'};
  next.currentSeat=0;next.phase='roll';next.turn=9;next.dice=null;
  if(variant==='blocked')next.board={...next.board,robberHexId:tile.hexId};
  const total=variant==='seven'?7:tile.token!;
  let matched=false;
  for(let seed=0;seed<10000;seed++){
   const a=fixtureDraw(seed,6),b=fixtureDraw(a.state,6);
   if(a.index+b.index+2===total){next.randomState=seed;matched=true;break;}
  }
  if(!matched)throw new Error('No matching deterministic dice stream');
  state=next;viewer='Player 1';activeLocalRoom=createLocalRoomSettings(24680,2,0);syncLocalActionClock();
  log=[];publicActivity='Dice visual fixture';lastTurnCue='9:0';pendingActivityAlert='';pendingRollPresentation=null;
  el('pass').hidden=true;el('game').hidden=false;enterGame();render();
  (window as any).__diceExpected={total,resource:tile.resource,secondResource,hexId:tile.hexId,city:verts[0],settlement:verts[1]};
 },
 expected(){return (window as any).__diceExpected;},
 getDice(){return state?.dice;},
 redraw(){render();},
};
`;
let browser,server,active;
const pageErrors=[];
try{
 const ui=await readFile(join(root,'src/game-ui.ts'),'utf8');
 const index=await readFile(join(root,'index.html'),'utf8');
 await writeFile(sourcePath,ui+'\n'+fixture);
 await writeFile(htmlPath,index.replace('/src/game-ui.ts','/src/__dice-roll-fixture.ts'));
 server=spawn(process.execPath,[join(root,'node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port','4182','--strictPort'],{cwd:root,stdio:'ignore'});
 for(let i=0;i<100;i++){try{if((await fetch(url)).ok)break;}catch{}await delay(200);}
 browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const camera=async page=>page.evaluate(()=>{
  const x=window.__hex3D.inspect();
  return {position:x.camera,target:x.target,zoom:x.zoom,quaternion:x.quaternion,mapBuilds:x.mapBuilds,instanceId:x.instanceId};
 });
 const sameCamera=(before,after)=>{
  for(const k of ['position','target','quaternion'])assert.ok(before[k].every((v,i)=>Math.abs(v-after[k][i])<1e-6),'Camera changed: '+k);
  assert.equal(before.zoom,after.zoom);assert.equal(before.instanceId,after.instanceId);assert.equal(before.mapBuilds,after.mapBuilds);
 };
 active=await browser.newPage({viewport:{width:1600,height:900}});active.on('pageerror',e=>pageErrors.push(String(e)));
 await active.goto(url,{waitUntil:'networkidle'});
 await active.evaluate(()=>window.__diceFixture.load());
 await active.waitForFunction(()=>window.__hex3D?.inspect().mode==='3d');
 const expected=await active.evaluate(()=>window.__diceFixture.expected());
 const before=await camera(active);
 await active.getByRole('button',{name:'Roll dice',exact:true}).click();
 await active.waitForFunction(()=>window.__hex3D.inspect().rollEffect?.landed===true,null,{timeout:8000});
 const result=await active.evaluate(()=>window.__hex3D.inspect());
 assert.deepEqual(result.rollEffect.top,result.rollEffect.dice);
 assert.ok(result.rollEffect.visibleFaces.every((faces,index)=>
   faces.length===3&&faces.includes(result.rollEffect.top[index])), 'dice must have two real visible side faces from the default oblique camera');
 assert.deepEqual(result.rollEffect.dice,await active.evaluate(()=>window.__diceFixture.getDice()));
 assert.equal(result.rollEffect.top[0]+result.rollEffect.top[1],expected.total);
 assert.ok(result.productionHexes.includes(expected.hexId));
 assert.equal(result.rollEffect.gainLabels.length,2);
 const city=result.rollEffect.gainLabels.find(x=>x.vertexId===expected.city);
 const settlement=result.rollEffect.gainLabels.find(x=>x.vertexId===expected.settlement);
 assert.ok(city&&settlement);
 assert.deepEqual(city.gains,[{resource:expected.resource,count:2}]);
 assert.deepEqual(settlement.gains,[{resource:expected.resource,count:1}]);
 assert.notEqual(city.color,settlement.color);
 assert.equal(await active.locator('.activity-alert.activity-dice').count(),0);
 sameCamera(before,await camera(active));
 await active.screenshot({path:`${evidence}/3d-dice-and-city-payout.png`});
 console.log('PASS 3D two real dice finish with authoritative faces, live props react, and +2/+1 float over color-matched buildings');

 await active.evaluate(()=>window.__diceFixture.load('multiple'));
 await active.locator('#board-view-top').click();
 const cameraBeforeTopRoll=await camera(active);
 const multiExpected=await active.evaluate(()=>window.__diceFixture.expected());
 await active.getByRole('button',{name:'Roll dice',exact:true}).click();
 await active.waitForFunction(()=>window.__hex3D.inspect().rollEffect?.landed===true,null,{timeout:8000});
 const multi=await active.evaluate(()=>window.__hex3D.inspect());
 assert.ok(multi.rollEffect.visibleFaces.every((faces,index)=>
   faces.length===3&&faces.includes(multi.rollEffect.top[index])),'even when the user selects Top view, dice must still show upper plus two side faces');
 sameCamera(cameraBeforeTopRoll,await camera(active));
 await active.screenshot({path:`${evidence}/3d-dice-isometric-from-top-view.png`});
 const cityMulti=multi.rollEffect.gainLabels.find(x=>x.vertexId===multiExpected.city);
 assert.ok(cityMulti);
 assert.ok(multiExpected.secondResource);
 assert.deepEqual(cityMulti.gains.map(x=>[x.resource,x.count]).sort(),
  [[multiExpected.resource,2],[multiExpected.secondResource,2]].sort());
 assert.equal(cityMulti.gains.reduce((sum,x)=>sum+x.count,0),4);
 console.log('PASS neighboring equal dice tokens award distinct per-resource icons +2/+2 to the same city');

 await active.evaluate(()=>window.__diceFixture.load('blocked'));
 await active.getByRole('button',{name:'Roll dice',exact:true}).click();
 await active.waitForFunction(()=>window.__hex3D.inspect().rollEffect?.landed===true,null,{timeout:8000});
 const blocked=await active.evaluate(()=>window.__hex3D.inspect());
 assert.ok(!blocked.productionHexes.includes(expected.hexId));
 assert.equal(blocked.rollEffect.gainLabels.length,0);
 console.log('PASS robber blocks resource animation and reward labels');

 await active.evaluate(()=>window.__diceFixture.load('seven'));
 await active.getByRole('button',{name:'Roll dice',exact:true}).click();
 await active.waitForFunction(()=>window.__hex3D.inspect().rollEffect?.landed===true,null,{timeout:8000});
 const seven=await active.evaluate(()=>window.__hex3D.inspect());
 assert.equal(seven.rollEffect.top.reduce((a,b)=>a+b,0),7);
 assert.equal(seven.rollEffect.gainLabels.length,0);
 assert.deepEqual(seven.productionHexes,[]);
 console.log('PASS seven displays exactly seven without tile or building production');

 await active.close();
 const phone=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
 active=phone;phone.on('pageerror',e=>pageErrors.push(String(e)));
 await phone.goto(url,{waitUntil:'networkidle'});
 await phone.evaluate(()=>window.__diceFixture.load());
 await phone.getByRole('button',{name:'Roll dice',exact:true}).tap();
 const mobile=await (await phone.waitForFunction(()=>{
  const view=window.__hex3D.inspect();
  return view.rollEffect?.landed && view.rollEffect.gainLabels.length===2 ? view : null;
 },null,{timeout:8000})).jsonValue();
 const [,,top,bottom]=mobile.frustum,cssPxPerUnit=mobile.canvasSize[1]*mobile.zoom/(top-bottom);
 assert.ok(mobile.canvasSize[0]<600);
 assert.ok(mobile.rollEffect.gainLabels.every(badge=>badge.heightWorld*cssPxPerUnit>=33.9),'phone payout badges have space for a legible quantity');
 await phone.close();
 const fallback=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true});active=fallback;
 fallback.on('pageerror',e=>pageErrors.push(String(e)));
 await fallback.goto(url+'&renderer=2d',{waitUntil:'networkidle'});
 await fallback.evaluate(()=>window.__diceFixture.load());
 await fallback.getByRole('button',{name:'Roll dice',exact:true}).click();
 assert.equal(await fallback.locator('.board-roll-overlay .board-rolled-die').count(),2);
 await fallback.waitForFunction(()=>window.__hex3D.inspect().rollEffect?.landed===true,null,{timeout:8000});
 const faceValues=await fallback.locator('.board-rolled-die').evaluateAll(nodes=>nodes.map(n=>Number(n.getAttribute('data-value'))));
 assert.equal(faceValues[0]+faceValues[1],expected.total);
 // A new guest snapshot can replace the SVG while the roll is still visible.
 const restored=await fallback.evaluate(()=>{
  window.__diceFixture.redraw();
  const root=document.querySelector('.board-roll-overlay').getBoundingClientRect();
  const badges=[...document.querySelectorAll('.board-roll-gain')];
  return {badges:badges.length,tiles:document.querySelectorAll('.roll-producing-hex').length,
   inside:badges.every(badge=>{const r=badge.getBoundingClientRect();return r.left>=root.left-1&&r.right<=root.right+1&&r.top>=root.top-1&&r.bottom<=root.bottom+1;})};
 });
 assert.equal(restored.badges,2);assert.ok(restored.tiles>=1);assert.ok(restored.inside,'both SVG gains remain on the phone board after a redraw');
 await fallback.screenshot({path:`${evidence}/2d-fallback-dice.png`});
 console.log('PASS 2D/mobile fallback shows true dice faces, tile pulse and player-colored building gains');
 assert.deepEqual(pageErrors,[]);
}catch(error){
 console.error(error?.stack||error);
 process.exitCode=1;
 try{await active?.screenshot({path:`${evidence}/failure.png`});}catch{}
}finally{
 await browser?.close();server?.kill('SIGTERM');
 await rm(sourcePath,{force:true});await rm(htmlPath,{force:true});
}
