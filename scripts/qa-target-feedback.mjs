import {assertDirectTargets,boardTargetIds,boardTargetPoint,clickBoardTarget} from './qa-board-targets.mjs';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';

const evidence=process.env.TARGET_EVIDENCE||'target-evidence';
await mkdir(evidence,{recursive:true});
const report={checks:[],errors:[]};
const check=(label,details={})=>{report.checks.push({label,...details,pass:true});console.log('PASS',label);};
const inspect=page=>page.evaluate(()=>window.__hex3D?.inspect());
const settle=async page=>{await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));await delay(80);};
const url=new URL(process.env.QA_URL||'http://127.0.0.1:4178/hex-island-game/');url.searchParams.set('qa3d','1');url.searchParams.delete('renderer');
const htmlPath='__target-feedback-fixture.html',fixturePath='src/__target-feedback-fixture.ts';
let server,browser,page;
const fixture=`
// Disposable test data only; excluded from every production build.
(window as any).__targetFixture={load(card:'knight'|'road-building'|null){
 clearBotTimer();remote=null;projection=null;networkRevision=0;localBotIds=new Set();
 localUndoState=null;localUndoPlayerId='';localUndoDeadlines=null;pendingLocalUndo=null;targetMode=null;
 localPaused=false;localPauseAt=0;localActionDeadlines.clear();pendingClockCommand=null;
 let initial=createGame(24680,['Player 1','Player 2','Player 3'],()=>0);
 for(let guard=0;guard<30&&initial.phase.startsWith('setup-');guard++){
  const playerId=initial.players[initial.currentSeat].id,kind=initial.phase==='setup-settlement'?'settlement':'road';
  const id=legalTargetIds(initial,playerId,kind)[0];if(!id)throw new Error('No setup target');
  initial=kind==='settlement'?localSetup(initial,{type:'place-settlement',playerId,vertexId:id}):localSetup(initial,{type:'place-road',playerId,edgeId:id});
 }
 initial.currentSeat=0;initial.turn=10;initial.phase='action';initial.playedDevelopment=false;
 initial.players[0].cards=card?[{type:card,boughtTurn:0}]:[];
 for(const p of initial.players)for(const r of RESOURCES){initial.bank[r]+=p.hand[r]-4;p.hand[r]=4;}
 state=initial;viewer='Player 1';activeLocalRoom=createLocalRoomSettings(24680,3,0);syncLocalActionClock();lastTurnCue='10:0';log=[];publicActivity='Choose a target.';pendingActivityAlert='';pendingProductionSummary=null;
 el('pass').hidden=true;el('game').hidden=false;enterGame();render();
}};
`;
async function ready(p){await p.waitForFunction(()=>window.__hex3D?.inspect().mode==='3d'&&window.__hex3D.inspect().frames>0);await settle(p);}
async function start(p,renderer){const u=new URL(url);if(renderer)u.searchParams.set('renderer',renderer);await p.goto(u.href,{waitUntil:'networkidle'});await p.locator('#local-room-create').click();await p.locator('#start').click();if(await p.locator('#pass').isVisible())await p.locator('#reveal').click();if(renderer!=='2d')await ready(p);}
async function orange(p,id,label){const info=await inspect(p);assert.equal(info.highlightedTarget,id,label);const active=info.targetColors.filter(t=>t.active);assert.equal(active.length,1,label+' exactly one active');assert.equal(active[0].id,id);assert.equal(active[0].color,'ff981f');assert.ok(info.targetColors.filter(t=>!t.active).every(t=>t.color==='fff3a0'));return info;}
async function preview(p,action,label){
 await p.getByRole('button',{name:action,exact:true}).click();await settle(p);await assertDirectTargets(p);
 const ids=await boardTargetIds(p);assert.ok(ids.length>=2,label+' needs choices');
 await p.mouse.move(0,0);await settle(p);assert.equal((await inspect(p)).highlightedTarget,null,label+' starts with no hidden selection');
 const a=ids[0],b=ids[1],before=await inspect(p),status=await p.locator('#game-status').textContent();
 await p.evaluate(()=>window.__oldTargetCancel=document.querySelector('#targets .target-cancel'));
 const point=await boardTargetPoint(p,a);assert.ok(point);
 await p.mouse.move(point.x,point.y);await settle(p);await orange(p,a,label+' first hover');
 const second=await boardTargetPoint(p,b);assert.ok(second);await p.mouse.move(second.x,second.y);await settle(p);await orange(p,b,label+' second hover');
 await p.mouse.move(0,0);await settle(p);const after=await inspect(p);assert.equal(after.highlightedTarget,null,label+' leave clears orange');
 assert.equal(after.instanceId,before.instanceId);assert.equal(after.mapBuilds,before.mapBuilds);
 assert.deepEqual(after.camera,before.camera);assert.deepEqual(after.projection,before.projection);assert.equal(after.zoom,before.zoom);
 assert.deepEqual(after.buildings,before.buildings);assert.deepEqual(after.roads,before.roads);assert.equal(after.robber,before.robber);assert.equal(after.picks,before.picks);
 assert.equal(await p.locator('#game-status').textContent(),status);
 assert.ok(await p.evaluate(()=>window.__oldTargetCancel===document.querySelector('#targets .target-cancel')));
 await p.mouse.move(second.x,second.y);await settle(p);await orange(p,b,label+' screenshot highlight');
 check(label+': no coordinate controls; pointer-only orange feedback preserves camera and state');
 return {a,b,point:second,before};
}
try{
 if(!process.env.QA_URL){
  const source=await readFile('src/game-ui.ts','utf8');await writeFile(fixturePath,source+fixture);
  const html=(await readFile('index.html','utf8')).replace('/src/game-ui.ts','/src/__target-feedback-fixture.ts');assert.ok(html.includes('__target-feedback-fixture.ts'));await writeFile(htmlPath,html);
  server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','4178','--strictPort'],{stdio:'pipe'});
  for(let i=0;i<100;i++){try{if((await fetch(url)).ok)break;}catch{}await delay(200);}
 }
 browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 page=await browser.newPage({viewport:{width:1440,height:900}});page.on('pageerror',e=>report.errors.push(String(e)));
 await start(page);
 let state=await preview(page,'Build settlement','Settlement');
 await page.locator('#board .turn-alert').waitFor({state:'hidden',timeout:5000});await page.screenshot({path:`${evidence}/orange-settlement.png`,fullPage:true});
 await clickBoardTarget(page,state.b);await settle(page);
 assert.ok((await inspect(page)).buildings.some(([id])=>id===state.b));assert.equal((await inspect(page)).highlightedTarget,null);
 check('Direct board click places the pointed settlement and removes stale highlight');
 state=await preview(page,'Build road','Road');
 await page.getByRole('button',{name:'Cancel selection',exact:true}).click();await settle(page);
 assert.equal((await inspect(page)).targets.length,0);assert.equal((await inspect(page)).highlightedTarget,null);
 assert.deepEqual((await inspect(page)).roads,state.before.roads);check('Cancel clears all orange targets without a move');
 await page.getByRole('button',{name:'Build road',exact:true}).click();await settle(page);
 let point=await page.evaluate(()=>window.__hex3D.point(window.__hex3D.inspect().targets[0]));
 const pre=await inspect(page);await page.mouse.move(point.x,point.y);await page.mouse.down({button:'middle'});await page.mouse.move(point.x+25,point.y-10,{steps:4});await page.mouse.up({button:'middle'});await settle(page);
 assert.equal((await inspect(page)).picks,pre.picks);assert.deepEqual((await inspect(page)).roads,pre.roads);check('Middle drag does not place a highlighted road');
 await page.locator('#board-view-reset').click();
 point=await page.evaluate(()=>window.__hex3D.point(window.__hex3D.inspect().targets[0]));await page.mouse.click(point.x,point.y);await settle(page);assert.equal((await inspect(page)).roads.length,1);check('Direct canvas click still places one road');
 if(!process.env.QA_URL){
  const fixtureURL=new URL('__target-feedback-fixture.html?qa3d=1',url);
  for(const [mode,card,label] of [['city',null,'Upgrade house to city'],['robber','knight','Move robber'],['free-road','road-building','Build road']]){
   await page.goto(fixtureURL.href,{waitUntil:'networkidle'});await page.evaluate(card=>window.__targetFixture.load(card),card);await ready(page);
   if(card)await page.getByRole('button',{name:card==='knight'?'Play Knight':'Play Road Building',exact:true}).click();
   state=await preview(page,label,mode);
   await page.locator('#board .activity-alert').waitFor({state:'hidden',timeout:5000});await page.screenshot({path:`${evidence}/orange-${mode}.png`,fullPage:true});
   await clickBoardTarget(page,state.b);await settle(page);
   const done=await inspect(page);assert.equal(done.highlightedTarget,null);
   if(mode==='city')assert.ok(done.buildings.some(([id,piece])=>id===state.b&&piece.kind==='city'));
   if(mode==='robber')assert.equal(done.robber,state.b);
   if(mode==='free-road'){assert.ok(done.roads.includes(state.b));await preview(page,'Build road','Second free road');}
   check(mode+': selected target remains correct through the actual reducer');
  }
 }
 await start(page,'2d');await page.getByRole('button',{name:'Build settlement',exact:true}).click();
 const nodes=page.locator('#board [data-target-id]');assert.ok(await nodes.count()>1);
 const first=await nodes.nth(0).getAttribute('data-target-id'),second=await nodes.nth(1).getAttribute('data-target-id');
 await assertDirectTargets(page);await page.mouse.move(0,0);assert.equal(await page.locator('#board .target-active').count(),0);
 await nodes.nth(1).hover();assert.equal(await page.locator('#board .target-active').getAttribute('data-target-id'),second);
 await page.mouse.move(0,0);assert.equal(await page.locator('#board .target-active').count(),0);
 await nodes.nth(0).focus();assert.equal(await page.locator('#board .target-active').getAttribute('data-target-id'),first);
 assert.equal(await nodes.nth(0).evaluate(n=>getComputedStyle(n).fill),'rgb(255, 152, 31)');
 await nodes.nth(0).press('Enter');assert.equal(await page.locator('#board [data-building-kind]').count(),1);
 await page.locator('#board-render-toggle').click();await ready(page);assert.equal((await inspect(page)).buildings.length,1);assert.equal((await inspect(page)).highlightedTarget,null);
 await page.getByRole('button',{name:'Build road',exact:true}).click();await assertDirectTargets(page);
 await page.getByRole('button',{name:'Cancel selection',exact:true}).click();assert.equal((await inspect(page)).highlightedTarget,null);
 check('SVG keyboard placement and renderer switching work without any coordinate picker');
 const context=await browser.newContext({viewport:{width:375,height:812},isMobile:true,hasTouch:true});const phone=await context.newPage();phone.on('pageerror',e=>report.errors.push(String(e)));
 await start(phone);await phone.getByRole('button',{name:'Build settlement',exact:true}).click();await settle(phone);
 const targets=(await inspect(phone)).targets;point=await phone.evaluate(id=>window.__hex3D.point(id),targets[1]);
 await phone.locator('#board canvas').scrollIntoViewIfNeeded();await settle(phone);point=await phone.evaluate(id=>window.__hex3D.point(id),targets[1]);const touch=await context.newCDPSession(phone);await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:point.x,y:point.y}]});await settle(phone);await orange(phone,targets[1],'Touch press');
 await touch.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});await settle(phone);assert.equal((await inspect(phone)).buildings.length,0);assert.equal((await inspect(phone)).picks,0);check('Touch press highlights and touch cancellation never places a building');
 await phone.touchscreen.tap(point.x,point.y);await settle(phone);assert.equal((await inspect(phone)).buildings.length,1);assert.equal((await inspect(phone)).highlightedTarget,null);check('Actual phone tap places once and clears the preview');
 await context.close();assert.deepEqual(report.errors,[]);
}catch(error){report.error=String(error.stack||error);console.error(report.error);process.exitCode=1;try{await page?.screenshot({path:`${evidence}/failure.png`,fullPage:true});}catch{}}
finally{await writeFile(`${evidence}/report.json`,JSON.stringify(report,null,2));await browser?.close();server?.kill('SIGTERM');if(!process.env.QA_URL){await rm(htmlPath,{force:true});await rm(fixturePath,{force:true});}}
