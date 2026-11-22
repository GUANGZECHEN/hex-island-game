import {clickBoardTarget} from './qa-board-targets.mjs';
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
 offer(canAccept=true){const empty=()=>({lumber:0,brick:0,wool:0,grain:0,ore:0});state!.offer={id:'fixture',proposer:'Player 1',targets:['Player 2'],give:{...empty(),lumber:1},receive:{...empty(),brick:1}};state!.players[1].hand.brick=canAccept?1:0;render();},
 discard(){state!.phase='discard';state!.discards={'Player 1':2};discardSubmitted=false;render();},
 deadline(){return localActionDeadlines.get('Player 1');},
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
 await page.locator('.learn-action-panel').waitFor();
 const learning=page.locator('.learn-action-grid');
 assert.equal(await learning.locator('button.action-button').count(),4,'exactly four learning actions are shown');
 for(const name of ['Build road','Build settlement','Upgrade house to city','Buy development card'])await presentDisabled(page,name);
 for(const [name,cost] of Object.entries({
  'Build road':{lumber:1,brick:1},'Build settlement':{lumber:1,brick:1,wool:1,grain:1},
  'Upgrade house to city':{grain:2,ore:3},'Buy development card':{wool:1,grain:1,ore:1},
 })){
  const chips=await button(page,name).locator('.action-cost .resource-chip').evaluateAll(nodes=>nodes.map(n=>({className:n.className,text:n.textContent.trim()})));
  assert.equal(chips.length,Object.keys(cost).length,name+' cost resource count');
  for(const [resource,amount] of Object.entries(cost))assert.ok(chips.some(chip=>chip.className.includes('resource-chip-'+resource)&&chip.text.endsWith(String(amount))),name+' '+resource+' cost');
 }
 const deadline=await page.evaluate(()=>window.__persistentFixture.deadline());
 assert.equal(await button(page,'Roll dice').count(),0,'roll is hidden outside roll phase');
 assert.equal(await page.locator('#actions button.action-button').filter({hasText:'End turn'}).count(),1,'only currently executable end turn is shown');
 assert.equal(await page.locator('#trade-actions .bank-trade-button').count(),0,'unavailable bank exchanges are hidden');
 assert.equal(await page.locator('.domestic-trade-card').count(),0,'trade composer is hidden outside a valid action turn');
 const before=await page.evaluate(()=>window.__persistentFixture.snapshot());
 await button(page,'Build road').evaluate(b=>b.click());
 assert.equal(await page.evaluate(()=>window.__persistentFixture.snapshot()),before,'disabled learning action cannot mutate game state');
 assert.equal(await page.evaluate(()=>window.__persistentFixture.deadline()),deadline,'disabled control does not reset the action clock');
 await page.evaluate(()=>window.__persistentFixture.hand(5));
 assert.equal(await button(page,'Build road').isEnabled(),true,'affordable legal road becomes enabled');
 assert.equal(await button(page,'Build settlement').isDisabled(),true,'settlement remains unavailable without a legal site');
 assert.equal(await button(page,'Upgrade house to city').isEnabled(),true,'city upgrade becomes enabled when a legal owned settlement and resources are available');
 assert.ok(await page.locator('#trade-actions .bank-trade-button').count()>0,'only executable bank exchanges are shown');
 const cityBefore=JSON.parse(await page.evaluate(()=>window.__persistentFixture.snapshot()));
 await button(page,'Upgrade house to city').click();await clickBoardTarget(page);
 const cityAfter=JSON.parse(await page.evaluate(()=>window.__persistentFixture.snapshot()));
 assert.equal(Object.values(cityAfter.buildings).filter(b=>b.playerId==='Player 1'&&b.kind==='city').length,Object.values(cityBefore.buildings).filter(b=>b.playerId==='Player 1'&&b.kind==='city').length+1,'reference control performs a real city upgrade');
 await page.evaluate(()=>{window.__persistentFixture.load();window.__persistentFixture.hand(5);});
 await page.evaluate(()=>window.__persistentFixture.phase('roll'));
 assert.equal(await button(page,'Roll dice').isEnabled(),true,'roll is shown in roll phase');
 assert.equal(await page.locator('#actions button.action-button').filter({hasText:'End turn'}).count(),0,'end turn hidden outside action phase');
 await presentDisabled(page,'Build road');
 await page.evaluate(()=>window.__persistentFixture.phase('action'));
 assert.equal(await button(page,'Build road').isEnabled(),true,'returning to action restores legal build');
 await page.evaluate(()=>window.__persistentFixture.cards('new'));
 assert.equal(await page.locator('[data-development="knight"]').count(),0,'new development card is not playable');
 await page.evaluate(()=>window.__persistentFixture.cards('old'));
 assert.equal(await page.locator('[data-development="knight"]').isEnabled(),true,'old owned card is shown when playable');
 await page.locator('.domestic-trade-card summary').click();
 assert.equal(await button(page,'Make offer').isDisabled(),true,'empty offer is invalid');
 await page.locator('.domestic-trade-card fieldset').nth(0).getByRole('button',{name:'Add one lumber'}).click();
 assert.equal(await button(page,'Make offer').isDisabled(),true,'one-sided offer is invalid');
 await page.locator('.domestic-trade-card fieldset').nth(1).getByRole('button',{name:'Add one grain'}).click();
 assert.equal(await button(page,'Make offer').isEnabled(),true,'complete affordable offer is valid');
 await screenshot(page,'classic-valid-desktop');
 await page.evaluate(()=>window.__persistentFixture.discard());
 assert.equal(await button(page,'Discard').isDisabled(),true,'discard draft starts invalid');
 await page.locator('#actions fieldset.resource-stepper-grid').getByRole('button',{name:'Add one lumber'}).click();
 await page.locator('#actions fieldset.resource-stepper-grid').getByRole('button',{name:'Add one lumber'}).click();
 assert.equal(await button(page,'Discard').isEnabled(),true,'complete discard draft becomes executable');
 const discardBefore=JSON.parse(await page.evaluate(()=>window.__persistentFixture.snapshot()));
 await button(page,'Discard').click();
 const discardAfter=JSON.parse(await page.evaluate(()=>window.__persistentFixture.snapshot()));
 assert.equal(discardAfter.players[0].hand.lumber,discardBefore.players[0].hand.lumber-2,'discard command removes selected cards');
 assert.equal(discardAfter.discards['Player 1'],undefined,'completed discard clears the player requirement');
 assert.equal(await button(page,'Discard').count(),0,'completed discard control disappears');
 await page.evaluate(()=>{window.__persistentFixture.load();window.__persistentFixture.hand(5);});
 await page.evaluate(()=>window.__persistentFixture.view('Player 2'));
 assert.equal(await page.locator('#actions button.action-button').filter({hasText:'End turn'}).count(),0,'off-turn action buttons are hidden');
 for(const name of ['Build road','Build settlement','Upgrade house to city','Buy development card'])await presentDisabled(page,name);
 await page.evaluate(()=>window.__persistentFixture.offer(false));
 assert.equal(await button(page,'Accept trade').count(),0,'unaffordable incoming offer hides Accept');
 assert.equal(await button(page,'Reject trade').isEnabled(),true,'unaffordable incoming offer can still be rejected');
 const shortfall=page.locator('.incoming-trade .trade-insufficient');
 assert.equal(await shortfall.isVisible(),true,'unaffordable incoming offer shows a shortfall');
 assert.match(await shortfall.innerText(),/\b1 brick\b/i,'shortfall identifies the missing resource and amount');
 await page.evaluate(()=>window.__persistentFixture.offer());
 assert.equal(await shortfall.count(),0,'affordable incoming offer shows no shortfall');
 assert.equal(await button(page,'Accept trade').isEnabled(),true,'incoming trade can still be accepted off turn');
 assert.equal(await button(page,'Reject trade').isEnabled(),true,'incoming trade can still be rejected off turn');
 await page.evaluate(()=>window.__persistentFixture.view('Player 1'));
 await page.evaluate(()=>window.__persistentFixture.paused(true));
 for(const name of ['Build road','Build settlement','Upgrade house to city','Buy development card'])await presentDisabled(page,name);
 assert.equal(await page.locator('#actions > .action-grid button').count(),0,'ordinary gameplay actions are hidden while paused');
 await page.evaluate(()=>window.__persistentFixture.paused(false));
 assert.equal(await button(page,'Build road').isEnabled(),true,'resume restores legal build');
 await page.evaluate(()=>window.__persistentFixture.phase('finished'));
 for(const name of ['Build road','Build settlement','Upgrade house to city','Buy development card'])await presentDisabled(page,name);
 await page.evaluate(()=>window.__persistentFixture.load('harbor-coop'));
 assert.equal(await learning.locator('button.action-button').count(),3,'Co-op omits development-card reference because that rule is disabled');
 assert.equal(await page.locator('.development-actions-inline').count(),0,'Co-op has no development-card play panel');
 await page.evaluate(()=>window.__persistentFixture.paused(true));
 await screenshot(page,'coop-disabled-desktop');
 await page.evaluate(()=>window.__persistentFixture.load('classic',true));
 assert.equal(await page.locator('[data-action="ship"]').count(),0,'unavailable optional ship action is hidden');
 await page.evaluate(()=>window.__persistentFixture.load('classic',false));
 assert.equal(await page.locator('[data-action="ship"]').count(),0,'optional ships remain excluded when off');
 for(const width of [1280,375,320]){
  await page.setViewportSize({width,height:812});
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,width+'px panel does not overflow');
  const metrics=await learning.locator('button.action-button').evaluateAll(nodes=>nodes.map(node=>{const r=node.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width,disabled:node.disabled};}));
  assert.equal(metrics.length,4);
  assert.ok(metrics.every(x=>x.width>0&&x.left>=0&&x.right<=width+1),width+'px learning cards fit viewport');
  await page.screenshot({path:`${evidence}/learning-panels-${width}.png`,fullPage:true});
 }
 assert.deepEqual(errors,[]);console.log('PASS actionable-only controls, four persistent learning panels, resource costs and mobile layout');
}finally{await browser?.close();server?.kill('SIGTERM');await rm(source,{force:true});await rm(html,{force:true});}
