import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {clickBoardTarget} from './qa-board-targets.mjs';
const evidence=process.env.HARBOR_EVIDENCE||'harbor-evidence';await mkdir(evidence,{recursive:true});
const report={scope:process.env.HARBOR_ALLOW_2D==='1'?'Fallback accepted for local functional checks':'3D required',checks:[],errors:[]};const check=(name)=>{report.checks.push({name,pass:true});console.log('PASS',name);};
const html='__harbor-fixture.html',source='src/__harbor-fixture.ts';
const fixture=`
(window as any).__harborFixture={load(outcome:'playing'|'win'|'lose'|'station'|'road-support'='playing'){
 clearBotTimer();remote=null;projection=null;networkRevision=0;localBotIds=new Set();localUndoState=null;pendingLocalUndo=null;targetMode=null;lastWinnerAlert='';
 let s=createGame(24680,['Player 1','Player 2'],undefined,{mode:'harbor-coop'});
 for(let n=0;n<8;n++){const c=chooseBotCommand(s,s.players[s.currentSeat].id)!;s=applyBotCommand(s,c);}
 s.currentSeat=0;s.phase='action';s.turn=1;
 for(const r of RESOURCES){s.bank[r]+=s.players[0].hand[r]-4;s.players[0].hand[r]=4;}
 const port=s.board.ports[0];
 // Reach a real port via a connected route; fixture setup never ships in the production bundle.
 const route=fixtureRoute(s,'Player 1',port.vertexIds);for(const edge of route.path)if(!s.roads[edge]){s.roads[edge]='Player 1';s.players[0].roads--;}
 s.harbor!.orders[0].portId=port.edgeId;
 if(outcome==='win')s.harbor!.completed=9;
 if(outcome==='lose'){s.harbor!.missed=2;s.harbor!.orders.forEach(o=>o.dueRound=1);s.turn=2;}
 if(outcome==='station'){
  const geometry=createIslandBoard();const vertex=geometry.vertices.find(v=>geometry.edges.filter(e=>e.vertexIds.includes(v.id)).length===3)!;
  const edges=geometry.edges.filter(e=>e.vertexIds.includes(vertex.id));s.roads[edges[0].id]='Player 1';s.roads[edges[1].id]='Player 2';
  s.buildings[edges[0].vertexIds.find(v=>v!==vertex.id)!]={playerId:'Player 1',kind:'settlement'};
  s.buildings[edges[1].vertexIds.find(v=>v!==vertex.id)!]={playerId:'Player 2',kind:'city'};
 }
 if(outcome==='road-support'){
  const geometry=createIslandBoard();const vertex=geometry.vertices.find(v=>geometry.edges.filter(e=>e.vertexIds.includes(v.id)).length===3)!;
  const edges=geometry.edges.filter(e=>e.vertexIds.includes(vertex.id)),mine=edges[0],theirs=edges[1],allowed=edges[2];
  const ownEnd=mine.vertexIds.find(v=>v!==vertex.id)!,otherEnd=theirs.vertexIds.find(v=>v!==vertex.id)!;
  const forbidden=geometry.edges.find(e=>e.id!==theirs.id&&e.vertexIds.includes(otherEnd))!;
  s.roads={[mine.id]:'Player 1',[theirs.id]:'Player 2'};
  s.buildings={[ownEnd]:{playerId:'Player 1',kind:'settlement'},[otherEnd]:{playerId:'Player 2',kind:'city'}};
  (window as any).__harborRoadFixture={allowed:allowed.id,forbidden:forbidden.id};
 }
 state=s;viewer='Player 1';activeLocalRoom=createLocalRoomSettings(24680,2,0,'harbor-coop');lastTurnCue='';pendingActivityAlert='';pendingProductionSummary=null;
 el('pass').hidden=true;el('game').hidden=false;enterGame();render();
}};
`;
let server,browser,page;
const base=new URL(process.env.QA_URL||'http://127.0.0.1:4180/hex-island-game/');base.searchParams.set('qa3d','1');base.searchParams.set('qaPlayers','2');
const ready=async p=>{await p.waitForFunction(allow=>window.__hex3D?.inspect().mode==='3d'||(allow&&document.querySelector('#board')?.dataset.renderer==='2d'),process.env.HARBOR_ALLOW_2D==='1');};
const reveal=async p=>{if(await p.locator('#pass').isVisible())await p.locator('#reveal').click();};
const watch=p=>{p.on('pageerror',e=>report.errors.push(String(e)));return p;};
async function setupPair(p){
 if(await p.getByRole('button',{name:'Place city',exact:true}).count()){
  await p.getByRole('button',{name:'Place city',exact:true}).click();await clickBoardTarget(p);return;
 }
 await p.getByRole('button',{name:'Place settlement',exact:true}).click();await clickBoardTarget(p);
 for(let n=0;n<2;n++){await p.getByRole('button',{name:'Place road',exact:true}).click();await clickBoardTarget(p);}
}
async function local(p,bot=false){await p.goto(base.href,{waitUntil:'networkidle'});await p.locator('#local-room-create').click();await p.locator('#local-game-mode').selectOption('harbor-coop');if(bot)await p.locator('#local-bot-count').selectOption('1');await p.locator('#start').click();await reveal(p);await ready(p);}
try{
 if(!process.env.QA_URL){
  const ui=await readFile('src/game-ui.ts','utf8');await writeFile(source,"import {shippingRoute as fixtureRoute} from './game/rules/harbor';\n"+ui+fixture);
  await writeFile(html,(await readFile('index.html','utf8')).replace('/src/game-ui.ts','/src/__harbor-fixture.ts'));
  server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','4180','--strictPort'],{stdio:'pipe'});
  for(let i=0;i<80;i++){try{if((await fetch(base)).ok)break;}catch{}await delay(150);}
 }
 browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});page=watch(await browser.newPage({viewport:{width:1280,height:900}}));
 await local(page);assert.equal(await page.locator('.harbor-order').count(),1);assert.match(await page.locator('.harbor-order').textContent(),/7 rounds left/);assert.equal(await page.locator('#seats').inputValue(),'2');assert.ok(await page.locator('#seats').isDisabled());
 for(let n=0;n<4;n++){await reveal(page);await setupPair(page);}await reveal(page);await ready(page);
 assert.equal(await page.locator('.harbor-order').count(),1);assert.match(await page.locator('.harbor-progress').textContent(),/Ships 0\/10/);
 assert.equal(await page.locator('#targets select').count(),0);check('Hot-seat co-op selects two players and asymmetric setup preserves the first order and its seven-round deadline');
 for(const [width,height] of [[1280,900],[375,812]]){await page.setViewportSize({width,height});await delay(150);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);await page.locator('#harbor-panel').scrollIntoViewIfNeeded();await page.screenshot({path:`${evidence}/harbor-${width}.png`,fullPage:true});}check('Co-op orders fit desktop and mobile without horizontal overflow');
 page.once('dialog',d=>d.accept());await page.locator('#local-restart').click();await reveal(page);assert.match(await page.locator('#turn-banner').textContent(),/Harbor Co-op/);assert.equal(await page.locator('.harbor-order').count(),1);check('Same-room local restart retains cooperative mode and starts the first scheduled order');
 await page.setViewportSize({width:1280,height:900});await local(page,true);
 for(let n=0;n<2;n++){await page.waitForFunction(()=>document.querySelector('#game-status')?.textContent.includes("Player 1's turn; phase: setup-settlement"),null,{timeout:30000});await setupPair(page);}
 await page.waitForFunction(()=>window.__hex3D.inspect().mode==='3d'?window.__hex3D.inspect().buildings.length===4:document.querySelectorAll('#board [data-building-kind]').length===4,null,{timeout:30000});assert.ok(await page.evaluate(()=>window.__hex3D.inspect().mode==='3d'?window.__hex3D.inspect().buildings.some(([,b])=>b.playerId==='Bot'):Array.from(document.querySelectorAll('#board [data-building-kind] title')).some(n=>n.textContent.startsWith('Bot '))));check('One-human plus one teammate Bot completes actual snake setup without hot-seat prompts');
 if(!process.env.QA_URL){
  const fixtureURL=new URL('__harbor-fixture.html?qa3d=1',base);await page.goto(fixtureURL.href,{waitUntil:'networkidle'});await page.evaluate(()=>window.__harborFixture.load());await ready(page);
  const id=await page.locator('.harbor-order').first().getAttribute('data-order-id');const card=page.locator(`.harbor-order[data-order-id="${id}"]`);
  let count=0;while(await card.count()&&await card.locator('button').count()){assert.ok(count++<6);await card.locator('button').first().click();}
  assert.equal(await page.locator('#harbor-panel').getAttribute('data-completed'),'1');await page.locator('#harbor-panel').scrollIntoViewIfNeeded();await page.screenshot({path:`${evidence}/harbor-load.png`,fullPage:true});check('Real Load buttons submit partial cargo and complete a ship through the cooperative reducer');
  await page.evaluate(()=>window.__harborFixture.load('win'));const winId=await page.locator('.harbor-order').first().getAttribute('data-order-id');
  for(let n=0;n<5&&await page.locator('#harbor-panel').getAttribute('data-outcome')==='playing';n++){await page.locator(`.harbor-order[data-order-id="${winId}"] button`).first().click();}
  assert.equal(await page.locator('#harbor-panel').getAttribute('data-outcome'),'won');assert.equal(await page.getByRole('button',{name:'End turn',exact:true}).count(),0);check('Tenth ship produces a real joint victory and removes action controls');
  await page.evaluate(()=>window.__harborFixture.load('lose'));await page.getByRole('button',{name:'End turn',exact:true}).click();assert.equal(await page.locator('#harbor-panel').getAttribute('data-outcome'),'lost');check('Third missed order produces a real team loss, with restart still available');
 }
 if(!process.env.QA_URL){
  const fixtureURL=new URL('__harbor-fixture.html?qa3d=1',base);
  for(const renderer of (process.env.HARBOR_ALLOW_2D==='1'?['2d']:['3d','2d'])){
   const u=new URL(fixtureURL);if(renderer==='2d')u.searchParams.set('renderer','2d');
   await page.goto(u.href,{waitUntil:'networkidle'});await page.evaluate(()=>window.__harborFixture.load('station'));
   if(renderer==='3d')await ready(page);
   const before=renderer==='3d'?await page.evaluate(()=>window.__hex3D.inspect()):null;
   await page.getByRole('button',{name:'Build trade station',exact:true}).click();
   assert.equal(await page.locator('#targets select').count(),0);
   const id=await clickBoardTarget(page);assert.equal(await page.locator('.harbor-station').count(),1);
   if(renderer==='3d'){
    const after=await page.evaluate(()=>window.__hex3D.inspect());assert.ok(after.stations.includes(id));assert.equal(after.instanceId,before.instanceId);assert.equal(after.mapBuilds,before.mapBuilds);assert.deepEqual(after.camera,before.camera);
   }else assert.equal(await page.locator('#board [data-station-id]').count(),1);
   await page.getByRole('button',{name:'Undo last action',exact:true}).click();assert.equal(await page.locator('.harbor-station').count(),0);
   await page.getByRole('button',{name:'Build trade station',exact:true}).click();await clickBoardTarget(page,id);
   assert.equal(await page.getByText('Offer to another player',{exact:true}).count(),0);
   const station=page.locator('.harbor-station');await station.locator('[data-send-resource]').first().click();
   assert.equal(await station.locator('button').count(),0);assert.match(await station.textContent(),/Sent this turn/);
   assert.equal(await page.getByRole('button',{name:'Undo last action',exact:true}).count(),0);
   await page.getByRole('button',{name:'End turn',exact:true}).click();await reveal(page);
   assert.match(await page.locator('#game-status').textContent(),/Player 2's turn/);
   // Quota from Player 1 does not consume Player 2's slot; raw state and legal use are also covered by authority tests.
   assert.match(await page.locator('.harbor-station').textContent(),/1 resource card per player turn/);
   check(renderer+': direct station build, Undo and one-card send quota; no offer bypass or camera rebuild');
   if(renderer==='3d'){await page.locator('#harbor-panel').scrollIntoViewIfNeeded();await page.screenshot({path:`${evidence}/trade-station.png`,fullPage:true});}
   await page.evaluate(()=>window.__harborFixture.load('road-support'));
   await page.getByRole('button',{name:'Build road',exact:true}).click();
   const roadTest=await page.evaluate(()=>window.__harborRoadFixture);
   const legal=renderer==='3d'?(await page.evaluate(()=>window.__hex3D.inspect())).targets:await page.locator('#board [data-legal-target="road"]').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('data-target-id')));
   assert.ok(legal.includes(roadTest.allowed));assert.ok(!legal.includes(roadTest.forbidden));
   await clickBoardTarget(page,roadTest.allowed);
   assert.equal(await page.locator('#game-error').textContent(),'');
   check(renderer+': owned road extends at a team junction; partner-city continuation is not highlighted or placeable');

  }
 }
 if(process.env.QA_SIGNALING_URL){
  const hc=await browser.newContext(),gc=await browser.newContext(),sc=await browser.newContext();const host=watch(await hc.newPage()),guest=watch(await gc.newPage()),spectator=watch(await sc.newPage());
  for(const p of [host,guest,spectator])await p.setViewportSize({width:1280,height:900});
  await host.goto(base.href);await host.locator('#room-create').click();await host.locator('#room-map-lobby').waitFor({state:'visible'});await host.locator('#room-game-mode').selectOption('harbor-coop');
  await host.waitForFunction(()=>document.querySelector('#room-invite')?.value.includes('#join='));const invite=await host.locator('#room-invite').inputValue();
  await guest.goto(invite);await guest.waitForFunction(()=>!document.querySelector('#room-ready')?.disabled);await guest.waitForFunction(()=>document.querySelector('#room-game-mode')?.value==='harbor-coop');assert.ok(await guest.locator('#room-game-mode').isDisabled());
  await host.locator('#room-ready').click();await guest.locator('#room-ready').click();await host.locator('#room-start').click();await ready(host);await ready(guest);
  await spectator.goto(invite);await ready(spectator);assert.equal(await spectator.locator('#private-hand-card').isVisible(),false);assert.equal(await spectator.locator('#harbor-panel button').count(),0);
  for(let n=0;n<4;n++){
   await host.waitForFunction(()=>document.querySelector('#game-status')?.textContent.includes('phase: setup-'));
   const actor=await host.getByRole('button',{name:/^Place (settlement|city)$/}).count()?host:guest;await setupPair(actor);
   const expected=n+1;await Promise.all([host,guest,spectator].map(p=>p.waitForFunction(expected=>window.__hex3D.inspect().buildings.length===expected,expected)));
  }
  const orders=await host.locator('.harbor-order').evaluateAll(ns=>ns.map(n=>[n.dataset.orderId,n.dataset.portId]));assert.deepEqual(await guest.locator('.harbor-order').evaluateAll(ns=>ns.map(n=>[n.dataset.orderId,n.dataset.portId])),orders);assert.equal(orders.length,1);check('Live host, guest and spectator share the same cooperative orders; private hands stay private');
  await guest.evaluate(()=>window.__hexQaDropRoomConnection());await guest.waitForFunction(()=>!document.body.classList.contains('network-resyncing')&&(window.__hexQaReconnectCount?.()||0)>0,null,{timeout:30000});assert.deepEqual(await guest.locator('.harbor-order').evaluateAll(ns=>ns.map(n=>[n.dataset.orderId,n.dataset.portId])),orders);check('Real guest disconnect and rejoin retains harbor orders');
  await spectator.close();await guest.close();await host.close();const rh=watch(await hc.newPage()),rg=watch(await gc.newPage());
  await rh.goto(base.href);await rh.locator('#room-reconnect').click();await rh.locator('#room-recovery-panel').waitFor({state:'visible',timeout:20000});
  await rg.goto(base.href);await rg.locator('#room-reconnect').click();await rh.getByRole('button',{name:/Resume latest/}).waitFor({state:'visible',timeout:25000});await rh.waitForFunction(()=>Array.from(document.querySelectorAll('#room-recovery-options button')).some(b=>!b.disabled));await rh.getByRole('button',{name:/Resume latest/}).click();await ready(rh);await ready(rg);
  assert.deepEqual(await rg.locator('.harbor-order').evaluateAll(ns=>ns.map(n=>[n.dataset.orderId,n.dataset.portId])),orders);check('Host full-page shutdown and saved-game resume preserves cooperative mode and exact orders');
  rh.once('dialog',d=>d.accept());await rh.locator('#game-restart').click();await rg.waitForFunction(()=>document.querySelector('#game-status')?.textContent.includes('Revision 0'));assert.match(await rg.locator('#turn-banner').textContent(),/Harbor Co-op/);assert.equal(await rg.locator('.harbor-order').count(),1);check('Live same-room restart begins a new cooperative match');
  await hc.close();await gc.close();await sc.close();
 }
 assert.deepEqual(report.errors,[]);
}catch(e){report.error=String(e.stack||e);console.error(report.error);process.exitCode=1;try{await page?.screenshot({path:`${evidence}/failure.png`,fullPage:true});}catch{}}
finally{await writeFile(`${evidence}/report.json`,JSON.stringify(report,null,2));await browser?.close();server?.kill('SIGTERM');if(!process.env.QA_URL){await rm(html,{force:true});await rm(source,{force:true});}}
