import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir,writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

await mkdir('evidence',{recursive:true});
const report={scope:'Isolated Three.js feasibility; not full gameplay or real-device performance acceptance',testedAt:new Date().toISOString(),checks:[],defaultProbe:null,renderer:null,error:null};
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','4177','--strictPort'],{stdio:'pipe'});
let serverLog='';server.stdout.on('data',x=>serverLog+=x);server.stderr.on('data',x=>serverLog+=x);
let browser;
const url='http://127.0.0.1:4177/';
const check=(name,details={})=>{report.checks.push({name,pass:true,...details});console.log('PASS',name,JSON.stringify(details));};
const distance=(a,b)=>Math.hypot(...a.map((value,i)=>value-b[i]));
const inspect=page=>page.evaluate(()=>window.__threeProof.inspect());
const settle=page=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
function colorStats(buffer){const png=PNG.sync.read(buffer),colors=new Set();for(let i=0;i<png.data.length;i+=16)colors.add(`${png.data[i]>>3},${png.data[i+1]>>3},${png.data[i+2]>>3}`);return {colors:colors.size,width:png.width,height:png.height};}
function pixelDifference(a,b){const x=PNG.sync.read(a),y=PNG.sync.read(b);assert.equal(x.width,y.width);assert.equal(x.height,y.height);let count=0;for(let i=0;i<x.data.length;i+=4)if(Math.abs(x.data[i]-y.data[i])+Math.abs(x.data[i+1]-y.data[i+1])+Math.abs(x.data[i+2]-y.data[i+2])>35)count++;return count;}
async function drag(page,button,dx,dy,modifier){const box=await page.locator('#viewport').boundingBox();const x=box.x+box.width*.5,y=box.y+box.height*.55;if(modifier)await page.keyboard.down(modifier);await page.mouse.move(x,y);await page.mouse.down({button});await page.mouse.move(x+dx,y+dy,{steps:12});await page.mouse.up({button});if(modifier)await page.keyboard.up(modifier);await settle(page);}
try {
  let ready=false;for(let i=0;i<80;i++){try{if((await fetch(url)).ok){ready=true;break;}}catch{}await delay(250);}assert.ok(ready,serverLog);
  const probe=await chromium.launch({headless:true});const probePage=await probe.newPage();
  report.defaultProbe=await probePage.evaluate(()=>{const gl=document.createElement('canvas').getContext('webgl2');if(!gl)return {webgl2:false};const ext=gl.getExtension('WEBGL_debug_renderer_info');return {webgl2:true,renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER)};});await probe.close();
  browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const page=await browser.newPage({viewport:{width:1920,height:720}}),pageErrors=[],consoleErrors=[],sockets=[];
  page.on('pageerror',error=>pageErrors.push(String(error)));page.on('console',message=>{if(message.type()==='error')consoleErrors.push(message.text());});page.on('websocket',socket=>sockets.push(socket.url()));
  await page.goto(url,{waitUntil:'networkidle'});await page.waitForFunction(()=>window.__threeProof?.inspect().mode==='3d');await settle(page);
  const first=await inspect(page);report.renderer=first.device;assert.equal(first.three,'180');assert.equal(first.hexCount,19);assert.ok(first.frameCount>0);assert.ok(first.triangles>1000);assert.ok(first.fullyVisible);
  const beforeImage=await page.locator('#viewport').screenshot();const pixels=colorStats(beforeImage);assert.ok(pixels.colors>60,JSON.stringify(pixels));
  check('WebGL2 renders real, nonblank Three.js pixels',{renderer:first.device,triangles:first.triangles,calls:first.calls,...pixels});
  await page.screenshot({path:'evidence/three-desktop-1920x720.png',fullPage:true});
  await drag(page,'middle',105,-35);const orbited=await inspect(page);assert.ok(distance(first.camera,orbited.camera)>.2);assert.equal(orbited.pickCount,0);assert.ok(orbited.sourceUnchanged);
  const changed=pixelDifference(beforeImage,await page.locator('#viewport').screenshot());assert.ok(changed>1000);check('Middle drag rotates the camera and pixels without triggering a selection',{changedPixels:changed});
  await page.screenshot({path:'evidence/three-orbited.png',fullPage:true});
  const oldTarget=orbited.target;await drag(page,'middle',28,18,'Shift');const panned=await inspect(page);assert.ok(distance(oldTarget,panned.target)>.01);assert.equal(panned.pickCount,0);check('Shift + middle drag pans independently');
  const view=await page.locator('#viewport').boundingBox();await page.mouse.move(view.x+view.width/2,view.y+view.height/2);await page.mouse.wheel(0,-180);await settle(page);const zoomed=await inspect(page);assert.ok(zoomed.zoom>panned.zoom);check('Mouse wheel zooms only on the canvas');
  const hand=await page.locator('#proof-hand').boundingBox();await page.mouse.move(hand.x+hand.width/2,hand.y+20);await page.mouse.wheel(0,100);await settle(page);assert.equal((await inspect(page)).zoom,zoomed.zoom);check('Scrolling Your hand does not zoom the board');
  await page.click('#reset-view');await settle(page);const reset=await inspect(page);assert.ok(distance(first.camera,reset.camera)<.001);assert.equal(reset.zoom,1);assert.ok(reset.fullyVisible);check('Reset restores a complete default view');
  const point=await page.evaluate(()=>window.__threeProof.point('h:0,0'));await page.mouse.click(point.x,point.y);assert.equal((await inspect(page)).lastPick,'h:0,0');check('Left-click ray picking preserves original hex IDs');
  await page.locator('#draft').fill('4');await page.evaluate(()=>window.originalDraft=document.getElementById('draft'));
  const sizes=[[1280,720],[1280,900],[1920,1080],[2560,900],[1101,700],[375,812],[320,700]];
  for(const [width,height] of sizes){await page.setViewportSize({width,height});await settle(page);await delay(100);const metrics=await page.evaluate(()=>{const rect=id=>document.getElementById(id).getBoundingClientRect();const canvas=rect('viewport'),hand=rect('proof-hand'),actions=rect('proof-actions');return {right:canvas.right,bottom:canvas.bottom,top:canvas.top,width:canvas.width,handActionGap:actions.top-hand.bottom,horizontalOverflow:document.documentElement.scrollWidth>innerWidth+1,sameInput:window.originalDraft===document.getElementById('draft'),draft:document.getElementById('draft').value};});assert.ok(!metrics.horizontalOverflow,JSON.stringify(metrics));assert.ok(metrics.width>100);if(width>1100)assert.ok(metrics.bottom<=height,JSON.stringify(metrics));assert.ok(metrics.handActionGap>=0&&metrics.handActionGap<=10,JSON.stringify(metrics));assert.ok(metrics.sameInput);assert.equal(metrics.draft,'4');assert.ok((await inspect(page)).fullyVisible);if(width===375)await page.screenshot({path:'evidence/three-mobile-375x812.png',fullPage:true});check(`Viewport ${width}x${height} fits and preserves input`,metrics);}
  await page.setViewportSize({width:1920,height:720});await settle(page);const frameA=(await inspect(page)).frameCount;await delay(400);const frameB=(await inspect(page)).frameCount;assert.ok(frameB-frameA<=1);assert.ok((await inspect(page)).sourceUnchanged);assert.equal(sockets.length,0);check('Static scene is rendered on demand; no WebSocket commands or map mutation',{idleExtraFrames:frameB-frameA});
  await page.goto(url+'?layout=expanded',{waitUntil:'networkidle'});await page.waitForFunction(()=>window.__threeProof?.inspect().mode==='3d');await settle(page);assert.equal((await inspect(page)).hexCount,24);assert.ok((await inspect(page)).fullyVisible);await page.screenshot({path:'evidence/three-expanded-24.png',fullPage:true});check('Existing expanded 24-hex topology renders and fits');
  await page.evaluate(()=>window.__threeProof.loseContext());await page.waitForFunction(()=>document.body.dataset.mode==='2d');assert.equal(await page.locator('#viewport canvas').count(),0);assert.equal(await page.locator('#viewport svg.island-board').count(),1);assert.equal(await page.locator('#viewport [data-hex-id]').count(),24);assert.ok((await inspect(page)).disposed);assert.ok((await inspect(page)).sourceUnchanged);await page.screenshot({path:'evidence/context-loss-svg-fallback.png',fullPage:true});check('Actual WebGL context loss disposes 3D resources and shows original SVG map');
  await page.goto(url+'?fallback=1',{waitUntil:'networkidle'});assert.equal((await inspect(page)).mode,'2d');assert.equal(await page.locator('#viewport [data-hex-id]').count(),19);await page.locator('#viewport [data-hex-id="h:0,0"]').click();assert.equal((await inspect(page)).lastPick,'h:0,0');check('Requested SVG fallback remains selectable with the same IDs');
  const unsupported=await browser.newPage({viewport:{width:1280,height:720}});await unsupported.addInitScript(()=>{const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){return type==='webgl2'?null:original.call(this,type,...args);};});await unsupported.goto(url,{waitUntil:'networkidle'});assert.equal((await inspect(unsupported)).mode,'2d');assert.match((await inspect(unsupported)).reason,/unavailable/);await unsupported.close();check('Unavailable WebGL2 automatically selects SVG without a blank page');
  assert.deepEqual(pageErrors,[]);assert.deepEqual(consoleErrors,[]);check('No browser exceptions or shader/console errors');
} catch(error) {report.error=String(error?.stack??error);console.error(report.error);process.exitCode=1;}
finally {await browser?.close();server.kill('SIGTERM');await writeFile('evidence/report.json',JSON.stringify(report,null,2));await writeFile('evidence/server.log',serverLog);}
