import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ArtAssets, makeTerrain, makeBoatPort, makeBuilding } from '../src/game/board/three/art.ts';
import { SEAT_EMBLEMS, HULL_STRIPE, SAIL_CLOTH, EMBLEM_INK } from '../src/game/ui/player-emblem.ts';
import { DRAWN_WHEAT, grainPreviewMask, MODELED_WHEAT } from '../src/game/board/grain-clearance.ts';
import { setWheatClearance } from '../src/game/board/three/wheat-batches.ts';
import { generateBoardSetup } from '../src/game/board/setup.ts';
import { worldGeometry, portBoatPlan } from '../src/game/board/three/model.ts';
import { ART_REVISION, refineTerrain, inspectTerrainArt, makeOcean, coastline, coastDistance, disposeArtInstances } from '../src/game/board/three/refinement.ts';

// The production label canvas is irrelevant to geometry tests; retain real Sprite meshes.
class GeometryAssets extends ArtAssets {
  override label(): THREE.SpriteMaterial { return this.extra(new THREE.SpriteMaterial()); }
  override playerSail(): THREE.SpriteMaterial { return this.extra(new THREE.SpriteMaterial()); }
}

test('refined terrain has real gradients, three sheep, cuboid bricks and upright wheat', () => {
  for (const layout of ['standard', 'expanded-5-6'] as const) {
    const board = generateBoardSetup(24680, layout), geometry = worldGeometry(layout), before = JSON.stringify(board), assets = new GeometryAssets();
    for (const hex of board.hexes) {
      const tile = makeTerrain(assets, hex, geometry.hexes.get(hex.hexId)!);
      const token = tile.token;
      refineTerrain(assets, hex, tile.root, tile.token);
      const art = inspectTerrainArt(tile.root);
      assert.equal(art.revision, ART_REVISION);
      assert.equal(art.id, hex.hexId);
      assert.ok(art.gradientColors >= 5, JSON.stringify(art));
      assert.equal(tile.token, token);
      if (hex.terrain === 'pasture') assert.equal(art.sheep, 3);
      else assert.equal(art.sheep, 0);
      if (hex.terrain === 'hills') { assert.equal(art.bricks, 9); assert.equal(art.cuboids, true); }
      if (hex.terrain === 'fields') { assert.equal(art.stems, 15); assert.equal(art.upward, true); }
      if (hex.terrain === 'desert') {
        assert.equal(tile.token, null); assert.equal(tile.root.children.length, 2);
        assert.ok(Math.abs(art.duneMin! - .123) < 1e-5);
        assert.ok(art.duneMax! > .40 && art.duneMax! < .58, JSON.stringify(art));
      }
      disposeArtInstances(tile.root);
    }
    assert.equal(JSON.stringify(board), before); assets.dispose();
  }
});

test('sand relief increases 65 percent while all seam vertices retain their base height', () => {
  const board = generateBoardSetup(49), hex = board.hexes.find(h => h.terrain === 'desert')!, assets = new GeometryAssets();
  const tile = makeTerrain(assets, hex, { x: 0, z: 0 });
  const sand = tile.root.children.find(c => c.userData.dunes) as THREE.Mesh;
  const previous = sand.geometry.getAttribute('position').clone();
  refineTerrain(assets, hex, tile.root, null);
  const after = sand.geometry.getAttribute('position');
  for (let i = 0; i < after.count; i++) {
    assert.ok(Math.abs(after.getY(i) - (.123 + (previous.getY(i) - .123) * 1.65)) < 1e-6);
    assert.equal(after.getX(i), previous.getX(i)); assert.equal(after.getZ(i), previous.getZ(i));
  }
  assets.dispose();
});

test('ocean derives shallow water and foam from actual coastline on both board sizes', () => {
  for (const layout of ['standard', 'expanded-5-6'] as const) {
    const geometry = worldGeometry(layout), assets = new GeometryAssets(), coast = coastline(geometry);
    assert.equal(coast.length, geometry.topology.edges.filter(e => e.hexIds.length === 1).length);
    for (const edge of coast) assert.ok(coastDistance((edge.a.x + edge.b.x) / 2, (edge.a.z + edge.b.z) / 2, coast) < 1e-10);
    const ocean = makeOcean(assets, 8, geometry), surface = ocean.getObjectByName('depth-gradient-water') as THREE.Mesh;
    const colors = surface.geometry.getAttribute('color'), distinct = new Set<string>();
    for (let i = 0; i < colors.count; i++) {
      const values = [colors.getX(i), colors.getY(i), colors.getZ(i)];
      assert.ok(values.every(n => Number.isFinite(n) && n >= 0 && n <= 1));
      distinct.add(values.map(n => n.toFixed(3)).join(','));
    }
    assert.ok(distinct.size > 100);
    const foam=ocean.getObjectByName('shore-foam') as THREE.LineSegments;
    assert.ok(foam.geometry.getAttribute('position').count > 100);
    assert.equal(ocean.getObjectByName('sea-ripples'),undefined,'calm sea has no decorative stripe pattern');
    assert.equal(surface.castShadow, false); assets.dispose();
  }
});

test('new repeated props release their per-instance GPU resources', () => {
  const assets = new GeometryAssets(), board = generateBoardSetup(17), roots: THREE.Group[] = []; let instances = 0, released = 0;
  for (const hex of board.hexes.filter(h => h.terrain === 'pasture' || h.terrain === 'fields')) {
    const tile = makeTerrain(assets, hex, { x: 0, z: 0 }); refineTerrain(assets, hex, tile.root, tile.token); roots.push(tile.root);
    tile.root.traverse(o => { if (o instanceof THREE.InstancedMesh) { instances++; o.addEventListener('dispose', () => released++); } });
  }
  roots.forEach(disposeArtInstances); assert.ok(instances > 0); assert.equal(released, instances); assets.dispose();
});

test('boat ports keep their deck origins and display trade information on larger sails', () => {
  const assets = new GeometryAssets(), board = generateBoardSetup(24680), geometry = worldGeometry('standard');
  for (const port of board.ports) {
    const plan = portBoatPlan(port, geometry), boat = makeBoatPort(assets, port.type, plan);
    assert.equal(boat.children.filter(c => c.name.startsWith('deck:')).length, 2);
    assert.deepEqual(plan.decks.map(d => d.vertexId), port.vertexIds);
    const sail = boat.getObjectByName('boat-ratio')!;
    assert.deepEqual(sail.userData, {
      ratio: port.type === 'generic' ? '3:1' : '2:1',
      resource: port.type === 'generic' ? null : port.type,
      stitched: true,
    });
    assert.ok(sail.scale.x >= .9 && sail.scale.y >= .9);
  }
  assets.dispose();
});

test('each ship keeps its owner’s colored hull, paint stripe and distinct camera-facing sail emblem', () => {
  const assets = new GeometryAssets();
  const colors = ['#2868b2', '#c74a42', '#f27ebd', '#8b55a1', '#d48826', '#2b9295'];
  const marks = new Set<string>();
  for (const [seat, color] of colors.entries()) {
    const ship = makeBuilding(assets, 'ship', color, seat);
    const hull = ship.getObjectByName('player-ship-hull');
    assert.ok(hull instanceof THREE.Mesh && hull.material instanceof THREE.MeshStandardMaterial);
    assert.equal(hull.material.color.getHexString(), color.slice(1));
    const stripe = ship.getObjectByName('player-ship-stripe');
    assert.ok(stripe instanceof THREE.Mesh && stripe.material instanceof THREE.MeshStandardMaterial);
    assert.equal(stripe.material.color.getHexString(), HULL_STRIPE.slice(1));
    const sail = ship.getObjectByName('player-ship-sail');
    assert.ok(sail instanceof THREE.Sprite);
    assert.ok(sail.center.y < .1, 'top view keeps the sail above its colored hull');
    assert.equal(sail.userData.emblem, SEAT_EMBLEMS[seat].name);
    marks.add(sail.userData.emblem);
  }
  assert.equal(marks.size, 6);
  assert.equal(new Set(SEAT_EMBLEMS.map(e => e.path)).size, 6);
  // Linear relative luminance is the same after conversion to grayscale.
  const luminance = (hex: string) => {
    const { r, g, b } = new THREE.Color(hex);
    return .2126 * r + .7152 * g + .0722 * b;
  };
  assert.ok((luminance(SAIL_CLOTH) + .05) / (luminance(EMBLEM_INK) + .05) >= 7);
  assets.dispose();
});

test('only a placement preview softens nearby wheat in both presentations on each map', () => {
  for (const layout of ['standard', 'expanded-5-6', 'twin-capes'] as const) {
    const { topology } = worldGeometry(layout);
    const hex = topology.hexes[0];
    const vertex = hex.vertexIds[3], edge = hex.edgeIds[0];
    const distant = topology.hexes.find(other => !other.vertexIds.includes(vertex) && !other.edgeIds.includes(edge))!;
    for (const art of [MODELED_WHEAT, DRAWN_WHEAT]) {
      const vertexMask = grainPreviewMask(hex, art, 'settlement', vertex);
      const roadMask = grainPreviewMask(hex, art, 'road', edge);
      assert.ok(vertexMask > 0 && roadMask > 0 && vertexMask !== roadMask);
      assert.equal(grainPreviewMask(hex, art, 'city', vertex), vertexMask);
      assert.equal(grainPreviewMask(distant, art, 'settlement', vertex), 0);
      assert.equal(grainPreviewMask(distant, art, 'road', edge), 0);
      assert.equal(grainPreviewMask(hex, art, 'ship', vertex), 0);
      assert.equal(grainPreviewMask(hex, art, 'road', null), 0, 'selecting the build action alone keeps the field clear');
      assert.equal(grainPreviewMask(hex, art, null, null), 0, 'ending the preview restores the field after placement');
    }
  }
});

test('a wheat preview preserves the crop, token and ground and restores exact matrices when placement ends', () => {
  const assets = new GeometryAssets(), board = generateBoardSetup(24680), geometry = worldGeometry(board.layout);
  const assignment = board.hexes.find(cell => cell.terrain === 'fields')!;
  const hex = geometry.topology.hexes.find(cell => cell.id === assignment.hexId)!;
  const { root, token } = makeTerrain(assets, assignment, geometry.hexes.get(hex.id)!);
  refineTerrain(assets, assignment, root, token);
  const base = root.children[0] as THREE.Mesh, baseMaterial = base.material, tokenMaterial = token!.material;
  const solid = root.getObjectByName('upright-wheat-stems') as THREE.InstancedMesh;
  const faded = root.getObjectByName('faded-upright-wheat-stems') as THREE.InstancedMesh;
  const originalMatrices = solid.instanceMatrix.array.slice();
  const mask = grainPreviewMask(hex, MODELED_WHEAT, 'settlement', hex.vertexIds[3]);
  setWheatClearance(root, mask);
  const art = inspectTerrainArt(root);
  assert.equal(art.stems, 15);
  assert.ok(art.fadedStems > 0 && art.fadedStems < art.stems);
  assert.ok(art.wheatOpacity <= .2);
  assert.equal((solid.material as THREE.Material).opacity, 1);
  assert.equal(solid.count + faded.count, 15);
  assert.equal(faded.castShadow, false);
  assert.equal(faded.parent?.userData.decorative, 'wheat');
  assert.equal(root.children[0], base); assert.equal(base.material, baseMaterial); assert.equal(token!.material, tokenMaterial);
  const version = solid.instanceMatrix.version;
  setWheatClearance(root, mask);
  assert.equal(solid.instanceMatrix.version, version, 'same effective border does not re-upload instances');
  setWheatClearance(root, grainPreviewMask(hex, MODELED_WHEAT, null, null));
  assert.equal(solid.count, 15); assert.equal(faded.visible, false); assert.equal(faded.count, 0);
  assert.deepEqual(solid.instanceMatrix.array, originalMatrices);
  assert.equal(inspectTerrainArt(root).fadedStems, 0);
  disposeArtInstances(root); assets.dispose();
});
