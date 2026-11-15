import * as THREE from 'three';
import type { ArtAssets } from './art.ts';

export const CITY_MODEL_REVISION = 'city-townhall-v1';

/** A compact upgrade of the existing house: one gabled hall and two low roofed wings.
 * Local origin and ground contact match the settlement. All GPU resources belong to ArtAssets.
 * No labels, player state, entropy or camera changes are needed to build this presentation.
 */
export function makeCityModel(assets: ArtAssets, color: string): THREE.Group {
  const root = new THREE.Group();
  root.userData = { kind: 'city', artRevision: CITY_MODEL_REVISION };
  const tint = (target: string, amount: number) => '#' + new THREE.Color(color).lerp(new THREE.Color(target), amount).getHexString();
  const roofColor = tint('#202d35', .30), foundationColor = tint('#35403a', .22), trimColor = tint('#fff3d7', .40);
  const box = (name: string, paint: string, size: [number, number, number], x: number, y: number, z: number) => {
    const part = assets.box(root, paint, size, x, y, z); part.name = name; return part;
  };
  box('city-foundation', foundationColor, [.490, .040, .380], 0, .150, 0);
  box('city-hall', color, [.278, .282, .290], 0, .311, 0);

  // The extrusion's end faces are player-colored gables; its sides form the darker pitched roof.
  const roof = assets.geometry('city-townhall-gable-v1', () => {
    const section = new THREE.Shape();
    section.moveTo(-.156, -.012); section.lineTo(.156, -.012); section.lineTo(.156, 0);
    section.lineTo(0, .182); section.lineTo(-.156, 0); section.closePath();
    const geometry = new THREE.ExtrudeGeometry(section, { depth: .350, bevelEnabled: false, steps: 1, curveSegments: 1 });
    geometry.translate(0, 0, -.175); return geometry;
  });
  assets.mesh(root, roof, [assets.material(color), assets.material(roofColor)], 0, .452, 0).name = 'city-main-roof';
  box('city-ridge', roofColor, [.016, .014, .360], 0, .634, 0);
  const slope = Math.atan2(.182, .156), railLength = Math.hypot(.182, .156);
  for (const z of [-.178, .178]) for (const side of [-1, 1]) {
    const rail = box(`city-gable-trim:${side}:${z}`, trimColor, [railLength, .012, .012], side * .078, .543, z);
    rail.rotation.z = -side * slope;
  }
  const towerRoof = assets.geometry('city-low-tower-roof-v1', () => {
    const geometry = new THREE.ConeGeometry(.103, .105, 4); geometry.rotateY(Math.PI / 4); return geometry;
  });
  for (const side of [-1, 1]) {
    const x = side * .167;
    box(`city-wing:${side}`, color, [.125, .232, .230], x, .286, .012);
    box(`city-wing-cornice:${side}`, trimColor, [.143, .018, .242], x, .410, .012);
    const cap = assets.mesh(root, towerRoof, assets.material(roofColor), x, .4715, .012);
    cap.name = `city-wing-roof:${side}`;
    box(`city-window-recess:${side}`, foundationColor, [.045, .066, .008], x, .307, .131);
    box(`city-window:${side}`, '#f4ebd2', [.029, .047, .010], x, .309, .137);
  }
  const arch = (key: string, width: number, height: number) => assets.geometry(key, () => {
    const shape = new THREE.Shape();
    shape.moveTo(-width / 2, 0); shape.lineTo(width / 2, 0); shape.lineTo(width / 2, height - width / 2);
    shape.absarc(0, height - width / 2, width / 2, 0, Math.PI, false); shape.closePath();
    return new THREE.ExtrudeGeometry(shape, { depth: .007, bevelEnabled: false, steps: 1, curveSegments: 5 });
  });
  assets.mesh(root, arch('city-arch-frame-v1', .076, .130), assets.material(trimColor), 0, .174, .148).name = 'city-door-frame';
  assets.mesh(root, arch('city-arch-door-v1', .053, .108), assets.material('#574a3b'), 0, .174, .157).name = 'city-door';
  box('city-entry-step', trimColor, [.094, .016, .060], 0, .170, .177);
  box('city-gable-window-frame', foundationColor, [.051, .051, .009], 0, .516, .179).rotation.z = Math.PI / 4;
  box('city-gable-window', '#f4ebd2', [.032, .032, .011], 0, .516, .186).rotation.z = Math.PI / 4;
  return root;
}
