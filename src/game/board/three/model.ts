import { createIslandBoard, type BoardLayout } from '../geometry.ts';
import { createBoardView } from '../presentation.ts';
import type { BoardSetup, Port } from '../setup.ts';
import type { TargetMode } from '../../rules/legal.ts';

/** Public scene data only: never hands, deck, entropy or room credentials. */
export interface BoardSceneView {
  harborPorts?:boolean;
  stations?:Readonly<Record<string,{builtBy:string}>>;
  board: BoardSetup;
  players: readonly { id: string; name: string; color: string }[];
  roads: Readonly<Record<string, string>>;
  buildings: Readonly<Record<string, { playerId: string; kind: 'settlement' | 'city' | 'ship' }>>;
  targetMode: TargetMode | null;
  legalTargets: readonly string[];
}
export interface GroundPoint { x: number; z: number }
export interface PortBoatPlan {
  center: GroundPoint;
  outward: GroundPoint;
  tangent: GroundPoint;
  decks: readonly { vertexId: string; start: GroundPoint; end: GroundPoint }[];
}
export function worldGeometry(layout: BoardLayout) {
  const topology = createIslandBoard(layout), view = createBoardView(topology);
  const xs = view.vertices.map(v => v.point.x), zs = view.vertices.map(v => v.point.y);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2;
  const vertices = new Map(view.vertices.map(v => [v.id, { x: v.point.x - cx, z: v.point.y - cz }]));
  const hexes = new Map(view.hexes.map(h => [h.id, { x: h.center.x - cx, z: h.center.y - cz }]));
  const edges = new Map(topology.edges.map(e => [e.id, { a: vertices.get(e.vertexIds[0])!, b: vertices.get(e.vertexIds[1])! }]));
  return { topology, vertices, edges, hexes };
}
/** Two bridges start at the original owned vertices; the boat is outside the coastal hex. */
export function portBoatPlan(port: Port, geometry: ReturnType<typeof worldGeometry>): PortBoatPlan {
  const a = geometry.vertices.get(port.vertexIds[0]), b = geometry.vertices.get(port.vertexIds[1]);
  const edge = geometry.topology.edges.find(e => e.id === port.edgeId);
  if (!a || !b || !edge || edge.hexIds.length !== 1) throw new Error('Invalid coastal port.');
  const h = geometry.hexes.get(edge.hexIds[0])!;
  const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
  const dl = Math.hypot(b.x - a.x, b.z - a.z), ol = Math.hypot(mid.x - h.x, mid.z - h.z);
  const tangent = { x: (b.x - a.x) / dl, z: (b.z - a.z) / dl };
  const outward = { x: (mid.x - h.x) / ol, z: (mid.z - h.z) / ol };
  const center = { x: mid.x + outward.x * 1.03, z: mid.z + outward.z * 1.03 };
  const decks = [a, b].map((start, index) => ({ vertexId: port.vertexIds[index], start: { ...start }, end: {
    x: center.x + tangent.x * (index ? .37 : -.37) - outward.x * .16,
    z: center.z + tangent.z * (index ? .37 : -.37) - outward.z * .16,
  } }));
  return { center, outward, tangent, decks };
}
/** Continuous sand surface. ring=1 is the boundary and meets the tile base. */
export function duneHeight(x: number, z: number, ring: number): number {
  const ridgeA = .19 * Math.exp(-((x + .20 + z * .35) ** 2 / .075 + (z + .12) ** 2 / .8));
  const ridgeB = .13 * Math.exp(-((x - .36 + z * .24) ** 2 / .06 + (z - .13) ** 2 / .5));
  return .123 + (ridgeA + ridgeB + .01) * Math.max(0, 1 - ring ** 6);
}
export function staticBoardKey(board: BoardSetup): string {
  return JSON.stringify([board.version, board.seed, board.layout, board.hexes, board.ports]);
}
