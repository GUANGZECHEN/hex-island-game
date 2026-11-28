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
import { projectState as twinProjection } from './game/network/authority.ts';

let opening: GameState | null = null;
let sharedTile: GameState['board']['hexes'][number] | undefined;
(window as any).__twinFixture = {
  prepare(kind: 'production' | 'seven' | 'knight') {
    if (remote || !state || state.board.layout !== 'twin-capes') throw new Error('Start a local Twin Capes match first');
    const topology = createIslandBoard(state.board.layout);
    if (!opening) {
      let next = structuredClone(state);
      const roller = next.players[next.currentSeat].id;
      sharedTile = next.board.hexes.find(tile => tile.resource && tile.token && tile.hexId !== next.board.robberHexId);
      const shared = topology.hexes.find(hex => hex.id === sharedTile?.hexId);
      if (!shared) throw new Error('A productive tile is required for both settlements');
      const productiveVertices = new Set(next.board.hexes.filter(tile => tile.resource).flatMap(tile =>
        topology.hexes.find(hex => hex.id === tile.hexId)!.vertexIds));
      // Real snake setup: put the two players on opposite corners of one producing tile.
      for (let step=0; next.phase.startsWith('setup-') && step<28; step++) {
        const playerId = next.players[next.currentSeat].id, settlement = next.phase === 'setup-settlement';
        const legal = twinLegalTargetIds(next, playerId, settlement ? 'settlement' : 'road');
        const id = step === 0 ? shared.vertexIds[0] : step === 2 ? shared.vertexIds[3] :
          settlement ? legal.find(id => productiveVertices.has(id)) : legal[0];
        if (!id || !legal.includes(id)) throw new Error('Illegal Twin Capes fixture opening');
        next = settlement ? localSetup(next,{type:'place-settlement',playerId,vertexId:id})
          : localSetup(next,{type:'place-road',playerId,edgeId:id});
      }
      if (next.phase !== 'roll' || next.players[next.currentSeat].id !== roller) throw new Error('Opening must reach the first roll');
      opening = next;
    }
    const next = structuredClone(opening), player = next.players[next.currentSeat];
    const shared = sharedTile!;
    const total = kind === 'seven' ? 7 : shared.token!;
    if (kind === 'knight') player.cards = [{type:'knight',boughtTurn:0}];
    else {
      let seed=0;
      for (; seed<10_000; seed++) {
        const first=twinDraw(seed,6), second=twinDraw(first.state,6);
        if (first.index+second.index+2 === total) break;
      }
      if (seed===10_000) throw new Error('Could not select a deterministic fixture roll');
      next.randomState=seed;
    }
    if (kind === 'seven') {
      next.turn += next.players.length;
      const extra = 8 - Object.values(player.hand).reduce((a,b)=>a+b,0);
      player.hand.lumber += extra; next.bank.lumber -= extra;
    }
    const hands = Object.fromEntries(next.players.map(p=>[p.id,Object.fromEntries(RESOURCES.map(res=>[res,0]))]));
    if (total !== 7) for (const cell of next.board.hexes) {
      if (!cell.resource || cell.token !== total || cell.hexId === next.board.robberHexId) continue;
      for (const id of topology.hexes.find(h=>h.id===cell.hexId)!.vertexIds) {
        const piece=next.buildings[id];
        if (piece) hands[piece.playerId][cell.resource] += piece.kind === 'city' ? 2 : 1;
      }
    }
    clearSupplement(); boardRenderer?.clearRoll(); pendingRollPresentation=null;
    targetMode=null; state=next; viewer=player.id; localActionDeadlines.clear(); syncLocalActionClock();
    el('pass').hidden=true; el('game').hidden=false; render();
    return {turn:next.turn,total,hex:shared.hexId,hands,roller:player.id,
      opponent:next.players.find(p=>p.id!==player.id)!.id};
  },
  // Only the addressed player's ordinary wire projection goes to the second test page.
  guestSnapshot(revision: number, id: string) {
    return {id, packet:structuredClone(twinProjection(state!,id,revision,'twin-browser-qa'))};
  },
  handSizes() {return Object.fromEntries(state!.players.map(p=>[p.id,Object.values(p.hand).reduce((a,b)=>a+b,0)]));}
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

// Five staggered rows in screenshot orientation. C = added corridor, W = lake.
const twinRows = ['LCCCL', 'LLWWLL', 'LLLLLLL', 'LLWWLL', 'LCCCL'];
const expectedLand = twinRows.flatMap((row, rowIndex) => {
  const r = rowIndex - 2;
  return [...row].flatMap((kind, i) => kind === 'W' ? [] : ['h:' + (i - (row.length - 1 + r) / 2) + ',' + r]);
}).sort();
const expectedTokens = [2,3,3,4,4,5,5,6,6,8,8,9,9,10,10,11,11,12, 5,9,4,10,3,11].sort((a,b) => a-b);

async function checkProductiveTiles(board) {
  const cells = await board.locator('[data-hex-id]').evaluateAll(nodes =>
    nodes.map(node => ({id:node.dataset.hexId, terrain:node.dataset.terrain, token:node.dataset.token})));
  assert.deepEqual(cells.map(tile => tile.id).sort(), expectedLand, 'three connected crossings enclose two lakes of two cells each');
  const deserts = cells.filter(tile => tile.terrain === 'desert');
  assert.equal(deserts.length,1);
  assert.equal(deserts[0].token,'none');
  assert.deepEqual(cells.filter(tile=>tile.terrain!=='desert').map(tile=>Number(tile.token)).sort((a,b)=>a-b),expectedTokens,
    'one desert, the 18 base-game tokens and exactly the six extra production numbers');
  assert.equal(await board.locator('[data-lake-divider]').count(),2);
  return deserts[0].id;
}

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
  await checkProductiveTiles(preview);
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
    assert.equal(view.hexCount, 25);
    assert.deepEqual(view.terrainArt.map(tile=>tile.id).sort(),expectedLand);
    const deserts=view.terrainArt.filter(tile=>tile.terrain==='desert');
    assert.equal(deserts.length,1);
    assert.equal(view.robber,deserts[0].id);
    assert.ok(view.oceanLayers.includes('lake-cell-dividers'));
    assert.equal(view.portCount,16);
    assert.equal(view.visibleTokens,24);
    assert.equal(view.landRobberVisible,true);
    assert.equal(view.piratePort,null);
    return view.robber;
  }
  const board=page.locator('#board');
  const desert=await checkProductiveTiles(board);
  assert.equal(await board.locator('.island-token').count(),24);
  const robber=board.locator('[data-hex-id][data-robber="true"]');
  assert.equal(await robber.getAttribute('data-hex-id'),desert);
  assert.ok(await robber.locator('.robber-marker').isVisible());
  assert.equal(await board.locator('[data-port-edge]').count(),16);
  assert.equal(await board.locator('[data-port-type="generic"]').count(),6);
  for (const resource of ['lumber','brick','wool','grain','ore']) {
    assert.equal(await board.locator('[data-port-type="'+resource+'"]').count(),2);
  }
  assert.equal(await board.locator('[data-port-closed="true"],[data-pirate="true"]').count(),0);
  assert.doesNotMatch(await board.locator('ul[aria-label="Coastal ports"]').innerText(),/trade closed/i);
  return desert;
}

async function privateHand(page) {
  const hand=await page.locator('#hand .resource-chip[data-resource]').evaluateAll(chips=>
    Object.fromEntries(chips.map(chip=>[chip.dataset.resource,Number(chip.querySelector('.resource-count').textContent)])));
  assert.equal(Object.keys(hand).length,5,'the phone shows a complete private hand');
  return hand;
}
const sum = hand => Object.values(hand).reduce((a,b)=>a+b,0);

async function checkReceipt(page, who, plan) {
  const own=page.locator('#roll-payout');
  assert.ok(await own.isVisible(), 'the player can see their own roll payout on a phone');
  assert.equal(await own.getAttribute('data-gain'),String(sum(plan.hands[who])));
  assert.equal(await own.getAttribute('data-turn'),String(plan.turn));
  const entry=page.locator('#log li[data-roll-turn="'+plan.turn+'"]');
  assert.equal(await entry.count(),1,'one public receipt per roll, including duplicate deliveries');
  const text=await entry.textContent();
  for (const [id,hand] of Object.entries(plan.hands)) assert.ok(text.includes(id+' +'+sum(hand)),text);
  assert.doesNotMatch(text,/lumber|brick|wool|grain|ore/i,'the public receipt lists counts only');
}

async function rollOnPhone(page, browser, url) {
  const plan=await page.evaluate(()=>window.__twinFixture.prepare('production'));
  const guest=await browser.newPage(phoneOptions);
  try {
    await guest.goto(url);
    const deliver=async revision=>{
      const message=await page.evaluate(({revision,id})=>window.__twinFixture.guestSnapshot(revision,id),{revision,id:plan.opponent});
      await guest.evaluate(({packet,id})=>window.__twinDeliver(packet,id),message);
    };
    await deliver(0);
    const initial=[await privateHand(page),await privateHand(guest)];
    // This is the real mobile Roll control. A second mobile page receives only
    // its recipient-scoped snapshot through the normal UI snapshot callback.
    await page.getByRole('button',{name:'Roll dice',exact:true}).tap();
    await phase(page,'action');
    await deliver(1); await deliver(1);
    for (const [index,[screen,id]] of [[page,plan.roller],[guest,plan.opponent]].entries()) {
      const after=await privateHand(screen), gains=plan.hands[id];
      assert.ok(sum(gains)>0,'both real settlements border the matching tile');
      for (const resource of Object.keys(after)) assert.equal(after[resource],initial[index][resource]+gains[resource],
        'the phone hand shows the exact resource awarded by its settlement');
      await checkReceipt(screen,id,plan);
    }
    await guest.reload();
    await deliver(1);
    await checkReceipt(guest,plan.opponent,plan);
    passed('Phone roll credits matching resources to the roller and nonrolling guest; public totals survive duplicate delivery and reconnect');
  } finally { await guest.close(); }
}

async function resolveRobber(page,renderer,plan,desert) {
  const mobile=renderer==='2d';
  const move=page.getByRole('button',{name:'Move robber',exact:true});
  if (mobile) await move.tap(); else await move.click();
  assert.deepEqual((await boardTargetIds(page)).sort(),expectedLand.filter(id=>id!==desert));
  const before=await page.evaluate(()=>window.__twinFixture.handSizes());
  assert.ok(before[plan.opponent]>0);
  if (mobile) {
    const land=page.locator('#board [data-legal-target="robber"][data-target-id="'+plan.hex+'"]');
    await land.focus(); await land.press('Enter');
  } else await clickBoardTarget(page,plan.hex);
  await phase(page,'steal');
  if (mobile) assert.equal(await page.locator('#board [data-robber="true"]').getAttribute('data-hex-id'),plan.hex);
  else assert.equal((await inspect(page)).robber,plan.hex);
  assert.equal(await page.getByRole('button',{name:'Skip theft'}).count(),0);
  const steal=page.getByRole('button',{name:'Steal',exact:true});
  if (mobile) await steal.tap(); else await steal.click();
  await phase(page,mobile?'action':'roll');
  const after=await page.evaluate(()=>window.__twinFixture.handSizes());
  assert.equal(after[plan.roller],before[plan.roller]+1);
  assert.equal(after[plan.opponent],before[plan.opponent]-1);
  assert.equal(await page.locator('#game-error').textContent(),'');
}
const phoneOptions={viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1,reducedMotion:'reduce'};

async function verify(renderer,url) {
  const mobile=renderer==='2d';
  const args=mobile?['--disable-gpu']:['--use-angle=swiftshader','--enable-unsafe-swiftshader'];
  const browser=await chromium.launch({headless:true,args});
  try {
    const page=await browser.newPage(mobile?phoneOptions:{viewport:{width:1280,height:900},reducedMotion:'reduce'});
    page.setDefaultTimeout(12000);
    const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await startTwin(page,url,renderer);
    const desert=await boardStatus(page,renderer);
    passed(renderer+' Twin Capes has 25 land hexes, two lakes, 24 tokens, a desert robber, 16 harbors and unlimited ships');
    if (!process.env.QA_URL) {
      let plan;
      if (mobile) {
        await rollOnPhone(page,browser,page.url());
        plan=await page.evaluate(()=>window.__twinFixture.prepare('seven'));
        await page.getByRole('button',{name:'Roll dice',exact:true}).tap();
        await phase(page,'discard');
        await checkReceipt(page,plan.roller,plan);
        const panel=page.getByRole('group',{name:'Discard exactly 4 cards'});
        const lumber=panel.getByRole('button',{name:'Add one lumber',exact:true});
        for (let i=0;i<4;i++) await lumber.tap();
        await page.getByRole('button',{name:'Discard',exact:true}).tap();
        assert.equal((await page.evaluate(()=>window.__twinFixture.handSizes()))[plan.roller],4);
      } else {
        plan=await page.evaluate(()=>window.__twinFixture.prepare('knight'));
        await page.getByRole('button',{name:'Play Knight',exact:true}).click();
      }
      await phase(page,'robber');
      await resolveRobber(page,renderer,plan,desert);
      passed(mobile?'Seven logs zero for both players, discards four, moves the robber and steals a card':
        'Knight moves the robber by direct WebGL picking, steals one card, and resumes the roll');
    }
    assert.deepEqual(errors,[]);
  } finally {await browser.close();}
}

await mkdir(evidence, {recursive:true});
let server;
try {
  let url = productUrl;
  if (!process.env.QA_URL) {
    const liveSource = await readFile('src/game-ui.ts','utf8');
    // Capture the ordinary recipient callback in the temporary fixture only.
    const entry='const network=initializeNetwork(';
    assert.ok(liveSource.includes(entry),'the browser fixture must use the actual multiplayer snapshot callback');
    const source=liveSource.replace(entry,`const network=((callbacks:Parameters<typeof initializeNetwork>[0])=>{
      (window as any).__twinDeliver=callbacks.snapshot;
      return initializeNetwork(callbacks);
    })(`);
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
