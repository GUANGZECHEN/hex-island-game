// Real local-bot browser regression. Run: node scripts/qa-bot-catch-up.mjs
// Requires Playwright Chromium. The instrumented Vite entry is disposable and never shipped.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {readFile,writeFile,rm,mkdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {join} from 'node:path';
const root=process.env.GAME_SOURCE_ROOT||process.cwd();
const source='src/__bot-catch-up-fixture.ts',html='__bot-catch-up-fixture.html';
const evidence=process.env.BOT_CATCH_UP_EVIDENCE||'bot-catch-up-evidence';
const url='http://127.0.0.1:4185/hex-island-game/'+html+'?qa3d=1';
const fixture=`
import {drawIndex as fixtureDraw} from './game/rules/state.ts';
import {calculateDiceProduction as fixtureProduction} from './game/rules/turn.ts';
const fixtureEvents:any[]=[];
let fixtureFailureArmed=false;
const fixtureCommit=commit;
commit=(next,description)=>{
 const before=state;
 if(before&&next&&isNewRoll(before,next)&&next.dice){
  const production=fixtureProduction(before,next.dice[0]+next.dice[1]);
  fixtureEvents.push({kind:'roll',at:performance.now(),before:structuredClone(before),after:structuredClone(next),production});
 }
 fixtureCommit(next,description);
 if(before&&next&&isNewRoll(before,next)&&fixtureFailureArmed){
  fixtureFailureArmed=false;
  const controller=boardRenderer as any,instance=controller?.instance;
  if(!instance||!controller.activeRoll)throw new Error('Expected active 3D roll for fallback fixture');
  instance.update=()=>{throw new Error('fixture update failure');};
  render();
  fixtureEvents.push({kind:'fallback',at:performance.now(),mode:(window as any).__hex3D.inspect().mode,reason:(window as any).__hex3D.inspect().reason});
 }
};
const fixtureSeenNotices=new WeakSet<HTMLElement>();
const fixtureObserver=new MutationObserver(records=>{
 for(const record of records){for(const node of record.removedNodes){
  if(node instanceof HTMLElement&&node.matches('.supplement-alert')&&!node.isConnected)fixtureEvents.push({kind:'notice-end',at:performance.now(),title:node.querySelector('strong')?.textContent});
 }
 for(const node of record.addedNodes){
  if(!(node instanceof HTMLElement)||!node.matches('.supplement-alert')||fixtureSeenNotices.has(node))continue;
  fixtureSeenNotices.add(node);
  fixtureEvents.push({kind:'notice',at:performance.now(),title:node.querySelector('strong')?.textContent,
   gains:Object.fromEntries(Array.from(node.querySelectorAll<HTMLElement>('[data-resource]')).map(item=>[item.dataset.resource,Number(item.textContent?.match(/\\+(\\d+)/)?.[1])]))});
 }}
});
fixtureObserver.observe(el('board'),{childList:true});
(window as any).__botCatchUp={
 load(shape:'reported'|'consecutive',fail3d=false){
  clearBotTimer();clearSupplement();boardRenderer?.clearRoll();remote=null;projection=null;networkRevision=0;
  if(typeof loggedSupplements!=='undefined')loggedSupplements.clear();
  localPaused=false;localPauseAt=0;localActionDeadlines.clear();pendingClockCommand=null;
  localUndoState=null;localUndoPlayerId='';localUndoDeadlines=null;pendingLocalUndo=null;targetMode=null;
  const settings=createLocalRoomSettings(24680,4,3,'classic',{catchUp:true,ships:false});
  const next=createGame(24680,[...settings.ids],()=>0,{mode:'classic',rules:settings.rules});
  const geometry=createIslandBoard(next.board.layout),scores=shape==='reported'?[6,3,8,6]:[6,3,3,8];
  let vertex=0;
  for(let i=0;i<scores.length;i++){
   for(let n=0;n<Math.floor(scores[i]/2);n++)next.buildings[geometry.vertices[vertex++].id]={playerId:settings.ids[i],kind:'city'};
   if(scores[i]%2)next.buildings[geometry.vertices[vertex++].id]={playerId:settings.ids[i],kind:'settlement'};
  }
  // Prevent production on the first, deterministic roll; later production is independently accounted for.
  for(const hex of next.board.hexes)if(hex.token!==null)hex.token=2;
  // Match the reported four-card Bot 1 hand without making its turn unbounded.
  next.players[1].hand.lumber=2;next.players[1].hand.brick=2;next.bank.lumber-=2;next.bank.brick-=2;
  next.currentSeat=1;next.phase='roll';next.turn=9;next.dice=null;
  for(let seed=0;seed<10000;seed++){const a=fixtureDraw(seed,6),b=fixtureDraw(a.state,6);if(a.index+b.index+2===8){next.randomState=seed;break;}}
  state=next;viewer=settings.humanId!;activeLocalRoom=settings;localBotIds=new Set(settings.botIds);botTurnKey='';botActionCount=0;
  syncLocalActionClock();log=[];publicActivity='Bot supplement fixture';lastTurnCue='9:1';pendingActivityAlert='';pendingRollPresentation=null;
  el('pass').hidden=true;el('game').hidden=false;enterGame();fixtureObserver.takeRecords();fixtureEvents.length=0;fixtureFailureArmed=fail3d;render();
  return {scores:next.players.map(p=>publicVictoryPoints(next,p.id)),ids:settings.ids};
 },
 delayMs:BOT_DELAY_MS,
 events(){return structuredClone(fixtureEvents);},
 logs(){return [...log];},
 hideBoard(){el('board').style.transform='translateY(-10000px)';window.dispatchEvent(new Event('resize'));},
 showBoard(){el('board').style.transform='';window.dispatchEvent(new Event('resize'));},
 refresh(){const before=structuredClone(state);state=structuredClone(state);render();return {before,after:structuredClone(state)};},
};`;
const errors=[],captureErrors=[];let server,browser,page;
const bounded=(promise,ms,label)=>{let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(label+' timed out after '+ms+'ms')),ms);})]).finally(()=>clearTimeout(timer));};
async function capture(mode){
 try{
  await bounded(page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))),1500,mode+' paint');
  const session=await bounded(page.context().newCDPSession(page),3000,mode+' CDP');
  const shot=await bounded(session.send('Page.captureScreenshot',{format:'png',fromSurface:mode!=='2d',captureBeyondViewport:false}),8000,mode+' screenshot');
  await writeFile(join(evidence,mode+'-bot-supplement.png'),Buffer.from(shot.data,'base64'));
 }catch(error){captureErrors.push(mode+': '+String(error));}
}
function validateRoll(event,player){
 const {before,after,production}=event,award=after.catchUpReward;
 assert.equal(before.players[before.currentSeat].id,player);
 assert.equal(award?.playerId,player,'roller must receive authoritative award');
 assert.equal(award.turn,after.turn);
 const gains=Object.entries(award.gains).filter(([,n])=>n>0);
 assert.equal(gains.length,2,'two distinct types at leader 8 VP');
 for(const [,n] of gains)assert.equal(n,1);
 for(const resource of Object.keys(award.gains)){
  for(const p of before.players){
   const expected=production[p.id][resource]+(p.id===player?award.gains[resource]:0);
   assert.equal(after.players.find(x=>x.id===p.id).hand[resource]-p.hand[resource],expected,player+' hand '+resource);
  }
  const produced=before.players.reduce((sum,p)=>sum+production[p.id][resource],0);
  assert.equal(before.bank[resource]-after.bank[resource],produced+award.gains[resource],player+' bank '+resource);
 }
 return Object.fromEntries(gains);
}
try{
 await mkdir(evidence,{recursive:true});
 let ui=await readFile(join(root,'src/game-ui.ts'),'utf8');const index=await readFile(join(root,'index.html'),'utf8');
 const marker='const next=applyBotCommand(before,command);';assert.ok(ui.includes(marker),'bot instrumentation point missing');
 ui=ui.replace(marker,marker+"fixtureEvents.push({kind:'bot-action',at:performance.now(),command:structuredClone(command)});");
 await writeFile(join(root,source),ui+'\n'+fixture);await writeFile(join(root,html),index.replace('/src/game-ui.ts','/'+source));
 server=spawn(process.execPath,[join(root,'node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port','4185','--strictPort'],{cwd:root,stdio:'ignore'});
 let ready=false;for(let i=0;i<100;i++){try{if((await fetch(url)).ok){ready=true;break;}}catch{}await delay(200);}assert.ok(ready,'Vite server failed to start');
 for(const mode of ['3d','2d']){
  browser=await chromium.launch({headless:true,args:mode==='3d'?['--use-angle=swiftshader','--enable-unsafe-swiftshader']:['--disable-gpu']});
  page=await browser.newPage({viewport:{width:1600,height:900}});page.setDefaultTimeout(8000);page.on('pageerror',error=>errors.push(String(error)));
  await page.goto(url+(mode==='2d'?'&renderer=2d':''),{waitUntil:'networkidle'});await page.bringToFront();
  assert.equal(await page.evaluate(()=>window.__botCatchUp.delayMs),2000,'bot actions use a two-second delay');
  await page.evaluate(async()=>{await document.fonts.ready;await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);});
  for(const [shape,scores,players] of [['reported',[6,3,8,6],['Bot 1']],['consecutive',[6,3,3,8],['Bot 1','Bot 2']]]){
   const initial=await page.evaluate(shape=>window.__botCatchUp.load(shape),shape);assert.deepEqual(initial.scores,scores);assert.deepEqual(initial.ids,['Player 1','Bot 1','Bot 2','Bot 3']);
   await page.waitForFunction(count=>window.__botCatchUp.events().filter(e=>e.kind==='roll').length>=count,players.length,{timeout:60000});
   await page.waitForFunction(count=>window.__botCatchUp.events().filter(e=>e.kind==='notice-end').length>=count,players.length,{timeout:30000});
   await page.waitForFunction(()=>{const e=window.__botCatchUp.events(),end=e.filter(x=>x.kind==='notice-end').at(-1);return e.some(x=>x.kind==='bot-action'&&x.at>end.at);},null,{timeout:20000});
   let events=await page.evaluate(()=>window.__botCatchUp.events());
   const rolls=events.filter(e=>e.kind==='roll');
   for(let i=0;i<players.length;i++){
    const gains=validateRoll(rolls[i],players[i]);
    if(i===0){assert.equal(Object.values(rolls[i].before.players[1].hand).reduce((a,b)=>a+b,0),4);assert.equal(Object.values(rolls[i].after.players[1].hand).reduce((a,b)=>a+b,0),6,'reported Bot 1 goes from four to six cards at the roll');}
    const notices=events.filter(e=>e.kind==='notice'&&e.title===players[i]+' gained supplement');
    assert.equal(notices.length,1,shape+' '+players[i]+' must display the supplement exactly once; trace '+JSON.stringify(events.map(e=>({kind:e.kind,at:e.at,title:e.title,roller:e.after?.catchUpReward?.playerId}))));
    assert.deepEqual(notices[0].gains,gains,shape+' notice must match authoritative reward');
    assert.ok(notices[0].at>rolls[i].at,'notice must follow its roll');
    const end=events.find(e=>e.kind==='notice-end'&&e.title===notices[0].title);
    assert.ok(end&&end.at-notices[0].at>=2150,'notice must remain visible for its full 2.2 second dwell');
    assert.ok(!events.some(e=>e.kind==='bot-action'&&e.at>rolls[i].at&&e.at<end.at),'bot must wait through dice and supplement presentation');
    const next=events.find(e=>e.kind==='bot-action'&&e.at>end.at);
    assert.ok(next&&next.at-end.at>=1950,'next bot action must wait 2 seconds after the notice');
    const expectedLog=players[i]+' gained supplement: '+Object.entries(gains).map(([r,n])=>n+' '+r).join(', ')+'.';
    const logs=await page.evaluate(()=>window.__botCatchUp.logs());
    assert.equal(logs.filter(item=>item===expectedLog).length,1,'one log entry must include the actual resources');
   }
   const actions=events.filter(e=>e.kind==='bot-action');
   for(let i=1;i<actions.length;i++)assert.ok(actions[i].at-actions[i-1].at>=1999,'bot actions must be at least 2 seconds apart');
   const logsBefore=await page.evaluate(()=>window.__botCatchUp.logs());
   const refreshed=await page.evaluate(()=>window.__botCatchUp.refresh());assert.deepEqual(refreshed.after,refreshed.before,'render must not award resources again');await delay(500);
   events=await page.evaluate(()=>window.__botCatchUp.events());
   assert.deepEqual((await page.evaluate(()=>window.__botCatchUp.logs())).filter(x=>x.includes(' gained supplement: ')),logsBefore.filter(x=>x.includes(' gained supplement: ')),'redraw must not duplicate award logs');
   for(const player of players)assert.equal(events.filter(e=>e.kind==='notice'&&e.title===player+' gained supplement').length,1,'render must not replay');
   console.log('PASS '+mode+' '+shape+' exact bank/hand award and single correctly labeled notice');
  }
  if(mode==='2d'){
   // Pausing while the notice is visible must suppress bot commands even after it expires.
   await page.evaluate(()=>window.__botCatchUp.load('reported'));
   await page.locator('.supplement-alert').waitFor({state:'visible',timeout:20000});
   await page.locator('#turn-clock-pause').click();
   const paused=await page.evaluate(()=>window.__botCatchUp.events().filter(e=>e.kind==='bot-action').length);
   await delay(6000);assert.equal(await page.evaluate(()=>window.__botCatchUp.events().filter(e=>e.kind==='bot-action').length),paused,'pause must stop bots through presentation completion');
   await page.locator('#turn-clock-pause').click();
   await page.waitForFunction(n=>window.__botCatchUp.events().filter(e=>e.kind==='bot-action').length>n,paused,{timeout:12000});
   // Moving the board outside the viewport must not stall the scheduler.
   await page.evaluate(()=>{window.__botCatchUp.hideBoard();window.__botCatchUp.load('reported');});
   await page.waitForFunction(()=>window.__botCatchUp.events().filter(e=>e.kind==='bot-action').length>=2,null,{timeout:14000});
   const hiddenEvents=await page.evaluate(()=>window.__botCatchUp.events());
   assert.equal(hiddenEvents.filter(e=>e.kind==='notice').length,0,'offscreen board cannot show a notice');
   assert.ok(hiddenEvents.find(e=>e.kind==='roll')?.after.catchUpReward,'offscreen roll still awards cards');
   await page.evaluate(()=>window.__botCatchUp.showBoard());
   console.log('PASS pause/resume and offscreen bot progress');
  }
  // Fresh roll after behavior checks, keeping screenshots independent of assertions.
  await page.evaluate(()=>window.__botCatchUp.load('reported'));
  await page.locator('.supplement-alert').waitFor({state:'visible',timeout:20000});
  assert.equal(await page.locator('.supplement-alert strong').textContent(),'Bot 1 gained supplement');
  await capture(mode);
  if(mode==='3d'){
   // Simulate one synchronous failure during an active 3D roll, then verify the real fallback.
   await page.evaluate(()=>window.__botCatchUp.load('reported',true));
   await page.waitForFunction(()=>window.__botCatchUp.events().some(e=>e.kind==='notice-end'),null,{timeout:20000});
   await page.waitForFunction(()=>{const events=window.__botCatchUp.events(),end=events.find(e=>e.kind==='notice-end');return events.some(e=>e.kind==='bot-action'&&e.at>end.at);},null,{timeout:12000});
   const events=await page.evaluate(()=>window.__botCatchUp.events());
   const fallback=events.find(e=>e.kind==='fallback');assert.equal(fallback?.mode,'2d');assert.match(fallback.reason,/fixture update failure/);
   const roll=events.find(e=>e.kind==='roll'),gains=validateRoll(roll,'Bot 1');
   const notices=events.filter(e=>e.kind==='notice');assert.equal(notices.length,1,'fallback must complete exactly one notice');
   assert.equal(notices[0].title,'Bot 1 gained supplement');assert.deepEqual(notices[0].gains,gains);
   const logs=await page.evaluate(()=>window.__botCatchUp.logs());assert.equal(logs.filter(x=>x.startsWith('Bot 1 gained supplement: ')).length,1);
   console.log('PASS 3d synchronous update failure resumes in 2d with one award and bot progress');
  }
  await browser.close();browser=null;page=null;
 }
 assert.deepEqual(errors,[],'browser errors');assert.deepEqual(captureErrors,[],'screenshots');
}catch(error){console.error(error?.stack||error);process.exitCode=1;}
finally{await browser?.close();server?.kill('SIGTERM');await rm(join(root,source),{force:true});await rm(join(root,html),{force:true});}
