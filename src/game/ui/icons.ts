import type { Development, Resource } from '../rules/state.ts';

/** Original, small line icons shared by the board, hand, ports and costs. */
export const RESOURCE_PATHS: Readonly<Record<Resource, string>> = {
  lumber: 'M12 2 5 10h3l-4 5h6v5h4v-5h6l-4-5h3L12 2Z',
  brick: 'M3 6h18v12H3zM3 12h18M9 6v6m6 0v6',
  // Wool bundle: fluffy outer fleece silhouette only; no internal curl or animal anatomy.
  wool: 'M7 18.5c-2.5 0-4.5-1.9-4.5-4.3 0-1.6.9-3 2.3-3.8-.1-.4-.2-.8-.2-1.2 0-2.3 1.9-4.2 4.2-4.2 1 0 1.9.3 2.6.9A4.8 4.8 0 0 1 15 4.5c2.6 0 4.7 2.1 4.7 4.7v.3c1.2.7 1.9 2 1.9 3.5 0 2.3-1.9 4.2-4.2 4.2-.6 0-1.2-.1-1.7-.4-.8 1.1-2.1 1.7-3.5 1.7-.9 0-1.8-.3-2.5-.8-.7.5-1.7.8-2.7.8Z',
  grain: 'M12 21V3m0 14-4-3m4 0 4-3m-4 0L8 8m4 0 4-3',
  ore: 'm4 17 3-9 5-4 5 3 3 10-4 3H8Zm3-9 5 3 5-4m-5 4v9',
};
export const BOARD_BUILDING_PATHS = {
  settlement: {
    shell: 'M3 11 12 4l9 7v10H3V11Z',
    accent: 'M2 11 12 3l10 8M17 8V5h3v6',
    detail: 'M9 21v-6h6v6M6.5 12.5h2.5v2.5H6.5zM15 12.5h2.5v2.5H15z',
  },
  city: {
    shell: 'M3 12h18v9H3v-9ZM7 12V8h10v4M9 8V4h6v4',
    accent: 'M2 12l4-4h2M16 8h2l4 4M12 4V2m0 0 2 1M12 2l-2 1',
    detail: 'M10.2 6h3.6M12 6v1.3M8 15h2v2H8zM14 15h2v2h-2zM11 21v-4h2v4',
  },
} as const;
export const DESERT_PATH = 'M3 18c3-4 6-4 9 0 2-3 5-4 9-1M3 21c3-3 6-3 9 0 2-2 5-3 9-1M7 7a2 2 0 1 0 4 0 2 2 0 1 0-4 0M9 2v2M9 10v2M4 7H2m14 0h-2M5.5 3.5 4 4m3-4-4 4';

export const ACTION_PATHS = {
  dice: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm2 5h.01M12 12h.01M17 16h.01',
  road: 'M4 20 9 4m6 0 5 16M10 17h4m-3-5h2m-1-4h.01',
  settlement: 'M3 11 12 3l9 8M5 10v10h14V10M10 20v-6h4v6',
  city: 'M3 20V9l5-4 5 4v11m0-8 4-3 4 3v8M7 12h2m-2 4h2m8-1h1',
  card: 'M6 3h12v18H6zM9 7h6m-6 4h6m-6 4h4',
  hand: 'M5 5h12v15H5zM8 2h11v15',
  trade: 'M4 8h15m-4-4 4 4-4 4M20 16H5m4-4-4 4 4 4',
  victory: 'M12 3l2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3Z',
  end: 'M4 12h14m-5-5 5 5-5 5M20 5v14',
} as const;
export type ActionIcon = keyof typeof ACTION_PATHS;
export const DEVELOPMENT_LABELS: Readonly<Record<Development,string>> = {
  knight:'Knight',
  'road-building':'Road Building',
  invention:'Year of Plenty',
  monopoly:'Monopoly',
  'victory-point':'Victory Point',
};
export const DEVELOPMENT_PATHS: Readonly<Record<Development,string>> = {
  knight:'M7 21h10M8 18h8l-1-7 3-3-4-5-6 3-2 5 3 3-1 7Z',
  'road-building':ACTION_PATHS.road,
  invention:'M9 18h6m-5 3h4m-6-9a4 4 0 1 1 8 0c0 2-2 3-2 5h-4c0-2-2-3-2-5Z',
  monopoly:'M4 8l4 4 4-7 4 7 4-4-2 11H6L4 8Z',
  'victory-point':ACTION_PATHS.victory,
};
const NS='http://www.w3.org/2000/svg';
export function icon(path:string, className='icon'):SVGSVGElement {
  const svg=document.createElementNS(NS,'svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('class',className);svg.setAttribute('aria-hidden','true');svg.setAttribute('focusable','false');
  const shape=document.createElementNS(NS,'path');shape.setAttribute('d',path);shape.setAttribute('fill','none');shape.setAttribute('stroke','currentColor');shape.setAttribute('stroke-width','2');shape.setAttribute('stroke-linecap','round');shape.setAttribute('stroke-linejoin','round');svg.append(shape);return svg;
}
export function resourceIcon(resource:Resource):SVGSVGElement {const svg=icon(RESOURCE_PATHS[resource],`icon resource-icon resource-${resource}`);svg.setAttribute('data-resource-icon',resource);return svg;}
export function desertIcon():SVGSVGElement {const svg=icon(DESERT_PATH,'icon desert-icon');svg.setAttribute('data-terrain-icon','desert');return svg;}
export function developmentIcon(card:Development):SVGSVGElement {const svg=icon(DEVELOPMENT_PATHS[card],`icon development-icon development-${card}`);svg.setAttribute('data-development-icon',card);return svg;}
export function developmentChip(card:Development,count:number,newCount=0):HTMLElement {
  const chip=document.createElement('span');chip.className='development-chip';chip.setAttribute('role','img');
  chip.setAttribute('aria-label',`${DEVELOPMENT_LABELS[card]}: ${count}${newCount?`, ${newCount} new this turn`:''}`);
  const number=document.createElement('span');number.className='development-count';number.textContent=String(count);chip.append(developmentIcon(card),number);
  if(newCount){const badge=document.createElement('span');badge.className='development-new';badge.textContent=newCount===count?'new':`${newCount} new`;chip.append(badge);}
  return chip;
}
export function resourceChip(resource:Resource,count:number):HTMLElement {
  const chip=document.createElement('span');chip.className=`resource-chip resource-chip-${resource}`;chip.setAttribute('data-resource',resource);chip.setAttribute('role','img');chip.setAttribute('aria-label',`${resource}: ${count}`);
  const number=document.createElement('span');number.className='resource-count';number.textContent=String(count);chip.append(resourceIcon(resource),number);return chip;
}
export function affordable(hand:Record<Resource,number>, cost:Partial<Record<Resource,number>>):boolean {return Object.entries(cost).every(([resource,amount])=>hand[resource as Resource] >= (amount ?? 0));}
