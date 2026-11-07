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
  assert.equal(hash, 'caf86878cbda18815b9ebce3c80960396c74d4ab955fcdfd56d999f82de8c19c');
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
    assert.equal(svg.children.length, 28);
    assert.equal(list.children.length, 19);
    for (const [index, group] of svg.children.slice(0, 19).entries()) {
      const hex = setup.hexes[index];
      assert.equal(group.attributes.get('data-hex-id'), hex.hexId);
      assert.equal(group.attributes.get('data-terrain'), hex.terrain);
      assert.equal(group.attributes.get('data-resource'), hex.resource ?? 'none');
      assert.equal(group.attributes.get('data-token'), String(hex.token ?? 'none'));
      assert.equal(group.attributes.get('data-robber'), String(hex.hexId === setup.robberHexId));
      assert.ok(group.children.some(child => child.tag === 'polygon' && child.attributes.get('class')?.includes(hex.terrain)));
      if (hex.resource) assert.ok(group.children.some(child => child.tag === 'svg' && child.attributes.get('data-resource-icon') === hex.resource));
      else assert.ok(group.children.some(child => child.tag === 'text' && child.textContent === 'None')); 
      if (hex.token !== null) {
        assert.ok(group.children.some(child => child.tag === 'circle'));
        assert.ok(group.children.some(child => child.tag === 'text' && child.textContent === String(hex.token)));
      } else assert.ok(group.children.some(child => child.tag === 'text' && child.textContent === 'Robber'));
      assert.ok(list.children[index].textContent.includes(hex.hexId));
    }
    const occupied = setup.hexes.find(hex => hex.token !== null)!;
    renderIslandBoard(container as unknown as HTMLElement, { ...setup, robberHexId: occupied.hexId });
    const moved = container.children[0].children.find(group => group.attributes.get('data-hex-id') === occupied.hexId)!;
    assert.ok(moved.children.some(child => child.tag === 'text' && child.textContent === 'Robber'));
  } finally { Object.assign(globalThis, { document: previous }); }
});
