import { createIslandBoard } from './geometry';
import { createBoardView } from './presentation';
const SVG_NS='http://www.w3.org/2000/svg';

/** Render placeholder cells only; topology and view mapping remain independent of the DOM. */
export function renderIslandBoard(container: HTMLElement): void {
  const view=createBoardView(createIslandBoard());
  const svg=document.createElementNS(SVG_NS,'svg');
  svg.setAttribute('viewBox',view.viewBox);svg.setAttribute('preserveAspectRatio','xMidYMid meet');svg.setAttribute('role','img');svg.setAttribute('aria-label','Prototype island board with 19 placeholder hexagons');svg.classList.add('island-board');
  for(const hex of view.hexes){
    const group=document.createElementNS(SVG_NS,'g');group.setAttribute('data-hex-id',hex.id);
    const polygon=document.createElementNS(SVG_NS,'polygon');polygon.setAttribute('points',hex.points.map(point=>`${point.x},${point.y}`).join(' '));polygon.setAttribute('class',`island-cell island-cell-${hex.placeholder.toLowerCase()}`);
    const title=document.createElementNS(SVG_NS,'title');title.textContent=`Placeholder ${hex.placeholder}, ${hex.id}`;polygon.append(title);
    const label=document.createElementNS(SVG_NS,'text');label.setAttribute('x',String(hex.center.x));label.setAttribute('y',String(hex.center.y));label.setAttribute('text-anchor','middle');label.setAttribute('dominant-baseline','central');label.setAttribute('class','island-label');label.textContent=hex.placeholder;
    group.append(polygon,label);svg.append(group);
  }
  container.replaceChildren(svg);
}
