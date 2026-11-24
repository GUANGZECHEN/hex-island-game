import test from 'node:test';
import assert from 'node:assert/strict';
import { boardPlayerRange, createIslandBoard, isBoardLayout, type Hex } from '../src/game/board/geometry.ts';
import { createBoardView, createSetupView } from '../src/game/board/presentation.ts';
import { coastalPortSlots, generateBoardSetup } from '../src/game/board/setup.ts';

const board = createIslandBoard('twin-capes');
const neck = board.hexes.find(hex => hex.id === 'h:0,0')!;
const west = board.hexes.filter(hex => hex.q < 0);
const east = board.hexes.filter(hex => hex.q > 0);

function flood(start: string, cells: readonly Hex[]): Set<string> {
  const allowed = new Map(cells.map(hex => [hex.id, hex]));
  const pending = [start], visited = new Set<string>();
  while (pending.length) {
    const id = pending.pop()!;
    if (visited.has(id)) continue;
    visited.add(id);
    for (const next of allowed.get(id)!.neighborIds) if (allowed.has(next)) pending.push(next);
  }
  return visited;
}

test('Twin Capes fits 2–6 players and its one-hex neck joins two comparable, connected landmasses', () => {
  assert.deepEqual(boardPlayerRange('standard'), { min: 2, max: 4 });
  assert.deepEqual(boardPlayerRange('expanded-5-6'), { min: 5, max: 6 });
  assert.deepEqual(boardPlayerRange('twin-capes'), { min: 2, max: 6 });
  assert.equal(isBoardLayout('twin-capes'), true);
  for (const invalid of [null, 1, {}, 'generic', '__proto__', 'toString']) assert.equal(isBoardLayout(invalid), false);
  assert.equal(board.hexes.length, 29);
  assert.equal(board.vertices.length, 86);
  assert.equal(board.edges.length, 114);
  assert.deepEqual(neck.neighborIds, ['h:-1,0', 'h:1,0']);
  assert.equal(flood(neck.id, board.hexes).size, 29);
  const split = board.hexes.filter(hex => hex.id !== neck.id);
  assert.deepEqual(flood('h:-1,0', split), new Set(west.map(hex => hex.id)));
  assert.deepEqual(flood('h:1,0', split), new Set(east.map(hex => hex.id)));
  assert.equal(west.length, 14); assert.equal(east.length, 14);
  for (const hex of west) assert.ok(east.some(other => other.q === -hex.q && other.r === -hex.r));
  for (const sea of ['h:0,-1', 'h:1,-1', 'h:0,1', 'h:-1,1']) assert.ok(!board.hexes.some(hex => hex.id === sea));

  // The constructive red-token placement succeeds for every shuffle, not just sampled seeds.
  for (const cape of [west, east]) for (const a of cape) for (const b of cape) {
    if (a === b || a.neighborIds.includes(b.id)) continue;
    assert.ok(cape.some(c => c !== a && c !== b && !a.neighborIds.includes(c.id) && !b.neighborIds.includes(c.id)));
  }
});

test('sixteen evenly distributed harbors have separate waterfronts and berth space, including in the bays', () => {
  const coast = board.edges.filter(edge => edge.hexIds.length === 1), slots = coastalPortSlots('twin-capes');
  assert.equal(coast.length, 54); assert.equal(slots.length, 16);
  assert.equal(new Set(slots.flatMap(edge => [...edge.vertexIds])).size, 32);
  const portEdges = new Set(slots.map(edge => edge.id));
  const view = createBoardView(board), centers = new Map(view.hexes.map(hex => [hex.id, hex.center]));
  const positions = new Map(view.edges.map(edge => [edge.id, edge]));
  const berths = slots.map(edge => {
    assert.equal(edge.hexIds.length, 1);
    const { start, end } = positions.get(edge.id)!, land = centers.get(edge.hexIds[0])!;
    const x = (start.x + end.x) / 2, y = (start.y + end.y) / 2;
    const dx = x - land.x, dy = y - land.y, length = Math.hypot(dx, dy);
    return { x: x + dx / length * 1.03, y: y + dy / length * 1.03 };
  });
  for (const [i, a] of berths.entries()) for (const b of berths.slice(i + 1)) assert.ok(Math.hypot(a.x - b.x, a.y - b.y) > 1.5);
  let current = slots[0], vertex = current.vertexIds[0], gap = 0;
  for (let i = 0; i < coast.length; i++) {
    vertex = current.vertexIds[0] === vertex ? current.vertexIds[1] : current.vertexIds[0];
    current = coast.find(edge => edge.id !== current.id && edge.vertexIds.includes(vertex))!;
    gap++;
    if (portEdges.has(current.id)) { assert.ok(gap === 3 || gap === 4); gap = 0; }
  }
  assert.equal(current.id, slots[0].id);
});

test('seeded capes have equivalent production and trade variety and a pirate on one actual harbor', () => {
  const slots = coastalPortSlots('twin-capes'), distinct = new Set<string>(), pirateStarts = new Set<string>();
  for (const seed of [...Array.from({ length: 250 }, (_, i) => i), 0xffffffff]) {
    const setup = generateBoardSetup(seed, 'twin-capes');
    assert.equal(setup.robberHexId, '');
    assert.ok(setup.piratePortEdgeId && setup.ports.some(port => port.edgeId === setup.piratePortEdgeId));
    pirateStarts.add(setup.piratePortEdgeId!);
    distinct.add(JSON.stringify(setup.hexes));
    assert.deepEqual(setup.hexes.map(hex => hex.hexId), board.hexes.map(hex => hex.id));
    assert.deepEqual(setup.ports.map(port => port.edgeId), slots.map(edge => edge.id));
    assert.ok(setup.hexes.every(hex => hex.terrain !== 'desert' && hex.token !== null && hex.resource !== null));
    const byId = new Map(setup.hexes.map(hex => [hex.hexId, hex]));
    const red = new Set(setup.hexes.filter(hex => hex.token === 6 || hex.token === 8).map(hex => hex.hexId));
    assert.ok(!red.has(neck.id));
    assert.ok(board.hexes.filter(hex => red.has(hex.id)).every(hex => !hex.neighborIds.some(id => red.has(id))));
    for (const cape of [west, east]) {
      const sums: Record<string, number> = {};
      const cells = new Set(cape.map(hex => hex.id));
      for (const hex of cape) {
        const { resource, token } = byId.get(hex.id)!;
        sums[resource!] = (sums[resource!] ?? 0) + 6 - Math.abs(7 - token!);
      }
      assert.equal(cape.filter(hex => red.has(hex.id)).length, 3);
      assert.deepEqual(Object.values(sums).sort((a,b) => a-b), [8,9,9,10,10]);
      const types = setup.ports.filter((_, i) => cells.has(slots[i].hexIds[0])).map(port => port.type).sort();
      assert.deepEqual(types, ['brick','generic','generic','generic','grain','lumber','ore','wool']);
    }
  }
  assert.equal(distinct.size, 251); assert.equal(pirateStarts.size, 16);
  const first = generateBoardSetup(42, 'twin-capes');
  assert.deepEqual(generateBoardSetup(42, 'twin-capes'), first);
  assert.ok(createSetupView(board, first).hexes.every(hex => !hex.robber && hex.token !== null));
  for (const layout of ['standard','expanded-5-6'] as const) assert.ok(!('piratePortEdgeId' in generateBoardSetup(42, layout)));
});
