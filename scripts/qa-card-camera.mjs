import {assertDirectTargets,boardTargetIds,boardTargetPoint,clickBoardTarget} from './qa-board-targets.mjs';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

// The fixture is generated only on the local test server; never included in a production build.
const evidence = process.env.CAMERA_EVIDENCE || 'camera-evidence';
const strict=process.env.CAMERA_EXPECT_STABLE==='1';
await mkdir(evidence, { recursive: true });
const htmlPath = '__card-camera-fixture.html', fixturePath = 'src/__card-camera-fixture.ts';
const rendererPath = 'src/game/board/three/renderer.ts';
const originalRenderer = await readFile(rendererPath, 'utf8');
const diagnosticRenderer = originalRenderer.replace("return { instanceId: this.instanceId, mode: '3d',", "return { frustum: [this.camera.left,this.camera.right,this.camera.top,this.camera.bottom], projection: this.camera.projectionMatrix.toArray(), quaternion: this.camera.quaternion.toArray(), canvasSize: [this.width,this.height], staticKey: this.key, instanceId: this.instanceId, mode: '3d',");
const fixture = `
// Isolated deterministic setup for real game controls; this module is never shipped.
(window as any).__cardCameraFixture = {
 load(card: Exclude<Development,'victory-point'>) {
  clearBotTimer();remote=null;projection=null;networkRevision=0;localBotIds=new Set();
  localUndoState=null;localUndoPlayerId='';pendingLocalUndo=null;targetMode=null;
  let fixture=createGame(24680,['Player 1','Player 2','Player 3'],()=>0);
  for(let guard=0;guard<30&&fixture.phase.startsWith('setup-');guard++){
   const actor=fixture.players[fixture.currentSeat].id;
   const kind=fixture.phase==='setup-settlement'?'settlement':'road';
   const id=legalTargetIds(fixture,actor,kind)[0];if(!id)throw new Error('Fixture has no legal setup target');
   fixture=kind==='settlement'?localSetup(fixture,{type:'place-settlement',playerId:actor,vertexId:id}):localSetup(fixture,{type:'place-road',playerId:actor,edgeId:id});
  }
  fixture.currentSeat=0;fixture.turn=10;fixture.phase='action';fixture.playedDevelopment=false;
  fixture.players[0].cards=[{type:card,boughtTurn:0}];
  for(const p of fixture.players)for(const r of RESOURCES){fixture.bank[r]+=p.hand[r]-3;p.hand[r]=3;}
  state=fixture;viewer='Player 1';activeLocalRoom=createLocalRoomSettings(24680,3,0);
  log=[];publicActivity='Player 1 traded resources with Player 2. The table is waiting for the next action; the current player may build a settlement, upgrade a city, exchange resources at a port, or play a development card.';lastTurnCue='10:0';pendingActivityAlert='';pendingRollPresentation=null;
  for(const timer of [turnAlertTimer,activityAlertTimer,victoryAlertTimer])if(timer!==null)clearTimeout(timer);
  turnAlertTimer=activityAlertTimer=victoryAlertTimer=null;
  for(const selector of ['.turn-alert','.activity-alert','.victory-alert'])document.querySelector(selector)?.remove();
  el('pass').hidden=true;el('game').hidden=false;enterGame();render();
 },
 read(){return {phase:state?.phase,board:JSON.stringify(state?.board),roads:Object.keys(state?.roads??{}),freeRoads:state?.freeRoads,cards:state?.players[0].cards};}
};
`;
let server,browser,page;const report={checks:[],errors:[]};
function maxDelta(a,b){return Math.max(0,...a.map((v,i)=>Math.abs(v-b[i])));}
function difference(before,after){
 const a=before.render,b=after.render;
 const units=r=>[(r.frustum[1]-r.frustum[0])/r.canvasSize[0]/r.zoom,(r.frustum[2]-r.frustum[3])/r.canvasSize[1]/r.zoom];
 return {position:maxDelta(a.camera,b.camera),target:maxDelta(a.target,b.target),quaternion:maxDelta(a.quaternion,b.quaternion),zoom:Math.abs(a.zoom-b.zoom),worldPerPixel:maxDelta(units(a),units(b))};
}
function verifyView(before,after,label){
 const delta=difference(before,after);const preserved=Object.values(delta).every(value=>value<1e-8);
 report.checks.push({label,preserved,delta,beforeSize:before.render.canvasSize,afterSize:after.render.canvasSize});
 assert.equal(after.render.staticKey,before.render.staticKey,label+' map identity');
 assert.equal(after.render.instanceId,before.render.instanceId,label+' rendering instance');
 if(strict)assert.ok(preserved,label+': '+JSON.stringify(delta));
 console.log(label,JSON.stringify({preserved,delta}));
}
async function stable(){await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));await delay(150);}
async function inspect(){return page.evaluate(()=>({render:window.__hex3D.inspect(),game:window.__cardCameraFixture.read(),box:(()=>{const r=document.querySelector('#board').getBoundingClientRect();return [r.x,r.y,r.width,r.height];})()}));}
async function moveCamera(){
 const r=await page.locator('#board canvas').boundingBox();
 await page.mouse.move(r.x+r.width*.5,r.y+r.height*.5);await page.mouse.down({button:'middle'});await page.mouse.move(r.x+r.width*.5+75,r.y+r.height*.5-24,{steps:8});await page.mouse.up({button:'middle'});
 await page.keyboard.down('Shift');await page.mouse.down({button:'middle'});await page.mouse.move(r.x+r.width*.5+102,r.y+r.height*.5-10,{steps:6});await page.mouse.up({button:'middle'});await page.keyboard.up('Shift');
 await page.mouse.move(r.x+r.width*.5,r.y+r.height*.5);await page.mouse.wheel(0,-160);await stable();
}
try{
 await writeFile(rendererPath,diagnosticRenderer);
 const source=await readFile('src/game-ui.ts','utf8');await writeFile(fixturePath,source+fixture);
 const html=(await readFile('index.html','utf8')).replace('/src/game-ui.ts','/src/__card-camera-fixture.ts');assert.ok(html.includes('__card-camera-fixture.ts'));await writeFile(htmlPath,html);
 server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','4176','--strictPort'],{stdio:'pipe'});
 let logs='';server.stdout.on('data',d=>logs+=d);server.stderr.on('data',d=>logs+=d);
 const url='http://127.0.0.1:4176/hex-island-game/__card-camera-fixture.html?qa3d=1';
 for(let i=0;i<100;i++){try{if((await fetch(url)).ok)break;}catch{}await delay(200);}
 browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 page=await browser.newPage({viewport:{width:1280,height:720}});page.on('pageerror',e=>report.errors.push(String(e)));
 const labels={'road-building':'Play Road Building',knight:'Play Knight',monopoly:'Play Monopoly',invention:'Play Year of Plenty'};
 for(const width of [1280,1600,1101])for(const card of Object.keys(labels)){
  await page.setViewportSize({width,height:720});await page.goto(url,{waitUntil:'networkidle'});await page.evaluate(card=>window.__cardCameraFixture.load(card),card);
  await page.waitForFunction(()=>window.__hex3D?.inspect().mode==='3d');await stable();await moveCamera();const before=await inspect();
  await page.getByRole('button',{name:labels[card],exact:true}).click();await stable();const after=await inspect();
  const deltas={position:maxDelta(before.render.camera,after.render.camera),target:maxDelta(before.render.target,after.render.target),zoom:Math.abs(before.render.zoom-after.render.zoom),frustum:maxDelta(before.render.frustum,after.render.frustum),projection:maxDelta(before.render.projection,after.render.projection)};
  const result={width,card,before,after,deltas,staticSame:before.render.staticKey===after.render.staticKey,preserved:Object.values(deltas).every(d=>d<1e-8)};report.checks.push(result);console.log(JSON.stringify({width,card,deltas,staticSame:result.staticSame,beforeBox:before.box,afterBox:after.box}));
  assert.equal(after.game.board,before.game.board);assert.equal(after.render.instanceId,before.render.instanceId);
  verifyView(before,after,width+' '+card+' play with notice reflow');
  // Exercise the same ResizeObserver path when card/target content changes the viewport.
  await page.evaluate(()=>{const host=document.querySelector('#board');host.style.setProperty('height',Math.max(180,host.clientHeight-28)+'px','important');host.style.setProperty('flex','0 0 auto','important');});
  await stable();const resized=await inspect();verifyView(after,resized,width+' '+card+' container resize');
  if(card==='road-building'){
   assert.equal(after.game.phase,'free-road');
   const roadReference=await inspect();
   for(let step=0;step<2;step++){
    await page.getByRole('button',{name:'Build road',exact:true}).click();await stable();
    const [selected]=await boardTargetIds(page);assert.ok(selected);
    await clickBoardTarget(page);await stable();
    const now=await inspect();report.checks.push({width,card,step:step+1,after:now});verifyView(roadReference,now,width+' free road '+(step+1));
    assert.equal(now.game.roads.length,before.game.roads.length+step+1);
   }
   assert.equal((await inspect()).game.phase,'action');
   await page.getByRole('button',{name:'Undo last action',exact:true}).click();await stable();
   const undone=await inspect();verifyView(roadReference,undone,width+' undo free road');assert.equal(undone.game.phase,'free-road');assert.equal(undone.game.roads.length,before.game.roads.length+1);
   await page.getByRole('button',{name:'Build road',exact:true}).click();await stable();
   await page.getByRole('button',{name:'Cancel selection',exact:true}).click();await stable();verifyView(roadReference,await inspect(),width+' cancel target');
   await page.getByRole('button',{name:'Build road',exact:true}).click();await clickBoardTarget(page);await stable();verifyView(roadReference,await inspect(),width+' replay free road');
  }
  await delay(2200);const timed=await inspect();report.checks.push({width,card,alertExpired:true,after:timed});verifyView(resized,timed,width+' '+card+' notice dismissal');
  if(width===1280&&card==='road-building')await page.screenshot({path:`${evidence}/road-building.png`,fullPage:true});
  await page.locator('#board-view-reset').click();await stable();const reset=await inspect();assert.equal(reset.render.zoom,1);assert.ok(reset.render.fullyVisible);
  await page.locator('#board-view-top').click();await stable();assert.ok((await inspect()).render.fullyVisible);
 }
 await writeFile(`${evidence}/server.log`,logs);assert.deepEqual(report.errors,[]);
}catch(error){report.error=String(error.stack||error);console.error(report.error);process.exitCode=1;try{await page?.screenshot({path:`${evidence}/failure.png`,fullPage:true});}catch{}}
finally{await writeFile(`${evidence}/report.json`,JSON.stringify(report,null,2));await browser?.close();server?.kill('SIGTERM');await writeFile(rendererPath,originalRenderer);await rm(fixturePath,{force:true});await rm(htmlPath,{force:true});}
