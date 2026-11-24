import * as THREE from 'three';
import { ArtAssets } from '../src/game/board/three/art.ts';
import { PlacementPreview } from '../src/game/board/three/placement-preview.ts';
import { generateBoardSetup } from '../src/game/board/setup.ts';
import { worldGeometry, type BoardSceneView } from '../src/game/board/three/model.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createIslandBoard } from '../src/game/board/geometry.ts';
import { adjacentPlacementHexes, isPlacement, TargetFeedback, TARGET_COLORS } from '../src/game/board/target-feedback.ts';

test('only the current legal target is highlighted and leaving it clears the preview', () => {
  const feedback = new TargetFeedback();
  feedback.update('board:road', ['a', 'b']);
  feedback.hover('a');
  assert.equal(feedback.active, 'a');
  feedback.hover('b');
  assert.equal(feedback.active, 'b');
  feedback.hover(null);
  assert.equal(feedback.active, null);
  feedback.hover('illegal');
  assert.equal(feedback.active, null);
  assert.equal(TARGET_COLORS.legal, '#fff3a0');
  assert.equal(TARGET_COLORS.active, '#ff981f');
});

test('a changed board, mode or set of legal targets clears obsolete highlights', () => {
  const feedback = new TargetFeedback();
  feedback.update('board:road', ['a', 'b']);
  feedback.hover('a');
  feedback.update('board:road', ['a', 'c']);
  assert.equal(feedback.active, 'a');
  feedback.update('board:road', ['c']);
  assert.equal(feedback.active, null);
  feedback.hover('c');
  feedback.update('board:city', ['c']);
  assert.equal(feedback.active, null);
  feedback.hover('c');
  feedback.update('another:city', ['c']);
  assert.equal(feedback.active, null);
});

test('each player previews targets independently', () => {
  const first = new TargetFeedback(), second = new TargetFeedback();
  for (const feedback of [first, second]) feedback.update('road', ['r1', 'r2']);
  first.hover('r1');
  second.hover('r2');
  assert.equal(first.active, 'r1');
  assert.equal(second.active, 'r2');
});
test('pointer highlighting has dedicated material, cleanup and no game/UI rebuild', () => {
  const source=readFileSync('src/game/board/three/renderer.ts','utf8');
  assert.ok(source.includes('private activeTargetMaterial'));
  assert.ok(source.includes('const material = active ? activeMaterial : legalMaterial'));
  assert.ok(source.includes('display.material = material'));
  assert.ok(source.includes('this.activeTargetMaterial.dispose()'));
  const hover=source.slice(source.indexOf('private hover ='),source.indexOf('private corners()'));
  assert.ok(!hover.includes('this.choose(')); assert.ok(!hover.includes('this.resetView('));
});
test('3D and SVG keep on-board feedback without coordinate selection controls', () => {
  const ui=readFileSync('src/game-ui.ts','utf8');
  assert.ok(!ui.includes("select(targets,'Legal target'"));
  assert.ok(!ui.includes("button(targets,'Use target'"));
  assert.ok(ui.includes("button(targets,'Cancel selection'"));
  assert.ok(ui.includes('Click or tap a highlighted'));
  assert.equal((ui.match(/setAttribute\('data-target-id'/g)||[]).length,5);
  const css=readFileSync('src/target-feedback.css','utf8');
  for(const part of ['game-target-vertex','game-target-road','game-target-city','robber-target'])assert.ok(css.includes(part+'.target-active'));
});

test('entering target mode does not preselect a hidden coordinate',()=>{
 const preview=new TargetFeedback();preview.update('board:road',['a','b']);
 assert.equal(preview.active,null);preview.hover('b');assert.equal(preview.active,'b');
 preview.hover(null);assert.equal(preview.active,null);
});

test('scenery focus follows the hexes adjoining the actual vertex or edge', () => {
  for (const layout of ['standard','expanded-5-6'] as const) {
    const board = createIslandBoard(layout);
    const coast = board.edges.find(edge => edge.hexIds.length === 1)!;
    const inland = board.edges.find(edge => edge.hexIds.length === 2)!;
    assert.deepEqual(adjacentPlacementHexes(board,'road',coast.id),coast.hexIds);
    assert.deepEqual(adjacentPlacementHexes(board,'road',inland.id),inland.hexIds);
    const junction = board.vertices.find(vertex => board.hexes.filter(hex => hex.vertexIds.includes(vertex.id)).length === 3)!;
    for (const kind of ['city','settlement','ship','station'] as const) {
      assert.equal(adjacentPlacementHexes(board,kind,junction.id).length,3);
      assert.deepEqual(adjacentPlacementHexes(board,kind,'missing'),[]);
      assert.ok(isPlacement(kind));
    }
  }
  assert.ok(isPlacement('road')); assert.equal(isPlacement(null),false); assert.equal(isPlacement('robber'),false);
});

test('3D road preview reuses the piece and quiets only adjacent scenery without editing shared art', () => {
  const assets = new ArtAssets(), preview = new PlacementPreview();
  const board = generateBoardSetup(24680), geometry = worldGeometry(board.layout);
  const [first, second] = geometry.topology.edges;
  const adjacent = first.hexIds[0], distant = board.hexes.find(hex => !first.hexIds.includes(hex.hexId))!.hexId;
  const makeTile = () => {
    const root = new THREE.Group(), tree = new THREE.Group(); tree.userData.decorative = 'tree'; root.add(tree);
    const crown = assets.box(tree,'#507347',[.2,.3,.2],0,0,0);
    return { root, crown };
  };
  const near = makeTile(), far = makeTile(), original = near.crown.material;
  assert.equal(far.crown.material,original);
  const tiles = new Map([[adjacent,near],[distant,far]]);
  const view:BoardSceneView = {board,roads:{},buildings:{},players:[{id:'A',name:'A',color:'#005692',seat:0}],
    targetMode:'road',legalTargets:[first.id,second.id],placementPlayerId:'A'};
  assert.ok(preview.update(first.id,view,geometry,tiles,assets));
  const piece = preview.root.children[0];
  assert.equal(preview.kind,'road'); assert.equal(preview.target,first.id);
  assert.notEqual(near.crown.material,original); assert.equal(far.crown.material,original);
  assert.equal(assets.material('#005692').transparent,false);
  assert.equal(preview.update(first.id,view,geometry,tiles,assets),false);
  assert.ok(preview.update(second.id,view,geometry,tiles,assets)); assert.equal(preview.root.children[0],piece);
  assert.ok(preview.update(null,view,geometry,tiles,assets));
  assert.equal(preview.root.children.length,0); assert.equal(near.crown.material,original);
  assert.equal(preview.update(first.id,{...view,placementPlayerId:undefined},geometry,tiles,assets),false);
  preview.reset(); assets.dispose();
});
