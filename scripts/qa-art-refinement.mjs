import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
const out = process.env.ART_EVIDENCE || 'art-evidence';
await mkdir(out, { recursive: true });
const report = { revision: 'refinement-1', scope: 'Real browser with software WebGL; not a device FPS benchmark', checks: [], errors: [] };
const pass = (name, details = {}) => { report.checks.push({ name, pass: true, ...details }); console.log('PASS', name, JSON.stringify(details)); };
let server, browser, page;
const url = new URL(process.env.QA_URL || 'http://127.0.0.1:4178/hex-island-game/');
url.searchParams.set('qa3d', '1'); url.searchParams.delete('renderer');
const inspect = () => page.evaluate(() => window.__hex3D.inspect());
async function ready() { await page.waitForFunction(() => window.__hex3D?.inspect().mode === '3d' && window.__hex3D.inspect().frames > 0); await delay(180); }
async function start(players) {
  await page.goto(url.href, { waitUntil: 'networkidle' });
  await page.locator('#local-room-create').click(); await page.locator('#seats').selectOption(String(players)); await page.locator('#seed').fill('24680');
  await page.locator('#start').click(); if (await page.locator('#pass').isVisible()) await page.locator('#reveal').click(); await ready();
}
try {
  if (!process.env.QA_URL) {
    server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '4178', '--strictPort'], { stdio: 'pipe' });
    for (let i = 0; i < 100; i++) { try { if ((await fetch(url)).ok) break; } catch {} await delay(200); }
  }
  browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  page = await browser.newPage({ viewport: { width: 1920, height: 900 } });
  page.on('pageerror', e => report.errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && /THREE|WebGL|shader/i.test(m.text())) report.errors.push(m.text()); });
  for (const count of [3, 6]) {
    await start(count); const info = await inspect();
    assert.equal(info.artRevision, report.revision); assert.equal(info.hexCount, count === 6 ? 24 : 19);
    for (const tile of info.terrainArt) {
      assert.ok(tile.gradientColors >= 5);
      if (tile.terrain === 'pasture') assert.equal(tile.sheep, 3);
      if (tile.terrain === 'hills') assert.ok(tile.bricks === 9 && tile.cuboids);
      if (tile.terrain === 'fields') assert.ok(tile.stems === 15 && tile.upward);
      if (tile.terrain === 'desert') assert.ok(tile.duneMax > .4 && Math.abs(tile.duneMin - .123) < .0001);
    }
    assert.ok(['depth-gradient-water', 'shore-foam'].every(n => info.oceanLayers.includes(n)));
    assert.ok(!info.oceanLayers.includes('sea-ripples'), 'calm water should have no wandering surface stripes');
    assert.ok(info.boats.every(b => b.decks.length === 2 && b.decks[0].vertexId !== b.decks[1].vertexId));
    const screenshot = await page.locator('#board canvas').screenshot(); const png = PNG.sync.read(screenshot), colors = new Set();
    for (let i = 0; i < png.data.length; i += 16) colors.add(`${png.data[i] >> 3},${png.data[i + 1] >> 3},${png.data[i + 2] >> 3}`);
    assert.ok(colors.size > 300); assert.ok(info.fullyVisible);
    pass(`${info.hexCount}-hex board renders all six requested refinements`, { triangles: info.triangles, calls: info.calls, colors: colors.size, terrain: info.terrainArt });
    await page.screenshot({ path: `${out}/art-${count === 6 ? 'expanded' : 'desktop'}.png`, fullPage: true });
    await page.locator('#board-view-top').click(); await delay(200);
    await page.screenshot({ path: `${out}/art-${count === 6 ? 'expanded' : 'standard'}-top.png`, fullPage: true });
    await page.locator('#board-view-reset').click(); await delay(300); const frames = (await inspect()).frames; await delay(500);
    assert.ok((await inspect()).frames - frames <= 1); pass('Ocean keeps idle rendering stopped', { players: count });
  }
  for (const [width, height] of [[1920, 720], [1280, 720], [375, 812], [320, 700]]) {
    await page.setViewportSize({ width, height }); await delay(350);
    assert.ok(!(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)));
    if (width > 1100) assert.ok((await page.locator('#board canvas').boundingBox()).y + (await page.locator('#board canvas').boundingBox()).height <= height + 1);
    if (width === 375) await page.screenshot({ path: `${out}/art-mobile.png`, fullPage: true });
    pass(`Refined art fits ${width}x${height}`);
  }
  for (let i = 0; i < 3; i++) {
    await page.locator('#board-render-toggle').click(); assert.equal(await page.locator('#board svg.island-board').count(), 1);
    await page.locator('#board-render-toggle').click(); await ready(); assert.equal((await inspect()).artRevision, report.revision);
  }
  pass('Repeated 2D/3D switching preserves the map and regenerates refined art');
  assert.deepEqual(report.errors, []); pass('No browser or shader errors');
} catch (e) {
  report.error = String(e.stack || e); console.error(report.error); process.exitCode = 1;
  try { await page?.screenshot({ path: `${out}/failure.png`, fullPage: true }); } catch {}
} finally { await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2)); await browser?.close(); server?.kill(); }
