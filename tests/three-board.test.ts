import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isPlacement } from '../src/game/board/target-feedback.ts';
import { generateBoardSetup, GENERATOR_VERSION } from '../src/game/board/setup.ts';
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
  const bridge = ui.slice(ui.indexOf('function drawBoard('), ui.indexOf('function drawSvgBoard('));
  assert.ok(ui.includes('availability.targetIds(targetMode)'));
  assert.ok(bridge.includes('targetMode,legalTargets'));
  assert.ok(bridge.includes('PLAYER_PIECE_PALETTE[p.seat]'));
  assert.ok(!bridge.includes('.hand')); assert.ok(!bridge.includes('.cards')); assert.ok(!bridge.includes('randomState'));
  assert.ok(!render.includes('WebSocket')); assert.ok(!render.includes('remote.submit'));
  assert.ok(render.includes('MIDDLE: THREE.MOUSE.ROTATE'));
  assert.ok(render.includes("document.body.classList.contains('network-resyncing')"));
  assert.ok(render.includes('this.renderer.dispose()'));
  assert.ok(controller.includes('this.drawSVG(view.legalTargets)'));
  assert.ok(controller.includes('qa3d'));
});

test('archived Twin Capes pirate moves between original offshore port targets without a board rebuild', () => {
  const b = generateBoardSetup(24680, 'twin-capes', GENERATOR_VERSION);
  const next = b.ports.find(port => port.edgeId !== b.piratePortEdgeId)!;
  assert.equal(staticBoardKey(b), staticBoardKey({ ...b, piratePortEdgeId: next.edgeId }));
  assert.equal(isPlacement('pirate'), false, 'moving the pirate never draws a construction preview');
  const geometry = worldGeometry(b.layout, b.version);
  assert.equal(geometry.hexes.size, 29);
  assert.equal(geometry.lakeDividers.length, 0);
  const centers = b.ports.map(port => {
    const plan = portBoatPlan(port, geometry);
    const edge = geometry.topology.edges.find(edge => edge.id === port.edgeId)!;
    const hex = geometry.hexes.get(edge.hexIds[0])!;
    assert.ok((plan.center.x - hex.x) * plan.outward.x + (plan.center.z - hex.z) * plan.outward.z > 1.8);
    return plan.center;
  });
  for (const [i, center] of centers.entries()) for (const other of centers.slice(i + 1)) {
    assert.ok(Math.hypot(center.x - other.x, center.z - other.z) > 1.46, 'neighboring target rings stay distinct');
  }
});

test('Twin Capes renders the robber, two two-hex lakes and a separate harbor berth per water space', () => {
  const board = generateBoardSetup(24680, 'twin-capes');
  const geometry = worldGeometry(board.layout, board.version);
  assert.equal(geometry.hexes.size, 25);
  assert.deepEqual(geometry.lakeDividers.map(({a,b}) => [(a.x+b.x)/2,(a.z+b.z)/2]), [[0,-1.5],[0,1.5]]);
  assert.equal(board.piratePortEdgeId, undefined);
  assert.equal(board.robberHexId, board.hexes.find(tile => tile.terrain === 'desert')!.hexId);
  const berths = board.ports.map(port => portBoatPlan(port, geometry).center);
  for (const {a,b} of geometry.lakeDividers) {
    const x=(a.x+b.x)/2,z=(a.z+b.z)/2;
    const boats=berths.filter(center => Math.abs(center.z-z) < .20 && Math.abs(center.x-x) < 1.1);
    assert.equal(boats.length,2);
    assert.ok(boats.some(c => c.x<x) && boats.some(c => c.x>x));
  }
  for(const [i,p] of berths.entries())for(const q of berths.slice(i+1))
    assert.ok(Math.hypot(q.x-p.x,q.z-p.z)>1.46,'neighboring sails and moorings stay separate');
});
