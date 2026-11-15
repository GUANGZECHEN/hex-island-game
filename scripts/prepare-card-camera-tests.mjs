import {readFile,writeFile} from 'node:fs/promises';
const path='scripts/qa-card-camera.mjs';let s=await readFile(path,'utf8');
const replace=(a,b)=>{if(!s.includes(a))throw new Error('Regression script drift: '+a.slice(0,90));s=s.replace(a,b);};
replace("const evidence = process.env.CAMERA_EVIDENCE || 'camera-evidence';", "const evidence = process.env.CAMERA_EVIDENCE || 'camera-evidence';\nconst strict=process.env.CAMERA_EXPECT_STABLE==='1';");
replace("publicActivity='Choose an action.';", "publicActivity='Player 1 traded resources with Player 2. The table is waiting for the next action; the current player may build a settlement, upgrade a city, exchange resources at a port, or play a development card.';");
replace("function maxDelta(a,b){return Math.max(0,...a.map((v,i)=>Math.abs(v-b[i])));}", `function maxDelta(a,b){return Math.max(0,...a.map((v,i)=>Math.abs(v-b[i])));}
function difference(before,after){
 const a=before.render,b=after.render;
 const units=r=>[(r.frustum[1]-r.frustum[0])/r.canvasSize[0]/r.zoom,(r.frustum[2]-r.frustum[3])/r.canvasSize[1]/r.zoom];
 return {position:maxDelta(a.camera,b.camera),target:maxDelta(a.target,b.target),quaternion:maxDelta(a.quaternion,b.quaternion),zoom:Math.abs(a.zoom-b.zoom),worldPerPixel:maxDelta(units(a),units(b))};
}
function verifyView(before,after,label){
 const delta=difference(before,after);const preserved=Object.values(delta).every(value=>value<1e-8);
 report.checks.push({label,preserved,delta,beforeSize:before.render.canvasSize,afterSize:after.render.canvasSize});
 assert.equal(after.render.staticKey,before.render.staticKey,label+' map identity');
 assert.equal(after.render.instanceId,before.render.instanceId,label+' rendering instance');
 if(strict)assert.ok(preserved,label+': '+JSON.stringify(delta));
 console.log(label,JSON.stringify({preserved,delta}));
}`);
replace("  assert.equal(after.game.board,before.game.board);assert.equal(after.render.instanceId,before.render.instanceId);", `  assert.equal(after.game.board,before.game.board);assert.equal(after.render.instanceId,before.render.instanceId);
  verifyView(before,after,width+' '+card+' play with notice reflow');
  // Exercise the same ResizeObserver path when card/target content changes the viewport.
  await page.evaluate(()=>{const host=document.querySelector('#board');host.style.setProperty('height',Math.max(180,host.clientHeight-28)+'px','important');host.style.setProperty('flex','0 0 auto','important');});
  await stable();const resized=await inspect();verifyView(after,resized,width+' '+card+' container resize');`);
replace("   assert.equal(after.game.phase,'free-road');", "   assert.equal(after.game.phase,'free-road');\n   const roadReference=await inspect();");
replace("    const now=await inspect();report.checks.push({width,card,step:step+1,after:now,projectionDelta:maxDelta(after.render.projection,now.render.projection)});", "    const now=await inspect();report.checks.push({width,card,step:step+1,after:now});verifyView(roadReference,now,width+' free road '+(step+1));\n    assert.equal(now.game.roads.length,before.game.roads.length+step+1);");
replace("   assert.equal((await inspect()).game.phase,'action');", `   assert.equal((await inspect()).game.phase,'action');
   await page.getByRole('button',{name:'Undo last action',exact:true}).click();await stable();
   const undone=await inspect();verifyView(roadReference,undone,width+' undo free road');assert.equal(undone.game.phase,'free-road');assert.equal(undone.game.roads.length,before.game.roads.length+1);
   await page.getByRole('button',{name:'Place road',exact:true}).click();await stable();
   await page.getByRole('button',{name:'Cancel selection',exact:true}).click();await stable();verifyView(roadReference,await inspect(),width+' cancel target');
   await page.getByRole('button',{name:'Place road',exact:true}).click();await page.getByRole('button',{name:'Use target',exact:true}).click();await stable();verifyView(roadReference,await inspect(),width+' replay free road');`);
replace("  await delay(2200);const timed=await inspect();report.checks.push({width,card,alertExpired:true,after:timed,projectionDelta:maxDelta(after.render.projection,timed.render.projection)});", "  await delay(2200);const timed=await inspect();report.checks.push({width,card,alertExpired:true,after:timed});verifyView(resized,timed,width+' '+card+' notice dismissal');");
replace("  if(width===1280&&card==='road-building')await page.screenshot({path:`${evidence}/road-building.png`,fullPage:true});", "  if(width===1280&&card==='road-building')await page.screenshot({path:`${evidence}/road-building.png`,fullPage:true});\n  await page.locator('#board-view-reset').click();await stable();const reset=await inspect();assert.equal(reset.render.zoom,1);assert.ok(reset.render.fullyVisible);\n  await page.locator('#board-view-top').click();await stable();assert.ok((await inspect()).render.fullyVisible);");
await writeFile(path,s);
