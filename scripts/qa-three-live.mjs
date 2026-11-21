import {assertDirectTargets,boardTargetIds,boardTargetPoint,clickBoardTarget} from './qa-board-targets.mjs';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

const evidence = process.env.THREE_EVIDENCE || 'three-evidence';
await mkdir(evidence, { recursive: true });
const report = { scope: 'Actual integrated game, not the disconnected prototype; software WebGL is not a hardware performance measurement', checks: [], errors: [], renderer: null };
const check = (name, details = {}) => { report.checks.push({ name, ...details, pass: true }); console.log('PASS', name, JSON.stringify(details)); };
const inspect = page => page.evaluate(() => window.__hex3D?.inspect());
const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const moved = (a, b) => Math.hypot(...a.map((x, i) => x - b[i]));
function assertCameraUnchanged(before,after,reason){
 for(const key of ['camera','target','quaternion'])assert.ok(moved(before[key],after[key]) < .002,`${reason}: ${key} shifted`);
 assert.ok(Math.abs(before.zoom-after.zoom)<.0001,`${reason}: zoom shifted`);
}
let server, browser;
const url = new URL(process.env.QA_URL || 'http://127.0.0.1:4175/hex-island-game/');
url.searchParams.set('qa3d', '1'); url.searchParams.set('qaPlayers', '2'); url.searchParams.delete('renderer');
let current;
const watch = p => { p.on('pageerror', e => report.errors.push(String(e))); p.on('console', m => { if (m.type() === 'error' && /THREE|WebGL|shader/i.test(m.text())) report.errors.push(m.text()); }); return p; };
async function ready(page) { await page.waitForFunction(() => window.__hex3D?.inspect().mode === '3d' && window.__hex3D.inspect().frames > 0, null, { timeout: 15000 }); await settle(page); }
async function reveal(page) { if (await page.locator('#pass').isVisible()) await page.locator('#reveal').click(); }
async function startLocal(page, count, seed = '24680') {
  await page.goto(url.href, { waitUntil: 'networkidle' });
  await page.locator('#local-room-create').click(); await page.locator('#seats').selectOption(String(count)); await page.locator('#seed').fill(seed);
  await page.locator('#start').click(); await reveal(page); await ready(page);
}
async function canvasPlace(page, action) {
  await page.getByRole('button', { name: action, exact: true }).click();
  await page.waitForFunction(() => (window.__hex3D?.inspect().targets.length || 0) > 0);
  await assertDirectTargets(page); const [id] = await boardTargetIds(page); assert.ok(id);
  const point = await page.evaluate(id => window.__hex3D.point(id), id);
  assert.ok(point); await page.mouse.click(point.x, point.y); await settle(page);
  assert.equal(await page.locator('#game-error').textContent(), '');
  return id;
}
async function drag(page, dx, dy, shift = false) {
  const b = await page.locator('#board canvas').boundingBox();
  if (shift) await page.keyboard.down('Shift');
  await page.mouse.move(b.x + b.width / 2, b.y + b.height * .55); await page.mouse.down({ button: 'middle' });
  await page.mouse.move(b.x + b.width / 2 + dx, b.y + b.height * .55 + dy, { steps: 12 }); await page.mouse.up({ button: 'middle' });
  if (shift) await page.keyboard.up('Shift'); await settle(page);
}
function colors(data) { const p = PNG.sync.read(data), result = new Set(); for (let i = 0; i < p.data.length; i += 16) result.add(`${p.data[i] >> 3},${p.data[i + 1] >> 3},${p.data[i + 2] >> 3}`); return result.size; }
try {
  if (!process.env.QA_URL) {
    server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '4175', '--strictPort'], { stdio: 'pipe' });
    for (let i = 0; i < 80; i++) { try { if ((await fetch(url)).ok) break; } catch {} await delay(200); }
  }
  browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = current = watch(await browser.newPage({ viewport: { width: 1920, height: 900 } }));
  await startLocal(page, 3);
  const actionTimer=page.locator('#turn-action-clock');
  assert.equal(await actionTimer.isVisible(),true,'the clock must be visible on the board');
  const startingSeconds=Number((await page.locator('#turn-action-clock-seconds').textContent()).split(':')[1]);
  assert.ok(startingSeconds>=42&&startingSeconds<=45);
  await delay(1220);
  const laterSeconds=Number((await page.locator('#turn-action-clock-seconds').textContent()).split(':')[1]);
  assert.ok(laterSeconds<startingSeconds,'the clock must count down live');
  await page.locator('#board-view-reset').click();
  const cameraSeconds=Number((await page.locator('#turn-action-clock-seconds').textContent()).split(':')[1]);
  assert.ok(cameraSeconds<=laterSeconds,'camera interaction must not reset the clock');
  await canvasPlace(page, 'Place settlement');
  const buildSeconds=Number((await page.locator('#turn-action-clock-seconds').textContent()).split(':')[1]);
  assert.ok(buildSeconds>=43&&buildSeconds<=45,'completed settlement must reset the clock to 45 seconds');
  await delay(1300);
  const beforeUndo=Number((await page.locator('#turn-action-clock-seconds').textContent()).split(':')[1]);
  await page.getByRole('button', { name: 'Undo last action', exact: true }).click();
  const afterUndo=Number((await page.locator('#turn-action-clock-seconds').textContent()).split(':')[1]);
  assert.ok(afterUndo<=beforeUndo,'Undo must not reset the clock');
  const timerBounds=await actionTimer.boundingBox(),boardBounds=await page.locator('#board').boundingBox();
  assert.ok(timerBounds&&boardBounds&&timerBounds.x+timerBounds.width<=boardBounds.x+boardBounds.width+6&&timerBounds.y<=boardBounds.y+60,'timer stays in the board upper-right corner');
  check('45-second clock ignores camera and Undo while a completed settlement resets it');
  await page.locator('#turn-clock-pause').click();
  assert.equal(await page.locator('#turn-clock-pause').getAttribute('aria-pressed'),'true');
  const frozen=await page.locator('#turn-action-clock-seconds').textContent();
  await delay(1500);
  assert.equal(await page.locator('#turn-action-clock-seconds').textContent(),frozen,'paused clock must stay frozen');
  assert.equal(await page.getByRole('button',{name:'Place settlement',exact:true}).count(),0,'game actions are unavailable while paused');
  check('Local pause freezes the displayed time and blocks gameplay');
  let info = await inspect(page); report.renderer = info.device;
  const picksBeforeCameraChecks=info.picks;
  assert.equal(info.hexCount, 19); assert.equal(info.portCount, 9); assert.ok(info.triangles > 3000); assert.ok(info.fullyVisible);
  const colorCount = colors(await page.locator('#board canvas').screenshot()); assert.ok(colorCount > 100);
  assert.ok(info.deserts.every(d => !d.hasToken && d.duneMeshes === 1 && d.props === 0));
  assert.ok(info.boats.every(b => b.decks.length === 2 && b.decks[0].vertexId !== b.decks[1].vertexId));
  check('Actual game defaults to nonblank 3D with sand dunes and nine boat ports', { triangles: info.triangles, calls: info.calls, colors: colorCount });
  await page.screenshot({ path: `${evidence}/three-live-desktop.png`, fullPage: true });
  assert.equal(info.ambientMotion.enabled, true);
  assert.ok(info.ambientMotion.decorations > 15);
  assert.equal(info.oceanLayers.includes('sea-ripples'), false, 'Sea must have no drifting white lines');
  assert.ok(info.oceanLayers.includes('depth-gradient-water'), 'Actual sea surface remains animated');
  const ambient0 = info.ambientMotion;
  await delay(380);
  const ambient1 = (await inspect(page)).ambientMotion;
  assert.notDeepEqual(ambient0.waveSamples, ambient1.waveSamples);
  assert.notDeepEqual(ambient0.boats, ambient1.boats);
  assert.equal(ambient1.waterReceivesShadow, false, 'Real water surface must not receive black cast-shadow patches');
  assert.equal(ambient1.oceanDepthFaces, 128 * 6, 'Ocean depth has side walls only, no dark top cap');
  assert.ok(ambient1.waterNormalVersion > 0, 'Water geometry must recompute normals as the physical surface undulates');
  assert.ok(ambient1.waterNormalVersion > ambient0.waterNormalVersion, 'Normals must update each motion frame');
  check('Sea mesh visibly deforms and relights without submerged dark disk; boats keep their original sway');

  for (const kind of ['tree','sheep','rock','brick','wheat']) {
    const point = await page.evaluate(kind => window.__hex3D.decorativePoint(kind), kind);
    assert.ok(point, `No decorative ${kind} object to tap`);
    const before = await inspect(page);
    await page.mouse.click(point.x, point.y);
    await page.waitForFunction(kind => window.__hex3D.inspect().ambientMotion.lastReactionKind === kind, kind, { timeout: 5000 });
    const during = await inspect(page);
    assertCameraUnchanged(before, during, `Tapped ${kind}`);
    assert.equal(during.picks, before.picks, `Tapped ${kind} issued a game command`);
    assert.equal(during.ambientMotion.lastReactionKind, kind);
  }
  await page.screenshot({ path: `${evidence}/three-live-reactive-art.png`, fullPage: true });
  await delay(1100);
  assert.equal((await inspect(page)).ambientMotion.reacting, 0);
  check('Clicking each resource model triggers only a temporary local animation, without moving the camera or gameplay state');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForFunction(() => !window.__hex3D.inspect().ambientMotion.enabled);
  const paused = await inspect(page);
  await delay(260);
  const pausedAfter = await inspect(page);
  assert.deepEqual(paused.ambientMotion.waveSamples, pausedAfter.ambientMotion.waveSamples);
  assert.ok(pausedAfter.frames - paused.frames <= 1);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.waitForFunction(() => window.__hex3D.inspect().ambientMotion.enabled);
  check('Reduced-motion preference pauses ambient animation and keeps the canvas static');
  const startCamera = (await inspect(page)).camera;
  await drag(page, 90, -20); let rotated = await inspect(page);
  assert.ok(moved(startCamera, rotated.camera) > .2); assert.equal(rotated.buildings.length, 0); assert.equal(rotated.picks, picksBeforeCameraChecks);
  await drag(page, 20, 15, true); assert.ok(moved(rotated.target, (await inspect(page)).target) > .005);
  const canvas = await page.locator('#board canvas').boundingBox(); await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2); await page.mouse.wheel(0, -120); await settle(page);
  const zoom = (await inspect(page)).zoom; assert.ok(zoom > 1);
  const hand = await page.locator('#private-hand-card').boundingBox(); await page.mouse.move(hand.x + hand.width / 2, hand.y + 15); await page.mouse.wheel(0, 50); await settle(page); assert.equal((await inspect(page)).zoom, zoom);
  await page.locator('#board-view-reset').click(); await settle(page); assert.ok(moved(startCamera, (await inspect(page)).camera) < .001);
  check('Middle orbit, Shift pan and canvas-only wheel work without executing a move');
  await page.locator('#turn-clock-pause').click();
  assert.equal(await page.locator('#turn-clock-pause').getAttribute('aria-pressed'),'false');
  await delay(1300);
  assert.ok(Number((await page.locator('#turn-action-clock-seconds').textContent()).split(':')[1])<Number(frozen.split(':')[1]),'resumed clock continues from its frozen remaining time');
  await drag(page, 35, 0); const cameraBeforeBuild = (await inspect(page)).camera;
  const placed = await canvasPlace(page, 'Place settlement');
  info = await inspect(page); assert.ok(info.buildings.some(([id]) => id === placed)); assert.ok(moved(cameraBeforeBuild, info.camera) < .001);
  const buttons = await page.locator('#actions button').allTextContents(); assert.match(buttons.at(-1), /Undo last action/);
  const viewBeforeUndo=await inspect(page);
  await page.getByRole('button', { name: 'Undo last action', exact: true }).click();
  assert.equal((await inspect(page)).buildings.length, 0);
  assertCameraUnchanged(viewBeforeUndo,await inspect(page),'Undo');
  check('Rotated 3D ray picking executes a real settlement command; safe Undo removes it');
  await page.locator('#board-view-reset').click();
  for (let i = 0; i < 6; i++) { await reveal(page); await canvasPlace(page, 'Place settlement'); await canvasPlace(page, 'Place road'); }
  await reveal(page); info = await inspect(page);
  assert.equal(info.buildings.length, 6); assert.equal(info.roads.length, 6);
  await drag(page,35,-14);
  const beforeDice=await inspect(page);
  await page.getByRole('button', { name: 'Roll dice', exact: true }).click(); await settle(page);
  assertCameraUnchanged(beforeDice,await inspect(page),'Dice roll');
  assert.ok((await page.locator('#game-status').textContent()).includes('dice '));
  await page.waitForFunction(()=>window.__hex3D.inspect().rollEffect?.landed===true,null,{timeout:7000});
  const result=await inspect(page);
  assert.deepEqual(result.rollEffect.top,result.rollEffect.dice,'3D die faces match authoritative dice');
  assert.equal(result.rollEffect.top.reduce((sum,n)=>sum+n,0),result.rollEffect.dice[0]+result.rollEffect.dice[1]);
  assert.equal(await page.locator('.activity-alert.activity-dice').count(),0,'old dice popup is gone');
  assert.equal(await page.locator('.activity-production-summary').count(),0,'gains belong above buildings');
  await page.screenshot({path:`${evidence}/three-live-dice-production.png`,fullPage:true});
  if (await page.getByRole('button', { name: 'Move robber', exact: true }).count()) { const old = (await inspect(page)).robber; await canvasPlace(page, 'Move robber'); assert.notEqual((await inspect(page)).robber, old); }
  check('Complete local setup, roads and dice use existing reducers and resource announcements');
  for (const [width, height] of [[1280, 720], [1920, 720], [2560, 900], [1101, 700], [375, 812], [320, 700]]) {
    await page.setViewportSize({ width, height }); await settle(page); await delay(120);
    const fit = await page.evaluate(() => {
      const b = document.querySelector('#board canvas').getBoundingClientRect(), h = document.querySelector('#private-hand-card').getBoundingClientRect(), a = document.querySelector('#board-action-pane').getBoundingClientRect();
      return { bottom: b.bottom, width: b.width, gap: a.top - h.bottom, overflow: document.documentElement.scrollWidth > innerWidth + 1 };
    });
    assert.ok(fit.width > 130 && !fit.overflow, JSON.stringify(fit)); if (width > 1100) assert.ok(fit.bottom <= height + 1, JSON.stringify(fit));
    assert.ok(fit.gap >= 0 && fit.gap < 12, JSON.stringify(fit));
    if (width === 375) await page.screenshot({ path: `${evidence}/three-live-mobile.png`, fullPage: true });
    check(`Integrated layout ${width}x${height} fits with hand adjacent to Actions`, fit);
  }
  await page.setViewportSize({ width: 1920, height: 900 }); await settle(page);
  page.once('dialog', dialog => dialog.accept()); await page.locator('#local-restart').click(); await reveal(page); await ready(page);
  assert.equal((await inspect(page)).buildings.length, 0); assert.equal((await inspect(page)).roads.length, 0);
  check('Same-room local restart clears 3D pieces');
  await page.getByRole('button', { name: 'Place settlement', exact: true }).click();
  await assertDirectTargets(page);
  await page.evaluate(() => window.__targetNode = document.querySelector('#targets .target-cancel'));
  const selected = await boardTargetIds(page); await drag(page, 30, -8);
  assert.ok(await page.evaluate(() => window.__targetNode === document.querySelector('#targets .target-cancel')));
  assert.deepEqual(await boardTargetIds(page), selected);
  const beforeRendererSwitch=await inspect(page);
  await page.locator('#board-render-toggle').click(); assert.equal(await page.locator('#board svg.island-board').count(), 1);
  assert.ok(await page.evaluate(() => window.__targetNode === document.querySelector('#targets .target-cancel')));
  await clickBoardTarget(page, selected[0]);
  assert.equal(await page.locator('#board [data-building-kind]').count(), 1);
  await page.locator('#board-render-toggle').click(); await ready(page); assert.equal((await inspect(page)).buildings.length, 1);
  assertCameraUnchanged(beforeRendererSwitch,await inspect(page),'2D/3D switch');
  await page.evaluate(() => window.__hex3D.loseContext()); await page.waitForFunction(() => document.querySelector('#board')?.dataset.renderer === '2d');
  assert.equal(await page.locator('#board [data-building-kind]').count(), 1);
  check('Camera and renderer switching retain direct-board controls; context loss preserves gameplay in SVG');
  await startLocal(page, 6, '86420'); info = await inspect(page); assert.equal(info.hexCount, 24); assert.equal(info.portCount, 11); assert.equal(info.deserts.length, 2);
  await page.screenshot({ path: `${evidence}/three-live-expanded.png`, fullPage: true });
  await delay(300); const f = (await inspect(page)).frames; await delay(550);
  const animatedFrames = (await inspect(page)).frames - f;
  assert.ok(animatedFrames >= 1 && animatedFrames <= 17, `Ambient 3D frame budget exceeded: ${animatedFrames}`);
  check('Expanded board has eleven moving boats, two dunes and a capped ambient animation frame rate', { animatedFrames });
  const unsupported = watch(await browser.newPage());
  await unsupported.addInitScript(() => { const get = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (type, ...args) { return type === 'webgl2' ? null : get.call(this, type, ...args); }; });
  await unsupported.goto(url.href); await unsupported.locator('#local-room-create').click(); await unsupported.locator('#start').click(); await reveal(unsupported);
  assert.equal(await unsupported.locator('#board svg.island-board').count(), 1); await unsupported.close();
  check('A device without WebGL2 starts a playable SVG game automatically');
  // Wait for the real 45-second deadline in a separate game; no accelerated clock
  // or synthetic activity is used, so this exercises the browser timeout path.
  const timeoutPage=watch(await browser.newPage({viewport:{width:1280,height:900}}));
  const timeoutUrl=new URL(url);timeoutUrl.searchParams.set('renderer','2d');
  await timeoutPage.goto(timeoutUrl.href);
  await timeoutPage.locator('#local-room-create').click();
  await timeoutPage.locator('#seats').selectOption('2');
  await timeoutPage.locator('#start').click();await reveal(timeoutPage);
  const timeoutStart=Date.now();
  await timeoutPage.waitForFunction(()=>document.querySelectorAll('#board [data-building-kind]').length===1,null,{timeout:55000});
  assert.ok(Date.now()-timeoutStart>=40000,'inactivity fallback must not fire early');
  assert.match(await timeoutPage.locator('#game-status').textContent(),/phase: setup-road/);
  await timeoutPage.close();
  check('A real 45-second local inactivity deadline performs the legal setup fallback');
  if (process.env.QA_SIGNALING_URL) {
    // Animated local art has already been verified above. Free SwiftShader GPU
    // budget before spinning up three independent live multiplayer windows.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const hc = await browser.newContext(), gc = await browser.newContext(), sc = await browser.newContext();
    const host = current = watch(await hc.newPage()), guest = watch(await gc.newPage()), spectator = watch(await sc.newPage());
    for (const p of [host, guest, spectator]) await p.setViewportSize({ width: 1280, height: 900 });
    await guest.emulateMedia({ reducedMotion: 'reduce' });
    await spectator.emulateMedia({ reducedMotion: 'reduce' });
    await host.goto(url.href); await host.locator('#room-create').click();
    await host.waitForFunction(() => document.querySelector('#room-invite')?.value.includes('#join='), null, { timeout: 30000 });
    const invite = await host.locator('#room-invite').inputValue();
    await guest.goto(invite); await guest.waitForFunction(() => !document.querySelector('#room-ready')?.disabled && !document.querySelector('#room-ready')?.hidden, null, { timeout: 30000 });
    await guest.locator('#room-ready').click(); await host.locator('#room-ready').click(); await host.waitForFunction(() => !document.querySelector('#room-start')?.disabled); await host.locator('#room-start').click();
    await ready(host); await ready(guest); await spectator.goto(invite); await ready(spectator);
    assert.equal(await spectator.locator('#private-hand-card').isVisible(), false); assert.equal((await inspect(spectator)).targets.length, 0);
    const actor = (await host.getByRole('button', { name: 'Place settlement', exact: true }).count()) ? host : guest;
    const observer = actor === host ? guest : host;
    const observerCamera = (await inspect(observer)).camera;
    await drag(actor, 40, 0); assert.ok(moved(observerCamera, (await inspect(observer)).camera) < .001);
    const id = await canvasPlace(actor, 'Place settlement');
    await observer.waitForFunction(id => window.__hex3D.inspect().buildings.some(([key]) => key === id), id);
    await spectator.waitForFunction(id => window.__hex3D.inspect().buildings.some(([key]) => key === id), id);
    assert.ok(moved(observerCamera, (await inspect(observer)).camera) < .001);
    await actor.getByRole('button', { name: 'Undo last action', exact: true }).click(); await observer.waitForFunction(() => window.__hex3D.inspect().buildings.length === 0);
    check('Live host/guest/spectator synchronize 3D building and Undo; cameras and private hands stay independent');
    await host.locator('#turn-clock-pause').click();
    for(const p of [host,guest,spectator])await p.waitForFunction(()=>document.querySelector('#turn-hint')?.textContent.includes('Paused'));
    assert.equal(await guest.locator('#turn-clock-pause').isVisible(),false);
    assert.equal(await spectator.locator('#turn-clock-pause').isVisible(),false);
    const onlineFrozen=await host.locator('#turn-action-clock-seconds').textContent();
    for(const p of [guest,spectator])await p.waitForFunction(value=>document.querySelector('#turn-action-clock-seconds')?.textContent===value,onlineFrozen);
    const pieces=(await inspect(host)).buildings.length;
    await delay(1500);
    for(const p of [host,guest,spectator])assert.equal(await p.locator('#turn-action-clock-seconds').textContent(),onlineFrozen,'every viewer sees the same frozen remaining time');
    assert.equal((await inspect(host)).buildings.length,pieces);
    assert.equal(await actor.getByRole('button',{name:'Place settlement',exact:true}).count(),0);
    await host.locator('#turn-clock-pause').click();
    for(const p of [host,guest,spectator])await p.waitForFunction(()=>!document.querySelector('#turn-hint')?.textContent.includes('Paused'));
    check('Only host can pause; all online viewers see the frozen clock and gameplay is blocked');
    const beforeReconnect = (await inspect(guest)).camera;
    await guest.evaluate(() => window.__hexQaDropRoomConnection());
    await guest.waitForFunction(() => !document.body.classList.contains('network-resyncing') && (window.__hexQaReconnectCount?.() || 0) > 0, null, { timeout: 30000 });
    assert.ok(moved(beforeReconnect, (await inspect(guest)).camera) < .001);
    check('A real guest connection loss/rejoin does not reset the 3D camera');
    const beforeSameRoomRestart=await inspect(guest);
    host.once('dialog', dialog => dialog.accept()); await host.locator('#game-restart').click();
    await guest.waitForFunction(() => document.querySelector('#game-status')?.textContent.includes('Revision 0')); await ready(guest);
    assert.equal((await inspect(guest)).buildings.length, 0); assert.equal((await inspect(spectator)).targets.length, 0);
    assertCameraUnchanged(beforeSameRoomRestart,await inspect(guest),'Same-room restart');
    check('Same-room multiplayer restart resets pieces but preserves camera and spectator restrictions');

    // Exit to the shared board's setup overlay, change the map, then start with
    // the original seats. Both clients retain their own 3D camera settings.
    const beforeAbort=await inspect(guest);
    host.once('dialog',dialog=>dialog.accept());
    await host.locator('#game-change-map').click();
    await guest.waitForFunction(()=>document.body.classList.contains('room-configuring'),null,{timeout:15000});
    await host.locator('#room-seed').fill('13579');
    await host.locator('#room-seed').dispatchEvent('change');
    await guest.waitForFunction(()=>document.querySelector('#room-seed')?.value==='13579',null,{timeout:15000});
    await host.locator('#room-ready').click();
    await guest.locator('#room-ready').click();
    await host.waitForFunction(()=>!document.querySelector('#room-start')?.disabled,null,{timeout:15000});
    await host.locator('#room-start').click();
    await ready(host);await ready(guest);
    assertCameraUnchanged(beforeAbort,await inspect(guest),'Abort / select new map / start');
    check('Map re-selection and a fresh room game preserve each player camera');
    await hc.close(); await gc.close(); await sc.close();
  }
  assert.deepEqual(report.errors, []); check('No page, shader or rendering errors');
} catch (error) {
  report.error = String(error.stack || error); console.error(report.error); process.exitCode = 1;
  try { await current?.screenshot({ path: `${evidence}/failure.png`, fullPage: true }); } catch {}
} finally {
  await writeFile(`${evidence}/report.json`, JSON.stringify(report, null, 2)); await browser?.close(); server?.kill('SIGTERM');
}
