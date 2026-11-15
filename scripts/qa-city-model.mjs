import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

// Disposable fixtures use the actual building factory, game UI and reducers; none ship to Pages.
const evidence=process.env.CITY_EVIDENCE||'city-evidence';await mkdir(evidence,{recursive:true});
const temporary=['__city-game.html','src/__city-game.ts','__city-gallery.html','src/__city-gallery.ts'];
const fixture=`
(window as any).__cityFixture={
 colors:()=>PLAYER_PIECE_PALETTE.map(p=>p.body),
 load(count:number){
  clearBotTimer();remote=null;projection=null;networkRevision=0;localBotIds=new Set();
  localUndoState=null;localUndoPlayerId='';pendingLocalUndo=null;targetMode=null;
  const settings=createLocalRoomSettings(24680,count,0);
  let game=createGame(settings.seed,settings.ids,()=>0,{boardLayout:settings.boardLayout});
  for(let guard=0;guard<80&&game.phase.startsWith('setup-');guard++){
   const playerId=game.players[game.currentSeat].id,kind=game.phase==='setup-settlement'?'settlement':'road';
   const id=legalTargetIds(game,playerId,kind)[0];if(!id)throw new Error('Missing legal fixture setup');
   game=kind==='settlement'?localSetup(game,{type:'place-settlement',playerId,vertexId:id}):localSetup(game,{type:'place-road',playerId,edgeId:id});
  }
  game.phase='action';game.turn=10;game.playedDevelopment=false;
  for(const p of game.players){for(const r of RESOURCES){game.bank[r]+=p.hand[r];p.hand[r]=0;}p.hand.grain=2;p.hand.ore=3;game.bank.grain-=2;game.bank.ore-=3;}
  for(let i=1;i<game.players.length;i++){
   game.currentSeat=i;const playerId=game.players[i].id,id=legalTargetIds(game,playerId,'city')[0];
   if(!id)throw new Error('Missing city fixture target');game=localBuild(game,{type:'build-city',playerId,vertexId:id});
  }
  game.currentSeat=0;state=game;viewer='Player 1';activeLocalRoom=settings;
  log=[];publicActivity='City model verification';lastTurnCue='10:0';pendingActivityAlert='';pendingProductionSummary=null;
  el('pass').hidden=true;el('game').hidden=false;enterGame();render();
 },
 read(){return {buildings:structuredClone(state!.buildings),hand:{...state!.players[0].hand},roads:JSON.stringify(state!.roads),board:JSON.stringify(state!.board),cities:state!.players[0].cities};}
};
`;
const gallery=`
import * as THREE from 'three';
import { ArtAssets, makeBuilding } from './game/board/three/art';
const colors=JSON.parse(new URLSearchParams(location.search).get('colors')!);
const scene=new THREE.Scene();scene.background=new THREE.Color('#e7ece6');
scene.add(new THREE.HemisphereLight(0xfff3da,0x536f73,2.4));
const sun=new THREE.DirectionalLight(0xfff6df,3);sun.position.set(-6,12,7);sun.castShadow=true;
sun.shadow.mapSize.set(2048,2048);sun.shadow.camera.left=-6;sun.shadow.camera.right=6;sun.shadow.camera.top=6;sun.shadow.camera.bottom=-6;sun.shadow.normalBias=.02;scene.add(sun);
const floor=new THREE.Mesh(new THREE.PlaneGeometry(20,20),new THREE.MeshStandardMaterial({color:'#e7ece6',roughness:1}));floor.rotation.x=-Math.PI/2;floor.position.y=-.006;floor.receiveShadow=true;scene.add(floor);
const assets=new ArtAssets(),models:THREE.Object3D[]=[];
colors.forEach((color:string,index:number)=>{
 const x=(index%3-1)*1.7,z=(Math.floor(index/3)-.5)*1.65;
 for(const [kind,dx] of [['settlement',-.40],['city',.35]] as const){
  const model=makeBuilding(assets,kind,color);model.position.set(x+dx,-.208,z);model.scale.setScalar(1.6);scene.add(model);models.push(model);
 }
});
const canvas=document.querySelector('canvas')!,renderer=new THREE.WebGLRenderer({canvas,antialias:true});renderer.setPixelRatio(1.5);renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
const height=innerHeight-80,width=innerWidth;renderer.setSize(width,height,false);
const camera=new THREE.OrthographicCamera(-2.9,2.9,2.9*height/width,-2.9*height/width,.1,100);camera.position.set(0,6,9);camera.lookAt(0,.28,0);renderer.render(scene,camera);
(window as any).__cityGallery={ready:true,revision:models[1].userData.artRevision,models:models.length,angle(){camera.position.set(3,6,9);camera.lookAt(0,.28,0);renderer.render(scene,camera);}};
`;
let browser,page,server;let logs='';const report={checks:[],errors:[]};
const stable=async()=>{await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));await delay(180);};
const inspect=()=>page.evaluate(()=>({scene:window.__hex3D.inspect(),game:window.__cityFixture.read()}));
function checkCamera(a,b){for(const key of ['camera','target','quaternion'])assert.deepEqual(b[key],a[key],key);assert.equal(b.zoom,a.zoom);assert.equal(b.instanceId,a.instanceId);}
try{
 const ui=await readFile('src/game-ui.ts','utf8'),html=await readFile('index.html','utf8');
 assert.ok(html.includes('/src/game-ui.ts'));
 await writeFile(temporary[0],html.replace('/src/game-ui.ts','/src/__city-game.ts'));
 await writeFile(temporary[1],ui+fixture);
 await writeFile(temporary[2],'<html><head><style>body{margin:0;background:#e7ece6;color:#294238;font:16px system-ui}header{height:80px;text-align:center;box-sizing:border-box;padding:12px}h1{margin:0;font-size:24px}p{margin:3px}canvas{display:block}</style></head><body><header><h1>Settlement → City</h1><p>Same player colors · centered hall · twin low towers</p></header><canvas></canvas><script type="module" src="/src/__city-gallery.ts"></script></body></html>');
 await writeFile(temporary[3],gallery);
 server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','4179','--strictPort'],{stdio:'pipe'});
 server.stdout.on('data',d=>logs+=d);server.stderr.on('data',d=>logs+=d);
 const base='http://127.0.0.1:4179/hex-island-game/';
 for(let i=0;i<100;i++){try{if((await fetch(base)).ok)break;}catch{}await delay(200);}
 browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 page=await browser.newPage({viewport:{width:1440,height:900}});page.on('pageerror',error=>report.errors.push(String(error)));
 await page.goto(base+'__city-game.html?qa3d=1',{waitUntil:'networkidle'});
 const colors=await page.evaluate(()=>window.__cityFixture.colors());
 await page.goto(base+'__city-gallery.html?colors='+encodeURIComponent(JSON.stringify(colors)),{waitUntil:'networkidle'});
 await page.waitForFunction(()=>window.__cityGallery?.ready);
 assert.equal(await page.evaluate(()=>window.__cityGallery.revision),'city-townhall-v1');
 assert.equal(await page.evaluate(()=>window.__cityGallery.models),12);
 await page.screenshot({path:evidence+'/city-six-colors.png'});
 await page.evaluate(()=>window.__cityGallery.angle());await page.screenshot({path:evidence+'/city-three-quarter.png'});
 report.checks.push('Six actual player colors rendered alongside unchanged settlements');
 for(const count of [3,6]){
  await page.setViewportSize({width:1440,height:900});await page.goto(base+'__city-game.html?qa3d=1',{waitUntil:'networkidle'});
  await page.evaluate(count=>window.__cityFixture.load(count),count);await page.waitForFunction(()=>window.__hex3D?.inspect().mode==='3d');await stable();
  const bounds=await page.locator('#board canvas').boundingBox();
  await page.mouse.move(bounds.x+bounds.width*.5,bounds.y+bounds.height*.5);await page.mouse.down({button:'middle'});await page.mouse.move(bounds.x+bounds.width*.5+38,bounds.y+bounds.height*.5-12,{steps:6});await page.mouse.up({button:'middle'});await stable();
  const before=await inspect();
  await page.getByRole('button',{name:'Upgrade city',exact:true}).click();await stable();
  const target=await page.locator('#targets select').inputValue();
  const point=await page.evaluate(id=>window.__hex3D.point(id),target);assert.ok(point);
  await page.mouse.click(point.x,point.y);await stable();
  const after=await inspect();assert.equal(after.game.buildings[target].kind,'city');assert.equal(after.game.cities,before.game.cities-1);
  assert.equal(after.game.hand.grain,before.game.hand.grain-2);assert.equal(after.game.hand.ore,before.game.hand.ore-3);
  assert.equal(after.game.board,before.game.board);assert.equal(after.game.roads,before.game.roads);checkCamera(before.scene,after.scene);
  await page.getByRole('button',{name:'Undo last action',exact:true}).click();await stable();
  const undo=await inspect();assert.deepEqual(undo.game,before.game);checkCamera(before.scene,undo.scene);
  await page.getByRole('button',{name:'Upgrade city',exact:true}).click();await page.getByRole('button',{name:'Use target',exact:true}).click();await stable();
  await delay(2200);await page.screenshot({path:evidence+'/city-board-'+count+'.png',fullPage:true});
  report.checks.push(count+' players: 3D target click upgrades city, correct cost/supply, Undo/replay and manual camera retained');
  await page.locator('#board-view-top').click();await stable();assert.ok((await inspect()).scene.fullyVisible);
  await page.screenshot({path:evidence+'/city-board-top-'+count+'.png',fullPage:true});
  await page.locator('#board-view-reset').click();await page.setViewportSize({width:375,height:812});await stable();
  assert.equal((await inspect()).scene.mode,'3d');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  await page.screenshot({path:evidence+'/city-mobile-'+count+'.png',fullPage:true});
  report.checks.push(count+' players: desktop top view, mobile 3D and no horizontal overflow');
 }
 assert.deepEqual(report.errors,[]);
}catch(error){report.error=String(error.stack||error);console.error(report.error);process.exitCode=1;try{await page?.screenshot({path:evidence+'/failure.png',fullPage:true});}catch{}}
finally{await writeFile(evidence+'/report.json',JSON.stringify(report,null,2));await writeFile(evidence+'/server.log',logs);await browser?.close();server?.kill('SIGTERM');for(const path of temporary)await rm(path,{force:true});}
