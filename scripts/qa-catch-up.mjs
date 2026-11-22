// Browser acceptance harness: node scripts/qa-catch-up.mjs (requires Playwright and Chromium).
// Fixture hooks are appended to a temporary Vite entry and are never shipped.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {readFile,writeFile,rm,mkdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {join} from 'node:path';
const root=process.env.GAME_SOURCE_ROOT||process.cwd(),source='src/__catch-up-fixture.ts',html='__catch-up-fixture.html';
const evidence=process.env.CATCH_UP_EVIDENCE||'catch-up-evidence';
const url='http://127.0.0.1:4184/hex-island-game/'+html+'?qa3d=1';
const fixture=`
import {drawIndex as fixtureDraw} from './game/rules/state.ts';
(window as any).__supplementFixture={
 load(variant:'normal'|'seven'|'off'|'low'='normal'){
  clearBotTimer();clearSupplement();boardRenderer?.clearRoll();remote=null;projection=null;networkRevision=0;localBotIds=new Set();
  localPaused=false;localPauseAt=0;localActionDeadlines.clear();pendingClockCommand=null;
  localUndoState=null;localUndoPlayerId='';localUndoDeadlines=null;pendingLocalUndo=null;targetMode=null;
  const next=createGame(24680,['Player 1','Player 2'],()=>0,{mode:'classic',rules:{catchUp:variant!=='off',ships:false}});
  const tile=next.board.hexes.find(h=>h.token===8&&h.resource!==null)!;
  const geometry=createIslandBoard(next.board.layout),hex=geometry.hexes.find(h=>h.id===tile.hexId)!;
  const city=hex.vertexIds[0];next.buildings[city]={playerId:'Player 1',kind:'city'};
  if(variant!=='low')for(const v of geometry.vertices.filter(v=>v.id!==city).slice(0,4))next.buildings[v.id]={playerId:'Player 2',kind:'city'};
  if(next.board.robberHexId===tile.hexId)next.board.robberHexId=next.board.hexes.find(h=>h.hexId!==tile.hexId)!.hexId;
  next.currentSeat=0;next.phase='roll';next.turn=9;next.dice=null;
  if(variant==='seven'){next.players[0].hand.lumber=7;next.bank.lumber-=7;}
  const total=variant==='seven'?7:8;
  for(let seed=0;seed<10000;seed++){const a=fixtureDraw(seed,6),b=fixtureDraw(a.state,6);if(a.index+b.index+2===total){next.randomState=seed;break;}}
  state=next;viewer='Player 1';activeLocalRoom=createLocalRoomSettings(24680,2,0,'classic',{catchUp:variant!=='off',ships:false});
  syncLocalActionClock();log=[];publicActivity='Supplement fixture';lastTurnCue='9:0';pendingActivityAlert='';pendingRollPresentation=null;
  el('pass').hidden=true;el('game').hidden=false;enterGame();render();
  (window as any).__supplementExpected={total,resource:tile.resource,city};
 },
 result(){return {reward:state?.catchUpReward,discards:state?.discards,hand:state?.players[0].hand,phase:state?.phase};},
 refresh(){state=structuredClone(state);render();},
};`;
await mkdir(evidence,{recursive:true});let server,browser,active;const errors=[];
try{
 const ui=await readFile(join(root,'src/game-ui.ts'),'utf8'),index=await readFile(join(root,'index.html'),'utf8');
 await writeFile(join(root,source),ui+'\n'+fixture);await writeFile(join(root,html),index.replace('/src/game-ui.ts','/'+source));
 server=spawn(process.execPath,[join(root,'node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port','4184','--strictPort'],{cwd:root,stdio:'ignore'});
 for(let i=0;i<100;i++){try{if((await fetch(url)).ok)break;}catch{}await delay(200);}
 browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 for(const mode of ['3d','2d']){
  active=await browser.newPage({viewport:{width:1600,height:900}});active.on('pageerror',e=>errors.push(String(e)));
  await active.goto(url+(mode==='2d'?'&renderer=2d':''),{waitUntil:'networkidle'});
  await active.evaluate(()=>window.__supplementFixture.load());
  await active.getByRole('button',{name:'Roll dice',exact:true}).click();
  assert.equal(await active.locator('.supplement-alert').count(),0,'supplement must wait for dice');
  await active.waitForFunction(()=>window.__hex3D.inspect().rollEffect?.landed===true,null,{timeout:8000});
  const effect=await active.evaluate(()=>window.__hex3D.inspect().rollEffect),expected=await active.evaluate(()=>window.__supplementFixture.result());
  assert.equal(await active.locator('.supplement-alert').count(),0,'supplement must wait for production animation');
  const fixtureExpected=await active.evaluate(()=>window.__supplementExpected);
  if(mode==='3d'){const city=effect.gainLabels.find(x=>x.vertexId===fixtureExpected.city);assert.ok(city,'production has a separate building gain');assert.equal(city.gains.find(x=>x.resource===fixtureExpected.resource)?.count,2);}
  else {const city=active.locator('[data-roll-building="'+fixtureExpected.city+'"]');assert.equal(await city.locator('[data-resource="'+fixtureExpected.resource+'"]').textContent(),'+2');}
  assert.equal(Object.values(expected.reward.gains).reduce((a,b)=>a+b,0),2);
  const alert=active.locator('.supplement-alert');await alert.waitFor({state:'visible',timeout:8000});
  assert.equal(await alert.locator('strong').textContent(),'Player 1 gained supplement');
  const visible=await alert.locator('[data-resource]').evaluateAll(nodes=>Object.fromEntries(nodes.map(n=>[n.dataset.resource,Number(n.textContent.match(/\+(\d+)/)?.[1])])));
  assert.deepEqual(visible,Object.fromEntries(Object.entries(expected.reward.gains).filter(([,n])=>n>0)));
  assert.equal(await alert.locator('[data-resource] svg').count(),Object.keys(visible).length);
  await active.evaluate(async()=>{await document.fonts.ready;await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);});await active.screenshot({path:join(evidence,mode+'-supplement.png')});
  await active.evaluate(()=>window.__supplementFixture.refresh());assert.equal(await active.locator('.supplement-alert').count(),1);
  await alert.waitFor({state:'detached',timeout:5000});await active.evaluate(()=>window.__supplementFixture.refresh());await delay(300);
  assert.equal(await active.locator('.supplement-alert').count(),0,'render/reconnect-like update must not replay reward');
  await active.evaluate(()=>window.__supplementFixture.load('seven'));
  await active.getByRole('button',{name:'Roll dice',exact:true}).click();
  const seven=await active.evaluate(()=>window.__supplementFixture.result());assert.equal(seven.phase,'robber');assert.deepEqual(seven.discards,{});assert.equal(Object.values(seven.hand).reduce((a,b)=>a+b,0),9);
  await alert.waitFor({state:'visible',timeout:8000});assert.equal(await alert.locator('strong').textContent(),'Player 1 gained supplement');
  for(const variant of ['off','low']){
   await active.evaluate(v=>window.__supplementFixture.load(v),variant);await active.getByRole('button',{name:'Roll dice',exact:true}).click();
   await delay(4000);assert.equal(await active.locator('.supplement-alert').count(),0);assert.equal((await active.evaluate(()=>window.__supplementFixture.result())).reward,undefined);
  }
  console.log('PASS '+mode+' production before separate exact supplement, seven pre-award discard, no repeat, disabled rule');await active.close();
 }
 assert.deepEqual(errors,[]);
}catch(error){console.error(error?.stack||error);process.exitCode=1;try{await active?.screenshot({path:join(evidence,'failure.png')});}catch{}}
finally{await browser?.close();server?.kill('SIGTERM');await rm(join(root,source),{force:true});await rm(join(root,html),{force:true});}
