import { createIslandBoard } from './geometry.ts';
import { createSetupView } from './presentation.ts';
import type { BoardSetup, HexSetup } from './setup.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';
const names: Record<HexSetup['terrain'], string> = { forest: 'Forest', hills: 'Hills', pasture: 'Pasture', fields: 'Fields', mountains: 'Mountains', desert: 'Desert' };

export function renderIslandBoard(container: HTMLElement, setup: BoardSetup): void {
  const view = createSetupView(createIslandBoard(), setup);
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', view.viewBox);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('island-board');
  const details = document.createElement('ul');
  details.className = 'sr-only';
  details.setAttribute('aria-label', 'Island terrain and number tokens');
  for (const hex of view.hexes) {
    const description = `${names[hex.terrain]}, ${hex.resource ?? 'no resource'}, ${hex.token === null ? 'no number' : `number ${hex.token}`}${hex.robber ? ', robber' : ''}, ${hex.id}`;
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
      circle.setAttribute('cx', String(hex.center.x)); circle.setAttribute('cy', String(hex.center.y + .4)); circle.setAttribute('r', '.29'); circle.setAttribute('class', 'island-token');
      group.append(circle);
      text(String(hex.token), .4, `island-number${hex.token === 6 || hex.token === 8 ? ' island-number-red' : ''}`);
    } else if (hex.robber) text('Robber', .4, 'island-label');
    svg.append(group);
  }
  container.replaceChildren(svg, details);
}
