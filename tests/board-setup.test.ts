import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createSetupView } from '../src/game/board/presentation.ts';
import { createIslandBoard } from '../src/game/board/geometry.ts';
import { generateBoardSetup, GENERATOR_VERSION, RESOURCE_BY_TERRAIN, coastalPortSlots } from '../src/game/board/setup.ts';

const board = createIslandBoard();
const counts = (values: readonly (string | number | null)[]) => Object.fromEntries([...new Set(values)].map(value => [String(value), values.filter(item => item === value).length]));

test('a thousand seeds produce complete, legal setups linked to geometry', () => {
  const deserts = new Set<string>();
  const layouts = new Set<string>();
  for (let seed = 0; seed < 1000; seed++) {
    const setup = generateBoardSetup(seed);
    assert.equal(setup.seed, seed);
    assert.equal(setup.version, GENERATOR_VERSION);
    assert.deepEqual(setup.hexes.map(hex => hex.hexId), board.hexes.map(hex => hex.id));
    assert.deepEqual(counts(setup.hexes.map(hex => hex.terrain)), { forest: 4, hills: 3, pasture: 4, fields: 4, mountains: 3, desert: 1 });
    assert.deepEqual(counts(setup.hexes.map(hex => hex.token)), { 2: 1, 3: 2, 4: 2, 5: 2, 6: 2, 8: 2, 9: 2, 10: 2, 11: 2, 12: 1, null: 1 });
    const byId = new Map(setup.hexes.map(hex => [hex.hexId, hex]));
    for (const hex of setup.hexes) {
      assert.equal(hex.resource, RESOURCE_BY_TERRAIN[hex.terrain]);
      assert.equal(hex.token === null, hex.terrain === 'desert');
      assert.equal(hex.hexId === setup.robberHexId, hex.terrain === 'desert');
    }
    for (const hex of board.hexes) {
      const token = byId.get(hex.id)!.token;
      if (token === 6 || token === 8) for (const neighbor of hex.neighborIds) assert.ok(![6, 8].includes(byId.get(neighbor)!.token as number));
    }
    assert.deepEqual(counts(setup.ports.map(port => port.type)), { generic: 4, lumber: 1, brick: 1, wool: 1, grain: 1, ore: 1 });
    assert.deepEqual(setup.ports.map(port => port.edgeId), coastalPortSlots().map(edge => edge.id));
    for (const port of setup.ports) assert.deepEqual(port.vertexIds, board.edges.find(edge => edge.id === port.edgeId)!.vertexIds);
    deserts.add(setup.robberHexId);
    layouts.add(JSON.stringify(setup.hexes));
  }
  assert.equal(deserts.size, 19);
  assert.ok(layouts.size > 990);
});

test('seeded output is deterministic and versioned, including boundary seeds', () => {
  for (const seed of [0, 1, 42, 0xffffffff]) assert.deepEqual(generateBoardSetup(seed), generateBoardSetup(seed));
  const hash = createHash('sha256').update(JSON.stringify(generateBoardSetup(1))).digest('hex');
  assert.equal(hash, '15601e8bdda2f38a1a26a01a5da8ae4c4df921bb8efaf088ae4b7a1b97aa9708');
});

test('invalid seeds fail explicitly', () => {
  for (const seed of [-1, 0x100000000, 1.5, NaN, Infinity, -Infinity]) assert.throws(() => generateBoardSetup(seed), RangeError);
});

test('presentation preserves every assignment and stable geometry ID with finite coordinates', () => {
  for (const seed of [0, 1, 42, 0xffffffff]) {
    const setup = generateBoardSetup(seed);
    const view = createSetupView(board, setup);
    assert.equal(view.hexes.length, 19);
    for (const [index, hex] of view.hexes.entries()) {
      const assignment = setup.hexes[index];
      assert.equal(hex.id, assignment.hexId);
      assert.equal(hex.terrain, assignment.terrain);
      assert.equal(hex.resource, assignment.resource);
      assert.equal(hex.token, assignment.token);
      assert.equal(hex.robber, hex.id === setup.robberHexId);
      assert.ok(Number.isFinite(hex.center.x) && Number.isFinite(hex.center.y));
      assert.ok(hex.points.every(point => Number.isFinite(point.x) && Number.isFinite(point.y)));
    }
  }
});

test('SVG renderer shows each assigned terrain, resource, token and robber under its stable ID', async () => {
  const { renderIslandBoard } = await import('../src/game/board/render.ts');
  class FakeElement {
    attributes = new Map<string, string>();
    children: FakeElement[] = [];
    textContent = '';
    className = '';
    classList = { add: (value: string) => { this.className = value; } };
    tag: string;
    constructor(tag: string) { this.tag = tag; }
    setAttribute(key: string, value: string) { this.attributes.set(key, value); }
    append(...elements: FakeElement[]) { this.children.push(...elements); }
    replaceChildren(...elements: FakeElement[]) { this.children = elements; }
  }
  const previous = globalThis.document;
  Object.assign(globalThis, { document: { createElement: (tag: string) => new FakeElement(tag), createElementNS: (_ns: string, tag: string) => new FakeElement(tag) } });
  try {
    const setup = generateBoardSetup(42);
    const container = new FakeElement('div');
    renderIslandBoard(container as unknown as HTMLElement, setup);
    const [svg, list] = container.children;
    const hexGroups=svg.children.filter(child=>child.attributes.get('data-hex-id'));
    const portGroups=svg.children.filter(child=>child.attributes.get('data-port-edge'));
    assert.equal(hexGroups.length,19);
    assert.equal(portGroups.length,9);
    assert.ok(svg.children.some(child=>child.tag==='rect'&&child.attributes.get('class')==='board-ocean'));
    assert.ok(svg.children.some(child=>child.tag==='rect'&&child.attributes.get('class')==='board-ocean-waves'));
    assert.ok(svg.children.some(child=>child.tag==='defs'));
    assert.equal(list.children.length, 19);
    for (const [index, group] of hexGroups.entries()) {
      const hex = setup.hexes[index];
      assert.equal(group.attributes.get('data-hex-id'), hex.hexId);
      assert.equal(group.attributes.get('data-terrain'), hex.terrain);
      assert.equal(group.attributes.get('data-resource'), hex.resource ?? 'none');
      assert.equal(group.attributes.get('data-token'), String(hex.token ?? 'none'));
      assert.equal(group.attributes.get('data-robber'), String(hex.hexId === setup.robberHexId));
      assert.ok(group.children.some(child => child.tag === 'polygon' && child.attributes.get('class')?.includes(hex.terrain)));
      assert.ok(group.children.some(child => child.tag === 'polygon' && child.attributes.get('class') === 'island-cell-shadow'));
      assert.ok(group.children.some(child => child.tag === 'polygon' && child.attributes.get('class') === 'island-cell-inset'));
      assert.ok(group.children.some(child => child.tag === 'g' && child.attributes.get('data-terrain-art') === hex.terrain));
      const terrainArt=group.children.find(child=>child.tag==='g'&&child.attributes.get('data-terrain-art')===hex.terrain)!;
      if(hex.terrain==='hills'){
        assert.ok(terrainArt.children.some(child=>child.tag==='path'&&child.attributes.get('class')==='terrain-art-clay-face'));
        assert.ok(terrainArt.children.some(child=>child.tag==='path'&&child.attributes.get('class')==='terrain-art-quarry-cut'));
        assert.equal(terrainArt.children.filter(child=>child.tag==='rect'&&child.attributes.get('class')==='terrain-art-brick').length,3);
      }
      if(hex.terrain==='mountains'){
        assert.ok(terrainArt.children.some(child=>child.tag==='path'&&child.attributes.get('class')==='terrain-art-rock-fill'));
        assert.ok(terrainArt.children.some(child=>child.tag==='path'&&child.attributes.get('class')==='terrain-art-quarry-bench'));
        assert.equal(terrainArt.children.filter(child=>child.tag==='circle'&&child.attributes.get('class')==='terrain-art-rubble').length,4);
      }
      if (hex.resource) {
        assert.ok(group.children.some(child => child.tag === 'svg' && child.attributes.get('data-resource-icon') === hex.resource));
        assert.ok(!group.children.some(child => child.tag === 'text' && child.attributes.get('class') === 'island-label'));
        const title = group.children.find(child => child.tag === 'title')!.textContent.toLowerCase();
        assert.ok(title.includes(hex.terrain) && title.includes(hex.resource));
        assert.ok(list.children[index].textContent.toLowerCase().includes(hex.terrain));
        assert.ok(list.children[index].textContent.toLowerCase().includes(hex.resource));
      }
      else { assert.equal(hex.terrain,'desert'); assert.ok(group.children.some(child => child.tag === 'svg' && child.attributes.get('data-terrain-icon') === 'desert')); assert.ok(!group.children.some(child => child.tag === 'text' && ['Desert','None'].includes(child.textContent))); } 
      if (hex.token !== null) {
        assert.ok(group.children.some(child => child.tag === 'circle' && child.attributes.get('class')?.includes('island-token')));
        assert.ok(group.children.some(child => child.tag === 'circle' && child.attributes.get('class')?.includes('island-token-rim')));
        assert.ok(group.children.some(child => child.tag === 'circle' && child.attributes.get('class')?.includes('island-token-pip')));
        assert.ok(group.children.some(child => child.tag === 'text' && child.textContent === String(hex.token)));
      } else assert.ok(group.children.some(child => child.tag === 'g' && child.attributes.get('data-robber-marker') === 'true'));
      assert.ok(list.children[index].textContent.includes(hex.hexId));
    }
    const descendants=(root:any):any[]=>root.children.flatMap((child:any)=>[child,...descendants(child)]);
    for(const [index,group] of portGroups.entries()){
      const port=setup.ports[index],all=descendants(group);
      assert.equal(group.attributes.get('data-port-edge'),port.edgeId);
      assert.equal(group.attributes.get('data-port-type'),port.type);
      const legs=all.filter(child=>child.tag==='line'&&child.attributes.get('class')?.includes('port-pier-leg'));
      assert.equal(legs.length,2);
      assert.notEqual(`${legs[0].attributes.get('x2')},${legs[0].attributes.get('y2')}`,`${legs[1].attributes.get('x2')},${legs[1].attributes.get('y2')}`);
      assert.equal(all.filter(child=>child.attributes.get('class')==='port-pier-stem').length,0);
      assert.equal(all.filter(child=>child.tag==='rect'&&child.attributes.get('class')==='port-dock-board').length,1);
      if(port.type==='generic'){
        assert.ok(!all.some(child=>child.attributes.get('class')==='port-anchor-icon'));
        assert.ok(all.some(child=>child.tag==='text'&&child.textContent==='3:1'));
      }else{
        assert.ok(all.some(child=>child.tag==='svg'&&child.attributes.get('data-resource-icon')===port.type));
        assert.ok(all.some(child=>child.tag==='text'&&child.textContent==='2:1'));
        assert.ok(!all.some(child=>child.tag==='text'&&child.textContent?.startsWith(port.type[0].toUpperCase())));
      }
    }
    const occupied = setup.hexes.find(hex => hex.token !== null)!;
    renderIslandBoard(container as unknown as HTMLElement, { ...setup, robberHexId: occupied.hexId });
    const moved = container.children[0].children.find(group => group.attributes.get('data-hex-id') === occupied.hexId)!;
    const marker=moved.children.find(child => child.tag === 'g' && child.attributes.get('data-robber-marker') === 'true')!;
    assert.ok(marker);
    const token=moved.children.find(child=>child.tag==='circle'&&child.attributes.get('class')?.includes('island-token'))!;
    const markerCircle=marker.children.find(child=>child.tag==='circle')!;
    assert.equal(markerCircle.attributes.get('cy'),token.attributes.get('cy'));
    assert.ok(moved.attributes.get('class')?.includes('robber-occupied'));
  } finally { Object.assign(globalThis, { document: previous }); }
});


test('expanded 5-6 player setup has 24 hexes, two deserts and eleven ports',()=>{
 const expanded=createIslandBoard('expanded-5-6');
 for(let seed=0;seed<300;seed++){
  const setup=generateBoardSetup(seed,'expanded-5-6');
  assert.equal(setup.layout,'expanded-5-6');
  assert.equal(setup.hexes.length,24);
  assert.deepEqual(setup.hexes.map(hex=>hex.hexId),expanded.hexes.map(hex=>hex.id));
  assert.deepEqual(counts(setup.hexes.map(hex=>hex.terrain)),{forest:5,hills:4,pasture:5,fields:4,mountains:4,desert:2});
  assert.deepEqual(counts(setup.hexes.map(hex=>hex.token)),{2:1,3:2,4:3,5:3,6:3,8:2,9:3,10:2,11:2,12:1,null:2});
  const deserts=setup.hexes.filter(hex=>hex.terrain==='desert');
  assert.equal(deserts.length,2);assert.ok(deserts.some(hex=>hex.hexId===setup.robberHexId));
  assert.ok(deserts.every(hex=>hex.token===null&&hex.resource===null));
  const byId=new Map(setup.hexes.map(hex=>[hex.hexId,hex]));
  for(const hex of expanded.hexes){
   const token=byId.get(hex.id)!.token;
   if(token===6||token===8)for(const neighbor of hex.neighborIds)assert.ok(![6,8].includes(byId.get(neighbor)!.token as number));
  }
  assert.deepEqual(counts(setup.ports.map(port=>port.type)),{generic:6,lumber:1,brick:1,wool:1,grain:1,ore:1});
  assert.deepEqual(setup.ports.map(port=>port.edgeId),coastalPortSlots('expanded-5-6').map(edge=>edge.id));
 }
 assert.deepEqual(generateBoardSetup(42,'expanded-5-6'),generateBoardSetup(42,'expanded-5-6'));
});
