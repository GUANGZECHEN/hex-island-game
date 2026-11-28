/** Six public seat marks with distinct solid silhouettes at small sizes. */
export const SEAT_EMBLEMS = [
  { name: 'diamond', path: 'M12 1 22 12 12 23 2 12Z' },
  { name: 'cross', path: 'M8 2h8v6h6v8h-6v6H8v-6H2V8h6Z' },
  { name: 'crescent', path: 'M18.6 2.8A10.4 10.4 0 1 0 21 19.2 9.4 9.4 0 0 1 18.6 2.8Z' },
  { name: 'chevron', path: 'M2 11 12 2l10 9v9l-10-9-10 9Z' },
  { name: 'star', path: 'm12 1 3.1 7 7.6.8-5.7 5.1 1.6 7.5-6.6-3.9-6.6 3.9L7 13.9 1.3 8.8l7.6-.8Z' },
  { name: 'bars', path: 'M2 3h7v18H2Zm13 0h7v18h-7Z' },
] as const;

export type SeatEmblem = typeof SEAT_EMBLEMS[number];
export const SAIL_CLOTH = '#fff1d8';
export const EMBLEM_INK = '#263d42';
export const HULL_STRIPE = '#fff1cf';
// All coordinates use the same 24-unit square in the SVG and WebGL canvas.
export const PLAYER_SAIL_OUTLINE = 'M2 1 21 4Q20 11 23 19L2 22Z';
export const EMBLEM_ON_SAIL = { x: 4.3, y: 4.5, size: 15.4 };
const NS = 'http://www.w3.org/2000/svg';

export function seatEmblem(seat: number): SeatEmblem {
  return SEAT_EMBLEMS[seat] ?? SEAT_EMBLEMS[0];
}

function emblemSvg(seat: number, onSail: boolean): SVGSVGElement {
  const emblem = seatEmblem(seat);
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('data-seat-emblem', emblem.name);
  if (onSail) {
    const cloth = document.createElementNS(NS, 'path');
    cloth.setAttribute('d', PLAYER_SAIL_OUTLINE);
    cloth.setAttribute('fill', SAIL_CLOTH);
    cloth.setAttribute('stroke', '#66543c');
    cloth.setAttribute('stroke-width', '0.9');
    svg.append(cloth);
  }
  const mark = document.createElementNS(NS, 'path');
  mark.setAttribute('d', emblem.path);
  mark.setAttribute('fill', EMBLEM_INK);
  if (onSail) {
    const { x, y, size } = EMBLEM_ON_SAIL;
    mark.setAttribute('transform', `translate(${x} ${y}) scale(${size / 24})`);
  }
  svg.append(mark);
  return svg;
}

export function playerSailSvg(seat: number): SVGSVGElement {
  return emblemSvg(seat, true);
}

export function playerMarker(seat: number): HTMLSpanElement {
  const marker = document.createElement('span');
  marker.className = 'player-marker with-emblem';
  marker.title = `Seat ${seat + 1} · ${seatEmblem(seat).name} emblem`;
  marker.setAttribute('aria-hidden', 'true');
  marker.append(emblemSvg(seat, false), document.createTextNode(String(seat + 1)));
  return marker;
}
