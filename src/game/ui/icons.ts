import type { Resource } from '../rules/state.ts';

/** Original, small line icons shared by the board, hand, ports and costs. */
export const RESOURCE_PATHS: Readonly<Record<Resource, string>> = {
  lumber: 'M12 2 5 10h3l-4 5h6v5h4v-5h6l-4-5h3L12 2Z',
  brick: 'M3 6h18v12H3zM3 12h18M9 6v6m6 0v6',
  // Sheep silhouette: woolly body, small head/ear and two legs.
  wool: 'M7 15c-2.2 0-4-1.7-4-3.8S4.8 7.5 7 7.5c.6-2 2.3-3.4 4.4-3.4 2.2 0 4 1.5 4.5 3.6 2.2-.1 4.1 1.5 4.1 3.6 0 2.1-1.7 3.7-3.9 3.7H7Zm9-5 2-1 2 1-1 2h-2l-1-2ZM8 15v4m7-4v4m-7 0h2m5 0h2',
  grain: 'M12 21V3m0 14-4-3m4 0 4-3m-4 0L8 8m4 0 4-3',
  ore: 'm4 17 3-9 5-4 5 3 3 10-4 3H8Zm3-9 5 3 5-4m-5 4v9',
};
export const DESERT_PATH = 'M3 18c3-4 6-4 9 0 2-3 5-4 9-1M3 21c3-3 6-3 9 0 2-2 5-3 9-1M7 7a2 2 0 1 0 4 0 2 2 0 1 0-4 0M9 2v2M9 10v2M4 7H2m14 0h-2M5.5 3.5 4 4m3-4-4 4';

export const ACTION_PATHS = {
  dice: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm2 5h.01M12 12h.01M17 16h.01',
  road: 'M4 20 9 4m6 0 5 16M10 17h4m-3-5h2m-1-4h.01',
  settlement: 'M3 11 12 3l9 8M5 10v10h14V10M10 20v-6h4v6',
  city: 'M3 20V9l5-4 5 4v11m0-8 4-3 4 3v8M7 12h2m-2 4h2m8-1h1',
  card: 'M6 3h12v18H6zM9 7h6m-6 4h6m-6 4h4',
  hand: 'M5 5h12v15H5zM8 2h11v15',
  trade: 'M4 8h15m-4-4 4 4-4 4M20 16H5m4-4-4 4 4 4',
  end: 'M4 12h14m-5-5 5 5-5 5M20 5v14',
} as const;
export type ActionIcon = keyof typeof ACTION_PATHS;
const NS='http://www.w3.org/2000/svg';
export function icon(path:string, className='icon'):SVGSVGElement {
  const svg=document.createElementNS(NS,'svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('class',className);svg.setAttribute('aria-hidden','true');svg.setAttribute('focusable','false');
  const shape=document.createElementNS(NS,'path');shape.setAttribute('d',path);shape.setAttribute('fill','none');shape.setAttribute('stroke','currentColor');shape.setAttribute('stroke-width','2');shape.setAttribute('stroke-linecap','round');shape.setAttribute('stroke-linejoin','round');svg.append(shape);return svg;
}
export function resourceIcon(resource:Resource):SVGSVGElement {const svg=icon(RESOURCE_PATHS[resource],`icon resource-icon resource-${resource}`);svg.setAttribute('data-resource-icon',resource);return svg;}
export function desertIcon():SVGSVGElement {const svg=icon(DESERT_PATH,'icon desert-icon');svg.setAttribute('data-terrain-icon','desert');return svg;}
export function resourceChip(resource:Resource,count:number):HTMLElement {
  const chip=document.createElement('span');chip.className='resource-chip';chip.setAttribute('role','img');chip.setAttribute('aria-label',`${resource}: ${count}`);
  const number=document.createElement('span');number.className='resource-count';number.textContent=String(count);chip.append(resourceIcon(resource),number);return chip;
}
export function affordable(hand:Record<Resource,number>, cost:Partial<Record<Resource,number>>):boolean {return Object.entries(cost).every(([resource,amount])=>hand[resource as Resource] >= (amount ?? 0));}
