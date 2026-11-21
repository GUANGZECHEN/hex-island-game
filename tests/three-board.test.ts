import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateBoardSetup } from '../src/game/board/setup.ts';
import { createIslandBoard } from '../src/game/board/geometry.ts';
import { worldGeometry, portBoatPlan, duneHeight, staticBoardKey } from '../src/game/board/three/model.ts';

for (const layout of ['standard', 'expanded-5-6'] as const) test(`${layout}: boats retain exactly two distinct bridges from their original coastal vertices`, () => {
  const geometry = worldGeometry(layout), topology = createIslandBoard(layout);
  for (const seed of [0, 1, 24680, 86420, 4294967295]) {
    const board = generateBoardSetup(seed, layout), before = JSON.stringify(board);
    assert.equal(geometry.hexes.size, layout === 'standard' ? 19 : 24);
    for (const port of board.ports) {
      const plan = portBoatPlan(port, geometry);
      assert.equal(plan.decks.length, 2);
      assert.deepEqual(plan.decks.map(d => d.vertexId), port.vertexIds);
      for (const deck of plan.decks) assert.deepEqual(deck.start, geometry.vertices.get(deck.vertexId));
      assert.ok(Math.hypot(plan.decks[0].end.x - plan.decks[1].end.x, plan.decks[0].end.z - plan.decks[1].end.z) > .7);
      const coastalHex = topology.edges.find(e => e.id === port.edgeId)!.hexIds[0], h = geometry.hexes.get(coastalHex)!;
      assert.ok((plan.center.x - h.x) * plan.outward.x + (plan.center.z - h.z) * plan.outward.z > 1.8);
      assert.ok(plan.decks.every(d => Math.hypot(d.end.x - d.start.x, d.end.z - d.start.z) > .5));
    }
    assert.equal(JSON.stringify(board), before);
  }
});
test('sand is a continuous variable-height surface and meets the hex edge cleanly', () => {
  const values = [duneHeight(0, 0, 0), duneHeight(-.25, -.1, .3), duneHeight(.4, .1, .5)];
  assert.ok(Math.max(...values) - Math.min(...values) > .01);
  for (let i = 0; i < 48; i++) assert.equal(duneHeight(Math.sin(i), Math.cos(i), 1), .123);
  assert.ok(values.every(y => y >= .123 && y < .5));
  const art = readFileSync('src/game/board/three/art.ts', 'utf8');
  const desert = art.slice(art.indexOf("if (hex.terrain === 'desert')"), art.indexOf('offsets.forEach'));
  assert.ok(desert.includes('return { root, token: null }'));
  assert.ok(!desert.includes('assets.sprite'));
});
test('moving the robber never recreates the static scene key', () => {
  const b = generateBoardSetup(24680);
  assert.equal(staticBoardKey(b), staticBoardKey({ ...b, robberHexId: b.hexes.find(h => h.hexId !== b.robberHexId)!.hexId }));
  assert.notEqual(staticBoardKey(b), staticBoardKey(generateBoardSetup(86420)));
});
test('3D receives only public geometry and targets, while camera remains outside gameplay', () => {
  const ui = readFileSync('src/game-ui.ts', 'utf8'), render = readFileSync('src/game/board/three/renderer.ts', 'utf8'), controller = readFileSync('src/game/board/three/controller.ts', 'utf8');
  const bridge = ui.slice(ui.indexOf('function drawBoard(){'), ui.indexOf('function drawSvgBoard(){'));
  assert.ok(bridge.includes('legalTargetIds(state,viewer,targetMode)'));
  assert.ok(bridge.includes('PLAYER_PIECE_PALETTE[p.seat]'));
  assert.ok(!bridge.includes('.hand')); assert.ok(!bridge.includes('.cards')); assert.ok(!bridge.includes('randomState'));
  assert.ok(!render.includes('WebSocket')); assert.ok(!render.includes('remote.submit'));
  assert.ok(render.includes('MIDDLE: THREE.MOUSE.ROTATE'));
  assert.ok(render.includes("document.body.classList.contains('network-resyncing')"));
  assert.ok(render.includes('this.renderer.dispose()'));
  assert.ok(controller.includes('this.drawSVG()'));
  assert.ok(controller.includes('qa3d'));
});
