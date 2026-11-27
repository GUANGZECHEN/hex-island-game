// Focused acceptance: real host authority and network recipient callbacks, without a relay.
// GAME_SOURCE_ROOT=<checkout> node scripts/qa-discard-map.mjs
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const root=process.env.GAME_SOURCE_ROOT||process.cwd();
const source=`src/__discard-map-${process.pid}.ts`, html=`__discard-map-${process.pid}.html`;
const url=`http://127.0.0.1:4192/hex-island-game/${html}?qa3d=1`;
const evidence=process.env.DISCARD_MAP_EVIDENCE||'discard-map-evidence';
const fixture=`
import {HostAuthority as DiscardAuthority} from './game/network/authority.ts';
let discardAuthority:DiscardAuthority;
(window as any).__discardFixture={
 load(layout:'standard'|'twin-capes'){
  const game=createGame(24680,['Player 1','Player 2','Player 3'],()=>0,{boardLayout:layout});
  for(const player of game.players){for(const r of RESOURCES)player.hand[r]=0;player.hand.lumber=8;}
  game.bank.lumber-=24;
  game.currentSeat=0;game.phase='discard';game.turn=9;game.dice=[3,4];
  game.discards={'Player 1':4,'Player 2':4,'Player 3':4};
  discardAuthority=new DiscardAuthority('discard-browser-qa',game,()=>0);
 },
 packet(id:string){return id==='spectator'?discardAuthority.spectatorSnapshot():discardAuthority.snapshot(id);},
 receive(id:string,command:any){return discardAuthority.receive(id,JSON.stringify({protocol:1,gameId:'discard-browser-qa',revision:discardAuthority.currentRevision(),commandId:'qa-'+id.replace(/ /g,'-')+'-'+discardAuthority.currentRevision()+'-'+command.type,sender:id,command}));},
 data(){return structuredClone({phase:state?.phase,discards:state?.discards,board:state?.board,viewer,submitted:discardSubmitted,hand:state?.players.find(p=>p.id===viewer)?.hand});}
};`;
const phone={viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1};
const desktop={viewport:{width:1280,height:900}};
let server,browser,active;const errors=[];
const snapshot=(host,id)=>host.evaluate(id=>window.__discardFixture.packet(id),id);
async function deliver(host,page,id){const packet=await snapshot(host,id);await page.evaluate(({packet,id})=>window.__discardCallbacks.snapshot(packet,id),{packet,id});}
async function mark(page){return page.evaluate(()=>{const map=document.querySelector('#board svg, #board canvas');if(!map)throw Error('Board element missing');window.__discardMap=map;return {data:window.__discardFixture.data(),view:window.__hex3D.inspect()};});}
async function check(page,before,label){
 const after=await page.evaluate(()=>({same:window.__discardMap===document.querySelector('#board svg, #board canvas'),data:window.__discardFixture.data(),view:window.__hex3D.inspect()}));
 assert.ok(after.same,`${label}: board element replaced`);
 assert.deepEqual(after.data.board,before.data.board,`${label}: board setup changed`);
 assert.equal(after.view.rollEffect,null,`${label}: roll replayed`);
 if(before.view.mode==='3d'){
  for(const name of ['instanceId','mapBuilds','staticKey'])assert.deepEqual(after.view[name],before.view[name],`${label}: ${name}`);
  for(const name of ['camera','target','quaternion','frustum','projection'])assert.ok(after.view[name].every((v,i)=>Math.abs(v-before.view[name][i])<1e-5),`${label}: ${name}`);
  assert.ok(Math.abs(after.view.zoom-before.view.zoom)<1e-6,`${label}: zoom`);
 }
 return after;
}
async function chooseDiscard(page){
 const field=page.locator('fieldset').filter({hasText:'Discard exactly 4 cards'});
 for(let i=0;i<4;i++)await field.getByRole('button',{name:'Add one lumber'}).click();
 await page.getByRole('button',{name:'Discard',exact:true}).click();
 return page.evaluate(()=>window.__discardCommands.shift());
}
try{
 await mkdir(evidence,{recursive:true});
 let ui=await readFile(join(root,'src/game-ui.ts'),'utf8');
 const entry='const network=initializeNetwork(';assert.ok(ui.includes(entry),'network callback hook exists');
 ui=ui.replace(entry,`const network=((callbacks:Parameters<typeof initializeNetwork>[0])=>{(window as any).__discardCallbacks=callbacks;(window as any).__discardCommands=[];const client=initializeNetwork(callbacks);client.submit=(command:any)=>{(window as any).__discardCommands.push(command);};return client;})(`);
 const index=await readFile(join(root,'index.html'),'utf8');
 await writeFile(join(root,source),ui+'\n'+fixture);await writeFile(join(root,html),index.replace('/src/game-ui.ts','/'+source));
 server=spawn(process.execPath,[join(root,'node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port','4192','--strictPort'],{cwd:root,stdio:'ignore'});
 let ready=false;for(let i=0;i<100&&!ready;i++){try{ready=(await fetch(url)).ok;}catch{}if(!ready)await delay(150);}assert.ok(ready,'fixture server started');
 for(const [mode,viewport,boardLayout] of [['2d',phone,'standard'],['3d',desktop,'standard'],['2d',phone,'twin-capes']]){
  browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:mode==='3d'?['--use-angle=swiftshader','--enable-unsafe-swiftshader']:['--disable-gpu']});
  active=await browser.newPage(viewport);const guest=await browser.newPage(phone),spectator=await browser.newPage(desktop);
  for(const page of [active,guest,spectator]){page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(String(e)));}
  await active.goto(url+(mode==='2d'?'&renderer=2d':''),{waitUntil:'networkidle'});
  await guest.goto(url+'&renderer=2d',{waitUntil:'networkidle'});await spectator.goto(url+'&renderer=2d',{waitUntil:'networkidle'});
  await active.evaluate(layout=>window.__discardFixture.load(layout),boardLayout);
  for(const [page,id] of [[active,'Player 1'],[guest,'Player 2'],[spectator,'spectator']])await deliver(active,page,id);
  await active.bringToFront();await active.waitForFunction(mode=>window.__hex3D?.inspect().mode===mode,mode);
  if(mode==='3d'){
   await active.waitForFunction(()=>window.__hex3D.renderedFrames()>0);
   const box=await active.locator('#board canvas').boundingBox();assert.ok(box,'3D canvas has dimensions');
   await active.mouse.move(box.x+box.width*.55,box.y+box.height*.5);await active.mouse.down({button:'middle'});
   await active.mouse.move(box.x+box.width*.55+70,box.y+box.height*.5-25,{steps:8});await active.mouse.up({button:'middle'});
   await active.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  }
  const pages=[active,guest,spectator],before=[];for(const page of pages)before.push(await mark(page));
  const first=await chooseDiscard(active);assert.deepEqual(first,{type:'discard',playerId:'Player 1',cards:{lumber:4,brick:0,wool:0,grain:0,ore:0}});
  assert.deepEqual(await active.evaluate(command=>window.__discardFixture.receive('Player 1',command),first),{ok:true,revision:0,pending:true});
  await active.evaluate(()=>window.__discardCallbacks.discardPending());
  assert.match(await active.locator('#turn-hint').innerText(),/submitted/i);
  for(let i=0;i<pages.length;i++)await check(pages[i],before[i],'first staged discard');
  const second=await chooseDiscard(guest);assert.deepEqual(second,{type:'discard',playerId:'Player 2',cards:{lumber:4,brick:0,wool:0,grain:0,ore:0}});
  assert.deepEqual(await active.evaluate(command=>window.__discardFixture.receive('Player 2',command),second),{ok:true,revision:0,pending:true});
  await guest.evaluate(()=>window.__discardCallbacks.discardPending());
  for(const [page,id] of [[active,'Player 1'],[guest,'Player 2'],[spectator,'spectator']])await deliver(active,page,id);
  for(let i=0;i<pages.length;i++){
   const view=await check(pages[i],before[i],'second staged discard and snapshot');
   assert.equal(view.data.phase,'discard');assert.equal(view.data.discards['Player 3'],4);
  }
  const third={type:'discard',playerId:'Player 3',cards:{lumber:4,brick:0,wool:0,grain:0,ore:0}};
  assert.deepEqual(await active.evaluate(command=>window.__discardFixture.receive('Player 3',command),third),{ok:true,revision:1});
  for(const [page,id] of [[active,'Player 1'],[guest,'Player 2'],[spectator,'spectator']]){await deliver(active,page,id);await deliver(active,page,id);}
  for(let i=0;i<pages.length;i++){
   const view=await check(pages[i],before[i],'settled discard and duplicate snapshot');
   assert.equal(view.data.phase,'robber');assert.deepEqual(view.data.discards,{});
   if(i<2)assert.equal(view.data.hand.lumber,4);
  }
  assert.equal(await spectator.locator('#private-hand-card').isVisible(),false);
  // Exercise real 2D target activation and authority validation using a fresh
  // Player 1 projection on the existing spectator page (avoids a second 3D scene).
  await deliver(active,spectator,'Player 1');
  await spectator.getByRole('button',{name:'Move robber',exact:true}).click();
  const target=spectator.locator('#board [data-legal-target="robber"]').first();assert.ok(await target.count()>0,'robber targets available');
  const id=await target.getAttribute('data-target-id');await target.press('Enter');
  const move=await spectator.evaluate(()=>window.__discardCommands.shift());
  assert.deepEqual(move,{type:'move-robber',playerId:'Player 1',hexId:id});
  assert.equal((await active.evaluate(command=>window.__discardFixture.receive('Player 1',command),move)).ok,true);
  await deliver(active,spectator,'Player 1');
  const updated=(await spectator.evaluate(()=>window.__discardFixture.data())).board;
  assert.equal(updated.robberHexId,id);
  assert.equal(await spectator.locator(`#board [data-hex-id="${id}"]`).getAttribute('data-robber'),'true');
  await active.screenshot({path:join(evidence,boardLayout+'-'+mode+'-discard.png')});
  console.log(`PASS ${boardLayout} ${mode}: staged discards, snapshots, board identity, camera and robber targeting`);
  await browser.close();browser=null;active=null;
 }
 assert.deepEqual(errors,[]);
}catch(error){console.error(error?.stack||error);process.exitCode=1;try{if(active){console.error('Discard diagnostics:',JSON.stringify(await active.evaluate(()=>({data:window.__discardFixture?.data(),view:window.__hex3D?.inspect(),same:window.__discardMap===document.querySelector('#board svg, #board canvas')}))));await active.screenshot({path:join(evidence,'failure.png')});}}catch(e){console.error('Diagnostic failed:',String(e));}}
finally{await browser?.close();server?.kill('SIGTERM');await rm(join(root,source),{force:true});await rm(join(root,html),{force:true});}
