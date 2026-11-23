import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const root=process.env.GAME_SOURCE_ROOT || process.cwd();
const html=join(root,'__trade-camera-fixture.html');
const source=join(root,'src/__trade-camera-fixture.ts');
const fixture=[
 "(window as any).__tradeCameraFixture = {",
 " load(mode: 'classic'|'harbor-coop'='classic') {",
 "  clearBotTimer(); remote=null; projection=null; networkRevision=0;localBotIds=new Set();",
 "  localPaused=false;localPauseAt=0;localActionDeadlines.clear();pendingClockCommand=null;localUndoDeadlines=null;",
 "  localUndoState=null;localUndoPlayerId='';pendingLocalUndo=null;targetMode=null;",
 "  const next=createGame(24680,['Player 1','Player 2'],()=>0,{mode});",
 "  next.phase='action';next.currentSeat=0;next.turn=7;",
 "  for(const [index,player] of next.players.entries()) for(const resource of RESOURCES){",
 "   const value=index===0?6:4;next.bank[resource]+=player.hand[resource]-value;player.hand[resource]=value;",
 "  }",
 "  if(mode==='harbor-coop'){",
 "   const board=createIslandBoard();",
 "   const junction=board.vertices.find(v=>board.edges.filter(e=>e.vertexIds.includes(v.id)).length===3)!;",
 "   const roads=board.edges.filter(e=>e.vertexIds.includes(junction.id));",
 "   next.roads[roads[0].id]='Player 1';next.roads[roads[1].id]='Player 2';",
 "   next.harbor!.stations={[junction.id]:{vertexId:junction.id,builtBy:'Player 1',lastSentTurns:{}}};",
 "  }",
 "  state=next;viewer='Player 1';activeLocalRoom=createLocalRoomSettings(24680,2,0,mode);syncLocalActionClock();",
 "  log=[];publicActivity='Trade camera test';lastTurnCue='';pendingActivityAlert='';pendingRollPresentation=null;",
 "  el('pass').hidden=true;el('game').hidden=false;enterGame();render();",
 " },",
 " view(id:string){viewer=id;render();},",
 " hand(id:string){return {...state!.players.find(p=>p.id===id)!.hand};},",
 " offer(){return state?.offer?.id??null;}",
 "};"
].join('\n');
let server,browser;
const origin='http://127.0.0.1:4181/hex-island-game/__trade-camera-fixture.html?qa3d=1';
const dist=(a,b)=>Math.max(...a.map((v,i)=>Math.abs(v-b[i])));
const inspect=p=>p.evaluate(()=>({
 camera:(window).__hex3D.inspect(),
 height:document.querySelector('.board-stage').style.getPropertyValue('--board-fit-height'),
 pageScroll:window.scrollY,
 board:(()=>{const r=document.querySelector('#board').getBoundingClientRect();return [r.width,r.height];})()
}));
function unchanged(a,b,label){
 const camA=a.camera,camB=b.camera;
 for(const name of ['camera','target','quaternion','frustum','projection'])
  assert.ok(dist(camA[name],camB[name])<1e-5,label+' camera '+name+' shifted: '+JSON.stringify([camA[name],camB[name]]));
 assert.ok(Math.abs(camA.zoom-camB.zoom)<1e-6,label+' zoom');
 assert.equal(camB.instanceId,camA.instanceId,label+' scene instance changed');
 assert.equal(camB.mapBuilds,camA.mapBuilds,label+' static scene rebuilt');
 assert.equal(b.height,a.height,label+' board-stage height shifted');
 assert.ok(dist(b.board,a.board)<1e-4,label+' board dimensions shifted');
}
const clockSeconds=async p=>{
 const [minutes,seconds]=(await p.locator('#turn-action-clock-seconds').textContent()).split(':').map(Number);
 return minutes*60+seconds;
};
const settle=p=>p.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
async function orbit(p){
 const b=await p.locator('#board canvas').boundingBox();
 await p.mouse.move(b.x+b.width*.55,b.y+b.height*.5);
 await p.mouse.down({button:'middle'});
 await p.mouse.move(b.x+b.width*.55+74,b.y+b.height*.5-26,{steps:10});
 await p.mouse.up({button:'middle'});
 await settle(p);
}
try{
 const ui=await readFile(join(root,'src/game-ui.ts'),'utf8');
 const markup=await readFile(join(root,'index.html'),'utf8');
 await writeFile(source,ui+'\n'+fixture);
 await writeFile(html,markup.replace('/src/game-ui.ts','/src/__trade-camera-fixture.ts'));
 server=spawn(process.execPath,[join(root,'node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port','4181','--strictPort'],{cwd:root,stdio:'ignore'});
 for(let i=0;i<120;i++){try{if((await fetch(origin)).ok)break;}catch{}await delay(200);}
 browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const page=await browser.newPage({viewport:{width:1600,height:900}});
 const errors=[];page.on('pageerror',error=>errors.push(String(error)));
 await page.goto(origin,{waitUntil:'networkidle'});
 await page.evaluate(()=>window.__tradeCameraFixture.load());
 await page.waitForFunction(()=>window.__hex3D?.inspect().mode==='3d');
 await settle(page);
 await orbit(page);
 await page.evaluate(()=>{document.body.style.minHeight='1900px';window.scrollTo(0,180);});
 await settle(page);
 const before=await inspect(page);
 assert.ok(before.camera.manualView);
 await delay(1500);
 const beforeBankClock=await clockSeconds(page);assert.ok(beforeBankClock<60);
 const oldHand=await page.evaluate(()=>window.__tradeCameraFixture.hand('Player 1'));
 await page.locator('#trade-actions [aria-label="Trade 4 lumber for 1 brick"]').click();
 await settle(page);
 let after=await inspect(page);
 unchanged(before,after,'Bank trade');
 const newHand=await page.evaluate(()=>window.__tradeCameraFixture.hand('Player 1'));
 assert.equal(newHand.lumber,oldHand.lumber-4);assert.equal(newHand.brick,oldHand.brick+1);
 assert.ok(await clockSeconds(page)>=59,'completed bank trade resets the clock');
 console.log('PASS bank trade preserves zoom, angle, fit, map and canvas',JSON.stringify({height:after.height,scroll:after.pageScroll}));
 await delay(1500);
 const beforeOfferClock=await clockSeconds(page);assert.ok(beforeOfferClock<60);
 const offerBefore=await inspect(page);
 await page.locator('#trade-actions .domestic-trade-card summary').click();
 await page.locator('#trade-actions .domestic-trade-card fieldset').nth(0).getByRole('button',{name:'Add one lumber'}).click();
 await page.locator('#trade-actions .domestic-trade-card fieldset').nth(1).getByRole('button',{name:'Add one grain'}).click();
 await page.getByRole('button',{name:'Make offer'}).click();
 await settle(page);
 const offerAfter=await inspect(page);
 unchanged(offerBefore,offerAfter,'Domestic offer');
 assert.ok(await page.evaluate(()=>window.__tradeCameraFixture.offer()));
 assert.ok(await clockSeconds(page)<=beforeOfferClock,'proposal and draft interactions do not reset the clock');
 await page.evaluate(()=>window.__tradeCameraFixture.view('Player 2'));
 await settle(page);
 await delay(1500);
 const beforeAcceptClock=await clockSeconds(page);assert.ok(beforeAcceptClock<60);
 const acceptBefore=await inspect(page);
 await page.getByRole('button',{name:'Accept trade'}).click();
 await settle(page);
 unchanged(acceptBefore,await inspect(page),'Domestic trade acceptance');
 assert.equal(await page.evaluate(()=>window.__tradeCameraFixture.offer()),null);
 assert.ok(await clockSeconds(page)>=59,'other-seat acceptance resets the active proposer clock');
 console.log('PASS domestic offer and acceptance preserve the 3D view');
 await page.evaluate(()=>window.__tradeCameraFixture.load('harbor-coop'));
 await settle(page);
 await orbit(page);
 await delay(1500);
 assert.ok(await clockSeconds(page)<60);
 const transferBefore=await inspect(page);
 const prevHand=await page.evaluate(()=>window.__tradeCameraFixture.hand('Player 1'));
 await page.locator('#harbor-panel [data-send-resource]').first().click();
 await settle(page);
 unchanged(transferBefore,await inspect(page),'Co-op station resource transfer');
 const remaining=await page.evaluate(()=>window.__tradeCameraFixture.hand('Player 1'));
 assert.equal(Object.values(prevHand).reduce((a,b)=>a+b,0)-Object.values(remaining).reduce((a,b)=>a+b,0),1);
 assert.ok(await clockSeconds(page)>=59,'completed Harbor gift resets the clock');
 console.log('PASS co-op station gift preserves the 3D view');
 assert.deepEqual(errors,[]);
}finally{
 await browser?.close();server?.kill('SIGTERM');
 await rm(source,{force:true});await rm(html,{force:true});
}
