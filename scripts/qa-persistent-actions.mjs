import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

// These hooks exist only in Vite's temporary test entry, never in production.
const source='src/__persistent-actions-fixture.ts', html='__persistent-actions-fixture.html';
const evidence=process.env.PERSISTENT_ACTIONS_EVIDENCE || 'persistent-actions-evidence';
const fixture=`
(window as any).__persistentFixture={
 load(mode:'classic'|'harbor-coop'='classic',ships=false){
  clearBotTimer();remote=null;projection=null;networkRevision=0;localBotIds=new Set();
  localPaused=false;localPauseAt=0;localActionDeadlines.clear();pendingClockCommand=null;
  localUndoState=null;localUndoPlayerId='';localUndoDeadlines=null;pendingLocalUndo=null;targetMode=null;
  let s=createGame(24680,['Player 1','Player 2'],undefined,{mode,rules:{catchUp:false,ships}});
  for(let i=0;i<30&&s.phase.startsWith('setup-');i++)s=applyBotCommand(s,chooseBotCommand(s,s.players[s.currentSeat].id)!);
  s.currentSeat=0;s.turn=10;s.phase='action';s.playedDevelopment=false;
  for(const p of s.players)for(const r of RESOURCES){s.bank[r]+=p.hand[r];p.hand[r]=0;}
  state=s;viewer='Player 1';activeLocalRoom=createLocalRoomSettings(24680,2,0,mode,{catchUp:false,ships});
  syncLocalActionClock();log=[];publicActivity='Availability test';lastTurnCue='';pendingActivityAlert='';pendingRollPresentation=null;
  el('pass').hidden=true;el('game').hidden=false;enterGame();render();
 },
 hand(n:number){for(const r of RESOURCES){state!.bank[r]+=state!.players[0].hand[r]-n;state!.players[0].hand[r]=n;}render();},
 view(id:string){viewer=id;render();},
 phase(phase:GameState['phase']){state!.phase=phase;render();},
 paused(value:boolean){localPaused=value;render();},
 cards(age:'none'|'new'|'old'){state!.players[0].cards=age==='none'?[]:[{type:'knight',boughtTurn:age==='new'?state!.turn:state!.turn-1}];render();},
 offer(){const empty=()=>({lumber:0,brick:0,wool:0,grain:0,ore:0});state!.offer={id:'fixture',proposer:'Player 1',targets:['Player 2'],give:{...empty(),lumber:1},receive:{...empty(),brick:1}};state!.players[1].hand.brick=1;render();},
 snapshot(){return JSON.stringify(state);}
};`;
const origin='http://127.0.0.1:4183/hex-island-game/__persistent-actions-fixture.html?qa3d=1';
let server,browser;
const button=(p,name)=>p.getByRole('button',{name,exact:true});
const presentDisabled=async (p,name)=>{const b=button(p,name);assert.equal(await b.count(),1,name+' remains present');assert.equal(await b.isDisabled(),true,name+' is disabled');};
const bank=async p=>{assert.equal(await p.locator('#trade-actions .bank-trade-button').count(),20,'all distinct resource pairs remain present');};
const fieldDisabled=async (field,label)=>{
 assert.equal(await field.evaluate(node=>node.disabled),true,label+' fieldset disabled');
 const children=field.locator('button');assert.ok(await children.count()>0,label+' has choice buttons');
 assert.equal(await children.first().isDisabled(),true,label+' child button disabled');
 assert.equal(await children.evaluateAll(nodes=>nodes.every(node=>node.matches(':disabled'))),true,label+' child buttons disabled');
};
const draftUnavailable=async (p,label)=>{
 assert.equal(await p.locator('.domestic-trade-card select').isDisabled(),true,label+' recipient disabled');
 const fields=p.locator('.domestic-trade-card fieldset');assert.equal(await fields.count(),2);
 for(let i=0;i<2;i++)await fieldDisabled(fields.nth(i),label+' draft');
 await fieldDisabled(p.locator('#actions fieldset.resource-stepper-grid'),label+' discard');
 const choices=p.locator('#actions .development-effect fieldset');assert.equal(await choices.count(),3);
 for(let i=0;i<3;i++)await fieldDisabled(choices.nth(i),label+' development choice');
};
// Test the individual controls, not merely the page's scroll width: a narrow grid
// can clip or overlap its children without expanding the document.
const checkSteppers=async (p,selector,paneSelector,label)=>{
 const fields=p.locator(selector);const expected=selector.includes('domestic')?2:1;
 assert.equal(await fields.count(),expected,label+' fieldset count');
 for(let i=0;i<expected;i++){
  const metrics=await fields.nth(i).evaluate((field,paneSelector)=>{
   const pane=document.querySelector(paneSelector),rect=node=>{const r=node.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};
   const rows=Array.from(field.querySelectorAll('.resource-stepper')).map(row=>({row:rect(row),parts:Array.from(row.children,rect),name:row.querySelector('.resource-stepper-name')?.textContent?.trim()}));
   return {field:rect(field),pane:rect(pane),rows};
  },paneSelector);
  assert.equal(metrics.rows.length,5,label+' must show all five resource rows');
  assert.deepEqual(metrics.rows.map(row=>row.name),['lumber','brick','wool','grain','ore']);
  const inside=(inner,outer)=>inner.left>=outer.left-1&&inner.right<=outer.right+1&&inner.top>=outer.top-1&&inner.bottom<=outer.bottom+1;
  for(const {row,parts,name} of metrics.rows){
   assert.equal(parts.length,4,label+' '+name+' has label, minus, count and plus');
   assert.ok(inside(row,metrics.field)&&inside(row,metrics.pane),label+' '+name+' row outside field or pane: '+JSON.stringify(metrics));
   for(const part of parts)assert.ok(part.width>0&&part.height>0&&inside(part,row)&&inside(part,metrics.field)&&inside(part,metrics.pane),label+' '+name+' control clipped: '+JSON.stringify(metrics));
   for(let j=1;j<parts.length;j++)assert.ok(parts[j-1].right<=parts[j].left+1,label+' '+name+' adjacent controls overlap: '+JSON.stringify(metrics));
  }
 }
};
// Capture after transient turn alerts, fonts, images, the real 3D renderer and paint frames are ready.
const screenshot=async (p,name)=>{
 await p.waitForFunction(()=>window.__hex3D?.inspect().mode==='3d'&&!!document.querySelector('#board canvas'),null,{timeout:30000});
 await p.locator('#board .turn-alert').waitFor({state:'detached',timeout:10000});
 await p.evaluate(async()=>{document.querySelector('.board-command-column').scrollTop=0;window.scrollTo(0,0);await document.fonts.ready;await Promise.all(Array.from(document.images, image=>image.decode().catch(()=>{})));await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});
 await p.screenshot({path:`${evidence}/${name}.png`,fullPage:true,animations:'disabled'});
};
try{
 await mkdir(evidence,{recursive:true});
 await writeFile(source,(await readFile('src/game-ui.ts','utf8'))+'\n'+fixture);
 await writeFile(html,(await readFile('index.html','utf8')).replace('/src/game-ui.ts','/src/__persistent-actions-fixture.ts'));
 server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','4183','--strictPort'],{stdio:'ignore'});
 for(let i=0;i<100;i++){try{if((await fetch(origin)).ok)break;}catch{}await delay(150);}
 browser=await chromium.launch({headless:true,...(process.env.QA_CHROMIUM_PATH?{executablePath:process.env.QA_CHROMIUM_PATH}:{}),args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const page=await browser.newPage({viewport:{width:1280,height:900}});const errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.goto(origin,{waitUntil:'networkidle'});await page.evaluate(()=>window.__persistentFixture.load());
 await page.waitForFunction(()=>window.__hex3D?.inspect().mode==='3d',null,{timeout:30000});
 await bank(page);
 for(const name of ['Build road','Build settlement','Upgrade city','Buy development card'])await presentDisabled(page,name);
 assert.equal(await page.locator('#trade-actions .bank-trade-button:enabled').count(),0);
 for(const card of ['knight','road-building','monopoly','invention'])assert.equal(await page.locator(`[data-development="${card}"]`).isDisabled(),true);
 const before=await page.evaluate(()=>window.__persistentFixture.snapshot());
 await delay(1200);const clock=await page.locator('#turn-action-clock-seconds').textContent();
 await page.locator('#trade-actions .bank-trade-button').first().evaluate(b=>b.click());
 await button(page,'Build road').evaluate(b=>{b.focus();b.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));b.click();});
 assert.equal(await page.evaluate(()=>window.__persistentFixture.snapshot()),before,'disabled mouse and keyboard activation must not mutate the game');
 assert.ok(Number((await page.locator('#turn-action-clock-seconds').textContent()).split(':')[1])<=Number(clock.split(':')[1]),'disabled actions must not reset the clock');
 await page.evaluate(()=>window.__persistentFixture.hand(5));
 assert.ok(await page.locator('#trade-actions .bank-trade-button:enabled').count()>0,'affordable bank exchanges become enabled');
 assert.equal(await button(page,'Build road').isEnabled(),true,'valid road becomes enabled');
 await page.evaluate(()=>window.__persistentFixture.phase('roll'));await bank(page);
 assert.equal(await button(page,'Roll dice').isEnabled(),true,'roll becomes enabled in roll phase');
 await presentDisabled(page,'Build road');assert.equal(await page.locator('#trade-actions .bank-trade-button:enabled').count(),0);
 await page.evaluate(()=>window.__persistentFixture.phase('action'));assert.equal(await button(page,'Build road').isEnabled(),true,'returning to action restores legal builds');
 await page.evaluate(()=>window.__persistentFixture.cards('new'));assert.equal(await page.locator('[data-development="knight"]').isDisabled(),true,'new cards cannot be played');
 await page.evaluate(()=>window.__persistentFixture.cards('old'));assert.equal(await page.locator('[data-development="knight"]').isEnabled(),true,'old owned card can be played');
 await page.locator('.domestic-trade-card summary').click();
 assert.equal(await button(page,'Make offer').isDisabled(),true,'empty offer is invalid');
 await page.locator('.domestic-trade-card fieldset').nth(0).getByRole('button',{name:'Add one lumber'}).click();
 assert.equal(await button(page,'Make offer').isDisabled(),true,'one-sided offer is invalid');
 await page.locator('.domestic-trade-card fieldset').nth(1).getByRole('button',{name:'Add one grain'}).click();
 assert.equal(await button(page,'Make offer').isEnabled(),true,'complete affordable offer is valid');
 assert.equal(await page.locator('.domestic-trade-card select').isEnabled(),true,'own-turn recipient selection is enabled');
 for(let i=0;i<2;i++){
  const field=page.locator('.domestic-trade-card fieldset').nth(i);
  assert.equal(await field.evaluate(node=>node.disabled),false,'own-turn draft fieldset is enabled');
  assert.equal(await field.getByRole('button',{name:'Add one wool'}).isEnabled(),true,'own-turn draft button is enabled');
 }
 await screenshot(page,'classic-valid-desktop');
 await page.evaluate(()=>window.__persistentFixture.view('Player 2'));await bank(page);
 await presentDisabled(page,'Build road');assert.equal(await page.locator('#trade-actions .bank-trade-button:enabled').count(),0);
 await draftUnavailable(page,'off turn');
 await page.evaluate(()=>window.__persistentFixture.offer());assert.equal(await button(page,'Accept trade').isEnabled(),true,'incoming trade can be accepted off turn');
 await page.evaluate(()=>window.__persistentFixture.view('Player 1'));await page.evaluate(()=>window.__persistentFixture.paused(true));await bank(page);await presentDisabled(page,'Build road');
 await draftUnavailable(page,'paused');
 await page.evaluate(()=>window.__persistentFixture.paused(false));assert.equal(await button(page,'Build road').isEnabled(),true,'resuming restores legal actions');
 await page.evaluate(()=>window.__persistentFixture.phase('finished'));await bank(page);await presentDisabled(page,'Build road');
 await page.evaluate(()=>window.__persistentFixture.load('harbor-coop'));await bank(page);assert.equal(await page.locator('[data-development], .development-actions-inline').count(),0,'v3 excludes development cards');assert.equal(await button(page,'Buy development card').count(),0);
 await page.evaluate(()=>window.__persistentFixture.paused(true));await presentDisabled(page,'End turn');
 await screenshot(page,'coop-disabled-desktop');
 await page.evaluate(()=>window.__persistentFixture.load('classic',true));assert.equal(await page.locator('[data-action="ship"]').count(),1,'optional ships appear when enabled');assert.equal(await page.locator('[data-action="ship"]').isDisabled(),true);
 await page.evaluate(()=>window.__persistentFixture.load('classic',false));assert.equal(await page.locator('[data-action="ship"]').count(),0,'optional ships are excluded when off');
 await page.evaluate(()=>window.__persistentFixture.hand(5));
 if(!await page.locator('.domestic-trade-card').evaluate(el=>el.open))await page.locator('.domestic-trade-card summary').click();
 for(const width of [375,320]){
  await page.setViewportSize({width,height:812});
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,width+'px mobile panel does not overflow');
  await checkSteppers(page,'#actions fieldset.resource-stepper-grid','#board-action-pane',width+'px disabled discard');
  await checkSteppers(page,'.domestic-trade-card fieldset','#board-trade-pane',width+'px enabled trade');
  await page.evaluate(()=>window.__persistentFixture.view('Player 2'));
  await draftUnavailable(page,width+'px off turn');
  await checkSteppers(page,'.domestic-trade-card fieldset','#board-trade-pane',width+'px disabled trade');
  await page.evaluate(()=>window.__persistentFixture.view('Player 1'));
 }
 await page.setViewportSize({width:375,height:812});
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 const camera=await page.evaluate(()=>window.__hex3D?.inspect());await page.evaluate(()=>window.__persistentFixture.hand(0));
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 const after=await page.evaluate(()=>window.__hex3D?.inspect());if(camera&&after){assert.deepEqual(after.camera,camera.camera);assert.deepEqual(after.target,camera.target);assert.equal(after.instanceId,camera.instanceId);}
 await screenshot(page,'classic-disabled-mobile');
 assert.deepEqual(errors,[]);console.log('PASS persistent actions, trade pairs, transitions, input and mobile layout');
}finally{await browser?.close();server?.kill('SIGTERM');await rm(source,{force:true});await rm(html,{force:true});}
