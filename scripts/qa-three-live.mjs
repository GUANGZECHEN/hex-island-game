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
  let info = await inspect(page); report.renderer = info.device;
  assert.equal(info.hexCount, 19); assert.equal(info.portCount, 9); assert.ok(info.triangles > 3000); assert.ok(info.fullyVisible);
  const colorCount = colors(await page.locator('#board canvas').screenshot()); assert.ok(colorCount > 100);
  assert.ok(info.deserts.every(d => !d.hasToken && d.duneMeshes === 1 && d.props === 0));
  assert.ok(info.boats.every(b => b.decks.length === 2 && b.decks[0].vertexId !== b.decks[1].vertexId));
  check('Actual game defaults to nonblank 3D with sand dunes and nine boat ports', { triangles: info.triangles, calls: info.calls, colors: colorCount });
  await page.screenshot({ path: `${evidence}/three-live-desktop.png`, fullPage: true });
  const startCamera = info.camera;
  await drag(page, 90, -20); let rotated = await inspect(page);
  assert.ok(moved(startCamera, rotated.camera) > .2); assert.equal(rotated.buildings.length, 0); assert.equal(rotated.picks, 0);
  await drag(page, 20, 15, true); assert.ok(moved(rotated.target, (await inspect(page)).target) > .005);
  const canvas = await page.locator('#board canvas').boundingBox(); await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2); await page.mouse.wheel(0, -120); await settle(page);
  const zoom = (await inspect(page)).zoom; assert.ok(zoom > 1);
  const hand = await page.locator('#private-hand-card').boundingBox(); await page.mouse.move(hand.x + hand.width / 2, hand.y + 15); await page.mouse.wheel(0, 50); await settle(page); assert.equal((await inspect(page)).zoom, zoom);
  await page.locator('#board-view-reset').click(); await settle(page); assert.ok(moved(startCamera, (await inspect(page)).camera) < .001);
  check('Middle orbit, Shift pan and canvas-only wheel work without executing a move');
  await drag(page, 35, 0); const cameraBeforeBuild = (await inspect(page)).camera;
  const placed = await canvasPlace(page, 'Place settlement');
  info = await inspect(page); assert.ok(info.buildings.some(([id]) => id === placed)); assert.ok(moved(cameraBeforeBuild, info.camera) < .001);
  const buttons = await page.locator('#actions button').allTextContents(); assert.match(buttons.at(-1), /Undo last action/);
  await page.getByRole('button', { name: 'Undo last action', exact: true }).click(); assert.equal((await inspect(page)).buildings.length, 0);
  check('Rotated 3D ray picking executes a real settlement command; safe Undo removes it');
  await page.locator('#board-view-reset').click();
  for (let i = 0; i < 6; i++) { await reveal(page); await canvasPlace(page, 'Place settlement'); await canvasPlace(page, 'Place road'); }
  await reveal(page); info = await inspect(page);
  assert.equal(info.buildings.length, 6); assert.equal(info.roads.length, 6);
  await page.getByRole('button', { name: 'Roll dice', exact: true }).click(); await settle(page);
  assert.ok((await page.locator('#game-status').textContent()).includes('dice '));
  assert.equal(await page.locator('.activity-production-row').count(), 3);
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
  await page.locator('#board-render-toggle').click(); assert.equal(await page.locator('#board svg.island-board').count(), 1);
  assert.ok(await page.evaluate(() => window.__targetNode === document.querySelector('#targets .target-cancel')));
  await clickBoardTarget(page, selected[0]);
  assert.equal(await page.locator('#board [data-building-kind]').count(), 1);
  await page.locator('#board-render-toggle').click(); await ready(page); assert.equal((await inspect(page)).buildings.length, 1);
  await page.evaluate(() => window.__hex3D.loseContext()); await page.waitForFunction(() => document.querySelector('#board')?.dataset.renderer === '2d');
  assert.equal(await page.locator('#board [data-building-kind]').count(), 1);
  check('Camera and renderer switching retain direct-board controls; context loss preserves gameplay in SVG');
  await startLocal(page, 6, '86420'); info = await inspect(page); assert.equal(info.hexCount, 24); assert.equal(info.portCount, 11); assert.equal(info.deserts.length, 2);
  await page.screenshot({ path: `${evidence}/three-live-expanded.png`, fullPage: true });
  await delay(500); const f = (await inspect(page)).frames; await delay(500); assert.ok((await inspect(page)).frames - f <= 1);
  check('Expanded 24-hex game has eleven boats and two bare dune tiles; idle rendering stops');
  const unsupported = watch(await browser.newPage());
  await unsupported.addInitScript(() => { const get = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (type, ...args) { return type === 'webgl2' ? null : get.call(this, type, ...args); }; });
  await unsupported.goto(url.href); await unsupported.locator('#local-room-create').click(); await unsupported.locator('#start').click(); await reveal(unsupported);
  assert.equal(await unsupported.locator('#board svg.island-board').count(), 1); await unsupported.close();
  check('A device without WebGL2 starts a playable SVG game automatically');
  if (process.env.QA_SIGNALING_URL) {
    const hc = await browser.newContext(), gc = await browser.newContext(), sc = await browser.newContext();
    const host = current = watch(await hc.newPage()), guest = watch(await gc.newPage()), spectator = watch(await sc.newPage());
    for (const p of [host, guest, spectator]) await p.setViewportSize({ width: 1280, height: 900 });
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
    const beforeReconnect = (await inspect(guest)).camera;
    await guest.evaluate(() => window.__hexQaDropRoomConnection());
    await guest.waitForFunction(() => !document.body.classList.contains('network-resyncing') && (window.__hexQaReconnectCount?.() || 0) > 0, null, { timeout: 30000 });
    assert.ok(moved(beforeReconnect, (await inspect(guest)).camera) < .001);
    check('A real guest connection loss/rejoin does not reset the 3D camera');
    host.once('dialog', dialog => dialog.accept()); await host.locator('#game-restart').click();
    await guest.waitForFunction(() => document.querySelector('#game-status')?.textContent.includes('Revision 0')); await ready(guest);
    assert.equal((await inspect(guest)).buildings.length, 0); assert.equal((await inspect(spectator)).targets.length, 0);
    check('Same-room multiplayer restart resets all 3D clients and preserves spectator restrictions');
    await hc.close(); await gc.close(); await sc.close();
  }
  assert.deepEqual(report.errors, []); check('No page, shader or rendering errors');
} catch (error) {
  report.error = String(error.stack || error); console.error(report.error); process.exitCode = 1;
  try { await current?.screenshot({ path: `${evidence}/failure.png`, fullPage: true }); } catch {}
} finally {
  await writeFile(`${evidence}/report.json`, JSON.stringify(report, null, 2)); await browser?.close(); server?.kill('SIGTERM');
}
