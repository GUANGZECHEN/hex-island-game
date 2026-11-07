import { createIslandBoard } from './geometry.ts';
import { createSetupView } from './presentation.ts';
import type { BoardSetup, HexSetup } from './setup.ts';
import { resourceIcon } from '../ui/icons.ts';
import type { Resource } from '../rules/state.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';
const names: Record<HexSetup['terrain'], string> = { forest: 'Forest', hills: 'Hills', pasture: 'Pasture', fields: 'Fields', mountains: 'Mountains', desert: 'Desert' };

export function renderIslandBoard(container: HTMLElement, setup: BoardSetup): void {
  const view = createSetupView(createIslandBoard(), setup);
  const svg = document.createElementNS(SVG_NS, 'svg');
  const [x, y, width, height] = view.viewBox.split(' ').map(Number);
  svg.setAttribute('viewBox', `${x - 1.05} ${y - 1.05} ${width + 2.1} ${height + 2.1}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('island-board');
  const details = document.createElement('ul');
  details.className = 'sr-only';
  details.setAttribute('aria-label', 'Island terrain and number tokens');
  for (const hex of view.hexes) {
    const description = `${names[hex.terrain]}, ${hex.resource ?? 'no resource'}, ${hex.token === null ? 'no number' : `number ${hex.token}${hex.token === 6 || hex.token === 8 ? ', high probability' : ''}`}${hex.robber ? ', robber' : ''}, ${hex.id}`;
    const item = document.createElement('li'); item.textContent = description; details.append(item);
    const group = document.createElementNS(SVG_NS, 'g');
    group.setAttribute('data-hex-id', hex.id);group.setAttribute('data-terrain', hex.terrain);group.setAttribute('data-resource', hex.resource ?? 'none');group.setAttribute('data-token', String(hex.token ?? 'none'));group.setAttribute('data-robber', String(hex.robber));
    const title = document.createElementNS(SVG_NS, 'title'); title.textContent = description;
    const polygon = document.createElementNS(SVG_NS, 'polygon');polygon.setAttribute('points', hex.points.map(point => `${point.x},${point.y}`).join(' '));polygon.setAttribute('class', `island-cell island-cell-${hex.terrain}`);group.append(title, polygon);
    const text = (value: string, dy: number, className: string) => {const label = document.createElementNS(SVG_NS, 'text');label.setAttribute('x', String(hex.center.x)); label.setAttribute('y', String(hex.center.y + dy));label.setAttribute('text-anchor', 'middle'); label.setAttribute('dominant-baseline', 'central');label.setAttribute('class', className); label.textContent = value; group.append(label);};
    if (hex.terrain === 'desert') text('Desert', -.2, 'island-label');
    if (hex.resource) {const symbol=resourceIcon(hex.resource);symbol.setAttribute('x',String(hex.center.x-.26));symbol.setAttribute('y',String(hex.center.y-.4));symbol.setAttribute('width','.52');symbol.setAttribute('height','.52');symbol.setAttribute('class',`tile-resource resource-${hex.resource}`);group.append(symbol);}
    if (hex.token !== null) {const circle = document.createElementNS(SVG_NS, 'circle');circle.setAttribute('cx', String(hex.center.x)); circle.setAttribute('cy', String(hex.center.y + .4)); circle.setAttribute('r', '.29'); circle.setAttribute('class', `island-token${hex.token === 6 || hex.token === 8 ? ' island-token-high' : ''}`);group.append(circle);text(String(hex.token), .4, `island-number${hex.token === 6 || hex.token === 8 ? ' island-number-red' : ''}`);}
    if (hex.robber) text('Robber', hex.token === null ? .42 : .83, 'robber-label');
    svg.append(group);
  }
  const vertices = new Map(view.vertices.map(vertex => [vertex.id, vertex.point]));
  const ports = document.createElement('ul');ports.className = 'sr-only'; ports.setAttribute('aria-label', 'Coastal ports');
  for (const port of setup.ports) {
    const a = vertices.get(port.vertexIds[0])!, b = vertices.get(port.vertexIds[1])!;const mid = {x:(a.x+b.x)/2, y:(a.y+b.y)/2};const length = Math.hypot(mid.x, mid.y);const ux=mid.x/length,uy=mid.y/length;const px = mid.x + ux * .72, py = mid.y + uy * .72;const endpoint={x:px-ux*.36,y:py-uy*.36};
    const group = document.createElementNS(SVG_NS, 'g');group.setAttribute('data-port-edge', port.edgeId);group.setAttribute('data-port-type',port.type);
    const portTitle=document.createElementNS(SVG_NS,'title');portTitle.textContent=port.type==='generic'?'Any resource 3:1 port':`${port.type} 2:1 port`;group.append(portTitle);
    for(const start of [a,b]){const line=document.createElementNS(SVG_NS,'line');line.setAttribute('x1',String(start.x));line.setAttribute('y1',String(start.y));line.setAttribute('x2',String(endpoint.x));line.setAttribute('y2',String(endpoint.y));line.setAttribute('class','port-connector');group.append(line);}
    const badge = document.createElementNS(SVG_NS, 'circle');badge.setAttribute('cx', String(px)); badge.setAttribute('cy', String(py)); badge.setAttribute('r', '.43'); badge.setAttribute('class', 'port-badge');group.append(badge);
    const label = document.createElementNS(SVG_NS, 'text');label.setAttribute('x', String(px)); label.setAttribute('text-anchor', 'middle'); label.setAttribute('dominant-baseline', 'central'); label.setAttribute('class', 'port-label');
    if(port.type==='generic'){label.setAttribute('y', String(py));label.textContent='3:1';group.append(label);}
    else{const symbol=resourceIcon(port.type as Resource);symbol.setAttribute('x',String(px-.16));symbol.setAttribute('y',String(py-.28));symbol.setAttribute('width','.32');symbol.setAttribute('height','.32');symbol.setAttribute('class',`port-resource-icon resource-${port.type}`);group.append(symbol);label.setAttribute('y', String(py+.19));label.textContent='2:1';group.append(label);}
    svg.append(group);const item = document.createElement('li'); item.textContent = port.type === 'generic' ? `Any resource 3:1 port at ${port.vertexIds.join(' and ')}` : `${port.type} 2:1 port at ${port.vertexIds.join(' and ')}`; ports.append(item);
  }
  container.replaceChildren(svg, details, ports);
}
