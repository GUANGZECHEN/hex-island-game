import { createIslandBoard } from './geometry.ts';
import { createSetupView } from './presentation.ts';
import type { BoardSetup, HexSetup } from './setup.ts';
import { desertIcon, resourceIcon } from '../ui/icons.ts';
import type { Resource } from '../rules/state.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';
const names: Record<HexSetup['terrain'], string> = { forest: 'Forest', hills: 'Hills', pasture: 'Pasture', fields: 'Fields', mountains: 'Mountains', desert: 'Desert' };
const terrainFallback:Record<HexSetup['terrain'],string>={forest:'#3f7954',hills:'#c66f4d',pasture:'#87b96b',fields:'#d9ae4a',mountains:'#727e8a',desert:'#d8be83'};
let boardRenderSequence=0;

function node(tag:string,attributes:Record<string,string>={}):SVGElement {
  const element=document.createElementNS(SVG_NS,tag) as SVGElement;
  for(const [key,value] of Object.entries(attributes))element.setAttribute(key,value);
  return element;
}
function path(parent:SVGElement,d:string,className:string){
  const shape=node('path',{d,class:className});parent.append(shape);return shape;
}
function line(parent:SVGElement,x1:number,y1:number,x2:number,y2:number,className:string){
  const shape=node('line',{x1:String(x1),y1:String(y1),x2:String(x2),y2:String(y2),class:className});parent.append(shape);return shape;
}
function gradient(defs:SVGElement,id:string,stops:readonly (readonly [string,string])[],radial=false){
  const g=node(radial?'radialGradient':'linearGradient',{id});
  if(!radial){g.setAttribute('x1','0');g.setAttribute('y1','0');g.setAttribute('x2','0');g.setAttribute('y2','1');}
  for(const [offset,color] of stops)g.append(node('stop',{offset,'stop-color':color}));
  defs.append(g);
}
function appendBoardDefs(svg:SVGElement,prefix:string){
  const defs=node('defs');
  gradient(defs,`${prefix}-board-ocean-gradient`,[['0%','#8fc3c3'],['52%','#6da9ad'],['100%','#4f8f98']]);
  gradient(defs,`${prefix}-terrain-forest`,[['0%','#5c9366'],['58%','#3f7954'],['100%','#2e6246']]);
  gradient(defs,`${prefix}-terrain-hills`,[['0%','#e4a07b'],['55%','#c66f4d'],['100%','#95533f']]);
  gradient(defs,`${prefix}-terrain-pasture`,[['0%','#abd28a'],['60%','#87b96b'],['100%','#659c58']]);
  gradient(defs,`${prefix}-terrain-fields`,[['0%','#edd273'],['55%','#d9ae4a'],['100%','#bd8f31']]);
  gradient(defs,`${prefix}-terrain-mountains`,[['0%','#aeb7c0'],['52%','#7b8792'],['100%','#59636d']]);
  gradient(defs,`${prefix}-terrain-desert`,[['0%','#ead9a7'],['55%','#d8be83'],['100%','#c8a66a']]);
  const pattern=node('pattern',{id:`${prefix}-board-ocean-waves`,width:'1.35',height:'.72',patternUnits:'userSpaceOnUse'});
  path(pattern,'M-.2 .31 C.12 .08 .48 .08 .8 .31 S1.48 .54 1.72 .31','board-ocean-wave-path');
  path(pattern,'M.18 .61 C.42 .44 .72 .44 .96 .61','board-ocean-wave-path board-ocean-wave-faint');
  defs.append(pattern);svg.append(defs);
}
function appendTerrainArt(group:SVGElement,terrain:HexSetup['terrain'],cx:number,cy:number){
  const art=node('g',{class:`terrain-art terrain-art-${terrain}`,'data-terrain-art':terrain});
  if(terrain==='forest'){
    path(art,`M${cx-.62} ${cy+.14}l.18-.34.18.34h-.11l.15.25h-.36l.15-.25Zm.45.04.24-.46.24.46h-.14l.18.3h-.48l.18-.3Zm.5-.04.2-.38.2.38h-.12l.16.27h-.4l.16-.27Z`,'terrain-art-primary');
    line(art,cx-.44,cy+.13,cx-.44,cy+.34,'terrain-art-detail');line(art,cx-.04,cy+.16,cx-.04,cy+.39,'terrain-art-detail');line(art,cx+.38,cy+.13,cx+.38,cy+.33,'terrain-art-detail');
  }else if(terrain==='hills'){
    // Exposed red-clay quarry: stepped cuts plus a few stacked bricks make the brick source legible at a glance.
    path(art,`M${cx-.72} ${cy+.31}L${cx-.52} ${cy+.07}L${cx-.18} ${cy-.03}L${cx+.02} ${cy+.08}L${cx+.34} ${cy-.02}L${cx+.72} ${cy+.28}`,'terrain-art-clay-face');
    path(art,`M${cx-.66} ${cy+.15}L${cx-.34} ${cy+.10}L${cx-.12} ${cy+.18}L${cx+.16} ${cy+.12}L${cx+.48} ${cy+.17}`,'terrain-art-quarry-cut');
    path(art,`M${cx-.58} ${cy+.31}L${cx-.29} ${cy+.24}L${cx+.02} ${cy+.31}L${cx+.34} ${cy+.24}L${cx+.61} ${cy+.31}`,'terrain-art-secondary');
    for(const [bx,by] of [[cx+.22,cy-.05],[cx+.39,cy-.01],[cx+.30,cy+.07]]){
      art.append(node('rect',{x:String(bx-.07),y:String(by-.035),width:'.14',height:'.07',rx:'.012',class:'terrain-art-brick'}));
    }
  }else if(terrain==='pasture'){
    path(art,`M${cx-.72} ${cy+.18}Q${cx-.38} ${cy-.08} ${cx-.02} ${cy+.18}T${cx+.72} ${cy+.18}`,'terrain-art-primary');
    path(art,`M${cx-.65} ${cy+.35}Q${cx-.2} ${cy+.13} ${cx+.18} ${cy+.35}Q${cx+.43} ${cy+.19} ${cx+.67} ${cy+.34}`,'terrain-art-secondary');
    path(art,`M${cx-.43} ${cy+.12}l-.05-.12m.05.12.06-.11M${cx+.4} ${cy+.2}l-.04-.12m.04.12.07-.1`,'terrain-art-detail');
  }else if(terrain==='fields'){
    for(const dx of [-.48,-.24,0,.24,.48]){
      line(art,cx+dx,cy+.34,cx+dx,cy-.18,'terrain-art-detail');
      path(art,`M${cx+dx} ${cy-.08}l-.10-.10m.10.2.11-.11M${cx+dx} ${cy+.08}l-.11-.09m.11.2.1-.1`,'terrain-art-primary');
    }
    path(art,`M${cx-.62} ${cy+.36}Q${cx} ${cy+.18} ${cx+.62} ${cy+.36}`,'terrain-art-secondary');
  }else if(terrain==='mountains'){
    // Angular quarry faces and loose boulders read as an ore/stone source rather than a generic alpine mountain.
    path(art,`M${cx-.72} ${cy+.34}L${cx-.45} ${cy-.02}L${cx-.20} ${cy+.08}L${cx+.08} ${cy-.12}L${cx+.34} ${cy+.02}L${cx+.70} ${cy+.34}Z`,'terrain-art-rock-fill');
    path(art,`M${cx-.45} ${cy-.02}L${cx-.22} ${cy+.22}L${cx+.08} ${cy-.12}L${cx+.17} ${cy+.19}L${cx+.34} ${cy+.02}`,'terrain-art-rock-facet');
    path(art,`M${cx-.60} ${cy+.22}L${cx-.29} ${cy+.15}L${cx-.08} ${cy+.24}L${cx+.17} ${cy+.17}L${cx+.48} ${cy+.23}`,'terrain-art-quarry-bench');
    for(const [rx,ry,rr] of [[cx-.46,cy+.30,.055],[cx-.31,cy+.34,.038],[cx+.43,cy+.29,.050],[cx+.55,cy+.34,.032]]){
      art.append(node('circle',{cx:String(rx),cy:String(ry),r:String(rr),class:'terrain-art-rubble'}));
    }
  }else{
    path(art,`M${cx-.72} ${cy+.2}Q${cx-.36} ${cy-.03} ${cx+.02} ${cy+.2}Q${cx+.34} ${cy+.02} ${cx+.7} ${cy+.21}`,'terrain-art-primary');
    path(art,`M${cx-.58} ${cy+.37}Q${cx-.18} ${cy+.18} ${cx+.12} ${cy+.37}Q${cx+.4} ${cy+.2} ${cx+.62} ${cy+.36}`,'terrain-art-secondary');
    art.append(node('circle',{cx:String(cx+.5),cy:String(cy-.3),r:'.08',class:'terrain-art-sun'}));
  }
  group.append(art);
}
function pipCount(token:number){return token===2||token===12?1:token===3||token===11?2:token===4||token===10?3:token===5||token===9?4:5;}
function appendNumberToken(group:SVGElement,cx:number,cy:number,token:number){
  const high=token===6||token===8,centerY=cy+.39;
  group.append(node('circle',{cx:String(cx),cy:String(centerY+.035),r:'.31',class:'island-token-shadow'}));
  group.append(node('circle',{cx:String(cx),cy:String(centerY),r:'.30',class:`island-token${high?' island-token-high':''}`}));
  group.append(node('circle',{cx:String(cx),cy:String(centerY),r:'.255',class:`island-token-rim${high?' island-token-rim-high':''}`}));
  const label=node('text',{x:String(cx),y:String(centerY-.045),'text-anchor':'middle','dominant-baseline':'central',class:`island-number${high?' island-number-red':''}`});
  label.textContent=String(token);group.append(label);
  const count=pipCount(token),spacing=.065,start=cx-((count-1)*spacing)/2;
  for(let i=0;i<count;i++)group.append(node('circle',{cx:String(start+i*spacing),cy:String(centerY+.155),r:'.018',class:`island-token-pip${high?' island-token-pip-high':''}`}));
}
function appendRobber(group:SVGElement,cx:number,cy:number){
  const y=cy+.39,marker=node('g',{class:'robber-marker','data-robber-marker':'true','aria-label':'Robber blocks production on this tile'});
  marker.append(node('circle',{cx:String(cx),cy:String(y+.035),r:'.34',class:'robber-token-shadow'}));
  marker.append(node('circle',{cx:String(cx),cy:String(y),r:'.32',class:'robber-marker-circle'}));
  marker.append(node('circle',{cx:String(cx),cy:String(y),r:'.245',class:'robber-marker-ring'}));
  line(marker,cx-.18,y-.18,cx+.18,y+.18,'robber-marker-slash');
  path(marker,`M${cx-.15} ${y-.18}Q${cx} ${y-.27} ${cx+.15} ${y-.18}`,'robber-marker-highlight');
  group.append(marker);
}

export function renderIslandBoard(container: HTMLElement, setup: BoardSetup): void {
  const view = createSetupView(createIslandBoard(setup.layout), setup);
  const svg = document.createElementNS(SVG_NS, 'svg');
  const [x, y, width, height] = view.viewBox.split(' ').map(Number);
  const vx=x-1.05,vy=y-1.05,vw=width+2.1,vh=height+2.1;
  svg.setAttribute('viewBox', `${vx} ${vy} ${vw} ${vh}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('island-board');
  const defsPrefix=`hex-board-${++boardRenderSequence}`;
  appendBoardDefs(svg,defsPrefix);
  svg.append(node('rect',{x:String(vx),y:String(vy),width:String(vw),height:String(vh),rx:'.42',class:'board-ocean',fill:'#6da9ad',style:`fill:url(#${defsPrefix}-board-ocean-gradient) #6da9ad`}));
  svg.append(node('rect',{x:String(vx),y:String(vy),width:String(vw),height:String(vh),rx:'.42',class:'board-ocean-waves',fill:'none',style:`fill:url(#${defsPrefix}-board-ocean-waves) transparent`}));

  const details = document.createElement('ul');
  details.className = 'sr-only';
  details.setAttribute('aria-label', 'Island terrain and number tokens');

  for (const hex of view.hexes) {
    const description = `${names[hex.terrain]}, ${hex.resource ?? 'no resource'}, ${hex.token === null ? 'no number' : `number ${hex.token}${hex.token === 6 || hex.token === 8 ? ', high probability' : ''}`}${hex.robber ? ', robber' : ''}, ${hex.id}`;
    const item = document.createElement('li');item.textContent = description;details.append(item);

    const group = node('g',{'data-hex-id':hex.id,'data-terrain':hex.terrain,'data-resource':hex.resource ?? 'none','data-token':String(hex.token ?? 'none'),'data-robber':String(hex.robber),class:`island-hex${hex.robber?' robber-occupied':''}`});
    const title = document.createElementNS(SVG_NS, 'title');title.textContent = description;group.append(title);
    const points=hex.points.map(point => `${point.x},${point.y}`).join(' ');
    group.append(node('polygon',{points,class:'island-cell-shadow'}));
    group.append(node('polygon',{points,class:`island-cell island-cell-${hex.terrain}`,fill:terrainFallback[hex.terrain],style:`fill:url(#${defsPrefix}-terrain-${hex.terrain}) ${terrainFallback[hex.terrain]}`}));
    const inset=node('polygon',{points,class:'island-cell-inset',transform:`translate(${hex.center.x} ${hex.center.y}) scale(.94) translate(${-hex.center.x} ${-hex.center.y})`});group.append(inset);
    appendTerrainArt(group,hex.terrain,hex.center.x,hex.center.y);

    if (hex.terrain === 'desert') {
      const symbol=desertIcon();symbol.setAttribute('x',String(hex.center.x-.25));symbol.setAttribute('y',String(hex.center.y-.50));symbol.setAttribute('width','.50');symbol.setAttribute('height','.50');group.append(symbol);
    }
    if (hex.resource) {
      const symbol=resourceIcon(hex.resource);symbol.setAttribute('x',String(hex.center.x-.21));symbol.setAttribute('y',String(hex.center.y-.51));symbol.setAttribute('width','.42');symbol.setAttribute('height','.42');symbol.setAttribute('class',`tile-resource resource-${hex.resource}`);group.append(symbol);
    }
    if (hex.token !== null) appendNumberToken(group,hex.center.x,hex.center.y,hex.token);
    if (hex.robber) appendRobber(group,hex.center.x,hex.center.y);
    svg.append(group);
  }

  const vertices = new Map(view.vertices.map(vertex => [vertex.id, vertex.point]));
  const islandCenter={x:view.hexes.reduce((sum,hex)=>sum+hex.center.x,0)/view.hexes.length,y:view.hexes.reduce((sum,hex)=>sum+hex.center.y,0)/view.hexes.length};
  const ports = document.createElement('ul');ports.className = 'sr-only';ports.setAttribute('aria-label', 'Coastal ports');

  for (const port of setup.ports) {
    const a = vertices.get(port.vertexIds[0])!, b = vertices.get(port.vertexIds[1])!,mid={x:(a.x+b.x)/2,y:(a.y+b.y)/2};
    const dx=mid.x-islandCenter.x,dy=mid.y-islandCenter.y,length=Math.hypot(dx,dy),ux=dx/length,uy=dy/length;
    // Push the dock farther offshore and bias it slightly along the coast so its two direct pier legs breathe and differ naturally in length.
    const tx=-uy,ty=ux,dockDistance=.78,dockBias=.055;
    const px=mid.x+ux*dockDistance+tx*dockBias,py=mid.y+uy*dockDistance+ty*dockBias;
    const angle=Math.atan2(ty,tx)*180/Math.PI,dockAttachHalf=.43,dockAttachInset=.305;
    const leftDock={x:px-tx*dockAttachHalf-ux*dockAttachInset,y:py-ty*dockAttachHalf-uy*dockAttachInset};
    const rightDock={x:px+tx*dockAttachHalf-ux*dockAttachInset,y:py+ty*dockAttachHalf-uy*dockAttachInset};
    const aAlong=(a.x-mid.x)*tx+(a.y-mid.y)*ty,bAlong=(b.x-mid.x)*tx+(b.y-mid.y)*ty;
    const aDock=aAlong<=bAlong?leftDock:rightDock,bDock=aAlong<=bAlong?rightDock:leftDock;
    const group=node('g',{'data-port-edge':port.edgeId,'data-port-type':port.type,class:`port-piece port-${port.type}`});
    const portTitle=document.createElementNS(SVG_NS,'title');portTitle.textContent=port.type==='generic'?'Any resource 3:1 port':`${port.type} 2:1 port`;group.append(portTitle);

    // Each coastal vertex gets its own pier leg, attached near a different end of the dock.
    line(group,a.x,a.y,aDock.x,aDock.y,'port-pier-leg port-pier-a');
    line(group,b.x,b.y,bDock.x,bDock.y,'port-pier-leg port-pier-b');

    const dock=node('g',{class:'port-dock',transform:`translate(${px} ${py}) rotate(${angle})`});
    dock.append(node('rect',{x:'-.48',y:'-.32',width:'.96',height:'.64',rx:'.11',class:'port-dock-shadow',transform:'translate(0 .04)'}));
    dock.append(node('rect',{x:'-.48',y:'-.32',width:'.96',height:'.64',rx:'.11',class:'port-dock-board'}));
    for(const x of [-.31,-.10,.10,.31])line(dock,x,-.27,x,.27,'port-dock-plank');
    dock.append(node('circle',{cx:'-.39',cy:'-.24',r:'.035',class:'port-bollard'}),node('circle',{cx:'.39',cy:'-.24',r:'.035',class:'port-bollard'}));
    group.append(dock);

    // Keep trade information upright even when the dock rotates around the coast.
    const face=node('g',{class:'port-face',transform:`translate(${px} ${py})`});
    const label=node('text',{x:'0','text-anchor':'middle','dominant-baseline':'central',class:'port-label'});
    if(port.type==='generic'){
      path(face,'M0 -.21v.27m-.14-.11q.14.18.28 0M-.19-.05h.38','port-anchor-icon');
      label.setAttribute('y','.20');label.textContent='3:1';face.append(label);
    }else{
      const symbol=resourceIcon(port.type as Resource);symbol.setAttribute('x','-.17');symbol.setAttribute('y','-.28');symbol.setAttribute('width','.34');symbol.setAttribute('height','.34');symbol.setAttribute('class',`port-resource-icon resource-${port.type}`);face.append(symbol);
      label.setAttribute('y','.21');label.textContent='2:1';face.append(label);
    }
    group.append(face);

    // One tiny boat silhouette gives desktop ports a coastal landmark; hidden on phones.
    const boatX=px+ux*.40,boatY=py+uy*.40,boat=node('g',{class:'port-boat-decor',transform:`translate(${boatX} ${boatY}) rotate(${angle})`});
    path(boat,'M-.16 .04h.32l-.06.09h-.2Z','port-boat-hull');line(boat,0,.04,0,-.13,'port-boat-mast');path(boat,'M.01-.12v.12h.11Z','port-boat-sail');group.append(boat);

    svg.append(group);
    const item=document.createElement('li');item.textContent=port.type==='generic'?`Any resource 3:1 port at ${port.vertexIds.join(' and ')}`:`${port.type} 2:1 port at ${port.vertexIds.join(' and ')}`;ports.append(item);
  }
  container.replaceChildren(svg, details, ports);
}
