import {assertDirectTargets,boardTargetIds,boardTargetPoint,clickBoardTarget} from './qa-board-targets.mjs';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

const evidence = process.env.LABEL_EVIDENCE || 'compact-action-evidence';
await mkdir(evidence, { recursive: true });
let server, browser, page;
const report={checks:[],errors:[]};
const check=(name,details={})=>{report.checks.push({name,pass:true,...details});console.log('PASS',name,JSON.stringify(details));};
const url=new URL(process.env.QA_URL || 'http://127.0.0.1:4176/hex-island-game/');
url.searchParams.set('renderer','2d');
try {
  if (!process.env.QA_URL) {
    server=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','4176','--strictPort'],{stdio:'pipe'});
    let started=false;
    for(let i=0;i<80;i++){try{if((await fetch(url)).ok){started=true;break;}}catch{}await delay(150);}
    assert.ok(started,'preview server failed to start');
  }
  browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  page=await browser.newPage({viewport:{width:1280,height:720}});
  page.on('pageerror',e=>report.errors.push(String(e)));
  await page.goto(url.href,{waitUntil:'networkidle'});
  await page.locator('#local-room-create').click();await page.locator('#seats').selectOption('2');await page.locator('#start').click();
  if(await page.locator('#pass').isVisible())await page.locator('#reveal').click();
  const settlement=page.getByRole('button',{name:'Place settlement',exact:true});
  assert.equal(await settlement.locator('.action-label').textContent(),'Settlement');
  assert.equal(await settlement.getAttribute('title'),'Place settlement');
  await settlement.click();await clickBoardTarget(page);
  const road=page.getByRole('button',{name:'Place road',exact:true});
  assert.equal(await road.locator('.action-label').textContent(),'Road');
  assert.match((await page.locator('#actions button').allTextContents()).at(-1),/Undo last action/);
  await page.getByRole('button',{name:'Undo last action',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'Place settlement',exact:true}).locator('.action-label').textContent(),'Settlement');
  assert.equal(await page.locator('#game-error').textContent(),'');
  check('Actual game setup uses short labels, full accessible names and unchanged safe Undo');

  // Freeze the real clock while inspecting passive layout fixtures.
  await page.evaluate(()=>{window.__qaActionTemplate=document.querySelector('#actions button.action-button').cloneNode(true);});
  await page.locator('#turn-clock-pause').click();
  assert.equal(await page.locator('#turn-clock-pause').getAttribute('aria-pressed'),'true');
  // Pure layout fixtures: use actual action and hand DOM nodes, never change game state.
  // Unit contracts independently verify all paid actions call the same presentation helper.
  await page.evaluate(()=>{
    const source=window.__qaActionTemplate;
    const chips=Array.from(document.querySelectorAll('#hand .resource-chip'));
    const actions=document.querySelector('#actions');actions.replaceChildren();
    const grid=document.createElement('div');grid.className='action-grid';actions.append(grid);
    for(const [full,label,iconType,cost] of [
      ['Build road','Road','road',[0,1]],['Build settlement','Settlement','settlement',[0,1,2,3]],
      ['Upgrade city','City','city',[3,4]],['Buy development card','Develop','card',[2,3,4]],
    ]){
      const b=source.cloneNode(true);b.dataset.action=iconType;b.setAttribute('aria-label',full);b.title=full;
      b.querySelector('.action-label').textContent=label;
      const row=document.createElement('span');row.className='action-cost';
      for(const i of cost){const chip=chips[i].cloneNode(true);const number=Array.from(chip.childNodes).find(n=>n.nodeType===3);if(number)number.textContent='1';row.append(chip);}
      b.append(row);grid.append(b);
    }
  });
  for(const [width,height] of [[1101,700],[1280,720],[1920,900],[375,812],[320,700]]){
    await page.setViewportSize({width,height});await delay(180);
    const metrics=await page.evaluate(()=>{
      const rect=e=>e.getBoundingClientRect();
      const pane=rect(document.querySelector('#board-action-pane'));
      const buttons=Array.from(document.querySelectorAll('#actions button.action-button'));
      return {paneWidth:pane.width,overflow:document.documentElement.scrollWidth>innerWidth+1,buttons:buttons.map(b=>{
        const r=rect(b),icon=rect(b.querySelector(':scope > .icon')),label=rect(b.querySelector('.action-label')),cost=rect(b.querySelector('.action-cost'));
        const range=document.createRange();range.selectNodeContents(b.querySelector('.action-label'));const text=range.getBoundingClientRect();
        return {label:b.querySelector('.action-label').textContent,width:r.width,height:r.height,
          iconClear:icon.right<=label.left+1,labelFits:text.right<=r.right-1&&text.left>=icon.right-1,
          costBelow:cost.top>=Math.max(icon.bottom,label.bottom)-1,costFits:cost.right<=r.right-1&&cost.left>=r.left,
          noInternalOverflow:b.scrollWidth<=b.clientWidth+1};
      })};
    });
    assert.ok(!metrics.overflow,JSON.stringify(metrics));
    assert.equal(metrics.buttons.length,4);
    assert.ok(metrics.buttons.every(b=>b.iconClear&&b.labelFits&&b.costBelow&&b.costFits&&b.noInternalOverflow),JSON.stringify(metrics));
    // Desktop actions intentionally remain a two-column grid. Keep this tied to
    // the measured pane instead of an arbitrary fixed pixel cap so a wider
    // command tray can grow without weakening the responsive fit check.
    if(width>1100)assert.ok(metrics.buttons.every(b=>b.width<=metrics.paneWidth/2+2&&b.height<95),JSON.stringify(metrics));
    check(`Four short-label/cost layout fixtures fit ${width}x${height}`,metrics);
    if(width===1280||width===375)await page.screenshot({path:`${evidence}/compact-actions-${width}.png`,fullPage:true});
  }
  assert.deepEqual(report.errors,[]);check('No browser errors');
}catch(error){report.error=String(error.stack||error);console.error(report.error);process.exitCode=1;try{await page?.screenshot({path:`${evidence}/failure.png`,fullPage:true});}catch{}}
finally{await writeFile(`${evidence}/report.json`,JSON.stringify(report,null,2));await browser?.close();server?.kill('SIGTERM');}
