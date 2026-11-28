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
const fixtureURL=new URL(htmlPath+'?qa3d=1',url);
const svgOnly=process.env.TARGET_SVG_ONLY==='1';
let server,browser,page,svgFixtureActive=false;
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
},robberWithSettlement(){
 const current=state!;
 for(const tile of createIslandBoard(current.board.layout).hexes){
  if(tile.id===current.board.robberHexId)continue;
  const vertex=tile.vertexIds.find(id=>current.buildings[id]?.kind==='settlement');
  if(vertex)return {hex:tile.id,vertex};
 }
 throw new Error('The robber fixture needs a legal hex with a settlement on its boundary');
},grainSite(){
 const current=state!;
 const land=createIslandBoard(current.board.layout);
 const cropIds=new Set(current.board.hexes.filter(tile=>tile.terrain==='fields').map(tile=>tile.hexId));
 const fields=land.hexes.filter(tile=>cropIds.has(tile.id));
 for(const tile of fields){
  const control=fields.find(other=>other.id!==tile.id&&!tile.neighborIds.includes(other.id));
  if(control)return {tile:tile.id,control:control.id,vertices:tile.vertexIds,edges:tile.edgeIds};
 }
 throw new Error('The grain fixture needs two separate fields');
}};
`;
async function ready(p){await p.waitForFunction(()=>window.__hex3D?.inspect().mode==='3d'&&window.__hex3D.inspect().frames>0);await settle(p);}
async function start(p,renderer,base=url){const u=new URL(base);if(renderer)u.searchParams.set('renderer',renderer);await p.goto(u.href,{waitUntil:'networkidle'});await p.locator('#local-room-create').click();await p.locator('#start').click();if(await p.locator('#pass').isVisible())await p.locator('#reveal').click();if(renderer!=='2d')await ready(p);}
async function orange(p,id,label){const info=await inspect(p);assert.equal(info.highlightedTarget,id,label);const active=info.targetColors.filter(t=>t.active);assert.equal(active.length,1,label+' exactly one active');assert.equal(active[0].id,id);assert.equal(active[0].color,'ff981f');assert.ok(info.targetColors.filter(t=>!t.active).every(t=>t.color==='fff3a0'));return info;}
async function preview(p,action,label,preferredTarget){
 await p.getByRole('button',{name:action,exact:true}).click();await settle(p);await assertDirectTargets(p);
 const ids=await boardTargetIds(p);assert.ok(ids.length>=2,label+' needs choices');
 await p.mouse.move(0,0);await settle(p);assert.equal((await inspect(p)).highlightedTarget,null,label+' starts with no hidden selection');
 const b=preferredTarget??ids[1];assert.ok(ids.includes(b),label+' target must remain legal');
 const a=ids.find(id=>id!==b),before=await inspect(p),status=await p.locator('#game-status').textContent();
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

const bounded=(promise,ms,label)=>{
 let timer;
 return Promise.race([promise,new Promise((_,reject)=>{
  timer=setTimeout(()=>reject(new Error(label+' timed out after '+ms+'ms')),ms);
 })]).finally(()=>clearTimeout(timer));
};
async function captureWebGLView(page,path){
 await page.locator('#board canvas.three-island-board').evaluate(canvas=>canvas.scrollIntoView({block:'center',inline:'center',behavior:'instant'}));
 await page.screenshot({path,timeout:10000});
}
async function captureSvgView(page,name,hex,{vectorOnly=false}={}){
 // Read the stable SVG state before requesting any native Chromium capture.
 const {svg,geometry}=await bounded(page.evaluate(id=>{
  const board=document.querySelector('#board svg.island-board');
  const tile=Array.from(board.querySelectorAll('[data-hex-id]')).find(node=>node.dataset.hexId===id);
  tile.scrollIntoView({block:'center',inline:'center',behavior:'instant'});
  const rect=node=>{const {x,y,width,height}=node.getBoundingClientRect();return {x,y,width,height};};
  const geometry={viewport:[innerWidth,innerHeight],board:rect(board),tile:rect(tile),fonts:document.fonts.status};
  const copy=board.cloneNode(true);
  const original=[board,...board.querySelectorAll('*')];
  const copies=[copy,...copy.querySelectorAll('*')];
  const ids=new Set(original.map(node=>node.id).filter(Boolean));
  const properties='color fill fill-opacity fill-rule opacity stroke stroke-width stroke-opacity stroke-linecap stroke-linejoin stroke-dasharray stroke-dashoffset paint-order vector-effect visibility display clip-path mask filter stop-color stop-opacity font-family font-size font-weight font-style text-anchor dominant-baseline letter-spacing'.split(' ');
  for(const [index,node] of original.entries()){
   const computed=getComputedStyle(node);
   for(const property of properties){
    const value=computed.getPropertyValue(property).replace(/url\((?:"([^"]*)"|'([^']*)'|([^)]*))\)/g,(match,double,single,bare)=>{
     const reference=(double??single??bare).split('#').pop();
     return ids.has(reference)?'url("#'+reference+'")':match;
    });
    if(value)copies[index].style.setProperty(property,value);
   }
  }
  const bounds=tile.getBBox(),pad=.5,viewWidth=bounds.width+pad*2,viewHeight=bounds.height+pad*2;
  copy.setAttribute('viewBox',[bounds.x-pad,bounds.y-pad,viewWidth,viewHeight].join(' '));
  copy.setAttribute('width','900');copy.setAttribute('height',String(Math.round(900*viewHeight/viewWidth)));
  return {svg:new XMLSerializer().serializeToString(copy),geometry};
 },hex),5000,name+' SVG snapshot');
 assert.ok(geometry.tile.width>0&&geometry.tile.height>0,'the sampled SVG tile must be visible');
 console.log(name+' geometry '+JSON.stringify(geometry));
 if(!vectorOnly){
  let session;
  try{
   // The non-surface path is also used by the standalone SVG catch-up QA.
   session=await bounded(page.context().newCDPSession(page),3000,name+' CDP session');
   const {data}=await bounded(session.send('Page.captureScreenshot',{format:'png',fromSurface:false,captureBeyondViewport:false}),8000,name+' PNG');
   const bytes=Buffer.from(data,'base64'),image=PNG.sync.read(bytes),{tile,viewport}=geometry;
   const scaleX=image.width/viewport[0],scaleY=image.height/viewport[1];
   const colors=new Set();
   for(let y=Math.max(0,Math.floor(tile.y*scaleY));y<Math.min(image.height,(tile.y+tile.height)*scaleY);y+=5){
    for(let x=Math.max(0,Math.floor(tile.x*scaleX));x<Math.min(image.width,(tile.x+tile.width)*scaleX);x+=5){
     const offset=(y*image.width+x)*4;
     colors.add((image.data[offset]<<16)|(image.data[offset+1]<<8)|image.data[offset+2]);
    }
   }
   assert.ok(colors.size>=8,'the captured tile should contain painted board art');
   await writeFile(evidence+'/'+name+'.png',bytes);
   return;
  }catch(error){
   console.log(name+' retaining SVG evidence after PNG capture failed: '+String(error));
  }finally{
   if(session)void session.detach().catch(()=>{});
  }
 }
 await writeFile(evidence+'/'+name+'.svg',svg);
}

async function verifySvgRobberArt(page,fixtureURL){
 const svgUrl=new URL(fixtureURL);svgUrl.searchParams.set('renderer','2d');
 await page.goto(svgUrl.href,{waitUntil:'networkidle'});
 await page.evaluate(()=>window.__targetFixture.load('knight'));
 const {hex,vertex}=await page.evaluate(()=>window.__targetFixture.robberWithSettlement());
 const settlement=page.locator(`#board [data-building-kind="settlement"][data-vertex-id="${vertex}"]`);
 const shell=settlement.locator('.game-building-shell');
 const originalFill=await shell.evaluate(node=>getComputedStyle(node).fill);
 await page.getByRole('button',{name:'Play Knight',exact:true}).click();
 await page.getByRole('button',{name:'Move robber',exact:true}).click();
 const target=page.locator(`#board [data-legal-target="robber"][data-target-id="${hex}"]`);
 const ink=()=>target.evaluate(node=>({
  stroke:Number(getComputedStyle(node.querySelector('.island-cell')).strokeOpacity),
  inset:Number(getComputedStyle(node.querySelector('.island-cell-inset')).fillOpacity)
 }));
 const idle=await ink();
 assert.ok(idle.stroke>=.5&&idle.stroke<=.70,'yellow outlines stay visible without a fully opaque stroke');
 await target.focus();
 assert.equal(await target.evaluate(node=>node.classList.contains('target-active')),true);
 const active=await ink();
 assert.ok(active.stroke>idle.stroke&&active.stroke<=.86);
 assert.ok(active.inset>0&&active.inset<=.2,'orange keyboard focus uses a light tint on the terrain');
 assert.ok(await shell.isVisible(),'the settlement remains on-screen while targeting the robber hex');
 assert.equal(await shell.evaluate(node=>getComputedStyle(node).fill),originalFill);
 assert.ok(await target.evaluate((tile,vertex)=>{
  const settlement=tile.ownerSVGElement.querySelector('[data-building-kind="settlement"][data-vertex-id="'+vertex+'"]');
  return !!(tile.compareDocumentPosition(settlement)&Node.DOCUMENT_POSITION_FOLLOWING);
 },vertex),'settlements paint over the robber target in SVG');
 await page.locator('#board .activity-alert').waitFor({state:'hidden',timeout:5000});
 await captureSvgView(page,'transparent-robber-2d',hex);
 await target.press('Enter');
 assert.equal(await page.locator('#board [data-robber="true"]').getAttribute('data-hex-id'),hex);
 assert.equal(await page.locator('#game-error').textContent(),'');
 check('Light SVG robber highlight preserves an adjacent settlement and keyboard placement');
}

async function verifyGrainArt(page,fixtureURL,renderer,piece){
 const place=async (kind,id)=>{
  await page.getByRole('button',{name:'Build '+kind,exact:true}).click();
  await clickBoardTarget(page,id);
  if(await page.locator('#pass').isVisible())await page.locator('#reveal').click();
  await settle(page);
 };
 const read=async id=>{
  if(renderer==='3d'){
   const tile=(await inspect(page)).terrainArt.find(tile=>tile.id===id);
   return {stems:tile.stems,faded:tile.fadedStems,opacity:tile.wheatOpacity};
  }
  return page.locator(`#board [data-hex-id="${id}"] .terrain-art-fields [data-wheat-stalk]`).evaluateAll(stalks=>
   stalks.map(stalk=>Number(getComputedStyle(stalk).opacity)*Number(getComputedStyle(stalk.parentElement).opacity)));
 };
 await start(page,renderer,fixtureURL);
 const site=await page.evaluate(()=>window.__targetFixture.grainSite());
 // Choose road endpoints toward a different grain bundle from its settlement.
 const [vertex,edge]=renderer==='3d'?[2,1]:[0,0];
 const settlementId=site.vertices[piece==='settlement'?3:vertex],edgeId=site.edges[edge];
 const seat=await page.locator('#player-strip .local-player').getAttribute('data-seat');
 const before=await read(site.tile),control=await read(site.control);
 const hasPiece=async(kind,id)=>{
  if(renderer==='3d'){
   const view=await inspect(page);
   return kind==='road'?view.roads.includes(id):view.buildings.some(([vertex,building])=>vertex===id&&building.kind===kind);
  }
  const selector=kind==='road'?'[data-road-id="'+id+'"]':'[data-building-kind="'+kind+'"][data-vertex-id="'+id+'"]';
  return page.locator('#board '+selector).isVisible();
 };
 if(renderer==='3d'){
  assert.ok(before.stems>0,'the grain field contains wheat');
  assert.equal(before.faded,0,'the empty field starts at normal opacity');
 }else{
  assert.equal(before.length,5,'the SVG field has five wheat stalk groups');
  assert.ok(before.every(opacity=>opacity>0),'all five stalks are visible');
 }
 if(piece==='road'){
  await place('settlement',settlementId);
  assert.deepEqual(await read(site.tile),before,'the starting settlement keeps the field at its original opacity');
 }
 const pieceId=piece==='road'?edgeId:settlementId,label=renderer+' '+piece;
 await place(piece,pieceId);
 assert.ok(await hasPiece(piece,pieceId),label+' is present at the selected site');
 assert.deepEqual(await read(site.tile),before,label+' leaves the adjacent grain field at its original opacity');
 assert.deepEqual(await read(site.control),control,label+' leaves a separate field unchanged');
 await page.locator('#board .turn-alert').waitFor({state:'hidden',timeout:5000});
 const name='grain-'+piece+'-'+renderer;
 check(label+' leaves grain art unchanged after actual placement');
 if(renderer==='3d')await captureWebGLView(page,`${evidence}/${name}.png`);
 else await captureSvgView(page,name,site.tile,{vectorOnly:piece==='road'});
 if(piece!=='road')return;

 // A setup road passes the device. Hand it back to its owner to use real Undo.
 page.once('dialog',dialog=>dialog.accept('Player '+seat));
 await page.locator('#switch-player').click();
 await page.locator('#reveal').click();
 await page.getByRole('button',{name:'Undo last action',exact:true}).click();
 if(await page.locator('#pass').isVisible())await page.locator('#reveal').click();
 await settle(page);
 assert.equal(await hasPiece('road',edgeId),false,'Undo removes the road');
 assert.ok(await hasPiece('settlement',settlementId),'Undo preserves the settlement');
 assert.deepEqual(await read(site.tile),before,'Undo leaves the grain field at its original opacity');
 assert.deepEqual(await read(site.control),control,'Undo leaves the separate field unchanged');
 assert.equal(await page.locator('#game-error').textContent(),'');
 check(renderer+' road Undo preserves the field and settlement');
 if(renderer==='2d'){
  await page.locator('#board .turn-alert').waitFor({state:'hidden',timeout:5000});
  await captureSvgView(page,'grain-road-undo-2d',site.tile);
 }
}

async function verifySvgFixtures(fixtureURL){
 svgFixtureActive=true;
 const svgBrowser=await chromium.launch({headless:true,args:['--disable-gpu']});
 try{
  for(const scenario of ['robber','settlement','road']){
   const page=await svgBrowser.newPage({viewport:{width:1440,height:900},reducedMotion:'reduce'});
   page.setDefaultTimeout(10000);
   page.on('pageerror',error=>report.errors.push(String(error)));
   try{
    if(scenario==='robber')await verifySvgRobberArt(page,fixtureURL);
    else await verifyGrainArt(page,fixtureURL,'2d',scenario);
   }finally{
    await page.close();
   }
  }
 }finally{
  await svgBrowser.close();
 }
 svgFixtureActive=false;
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
 const context=await browser.newContext({viewport:{width:375,height:812},isMobile:true,hasTouch:true,reducedMotion:'reduce'});
 const phone=await context.newPage();phone.on('pageerror',error=>report.errors.push(String(error)));
 const buildSettlement=phone.getByRole('button',{name:'Build settlement',exact:true});
 const buildRoad=phone.getByRole('button',{name:'Build road',exact:true});
 const reveal=async()=>{if(await phone.locator('#pass').isVisible())await phone.locator('#reveal').tap();};
 const seat=()=>phone.locator('#player-strip .local-player').getAttribute('data-seat');
 const pieces=async()=>{
  if(renderer==='3d'){
   const {buildings,roads,picks}=await inspect(phone);
   return {settlements:buildings.filter(([,piece])=>piece.kind==='settlement').map(([id])=>id),roads,picks};
  }
  const ids=(selector,attribute)=>phone.locator(selector).evaluateAll((nodes,attribute)=>nodes.map(node=>node.getAttribute(attribute)),attribute);
  return {
   settlements:await ids('#board [data-building-kind="settlement"]','data-vertex-id'),
   roads:await ids('#board [data-road-id]','data-road-id')
  };
 };
 const pointOf=async(id,touchId=0)=>{
  const point=await boardTargetPoint(phone,id);
  assert.ok(point&&Number.isFinite(point.x)&&Number.isFinite(point.y),'touch target must be on the board');
  return {...point,id:touchId};
 };
 const offset=point=>({...point,x:point.x+(point.x<phone.viewportSize().width-40?32:-32)});
 const touch=await context.newCDPSession(phone);
 const send=(type,touchPoints=[])=>touch.send('Input.dispatchTouchEvent',{type,touchPoints});
 const tapTarget=async (id,hold=false)=>{
  const before=await pieces();
  const point=await pointOf(id);
  if(hold){
   // Exercise a slow stationary release without Chromium's native long-press menu.
   const elapsed=await phone.evaluate(async ({x,y})=>{
    const target=document.elementFromPoint(x,y);
    if(!target?.closest('#board'))throw new Error('The held pointer needs a board target');
    const event={pointerId:9001,pointerType:'touch',isPrimary:true,button:0,
      clientX:x,clientY:y,bubbles:true,cancelable:true};
    const start=performance.now();
    target.dispatchEvent(new PointerEvent('pointerdown',{...event,buttons:1}));
    await new Promise(resolve=>setTimeout(resolve,650));
    target.dispatchEvent(new PointerEvent('pointerup',{...event,buttons:0}));
    return performance.now()-start;
   },point);
   assert.ok(elapsed>=600,'the successful held release lasts longer than the former duration cutoff');
  }else{
   await phone.touchscreen.tap(point.x,point.y);
  }
  await settle(phone);
  if(renderer==='3d')assert.equal((await pieces()).picks,before.picks+1,'one valid release emits one canvas pick');
  assert.equal(await phone.locator('#game-error').textContent(),'');
 };
 const undo=async owner=>{
  await reveal();
  if(await seat()!==owner){
   phone.once('dialog',dialog=>dialog.accept('Player '+owner));
   await phone.locator('#switch-player').tap();
   await reveal();
  }
  await phone.getByRole('button',{name:'Undo last action',exact:true}).tap();
  await reveal();
  await settle(phone);
 };
 try{
  await start(phone,renderer);
  const owner=await seat();
  assert.ok(owner);
  assert.equal(await phone.locator('#board-confirm-placement').count(),0,'phone placement has no confirmation control');
  await buildSettlement.tap();
  await assertDirectTargets(phone);
  const ids=await boardTargetIds(phone);assert.ok(ids.length>=3);
  const first=ids[1],second=ids[2];
  const empty=await pieces();
  const noPlacement=async label=>{
   await settle(phone);
   assert.deepEqual(await pieces(),empty,label+' must not commit or pick a piece');
  };

  let point=await pointOf(first);
  await send('touchStart',[point]);
  await noPlacement('touch press');
  if(renderer==='3d'){
   const info=await inspect(phone);
   assert.equal(info.placementPiece,'settlement');
   assert.equal(info.previewTargetId,first);
  }else{
   assert.equal(await phone.locator('#board [data-placement-preview="settlement"]').getAttribute('data-preview-target'),first);
  }
  await send('touchCancel');
  await noPlacement('touch cancellation');
  if(renderer==='3d')assert.equal((await inspect(phone)).highlightedTarget,null);
  else assert.equal(await phone.locator('#board [data-placement-preview]').count(),0);

  point=await pointOf(first);
  await send('touchStart',[point]);
  await send('touchMove',[offset(point)]);
  await send('touchMove',[point]);
  await send('touchEnd');
  await noPlacement('drag out and back');

  point=await pointOf(first);
  await send('touchStart',[point]);
  await send('touchStart',[point,{...offset(point),id:1}]);
  await send('touchEnd');
  await noPlacement('second finger');

  point=await pointOf(first);
  await send('touchStart',[point]);
  await phone.evaluate(({x,y})=>{
   const target=document.elementFromPoint(x,y);
   if(!target?.closest('#board'))throw new Error('The context-menu cancellation needs a board target');
   target.dispatchEvent(new PointerEvent('contextmenu',{pointerType:'touch',button:2,
     clientX:x,clientY:y,bubbles:true,cancelable:true}));
  },point);
  await send('touchEnd');
  await noPlacement('browser context menu');

  if(renderer==='3d'){
   const adjust=phone.locator('#board-adjust-view');
   await adjust.check();
   point=await pointOf(first);
   await phone.touchscreen.tap(point.x,point.y);
   await noPlacement('tap while adjusting the view');
   const camera=(await inspect(phone)).camera;
   await send('touchStart',[point]);
   await send('touchMove',[offset(point)]);
   await send('touchEnd');
   await noPlacement('camera drag');
   assert.notDeepEqual((await inspect(phone)).camera,camera,'Adjust view still moves the camera');
   await adjust.uncheck();
   await phone.locator('#board-view-reset').tap();
  }

  await phone.getByRole('button',{name:'Cancel selection',exact:true}).tap();
  assert.equal((await boardTargetIds(phone)).length,0);
  await buildSettlement.tap();
  const pause=phone.locator('#turn-clock-pause');
  await pause.tap();
  assert.equal((await boardTargetIds(phone)).length,0,'pausing invalidates legal placement targets');
  await pause.tap();
  await noPlacement('cancel and resume');

  await buildSettlement.tap();
  await tapTarget(second);
  assert.deepEqual((await pieces()).settlements,[second],'one tap places the pointed settlement');
  await undo(owner);
  assert.deepEqual((await pieces()).settlements,[],'one Undo removes the only settlement');
  await buildSettlement.tap();
  await tapTarget(first,true);
  assert.deepEqual((await pieces()).settlements,[first],'a steady held release can choose another settlement after Undo');

  await buildRoad.tap();
  const [edge]=await boardTargetIds(phone);assert.ok(edge);
  await tapTarget(edge);
  await reveal();
  assert.deepEqual((await pieces()).roads,[edge],'one tap places the pointed road');
  await undo(owner);
  assert.deepEqual((await pieces()).roads,[],'one Undo removes the only road');
  assert.deepEqual((await pieces()).settlements,[first],'road Undo keeps the settlement');
  await buildRoad.tap();
  await tapTarget(edge);
  await reveal();
  assert.deepEqual((await pieces()).roads,[edge],'the undone road can be placed with one tap again');
  check(renderer+' phone placement accepts quick and steady releases, supports Undo and retap, and rejects interrupted gestures');
 }finally{
  await context.close();
 }
}

try{
 if(svgOnly&&process.env.QA_URL)throw new Error('TARGET_SVG_ONLY uses the local Vite fixture; unset QA_URL');
 if(!process.env.QA_URL){
  const source=await readFile('src/game-ui.ts','utf8');await writeFile(fixturePath,source+fixture);
  const html=(await readFile('index.html','utf8')).replace('/src/game-ui.ts','/src/__target-feedback-fixture.ts');assert.ok(html.includes('__target-feedback-fixture.ts'));await writeFile(htmlPath,html);
  server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','4178','--strictPort'],{stdio:'pipe'});
  for(let i=0;i<100;i++){try{if((await fetch(url)).ok)break;}catch{}await delay(200);}
 }
 if(svgOnly)await verifySvgFixtures(fixtureURL);
 else{
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
  for(const [mode,card,label] of [['city',null,'Upgrade house to city'],['robber','knight','Move robber'],['free-road','road-building','Build road']]){
   await page.goto(fixtureURL.href,{waitUntil:'networkidle'});await page.evaluate(card=>window.__targetFixture.load(card),card);await ready(page);
   if(card)await page.getByRole('button',{name:card==='knight'?'Play Knight':'Play Road Building',exact:true}).click();
   const nearby=mode==='robber'?await page.evaluate(()=>window.__targetFixture.robberWithSettlement()):null;
   state=await preview(page,label,mode,nearby?.hex);
   if(nearby){
    assert.ok(state.before.targetColors.every(target=>target.opacity>=.12&&target.opacity<=.25&&target.depthTest),
      'yellow WebGL robber targets are translucent and respect geometry depth');
    const active=(await inspect(page)).targetColors.find(target=>target.id===nearby.hex);
    assert.ok(active.active&&active.depthTest&&active.opacity>.25&&active.opacity<=.36,
      'the pointed hex remains distinct without painting over the settlement');
    assert.ok(state.before.buildings.some(([id,piece])=>id===nearby.vertex&&piece.kind==='settlement'));
    check('Light WebGL robber highlights preserve the adjacent settlement and direct selection');
   }
   await page.locator('#board .activity-alert').waitFor({state:'hidden',timeout:5000});await page.screenshot({path:`${evidence}/orange-${mode}.png`,fullPage:true});
   await clickBoardTarget(page,state.b);await settle(page);
   const done=await inspect(page);assert.equal(done.highlightedTarget,null);
   if(mode==='city')assert.ok(done.buildings.some(([id,piece])=>id===state.b&&piece.kind==='city'));
   if(mode==='robber')assert.equal(done.robber,state.b);
   if(mode==='free-road'){assert.ok(done.roads.includes(state.b));await preview(page,'Build road','Second free road');}
   check(mode+': selected target remains correct through the actual reducer');
  }
  await verifyShipArt(page,fixtureURL);
  for(const piece of ['settlement','road'])await verifyGrainArt(page,fixtureURL,'3d',piece);
  await verifySvgFixtures(fixtureURL);
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
 }
 assert.deepEqual(report.errors,[]);
}catch(error){report.error=String(error.stack||error);console.error(report.error);process.exitCode=1;try{if(!svgFixtureActive)await page?.screenshot({path:`${evidence}/failure.png`,timeout:5000});}catch{}}
finally{await writeFile(`${evidence}/report.json`,JSON.stringify(report,null,2));await browser?.close();server?.kill('SIGTERM');if(!process.env.QA_URL){await rm(htmlPath,{force:true});await rm(fixturePath,{force:true});}}
