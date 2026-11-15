import { readFile,writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';

// Package the already-tested production bundle without external imports or assets.
const html=await readFile('dist/index.html','utf8');
const jsTag=html.match(/<script[^>]+src="\.\/([^"]+)"[^>]*><\/script>/);
const cssTag=html.match(/<link[^>]+href="\.\/([^"]+)"[^>]*>/);
assert.ok(jsTag&&cssTag);
const js=await readFile('dist/'+jsTag[1],'utf8'),css=await readFile('dist/'+cssTag[1],'utf8');
assert.ok(!js.includes('import('),'Standalone must not rely on dynamic asset imports');
const packed=html.replace(jsTag[0],()=>'<script type="module">'+js.replaceAll('</script','<\\/script')+'</script>').replace(cssTag[0],()=>'<style>'+css.replaceAll('</style','<\\/style')+'</style>');
const filename='evidence/Hex_Island_3D_Verification.html';await writeFile(filename,packed);
const report=JSON.parse(await readFile('evidence/report.json','utf8'));
const check=(name,details={})=>{report.checks.push({name,pass:true,...details});console.log('PASS',name,JSON.stringify(details));};
let browser;
try{
 browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const page=await browser.newPage({viewport:{width:1280,height:720}}),errors=[],external=[];
 page.on('pageerror',e=>errors.push(String(e)));
 page.on('request',r=>{if(/^https?:/.test(r.url()))external.push(r.url());});
 await page.goto(pathToFileURL(resolve(filename)).href,{waitUntil:'networkidle'});
 await page.waitForFunction(()=>window.__threeProof?.inspect().mode==='3d');
 const before=await page.evaluate(()=>window.__threeProof.inspect());
 assert.equal(before.hexCount,19);assert.ok(before.frameCount>0);assert.ok(before.triangles>1000);
 check('Standalone HTML opens through file URL and renders the same Three.js scene');
 const png=PNG.sync.read(await page.locator('#viewport').screenshot());const colors=new Set();for(let i=0;i<png.data.length;i+=16)colors.add(`${png.data[i]>>3},${png.data[i+1]>>3},${png.data[i+2]>>3}`);assert.ok(colors.size>60);
 check('Standalone screenshot contains real rendered pixels',{sampledColors:colors.size});
 const box=await page.locator('#viewport').boundingBox(),x=box.x+box.width/2,y=box.y+box.height/2;
 await page.mouse.move(x,y);await page.mouse.down({button:'middle'});await page.mouse.move(x+70,y-25,{steps:10});await page.mouse.up({button:'middle'});
 const after=await page.evaluate(()=>window.__threeProof.inspect());assert.ok(Math.hypot(...after.camera.map((v,i)=>v-before.camera[i]))>.1);assert.equal(after.pickCount,0);
 await page.click('#reset-view');const point=await page.evaluate(()=>window.__threeProof.point('h:0,0'));await page.mouse.click(point.x,point.y);assert.equal((await page.evaluate(()=>window.__threeProof.inspect())).lastPick,'h:0,0');
 check('Standalone middle-drag and left-click remain independent');
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 check('Standalone requires no external network requests or npm installation',{bytes:Buffer.byteLength(packed)});
 report.standalone={filename,verifiedVia:'file URL in real Chromium / ANGLE SwiftShader',externalRequests:0};
}catch(error){report.packagingError=String(error?.stack??error);console.error(report.packagingError);process.exitCode=1;}
finally{await browser?.close();await writeFile('evidence/report.json',JSON.stringify(report,null,2));}
