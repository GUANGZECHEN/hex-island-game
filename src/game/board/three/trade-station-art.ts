import * as THREE from 'three';
import type { ArtAssets } from './art.ts';
/** Compact communal market stall. All meshes reuse resources owned by ArtAssets. */
export function makeTradeStation(assets:ArtAssets):THREE.Group {
 const root=new THREE.Group();root.name='trade-station';
 assets.box(root,'#826047',[.34,.055,.25],0,.17,0);
 assets.box(root,'#d2ac73',[.28,.14,.19],0,.25,0);
 for(const x of [-.13,.13])for(const z of [-.08,.08])assets.box(root,'#765238',[.025,.22,.025],x,.32,z);
 assets.box(root,'#26998d',[.38,.05,.29],0,.43,0);
 for(const x of [-.12,0,.12])assets.box(root,'#fff0ca',[.045,.012,.292],x,.462,0);
 assets.box(root,'#ce9a55',[.085,.06,.065],-.065,.345,.015);
 assets.box(root,'#deb87a',[.085,.06,.065],.065,.345,.015);
 return root;
}
