// Focused browser acceptance: GAME_SOURCE_ROOT=<checkout> node scripts/qa-unlimited-bank.mjs
// The temporary Vite entry uses the real UI, reducer and recipient snapshot callback.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const root=process.env.GAME_SOURCE_ROOT||process.cwd();
const source=`src/__unlimited-bank-${process.pid}.ts`, html=`__unlimited-bank-${process.pid}.html`;
const url=`http://127.0.0.1:4189/hex-island-game/${html}?qa3d=1`;
const evidence=process.env.UNLIMITED_BANK_EVIDENCE||'unlimited-bank-evidence';
const fixture=`
import {drawIndex as unlimitedDraw} from './game/rules/state.ts';
import {projectState as unlimitedProject} from './game/network/authority.ts';
(window as any).__unlimitedFixture={
 load(){
  clearBotTimer();clearSupplement();boardRenderer?.clearRoll();remote=null;projection=null;networkRevision=0;localBotIds=new Set();
  localPaused=false;localPauseAt=0;localActionDeadlines.clear();pendingClockCommand=null;
  localUndoState=null;localUndoPlayerId='';localUndoDeadlines=null;pendingLocalUndo=null;pendingRollPresentation=null;targetMode=null;
  const next=createGame(24680,['Player 1','Player 2'],()=>0);
  const tile=next.board.hexes.find(h=>h.token===8&&h.resource!==null&&h.hexId!==next.board.robberHexId)!;
  const hex=createIslandBoard(next.board.layout).hexes.find(h=>h.id===tile.hexId)!;
  const city=hex.vertexIds[0],settlement=hex.vertexIds[2];
  next.buildings[city]={playerId:'Player 1',kind:'city'};
  next.buildings[settlement]={playerId:'Player 2',kind:'settlement'};
  // Make the matching tile the only producing tile, so the expected awards are independent of map layout.
  for(const cell of next.board.hexes)if(cell.hexId!==tile.hexId&&cell.token===8)cell.token=9;
  for(const resource of RESOURCES)next.bank[resource]=resource===tile.resource?0:-2;
  next.currentSeat=0;next.phase='roll';next.turn=9;next.dice=null;
  for(let seed=0;seed<10000;seed++){const a=unlimitedDraw(seed,6),b=unlimitedDraw(a.state,6);if(a.index+b.index+2===8){next.randomState=seed;break;}}
  state=next;viewer='Player 1';activeLocalRoom=createLocalRoomSettings(24680,2,0);syncLocalActionClock();
  log=[];publicActivity='Unlimited bank fixture';lastTurnCue='9:0';pendingActivityAlert='';
  el('pass').hidden=true;el('game').hidden=false;enterGame(true);render();
  return {resource:tile.resource,city,settlement};
 },
 snapshot(revision:number,id:string){return {id,packet:structuredClone(unlimitedProject(state!,id,revision,'unlimited-browser-qa'))};},
 data(){return structuredClone({players:state!.players,bank:state!.bank,receipt:state!.lastRollPayout});},
 trade(){
  const p=state!.players[0];for(const r of RESOURCES)p.hand[r]=0;
  p.hand.lumber=4;state!.bank.brick=-3;state!.phase='action';render();
 }
};`;

const phone={viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1};
let server,browser,active; const errors=[];
async function checkBank(page){
 const ledger=page.locator('#board-ledger');
 if(await ledger.getAttribute('open')===null)await ledger.locator(':scope > summary').click();
 const chips=page.locator('#bank .resource-chip'); assert.equal(await chips.count(),5);
 for(const chip of await chips.all()){
  assert.equal(await chip.locator('.resource-count').textContent(),'∞');
  assert.match(await chip.getAttribute('aria-label'),/unlimited/i);
 }
 assert.doesNotMatch(await page.locator('#bank').innerText(),/-\d/);
}
async function hand(page){return page.locator('#hand .resource-chip').evaluateAll(nodes=>Object.fromEntries(nodes.map(n=>[n.dataset.resource,Number(n.querySelector('.resource-count').textContent)])));}
async function receipt(page,id,counts){
 const item=page.locator('#log li[data-roll-turn="9"]');assert.equal(await item.count(),1);
 const text=await item.textContent();for(const [player,count] of Object.entries(counts))assert.ok(text.includes(player+' +'+count),text);
 assert.equal(await page.locator('#roll-payout').getAttribute('data-gain'),String(counts[id]));
}
try{
 await mkdir(evidence,{recursive:true});
 let ui=await readFile(join(root,'src/game-ui.ts'),'utf8');
 const entry='const network=initializeNetwork(';assert.ok(ui.includes(entry),'recipient snapshot hook exists');
 ui=ui.replace(entry,`const network=((callbacks:Parameters<typeof initializeNetwork>[0])=>{(window as any).__unlimitedDeliver=callbacks.snapshot;return initializeNetwork(callbacks);})(`);
 const index=await readFile(join(root,'index.html'),'utf8');
 await writeFile(join(root,source),ui+'\n'+fixture);await writeFile(join(root,html),index.replace('/src/game-ui.ts','/'+source));
 server=spawn(process.execPath,[join(root,'node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port','4189','--strictPort'],{cwd:root,stdio:'ignore'});
 let ready=false;for(let i=0;i<100&&!ready;i++){try{ready=(await fetch(url)).ok;}catch{}if(!ready)await delay(150);}assert.ok(ready,'fixture server started');
 for(const mode of ['2d','3d']){
  browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:mode==='3d'?['--use-angle=swiftshader','--enable-unsafe-swiftshader']:['--disable-gpu']});
  active=await browser.newPage(mode==='2d'?phone:{viewport:{width:1280,height:900}});active.setDefaultTimeout(12000);active.on('pageerror',e=>errors.push(String(e)));
  const target=url+(mode==='2d'?'&renderer=2d':'');await active.goto(target,{waitUntil:'networkidle'});
  const plan=await active.evaluate(()=>window.__unlimitedFixture.load());
  // Guest checks concern the real mobile receipt and hand, not its renderer.
  // Avoid running two concurrent software-rendered 3D scenes in CI.
  const guest=await browser.newPage(phone);guest.on('pageerror',e=>errors.push(String(e)));await guest.goto(url+'&renderer=2d',{waitUntil:'networkidle'});
  const deliver=async revision=>{const packet=await active.evaluate(revision=>window.__unlimitedFixture.snapshot(revision,'Player 2'),revision);await guest.evaluate(({packet,id})=>window.__unlimitedDeliver(packet,id),packet);};
  await deliver(0);await checkBank(active);await checkBank(guest);
  const before=[await hand(active),await hand(guest)];
  // The guest was opened after the host. Keep the host visible and wait for its
  // renderer before rolling, as the 3D animation is shortened in a hidden tab.
  await active.bringToFront();
  await active.waitForFunction(mode=>!document.hidden&&window.__hex3D?.inspect().mode===mode,mode,{timeout:12000});
  if(mode==='3d')await active.waitForFunction(()=>window.__hex3D.renderedFrames()>0,null,{timeout:12000});
  // Observe before clicking: a slow awaited click can outlive the transient
  // landing and labels, even though the roll and payout already succeeded.
  await active.evaluate(({mode,city,settlement,resource})=>{
   window.__unlimitedLanding=null;
   window.__unlimitedObservation={samples:0,maxGapMs:0,sawRoll:false,lastEffect:null};
   let last=performance.now();
   const timer=setInterval(()=>{
    const now=performance.now(), observation=window.__unlimitedObservation;
    observation.samples++;observation.maxGapMs=Math.max(observation.maxGapMs,now-last);last=now;
    const effect=window.__hex3D?.inspect().rollEffect;
    if(effect){observation.sawRoll=true;observation.lastEffect={landed:effect.landed};}
    if(!effect?.landed)return;
    window.__unlimitedLanding=mode==='3d'
     ?effect.gainLabels.map(label=>({vertexId:label.vertexId,gains:label.gains}))
     :[city,settlement].map(vertexId=>({vertexId,text:document.querySelector(`[data-roll-building="${vertexId}"] [data-resource="${resource}"]`)?.textContent}));
    clearInterval(timer);
   },20);
  },{mode,city:plan.city,settlement:plan.settlement,resource:plan.resource});
  await active.getByRole('button',{name:'Roll dice',exact:true}).click();
  const labels=await (await active.waitForFunction(()=>window.__unlimitedLanding,null,{timeout:10000})).jsonValue();
  if(mode==='3d'){
   for(const [id,count] of [[plan.city,2],[plan.settlement,1]])assert.equal(labels.find(x=>x.vertexId===id)?.gains.find(x=>x.resource===plan.resource)?.count,count);
  }else for(const [id,count] of [[plan.city,2],[plan.settlement,1]])assert.equal(labels.find(x=>x.vertexId===id)?.text,'+'+count);
  const after=await active.evaluate(()=>window.__unlimitedFixture.data());
  assert.equal(after.players[0].hand[plan.resource]-before[0][plan.resource],2);
  assert.equal(after.players[1].hand[plan.resource]-before[1][plan.resource],1);
  assert.equal(after.bank[plan.resource],-3,'ledger may cross zero');
  await deliver(1);await deliver(1);
  const guestHand=await hand(guest);assert.equal(guestHand[plan.resource]-before[1][plan.resource],1);
  await receipt(active,'Player 1',{'Player 1':2,'Player 2':1});await receipt(guest,'Player 2',{'Player 1':2,'Player 2':1});
  await checkBank(active);await checkBank(guest);
  await active.evaluate(()=>window.__unlimitedFixture.trade());
  const trade=active.getByRole('button',{name:'Trade 4 lumber for 1 brick',exact:true});assert.equal(await trade.count(),1);assert.equal(await trade.isEnabled(),true);
  assert.equal(await active.getByRole('button',{name:'Trade 4 ore for 1 brick',exact:true}).count(),0,'unaffordable trade is unavailable');
  await trade.click();const traded=await active.evaluate(()=>window.__unlimitedFixture.data());
  assert.equal(traded.players[0].hand.lumber,0);assert.equal(traded.players[0].hand.brick,1);assert.equal(traded.bank.brick,-4);
  await checkBank(active);await active.screenshot({path:join(evidence,mode+'-trade.png')});
  console.log('PASS '+mode+' full production at zero stock, guest receipts, accessible unlimited bank, and affordable trade');
  await browser.close();browser=null;active=null;
 }
 assert.deepEqual(errors,[]);
}catch(error){
 console.error(error?.stack||error);process.exitCode=1;
 try{
  if(active){
   const diagnostic=await active.evaluate(()=>{
    const view=window.__hex3D?.inspect(),rect=document.querySelector('#board')?.getBoundingClientRect();
    const data=window.__unlimitedFixture?.data();
    return {mode:view?.mode,frames:window.__hex3D?.renderedFrames(),rollEffect:view?.rollEffect??null,
     hidden:document.hidden,board:rect?{x:rect.x,y:rect.y,width:rect.width,height:rect.height}:null,
     observation:window.__unlimitedObservation??null,hands:data?.players.map(p=>({id:p.id,hand:p.hand})),receipt:data?.receipt??null};
   });
   console.error('Unlimited-bank diagnostics:',JSON.stringify(diagnostic));
   await active.screenshot({path:join(evidence,'failure.png')});
  }
 }catch(diagnosticError){console.error('Could not collect diagnostics:',String(diagnosticError));}
}
finally{await browser?.close();server?.kill('SIGTERM');await rm(join(root,source),{force:true});await rm(join(root,html),{force:true});}
