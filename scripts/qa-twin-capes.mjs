import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { boardTargetIds, clickBoardTarget } from './qa-board-targets.mjs';

const evidence = process.env.TWIN_CAPES_EVIDENCE || 'twin-capes-evidence';
const productUrl = new URL(process.env.QA_URL || 'http://127.0.0.1:4186/hex-island-game/');
const sourcePath = `src/__qa-twin-capes-${process.pid}.ts`;
const htmlPath = `__qa-twin-capes-${process.pid}.html`;
const fixture = `
import { drawIndex as twinDraw } from './game/rules/state.ts';
import { legalTargetIds as twinLegalTargetIds } from './game/rules/legal.ts';

// The fixture starts from the board selected through the ordinary game UI.
let preparedTwin: GameState | null = null;
let twinYield: { resource: Resource; total: number; expected: number } | null = null;
(window as any).__twinFixture = {
  prepare(kind: 'production' | 'seven' | 'knight') {
    if (remote || !state || state.board.layout !== 'twin-capes') throw new Error('Start a local Twin Capes match first');
    if (!preparedTwin) {
      let next = structuredClone(state);
      const owner = next.players[next.currentSeat].id;
      const port = next.board.ports.find(port => port.edgeId === next.board.piratePortEdgeId);
      const topology = createIslandBoard(next.board.layout);
      const tileById = new Map(next.board.hexes.map(tile => [tile.hexId, tile]));
      const vertex = port?.vertexIds.find(vertex => topology.hexes.some(hex => hex.vertexIds.includes(vertex)));
      const hex = topology.hexes.find(hex => vertex && hex.vertexIds.includes(vertex));
      const tile = hex && tileById.get(hex.id);
      if (!vertex || !tile?.resource || !tile.token) throw new Error('The closed harbor needs a productive neighboring hex');
      for (let step = 0; next.phase.startsWith('setup-') && step < 28; step++) {
        const playerId = next.players[next.currentSeat].id;
        const settlement = next.phase === 'setup-settlement';
        const targets = twinLegalTargetIds(next, playerId, settlement ? 'settlement' : 'road');
        const id = step === 0 ? vertex : targets[0];
        if (!id || !targets.includes(id)) throw new Error('No valid Twin Capes opening placement');
        next = settlement
          ? localSetup(next, { type: 'place-settlement', playerId, vertexId: id })
          : localSetup(next, { type: 'place-road', playerId, edgeId: id });
      }
      if (next.phase !== 'roll' || next.players[next.currentSeat].id !== owner) throw new Error('The legal opening must reach the harbor owner’s roll');
      const expected = topology.hexes.reduce((count, hex) => {
        const assignment = tileById.get(hex.id);
        if (assignment?.resource !== tile.resource || assignment.token !== tile.token) return count;
        return count + hex.vertexIds.filter(id => next.buildings[id]?.playerId === owner).length;
      }, 0);
      twinYield = { resource: tile.resource, total: tile.token, expected };
      preparedTwin = next;
    }
    const next = structuredClone(preparedTwin);
    const player = next.players[next.currentSeat];
    const yieldTile = twinYield!;
    if (kind === 'knight') player.cards = [{ type: 'knight', boughtTurn: 0 }];
    else {
      const total = kind === 'seven' ? 7 : yieldTile.total;
      let seed = 0;
      for (; seed < 10_000; seed++) {
        const a = twinDraw(seed, 6), b = twinDraw(a.state, 6);
        if (a.index + b.index + 2 === total) break;
      }
      if (seed === 10_000) throw new Error('Could not choose a fixture roll');
      next.randomState = seed;
    }
    clearSupplement();
    boardRenderer?.clearRoll();
    pendingRollPresentation = null;
    targetMode = null;
    state = next;
    viewer = player.id;
    localActionDeadlines.clear();
    syncLocalActionClock();
    el('pass').hidden = true;
    el('game').hidden = false;
    render();
    return { ...yieldTile, before: player.hand[yieldTile.resource] };
  },
  hand(resource: Resource) {
    return state!.players.find(player => player.id === viewer)!.hand[resource];
  }
};
`;

const log = [];
const inspect = page => page.evaluate(() => window.__hex3D.inspect());
function passed(name, details) {
  log.push({ name, ...details });
  console.log('PASS ' + name);
}
const phase = (page, name) => page.waitForFunction(name =>
  document.querySelector('#game-status')?.textContent?.match(/phase: ([\w-]+)/)?.[1] === name,
  name, { timeout: 10000 }
);

async function startTwin(page, url, renderer) {
  const target = new URL(url);
  target.searchParams.set('qa3d', '1');
  target.searchParams.set('renderer', renderer);
  await page.goto(target.href);
  await page.locator('#local-room-create').click();
  await page.locator('#local-game-mode').selectOption('classic');
  const board = page.locator('#local-board-version');
  assert.match(await board.locator('option[value="twin-capes"]').innerText(), /Twin Capes/i);
  await board.selectOption('twin-capes');
  await page.locator('#seats').selectOption('2');
  await page.locator('#seed').fill('24680');
  assert.equal(await page.locator('#local-rule-ships').isChecked(), true);
  assert.equal(await page.locator('#local-rule-ships').isDisabled(), true);
  const preview = page.locator('#local-map-preview');
  assert.equal(await preview.locator('[data-hex-id]').count(), 29);
  assert.equal(await preview.locator('[data-port-edge]').count(), 16);
  await page.locator('#start').click();
  if (await page.locator('#pass').isVisible()) await page.locator('#reveal').click();
  await phase(page, 'setup-settlement');
  await page.waitForFunction(renderer => document.querySelector('#board')?.dataset.renderer === renderer &&
    (renderer === '2d' || window.__hex3D?.inspect().frames > 0), renderer, { timeout: 20000 });
  const shipSupply = await page.locator('#piece-supply').evaluate(node => [
    node.innerText,
    ...Array.from(node.querySelectorAll('[aria-label],[title]'), item => [item.getAttribute('aria-label'), item.title].join(' '))
  ].join(' '));
  assert.match(shipSupply, /unlimited|∞/i, 'Twin Capes identifies unlimited ships in the private supply');
}

async function boardStatus(page, renderer) {
  if (renderer === '3d') {
    const view = await inspect(page);
    assert.equal(view.hexCount, 29);
    assert.equal(view.portCount, 16);
    assert.equal(view.visibleTokens, 29);
    assert.equal(view.landRobberVisible, false);
    return { ports: view.boats.map(boat => boat.edge), closed: view.piratePort };
  }
  const board = page.locator('#board');
  const land = await board.locator('[data-hex-id]').evaluateAll(nodes => nodes.map(node => node.dataset.hexId));
  assert.equal(land.length, 29);
  assert.ok(['h:-1,0','h:0,0','h:1,0'].every(id => land.includes(id)), 'the isthmus joins the two capes');
  assert.ok(['h:0,-1','h:0,1'].every(id => !land.includes(id)), 'both bays stay open to water');
  assert.equal(land.filter(id => Number(id.slice(2).split(',')[0]) < 0).length, 14);
  assert.equal(land.filter(id => Number(id.slice(2).split(',')[0]) > 0).length, 14);
  assert.equal(await board.locator('.island-token').count(), 29);
  assert.equal(await board.locator('.robber-marker,[data-terrain="desert"]').count(), 0);
  const ports = await board.locator('[data-port-edge]').evaluateAll(nodes => nodes.map(node => node.dataset.portEdge));
  assert.equal(ports.length, 16);
  assert.equal(new Set(ports).size, 16);
  assert.equal(await board.locator('[data-port-type="generic"]').count(), 6);
  for (const resource of ['lumber','brick','wool','grain','ore']) {
    assert.equal(await board.locator(`[data-port-type="${resource}"]`).count(), 2);
  }
  const closed = board.locator('[data-port-edge][data-port-closed="true"]');
  assert.equal(await closed.count(), 1);
  assert.equal(await closed.locator('[data-pirate="true"]').isVisible(), true);
  assert.match((await board.locator('ul[aria-label="Coastal ports"]').textContent()) || '', /trade closed/i);
  return { ports, closed: await closed.getAttribute('data-port-edge') };
}

async function movePirate(page, renderer, initial) {
  const action = page.getByRole('button',{name:'Move pirate',exact:true});
  await action.click();
  const candidates = await boardTargetIds(page);
  assert.deepEqual([...candidates].sort(), initial.ports.filter(id => id !== initial.closed).sort());
  const id = candidates[0];
  if (renderer === '2d') {
    const harbor = page.locator(`#board [data-legal-target="pirate"][data-target-id="${id}"]`);
    await harbor.focus();
    await harbor.press('Enter');
  } else {
    assert.equal((await inspect(page)).targetMode, 'pirate');
    await clickBoardTarget(page, id);
  }
  await phase(page, renderer === '2d' ? 'action' : 'roll');
  assert.equal(await page.locator('#game-error').textContent(), '');
  const moved = await boardStatus(page, renderer);
  assert.equal(moved.closed, id, 'the closure moves to the chosen harbor');
  assert.notEqual(moved.closed, initial.closed, 'the old harbor reopens');
}

async function verify(renderer, url) {
  const args = renderer === '2d' ? ['--disable-gpu'] : ['--use-angle=swiftshader','--enable-unsafe-swiftshader'];
  const browser = await chromium.launch({ headless: true, args });
  try {
    const page = await browser.newPage({ viewport: {width:1280,height:900}, reducedMotion:'reduce' });
    page.setDefaultTimeout(12000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await startTwin(page, url, renderer);
    const initial = await boardStatus(page, renderer);
    assert.ok(initial.ports.includes(initial.closed), 'the pirate starts on an actual harbor');
    passed(renderer + ' Twin Capes chooser, topology, pirate harbor and unlimited ship supply',
      { ports: initial.ports.length, closed: initial.closed });

    if (!process.env.QA_URL) {
      if (renderer === '2d') {
        const yieldTile = await page.evaluate(() => window.__twinFixture.prepare('production'));
        await page.getByRole('button', {name:'Roll dice',exact:true}).click();
        await phase(page, 'action');
        assert.ok(yieldTile.expected > 0);
        assert.equal(await page.evaluate(resource => window.__twinFixture.hand(resource), yieldTile.resource),
          yieldTile.before + yieldTile.expected, 'all matching settlements produce, including the one at the pirate’s harbor');
        assert.equal((await boardStatus(page,renderer)).closed, initial.closed);
        await page.evaluate(() => window.__twinFixture.prepare('seven'));
        await page.getByRole('button', {name:'Roll dice',exact:true}).click();
      } else {
        await page.evaluate(() => window.__twinFixture.prepare('knight'));
        await page.getByRole('button', {name:'Play Knight',exact:true}).click();
      }
      await phase(page, 'pirate');
      await movePirate(page, renderer, initial);
      passed(renderer === '2d' ? 'Seven moves the pirate by keyboard; the closed harbor’s settlement produces'
        : 'Knight moves the pirate by direct 3D picking and returns to Roll');
    }
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
}

await mkdir(evidence, {recursive:true});
let server;
try {
  let url = productUrl;
  if (!process.env.QA_URL) {
    const source = await readFile('src/game-ui.ts', 'utf8');
    const html = (await readFile('index.html', 'utf8')).replace('/src/game-ui.ts', '/'+sourcePath);
    assert.ok(html.includes(sourcePath), 'temporary fixture entry is linked');
    await writeFile(sourcePath, source+'\n'+fixture);
    await writeFile(htmlPath, html);
    url = new URL(htmlPath, productUrl);
    server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '4186', '--strictPort'], {stdio:'ignore'});
    let ready = false;
    for (let attempt=0; attempt<80 && !ready; attempt++) {
      try { ready = (await fetch(url)).ok; } catch { /* Wait for Vite to start. */ }
      if (!ready) await delay(125);
    }
    assert.ok(ready, 'the local Twin Capes fixture served successfully');
  }
  await verify('2d', url);
  await verify('3d', url);
} catch (error) {
  console.error(error);
  log.push({error: String(error)});
  process.exitCode = 1;
} finally {
  server?.kill('SIGTERM');
  if (!process.env.QA_URL) await Promise.all([rm(sourcePath,{force:true}),rm(htmlPath,{force:true})]);
  await writeFile(evidence+'/report.json', JSON.stringify(log,null,2));
}
