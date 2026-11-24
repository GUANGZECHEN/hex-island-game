import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { boardTargetIds, boardTargetPoint } from './qa-board-targets.mjs';

const fixtureOrigin = 'https://board-performance.invalid';
const sampleCount = 20;

// Vite adds this only to the QA build held in memory. The shipped game has no
// fixture setter. Measurements go through the game's normal controls/reducers.
function prepareDenseBoard() {
  activeLocalRoom = createLocalRoomSettings(86420, 6, 0);
  const next = createGame(86420, activeLocalRoom.ids, () => 0, { boardLayout: activeLocalRoom.boardLayout });
  const graph = createIslandBoard(next.board.layout);
  const occupied = new Set();
  for (const vertex of graph.vertices) {
    if (occupied.size === 18) break;
    if (graph.edges.some(edge => edge.vertexIds.includes(vertex.id) && edge.vertexIds.some(id => occupied.has(id)))) continue;
    const owner = next.players[occupied.size % next.players.length];
    const kind = occupied.size < 12 ? 'settlement' : 'city';
    next.buildings[vertex.id] = { playerId: owner.id, kind };
    owner[kind === 'city' ? 'cities' : 'settlements']--;
    occupied.add(vertex.id);
  }
  for (const [index, edge] of graph.edges.slice(0, 48).entries()) {
    const owner = next.players[index % next.players.length];
    next.roads[edge.id] = owner.id;
    owner.roads--;
  }
  next.phase = 'action';
  next.turn = 45;
  next.currentSeat = 0;
  next.dice = [3, 2];
  for (const [resource, amount] of [['grain', 2], ['ore', 3]]) {
    next.players[0].hand[resource] = amount;
    next.bank[resource] -= amount;
  }
  state = next;
  viewer = next.players[0].id;
  syncLocalActionClock();
  // Safe Undo intentionally restores the pre-build deadline. Each independent
  // measurement starts with a fresh turn window outside its timed region.
  window.__startPerformanceTrial = () => syncLocalActionClock([viewer]);
  el('pass').hidden = true;
  el('game').hidden = false;
  enterGame(true);
  render();
}

async function loadFixture(page) {
  const root = process.env.GAME_SOURCE_ROOT || process.env.GITHUB_WORKSPACE || process.cwd();
  const require = createRequire(join(root, 'package.json'));
  const viteEntry = join(dirname(require.resolve('vite/package.json')), 'dist/node/index.js');
  const { build } = await import(pathToFileURL(viteEntry).href);
  const result = await build({
    root, configFile: false, base: '/', logLevel: 'error',
    plugins: [{
      name: 'local-board-performance-fixture', enforce: 'pre',
      transform(code, id) {
        if (id.replaceAll('\\', '/').endsWith('/src/game-ui.ts')) {
          return code + '\n(' + prepareDenseBoard.toString() + ')();';
        }
      },
    }],
    build: { write: false, rollupOptions: { input: join(root, 'index.html') } },
  });
  const files = new Map(result.output.map(file => [file.fileName, file]));
  await page.route(fixtureOrigin + '/**', route => {
    const path = new URL(route.request().url()).pathname.slice(1) || 'index.html';
    const file = files.get(path);
    if (!file) return route.fulfill({ status: 404, body: '' });
    const contentType = path.endsWith('.js') ? 'application/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html';
    return route.fulfill({ contentType, body: file.type === 'chunk' ? file.code : Buffer.from(file.source) });
  });
  await page.goto(fixtureOrigin + '/?qa3d=1', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__hex3D?.renderedFrames() > 0);
}

const settle = page => page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
const round = n => Math.round(n * 10) / 10;
function distribution(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  assert.ok(sorted.length > 0 && sorted.every(n => Number.isFinite(n) && n >= 0));
  return { count: sorted.length, median: round(sorted[Math.ceil(sorted.length / 2) - 1]), p95: round(sorted[Math.ceil(sorted.length * .95) - 1]) };
}
async function attachInput(page) {
  const session = await page.context().newCDPSession(page);
  const hasTouch = await page.evaluate(() => navigator.maxTouchPoints > 0);
  if (!hasTouch) await session.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  return { session, async reset() {
    if (!hasTouch) await session.send('Emulation.setTouchEmulationEnabled', { enabled: false });
    await session.detach();
  } };
}
async function touch(session, type, point) {
  await session.send('Input.dispatchTouchEvent', { type, touchPoints: point ? [{ ...point, id: 1 }] : [] });
}

// Native release timestamp to the first post-render task showing the new piece.
// The browser measures feedback before the physical display scans it out.
async function measureConstruction(page, session, point, id, kind) {
  await page.evaluate(({ id, kind }) => {
    window.__boardTap = new Promise((resolve, reject) => {
      const listener = new AbortController();
      const channel = new MessageChannel();
      let frame;
      function stop() {
        clearTimeout(timer);
        cancelAnimationFrame(frame);
        listener.abort();
        channel.port1.close();
        channel.port2.close();
      }
      const timer = setTimeout(() => {
        stop();
        reject(new Error('Timed out waiting for the tapped ' + kind + ' to render at ' + id));
      }, 8000);
      document.addEventListener('pointerup', event => {
        if (event.pointerType !== 'touch' || event.target !== document.querySelector('#board canvas')) {
          stop();
          reject(new Error('Expected the touch release on the game board canvas'));
          return;
        }
        const before = window.__hex3D.renderedFrames();
        const checkNextFrame = () => {
          frame = requestAnimationFrame(() => channel.port2.postMessage(null));
        };
        channel.port1.onmessage = () => {
          const now = performance.now();
          if (window.__hex3D.renderedFrames() > before) {
            const scene = window.__hex3D.inspect();
            if (scene.buildings.some(([key, piece]) => key === id && piece.kind === kind)) {
              stop();
              resolve({ constructionMs: now - event.timeStamp, structureGroupCpuMs: scene.structureBuildMs });
              return;
            }
          }
          checkNextFrame();
        };
        checkNextFrame();
      }, { once: true, capture: true, signal: listener.signal });
    });
  }, { id, kind });
  await touch(session, 'touchStart', point);
  await touch(session, 'touchEnd');
  return page.evaluate(() => window.__boardTap);
}

async function place(page, session, label, kind) {
  await page.getByRole('button', { name: label, exact: true }).click();
  const [id] = await boardTargetIds(page);
  assert.ok(id, 'Expected a legal target');
  const point = await boardTargetPoint(page, id);
  assert.ok(point);
  const result = await measureConstruction(page, session, point, id, kind);
  assert.equal(await page.locator('#game-error').textContent(), '');
  return result;
}

async function orbit(page, session) {
  const { narrow, nativeTouch } = await page.evaluate(() => ({ narrow: innerWidth <= 1100, nativeTouch: navigator.maxTouchPoints > 0 }));
  const touchCamera = narrow || nativeTouch;
  if (touchCamera && !nativeTouch) await session.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  if (touchCamera && await page.locator('#board-adjust-view').isVisible()) await page.locator('#board-adjust-view').check();
  const canvas = page.locator('#board canvas');
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  assert.ok(box);
  const before = await page.evaluate(() => window.__hex3D.inspect().camera);
  await page.evaluate(() => {
    window.__boardDrag = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Did not receive a complete camera drag')), 30000);
      document.addEventListener('pointerdown', down => {
        const first = window.__hex3D.renderedFrames();
        const gaps = [];
        let previous = down.timeStamp, frames = first, raf;
        function sample(time) {
          const latest = window.__hex3D.renderedFrames();
          if (latest > frames) {
            gaps.push(time - previous);
            frames = latest;
            previous = time;
          }
          raf = requestAnimationFrame(sample);
        }
        raf = requestAnimationFrame(sample);
        document.addEventListener('pointerup', up => {
          clearTimeout(timeout);
          cancelAnimationFrame(raf);
          resolve({ frames: window.__hex3D.renderedFrames() - first, elapsed: up.timeStamp - down.timeStamp, gaps });
        }, { capture: true, once: true });
      }, { capture: true, once: true });
    });
  });
  const start = { x: box.x + box.width * .42, y: box.y + box.height * .48 };
  const distance = box.width * .18;
  if (touchCamera) {
    await touch(session, 'touchStart', start);
    for (let step = 1; step <= 60; step++) {
      await touch(session, 'touchMove', { x: start.x + distance * step / 60, y: start.y });
      await page.evaluate(() => new Promise(requestAnimationFrame));
    }
    await touch(session, 'touchEnd');
  } else {
    await page.mouse.move(start.x, start.y);
    await page.mouse.down({ button: 'middle' });
    await page.mouse.move(start.x + distance, start.y, { steps: 60 });
    await page.mouse.up({ button: 'middle' });
  }
  const sample = await page.evaluate(() => window.__boardDrag);
  if (touchCamera && !nativeTouch) await session.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  const after = await page.evaluate(() => window.__hex3D.inspect().camera);
  assert.ok(Math.hypot(...after.map((value, i) => value - before[i])) > .01, 'Camera must actually move');
  assert.ok(sample.frames > 0 && sample.elapsed > 0);
  // The first partial frame may straddle the input timestamp.
  return { frames: sample.frames, elapsedMs: round(sample.elapsed), fps: round(sample.frames * 1000 / sample.elapsed), frameGapMs: distribution(sample.gaps.slice(1)), input: touchCamera ? 'touch' : 'middle mouse' };
}

export async function measureExpandedBoard(page, { sameContext = false } = {}) {
  const live = await attachInput(page);
  let opening;
  try {
    opening = await place(page, live.session, 'Build settlement', 'settlement');
  } finally {
    await live.reset();
  }
  const dense = sameContext ? await page.context().newPage()
    : await page.context().browser().newPage({ viewport: page.viewportSize() });
  const errors = [];
  dense.on('pageerror', error => errors.push(String(error)));
  try {
    if (page.viewportSize()) await dense.setViewportSize(page.viewportSize());
    await loadFixture(dense);
    const input = await attachInput(dense);
    const board = await dense.evaluate(() => {
      const s = window.__hex3D.inspect();
      return { hexes: s.hexCount, ports: s.portCount, roads: s.roads.length, buildings: s.buildings.length, renderer: s.device,
        viewport: [innerWidth, innerHeight], drawCalls: s.calls, triangles: s.triangles };
    });
    assert.deepEqual([board.hexes, board.ports, board.roads, board.buildings], [24, 11, 48, 18]);
    const samples = [];
    // One unmeasured warm-up compiles any new materials and exercises Undo.
    for (let i = 0; i <= sampleCount; i++) {
      await dense.evaluate(() => window.__startPerformanceTrial());
      let result;
      try {
        result = await place(dense, input.session, 'Upgrade house to city', 'city');
      } catch (cause) {
        const diagnostic = await dense.evaluate(() => ({
          status: document.getElementById('game-status')?.textContent,
          clock: document.getElementById('turn-action-clock-seconds')?.textContent,
          handoff: !document.getElementById('pass')?.hidden,
          renderer: document.getElementById('board')?.dataset.renderer,
          mode: window.__hex3D?.inspect().targetMode,
        }));
        throw new Error('Dense construction trial ' + i + ' failed: ' + String(cause) + ' ' + JSON.stringify(diagnostic), { cause });
      }
      if (i > 0) samples.push(result);
      await dense.getByRole('button', { name: 'Undo last action', exact: true }).click();
      await settle(dense);
    }
    await input.reset();
    const cameraSession = await dense.context().newCDPSession(dense);
    const camera = await orbit(dense, cameraSession);
    await cameraSession.detach();
    assert.deepEqual(errors, []);
    return { scope: 'Single touch release to first post-render task showing the placed piece in local play; the dense position is synthetic and hardware targets apply on physical devices', opening, board,
      constructionMs: distribution(samples.map(s => s.constructionMs)),
      structureGroupCpuMs: distribution(samples.map(s => s.structureGroupCpuMs)), camera };
  } finally {
    await dense.close();
    await page.bringToFront();
  }
}

// Run against an ordinary Chrome installation or a browser on an attached phone.
// A CDP connection uses a fresh tab and retains the device's actual viewport.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const browser = process.env.QA_CDP_URL ? await chromium.connectOverCDP(process.env.QA_CDP_URL)
    : await chromium.launch({ channel: process.env.QA_CHROME_CHANNEL || 'chrome', headless: false });
  const context = process.env.QA_CDP_URL ? browser.contexts()[0] : await browser.newContext({ viewport: null });
  const page = await context.newPage();
  try {
    const url = new URL(process.env.QA_URL || 'http://127.0.0.1:4175/hex-island-game/');
    url.searchParams.set('qa3d', '1');
    await page.goto(url.href);
    await page.locator('#local-room-create').click();
    await page.locator('#seats').selectOption('6');
    await page.locator('#seed').fill('86420');
    await page.locator('#start').click();
    if (await page.locator('#pass').isVisible()) await page.locator('#reveal').click();
    await page.waitForFunction(() => window.__hex3D?.renderedFrames() > 0);
    console.log(JSON.stringify(await measureExpandedBoard(page, { sameContext: true }), null, 2));
  } finally {
    await page.close();
    await browser.close();
  }
}
