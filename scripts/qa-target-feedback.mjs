import {assertDirectTargets,boardTargetIds,boardTargetPoint,clickBoardTarget} from './qa-board-targets.mjs';
import {chromium} from 'playwright';
import {PNG} from 'pngjs';
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
import { legalTargetIds } from './game/rules/legal.ts';

// Disposable test data only; excluded from every production build.
(window as any).__targetFixture={load(card:'knight'|'road-building'|null,ships=false){
 clearBotTimer();remote=null;projection=null;networkRevision=0;localBotIds=new Set();
 localUndoState=null;localUndoPlayerId='';localUndoDeadlines=null;pendingLocalUndo=null;targetMode=null;
 localPaused=false;localPauseAt=0;localActionDeadlines.clear();pendingClockCommand=null;
 const rules={catchUp:false,ships};
 let initial=createGame(24680,['Player 1','Player 2','Player 3'],()=>0,{rules});
 const portVertices=new Set(initial.board.ports.flatMap(port=>port.vertexIds));
 for(let guard=0;guard<30&&initial.phase.startsWith('setup-');guard++){
  const playerId=initial.players[initial.currentSeat].id,kind=initial.phase==='setup-settlement'?'settlement':'road';
  const candidates=legalTargetIds(initial,playerId,kind);
  const ownsPort=[...portVertices].some(id=>initial.buildings[id]?.playerId===playerId);
  const port=ships&&kind==='settlement'&&!ownsPort&&initial.currentSeat<2?candidates.find(id=>portVertices.has(id)):undefined;
  const id=port??candidates[0];if(!id)throw new Error('No setup target');
  initial=kind==='settlement'?localSetup(initial,{type:'place-settlement',playerId,vertexId:id}):localSetup(initial,{type:'place-road',playerId,edgeId:id});
 }
 initial.currentSeat=0;initial.turn=10;initial.phase='action';initial.playedDevelopment=false;
 initial.players[0].cards=card?[{type:card,boughtTurn:0}]:[];
 for(const p of initial.players)for(const r of RESOURCES){initial.bank[r]+=p.hand[r]-4;p.hand[r]=4;}
 state=initial;viewer='Player 1';activeLocalRoom=createLocalRoomSettings(24680,3,0,'classic',rules);syncLocalActionClock();lastTurnCue='10:0';log=[];publicActivity='Choose a target.';pendingActivityAlert='';pendingRollPresentation=null;
 el('pass').hidden=true;el('game').hidden=false;enterGame(true);render();
},setShipBuilder(seat:number){
 state!.currentSeat=seat;viewer=state!.players[seat].id;lastTurnCue='10:'+seat;
 syncLocalActionClock();render();
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

async function captureShipArt(page,renderer){
 for(const [size,width,height] of [['desktop',1440,900],['phone',375,812]]){
  await page.setViewportSize({width,height});
  await settle(page);
  const base=`${evidence}/ship-identities-${renderer}-${size}`;
  const image=await page.locator('#board').screenshot({path:base+'.png'});
  const gray=PNG.sync.read(image);
  for(let offset=0;offset<gray.data.length;offset+=4){
   const value=Math.round(gray.data[offset]*.2126+gray.data[offset+1]*.7152+gray.data[offset+2]*.0722);
   gray.data[offset]=gray.data[offset+1]=gray.data[offset+2]=value;
  }
  await writeFile(base+'-grayscale.png',PNG.sync.write(gray));
 }
 await page.setViewportSize({width:1440,height:900});
 await settle(page);
}
async function verifyShipArt(page,fixtureURL){
 await page.goto(fixtureURL.href,{waitUntil:'networkidle'});
 await page.evaluate(()=>window.__targetFixture.load(null,true));
 await ready(page);
 const ships=[];
 for(const seat of [1,2]){
  if(seat===2)await page.evaluate(()=>window.__targetFixture.setShipBuilder(1));
  const playerCard=page.locator(`#player-strip [data-seat="${seat}"]`);
  const owner=await playerCard.locator('.player-summary-name').textContent();
  const emblem=await playerCard.locator('.player-marker [data-seat-emblem]').getAttribute('data-seat-emblem');
  assert.ok(emblem,'the owning seat must show its emblem in the player card');
  await page.getByRole('button',{name:/^Build ship/}).click();
  const id=await clickBoardTarget(page);
  await settle(page);
  const ship=(await inspect(page)).shipIdentities.find(ship=>ship.id===id);
  assert.equal(ship?.owner,owner.replace(' · You',''),'placed ship reports the owning player');
  assert.equal(ship.emblem,emblem,'the 3D ship sail matches the owning seat emblem');
  assert.equal(ship.hullColor,seat===1?'#2868b2':'#c74a42','the 3D hull matches the owning seat color');
  assert.equal(ship.stripeColor,'#fff1cf','owned ships use the contrasting cream stripe');
  ships.push(ship);
 }
 assert.notEqual(ships[0].emblem,ships[1].emblem,'different seats have distinct shapes without color');
 assert.notEqual(ships[0].hullColor,ships[1].hullColor,'hulls retain seat colors');
 assert.equal((await inspect(page)).boats.length,9,'owned ships do not shift neutral ports');
 await page.locator('#board .activity-alert').waitFor({state:'hidden',timeout:5000});
 await captureShipArt(page,'3d');
 await page.locator('#board-render-toggle').click();
 await page.waitForFunction(()=>document.querySelector('#board')?.dataset.renderer==='2d');
 for(const ship of ships){
  const piece=page.locator(`#board [data-vertex-id="${ship.id}"][data-building-kind="ship"]`);
  assert.equal(await piece.locator('[data-seat-emblem]').getAttribute('data-seat-emblem'),ship.emblem,'the SVG ship uses the same owning-seat emblem as 3D');
  assert.equal(await piece.locator('.game-building-shell').getAttribute('fill'),ship.hullColor,'the SVG hull matches the 3D owner color');
 }
 assert.equal(await page.locator('#board [data-port-edge] [data-seat-emblem]').count(),0,'neutral SVG ports have no owning-seat emblem');
 await captureShipArt(page,'2d');
 check('Placed ships match their owner cards in 3D and SVG with desktop and phone color and grayscale evidence');
}
async function verifyTouchPlacement(browser,renderer){
 const context=await browser.newContext({viewport:{width:375,height:812},isMobile:true,hasTouch:true});
 const phone=await context.newPage();phone.on('pageerror',e=>report.errors.push(String(e)));
 const confirm=phone.locator('#board-confirm-placement');
 const build=phone.getByRole('button',{name:'Build settlement',exact:true});
 const cancel=phone.getByRole('button',{name:'Cancel selection',exact:true});
 const pause=phone.locator('#turn-clock-pause');
 const placements=async ()=>renderer==='3d'?(await inspect(phone)).buildings.length:phone.locator('#board [data-building-kind]').count();
 const assertPreview=async id=>{
  if(renderer==='2d')assert.equal(await phone.locator('#board [data-placement-preview]').getAttribute('data-preview-target'),id);
  else{
   const info=await inspect(phone);
   assert.equal(info.placementPiece,'settlement');
   assert.equal(info.previewTargetId,id);
  }
 };
 const tapTarget=async id=>{
  const point=await boardTargetPoint(phone,id);assert.ok(point,'touch target must be on the board');
  await phone.touchscreen.tap(point.x,point.y);
  await confirm.waitFor({state:'visible'});
  assert.match(await confirm.innerText(),/Confirm settlement/i);
  assert.equal((await inspect(phone)).selectedTarget,id,'release pins this target without placing it');
  await assertPreview(id);
  assert.equal(await placements(),0);
 };
 try{
  await start(phone,renderer);
  await build.tap();
  const ids=await boardTargetIds(phone);assert.ok(ids.length>=3);
  const first=ids[1],second=ids[2];
  const point=await boardTargetPoint(phone,first);assert.ok(point);
  const touch=await context.newCDPSession(phone);
  await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:point.x,y:point.y}]});
  await settle(phone);
  await assertPreview(first);
  assert.equal(await confirm.isVisible(),false,'press alone cannot select a placement');
  await touch.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});
  await settle(phone);
  assert.equal(await confirm.isVisible(),false,'touch cancellation leaves no confirmation');
  assert.equal(await placements(),0,'touch cancellation must not place a building');
  await tapTarget(first);
  await cancel.tap();
  assert.equal(await confirm.isVisible(),false,'Cancel selection clears the touch confirmation');
  assert.equal((await inspect(phone)).selectedTarget,null);
  await build.tap();
  await tapTarget(first);
  await pause.tap();
  assert.equal(await confirm.isVisible(),false,'loss of placement legality clears stale confirmation');
  assert.equal((await inspect(phone)).selectedTarget,null);
  await pause.tap();
  assert.equal(await placements(),0,'resuming cannot apply the discarded target');
  await build.tap();
  await tapTarget(first);
  await tapTarget(second);
  await confirm.tap();
  await settle(phone);
  assert.equal(await placements(),1,'exactly one confirmation places the replacement target');
  const placed=renderer==='2d'?await phone.locator('#board [data-building-kind="settlement"]').getAttribute('data-vertex-id'):(await inspect(phone)).buildings[0][0];
  assert.equal(placed,second);
  assert.equal(await confirm.isVisible(),false);
  assert.equal((await inspect(phone)).selectedTarget,null);
  assert.equal(await phone.locator('#game-error').textContent(),'');
  await phone.getByRole('button',{name:'Build road',exact:true}).tap();
  const [edge]=await boardTargetIds(phone);assert.ok(edge);
  const roadPoint=await boardTargetPoint(phone,edge);assert.ok(roadPoint);
  await phone.touchscreen.tap(roadPoint.x,roadPoint.y);
  await confirm.waitFor({state:'visible'});
  assert.match(await confirm.innerText(),/Confirm road/i);
  assert.equal((await inspect(phone)).selectedTarget,edge);
  const roads=async ()=>renderer==='3d'?(await inspect(phone)).roads.length:phone.locator('#board .game-road-piece').count();
  assert.equal(await roads(),0,'touch release previews a road without placing it');
  await confirm.tap();
  await settle(phone);
  assert.equal(await roads(),1,'road confirmation places exactly one road');
  check(renderer+' touch settlement and road previews require explicit confirmation; Cancel, retarget and stale paths pass');
 }finally{
  await context.close();
 }
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
  await verifyShipArt(page,fixtureURL);
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
 assert.equal(await page.locator('#board [data-building-kind]').getAttribute('data-vertex-id'),first,'keyboard activates its focused target, not the previously hovered target');
 await page.locator('#board-render-toggle').click();await ready(page);assert.equal((await inspect(page)).buildings.length,1);assert.equal((await inspect(page)).highlightedTarget,null);
 await page.getByRole('button',{name:'Build road',exact:true}).click();await assertDirectTargets(page);
 await page.getByRole('button',{name:'Cancel selection',exact:true}).click();assert.equal((await inspect(page)).highlightedTarget,null);
 check('SVG keyboard placement and renderer switching work without any coordinate picker');
 await verifyTouchPlacement(browser,'3d');
 await verifyTouchPlacement(browser,'2d');
 assert.deepEqual(report.errors,[]);
}catch(error){report.error=String(error.stack||error);console.error(report.error);process.exitCode=1;try{await page?.screenshot({path:`${evidence}/failure.png`,fullPage:true});}catch{}}
finally{await writeFile(`${evidence}/report.json`,JSON.stringify(report,null,2));await browser?.close();server?.kill('SIGTERM');if(!process.env.QA_URL){await rm(htmlPath,{force:true});await rm(fixturePath,{force:true});}}
