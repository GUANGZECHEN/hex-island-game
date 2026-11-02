import { createIslandBoard } from './geometry.ts';
import { createSetupView } from './presentation.ts';
import type { BoardSetup, HexSetup } from './setup.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';
const names: Record<HexSetup['terrain'], string> = { forest: 'Forest', hills: 'Hills', pasture: 'Pasture', fields: 'Fields', mountains: 'Mountains', desert: 'Desert' };

export function renderIslandBoard(container: HTMLElement, setup: BoardSetup): void {
  const view = createSetupView(createIslandBoard(), setup);
  const svg = document.createElementNS(SVG_NS, 'svg');
  const [x, y, width, height] = view.viewBox.split(' ').map(Number);
  svg.setAttribute('viewBox', `${x - .8} ${y - .8} ${width + 1.6} ${height + 1.6}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('island-board');
  const details = document.createElement('ul');
  details.className = 'sr-only';
  details.setAttribute('aria-label', 'Island terrain and number tokens');
  for (const hex of view.hexes) {
    const description = `${names[hex.terrain]}, ${hex.resource ?? 'no resource'}, ${hex.token === null ? 'no number' : `number ${hex.token}${hex.token === 6 || hex.token === 8 ? ', high probability' : ''}`}${hex.robber ? ', robber' : ''}, ${hex.id}`;
    const item = document.createElement('li');
    item.textContent = description;
    details.append(item);
    const group = document.createElementNS(SVG_NS, 'g');
    group.setAttribute('data-hex-id', hex.id);
    group.setAttribute('data-terrain', hex.terrain);
    group.setAttribute('data-resource', hex.resource ?? 'none');
    group.setAttribute('data-token', String(hex.token ?? 'none'));
    group.setAttribute('data-robber', String(hex.robber));
    const title = document.createElementNS(SVG_NS, 'title');
    title.textContent = description;
    const polygon = document.createElementNS(SVG_NS, 'polygon');
    polygon.setAttribute('points', hex.points.map(point => `${point.x},${point.y}`).join(' '));
    polygon.setAttribute('class', `island-cell island-cell-${hex.terrain}`);
    group.append(title, polygon);
    const text = (value: string, y: number, className: string) => {
      const label = document.createElementNS(SVG_NS, 'text');
      label.setAttribute('x', String(hex.center.x)); label.setAttribute('y', String(hex.center.y + y));
      label.setAttribute('text-anchor', 'middle'); label.setAttribute('dominant-baseline', 'central');
      label.setAttribute('class', className); label.textContent = value; group.append(label);
    };
    text(hex.terrain === 'mountains' ? 'Mtns' : names[hex.terrain], -.45, 'island-label');
    text(hex.resource ?? 'None', -.10, 'island-resource');
    if (hex.token !== null) {
      const circle = document.createElementNS(SVG_NS, 'circle');
      circle.setAttribute('cx', String(hex.center.x)); circle.setAttribute('cy', String(hex.center.y + .4)); circle.setAttribute('r', '.29'); circle.setAttribute('class', `island-token${hex.token === 6 || hex.token === 8 ? ' island-token-high' : ''}`);
      group.append(circle);
      text(String(hex.token), .4, `island-number${hex.token === 6 || hex.token === 8 ? ' island-number-red' : ''}`);
    }
    if (hex.robber) text('Robber', hex.token === null ? .4 : .83, 'robber-label');
    svg.append(group);
  }
  const vertices = new Map(view.vertices.map(vertex => [vertex.id, vertex.point]));
  const ports = document.createElement('ul');
  ports.className = 'sr-only'; ports.setAttribute('aria-label', 'Coastal ports');
  for (const port of setup.ports) {
    const a = vertices.get(port.vertexIds[0])!, b = vertices.get(port.vertexIds[1])!;
    const mid = {x:(a.x+b.x)/2, y:(a.y+b.y)/2};
    const length = Math.hypot(mid.x, mid.y);
    const px = mid.x + mid.x / length * .5, py = mid.y + mid.y / length * .5;
    const badge = document.createElementNS(SVG_NS, 'circle');
    badge.setAttribute('cx', String(px)); badge.setAttribute('cy', String(py)); badge.setAttribute('r', '.34'); badge.setAttribute('class', 'port-badge');
    const label = document.createElementNS(SVG_NS, 'text');
    label.setAttribute('x', String(px)); label.setAttribute('y', String(py)); label.setAttribute('text-anchor', 'middle'); label.setAttribute('dominant-baseline', 'central'); label.setAttribute('class', 'port-label');
    label.textContent = port.type === 'generic' ? '3:1' : `${port.type[0].toUpperCase()} 2:1`;
    const group = document.createElementNS(SVG_NS, 'g'); group.setAttribute('data-port-edge', port.edgeId); group.append(badge, label); svg.append(group);
    const item = document.createElement('li'); item.textContent = `${port.type === 'generic' ? 'Any resource 3:1' : `${port.type} 2:1`} port at ${port.vertexIds.join(' and ')}`; ports.append(item);
  }
  container.replaceChildren(svg, details, ports);
}
