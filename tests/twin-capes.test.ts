import test from 'node:test';
import assert from 'node:assert/strict';
import { boardPlayerRange, createIslandBoard, isBoardLayout, TWIN_CAPES_LAKES } from '../src/game/board/geometry.ts';
import { createBoardView, createSetupView } from '../src/game/board/presentation.ts';
import { coastalPortSlots, generateBoardSetup, GENERATOR_VERSION, TWIN_CAPES_VERSION } from '../src/game/board/setup.ts';

const board = createIslandBoard('twin-capes');
const tokenDeck = [2,3,3,3,4,4,4,5,5,5,6,6,8,8,9,9,9,10,10,10,11,11,11,12];

test('Twin Capes has three crossings and two enclosed two-hex lakes on its 25-land footprint', () => {
  assert.deepEqual(boardPlayerRange('standard'), {min:2,max:4});
  assert.deepEqual(boardPlayerRange('expanded-5-6'), {min:5,max:6});
  assert.deepEqual(boardPlayerRange('twin-capes'), {min:2,max:6});
  assert.equal(isBoardLayout('twin-capes'), true);
  for (const value of [null, 1, {}, '__proto__', 'toString']) assert.equal(isBoardLayout(value), false);
  const rows = [-2,-1,0,1,2].map(r => board.hexes.filter(hex => hex.r === r).map(hex => hex.q));
  assert.deepEqual(rows, [[-1,0,1,2,3], [-2,-1,2,3], [-3,-2,-1,0,1,2,3], [-3,-2,1,2], [-3,-2,-1,0,1]]);
  assert.deepEqual([board.hexes.length,board.vertices.length,board.edges.length], [25,78,104]);
  const land = new Set(board.hexes.map(hex => hex.id));
  for (const lake of TWIN_CAPES_LAKES) for (const [q,r] of lake) {
    const neighbors = [[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]].map(([dq,dr]) => `h:${q+dq},${r+dr}`);
    assert.equal(neighbors.filter(id => land.has(id)).length, 5);
    assert.ok(!land.has(`h:${q},${r}`));
  }
});

test('sixteen separate harbors fit around the sea and inside both lakes', () => {
  const coast = board.edges.filter(edge => edge.hexIds.length === 1);
  const slots = coastalPortSlots('twin-capes'), portIds = new Set(slots.map(edge => edge.id));
  assert.equal(coast.length, 58); assert.equal(slots.length, 16);
  assert.equal(new Set(slots.flatMap(edge => [...edge.vertexIds])).size, 32);
  const remaining = new Set(coast.map(edge => edge.id));
  const loops = [];
  for (const first of coast) {
    if (!remaining.has(first.id)) continue;
    let edge = first, vertex = first.vertexIds[0], length = 0, ports = 0;
    do {
      assert.ok(remaining.delete(edge.id));
      length++; if (portIds.has(edge.id)) ports++;
      vertex = edge.vertexIds.find(v => v !== vertex)!;
      edge = coast.find(candidate => candidate !== edge && candidate.vertexIds.includes(vertex))!;
    } while (edge !== first);
    loops.push([length,ports]);
  }
  assert.deepEqual(loops.sort((a,b) => a[0]-b[0]), [[10,2],[10,2],[38,12]]);

  const view = createBoardView(board), points = new Map(view.vertices.map(v => [v.id,v.point]));
  const centers = new Map(view.hexes.map(h => [h.id,h.center]));
  const berths = slots.map(edge => {
    const [a,b] = edge.vertexIds.map(id => points.get(id)!);
    const midX=(a.x+b.x)/2, midY=(a.y+b.y)/2, land=centers.get(edge.hexIds[0])!;
    const dx=midX-land.x, dy=midY-land.y, n=Math.hypot(dx,dy);
    return [midX+1.03*dx/n,midY+1.03*dy/n];
  });
  for (const [i,a] of berths.entries()) for (const b of berths.slice(i+1)) assert.ok(Math.hypot(a[0]-b[0],a[1]-b[1])>1.5);
});

test('each seed uses the approved deck and a desert robber, with equal production odds on the capes', () => {
  const slots = coastalPortSlots('twin-capes'), starts = new Set<string>(), deals = new Set<string>();
  const sides = board.hexes.map(hex => Math.sign(2*hex.q+hex.r));
  const portTypes = ['brick','generic','generic','generic','grain','lumber','ore','wool'];
  for (const seed of [...Array.from({length:250},(_,i)=>i),0xffffffff]) {
    const setup = generateBoardSetup(seed,'twin-capes');
    assert.equal(setup.version,TWIN_CAPES_VERSION);
    assert.deepEqual(setup.hexes.map(h=>h.hexId),board.hexes.map(h=>h.id));
    const desert = setup.hexes.filter(h=>h.terrain==='desert');
    assert.equal(desert.length,1); assert.equal(desert[0].hexId,setup.robberHexId);
    assert.equal(desert[0].token,null); assert.equal(desert[0].resource,null);
    assert.ok(!('piratePortEdgeId' in setup));
    starts.add(setup.robberHexId); deals.add(JSON.stringify(setup.hexes));
    assert.deepEqual(setup.hexes.flatMap(h=>h.token===null?[]:[h.token]).sort((a,b)=>a-b),tokenDeck);
    const red = new Set(setup.hexes.filter(h=>h.token===6||h.token===8).map(h=>h.hexId));
    assert.ok(board.hexes.filter(h=>red.has(h.id)).every(h=>!h.neighborIds.some(id=>red.has(id))));
    for (const side of [-1,1]) {
      const shore = setup.hexes.filter((_,i)=>sides[i]===side);
      assert.equal(new Set(shore.map(h=>h.resource)).size,5);
      assert.equal(shore.reduce((sum,h)=>sum+6-Math.abs(7-h.token!),0),35);
      assert.deepEqual(setup.ports.slice(side<0?0:8,side<0?8:16).map(p=>p.type).sort(),portTypes);
    }
    assert.deepEqual(setup.ports.map(p=>p.edgeId),slots.map(e=>e.id));
  }
  assert.equal(starts.size,3); assert.equal(deals.size,251);
  const current = generateBoardSetup(42,'twin-capes');
  assert.deepEqual(generateBoardSetup(42,'twin-capes',TWIN_CAPES_VERSION),current);
  assert.equal(createSetupView(board,current).hexes.filter(h=>h.robber).length,1);
});

test('original Twin Capes seeds still reproduce their 29-hex topology and pirate harbor', () => {
  const old = generateBoardSetup(42,'twin-capes',GENERATOR_VERSION);
  const topology = createIslandBoard('twin-capes',old.version), ports = coastalPortSlots('twin-capes',old.version);
  assert.deepEqual([topology.hexes.length,topology.vertices.length,topology.edges.length],[29,86,114]);
  assert.equal(old.version,GENERATOR_VERSION); assert.equal(old.robberHexId,'');
  assert.equal(old.piratePortEdgeId,'e:v:3,-7|v:4,-8');
  assert.deepEqual(old.hexes.map(h=>h.hexId),topology.hexes.map(h=>h.id));
  assert.deepEqual(old.ports.map(p=>p.edgeId),ports.map(e=>e.id));
  assert.equal(old.hexes.map(h=>h.terrain.slice(0,2)+h.token).join(','),
    'hi5,pa4,pa11,hi2,fi6,fo9,fo3,hi6,fi4,mo10,mo3,mo5,fo10,pa8,fi10,fo5,pa8,mo4,hi10,pa10,fo12,pa11,hi3,hi9,fi11,fo8,fi9,mo6,fi4');
  assert.ok(createSetupView(topology,old).hexes.every(h=>!h.robber&&h.token!==null));
});
