import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const path='src/game/board/three/art.ts';
let source=await readFile(path,'utf8');
assert.ok(!source.includes('makeCityModel'), 'City integration must be applied exactly once.');
const old=`export function makeBuilding(assets: ArtAssets, kind: 'settlement' | 'city', color: string): THREE.Group {
  const g = new THREE.Group(); g.userData.kind = kind;
  assets.box(g, color, kind === 'city' ? [.43, .27, .34] : [.27, .25, .29], 0, .265, 0);
  const roof = assets.geometry('house-roof', () => { const geo = new THREE.ConeGeometry(.245, .20, 4); geo.rotateY(Math.PI / 4); return geo; });
  assets.mesh(g, roof, assets.material(color), kind === 'city' ? -.12 : 0, .47, 0);
  if (kind === 'city') { assets.box(g, color, [.20, .47, .25], .16, .37, .04); assets.box(g, color, [.25, .065, .30], .16, .63, .04); }
  assets.box(g, '#f4ebd2', [.065, .09, .01], -.06, .285, .151);
  assets.box(g, '#574a3b', [.068, .14, .012], .065, .22, .153);
  return g;
}`;
const next=`export function makeBuilding(assets: ArtAssets, kind: 'settlement' | 'city', color: string): THREE.Group {
  if (kind === 'city') return makeCityModel(assets, color);
  const g = new THREE.Group(); g.userData.kind = kind;
  assets.box(g, color, [.27, .25, .29], 0, .265, 0);
  const roof = assets.geometry('house-roof', () => { const geo = new THREE.ConeGeometry(.245, .20, 4); geo.rotateY(Math.PI / 4); return geo; });
  assets.mesh(g, roof, assets.material(color), 0, .47, 0);
  assets.box(g, '#f4ebd2', [.065, .09, .01], -.06, .285, .151);
  assets.box(g, '#574a3b', [.068, .14, .012], .065, .22, .153);
  return g;
}`;
assert.equal(source.split(old).length,2,'Expected unchanged building factory.');
source=source.replace(old,next).replace("import * as THREE from 'three';","import * as THREE from 'three';\nimport { makeCityModel } from './city-model.ts';");
await writeFile(path,source);
