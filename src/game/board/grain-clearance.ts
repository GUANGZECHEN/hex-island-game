import type { Hex } from './geometry.ts';

export const GRAIN_FADE_OPACITY = .18;
export const WHEAT_PATCHES = [[-.43, -.29], [.39, -.30], [.05, .49]] as const;
export const SVG_WHEAT_OFFSETS = [-.48, -.24, 0, .24, .48] as const;

type Point = readonly [number, number];
type BorderMasks = { corners: number[]; edges: number[] };
// Pointy-top vertices have the same clockwise ordering as Hex.vertexIds and Hex.edgeIds.
const corners: Point[] = Array.from({ length: 6 }, (_, i): Point => [Math.sin(i * Math.PI / 3), -Math.cos(i * Math.PI / 3)]);

function nearestCrops(crops: readonly Point[], a: Point, b: Point, tolerance: number): number {
  const dx = b[0] - a[0], dy = b[1] - a[1], lengthSq = dx * dx + dy * dy;
  const distances = crops.map(([x, y]) => {
    const t = lengthSq ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / lengthSq)) : 0;
    return Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy);
  });
  const nearest = Math.min(...distances);
  return distances.reduce((mask, d, index) => d <= nearest + tolerance ? mask | (1 << index) : mask, 0);
}

function borders(crops: readonly Point[], tolerance: number): BorderMasks {
  return { corners: corners.map(p => nearestCrops(crops, p, p, tolerance)),
    edges: corners.map((p, i) => nearestCrops(crops, p, corners[(i + 1) % 6], tolerance)) };
}

// A border can run between two equally close bundles; both grow at that piece's feet.
export const MODELED_WHEAT = borders(WHEAT_PATCHES, .095);
export const DRAWN_WHEAT = borders(SVG_WHEAT_OFFSETS.map<Point>(x => [x, .08]), .037);

/** A placement preview clears only the wheat nearest its active target. */
export function grainPreviewMask(hex: Hex, art: BorderMasks, kind: string | null, id: string | null): number {
  if (!id) return 0;
  if (kind === 'road') return art.edges[hex.edgeIds.indexOf(id)] ?? 0;
  if (kind === 'settlement' || kind === 'city') return art.corners[hex.vertexIds.indexOf(id)] ?? 0;
  return 0;
}
