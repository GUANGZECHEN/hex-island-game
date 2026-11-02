/** Logical board topology. All identities use integer lattice coordinates. */
export interface Vertex { id: string; u: number; v: number }
export interface Edge { id: string; vertexIds: readonly [string, string]; hexIds: readonly string[] }
export interface Hex { id: string; q: number; r: number; vertexIds: readonly string[]; edgeIds: readonly string[]; neighborIds: readonly string[] }
export interface Board { hexes: readonly Hex[]; vertices: readonly Vertex[]; edges: readonly Edge[] }

// Pointy-top corners in an integer lattice: x units sqrt(3)/2, y units 1/2.
const CORNERS: readonly (readonly [number, number])[] = [[0,-2],[1,-1],[1,1],[0,2],[-1,1],[-1,-1]];
const vertexId = (u: number, v: number): string => `v:${u},${v}`;
const compareIds = (a:string,b:string):number => a < b ? -1 : a > b ? 1 : 0;
const edgeId = (a: string, b: string): string => `e:${[a,b].sort().join('|')}`;

/** Radius-two axial island. Stable ordering is q, then r, ascending. */
export function createIslandBoard(): Board {
  const vertices = new Map<string, Vertex>();
  const edges = new Map<string, { id: string; vertexIds: [string, string]; hexIds: string[] }>();
  const cells: { id: string; q: number; r: number; vertexIds: string[]; edgeIds: string[] }[] = [];
  for (let q = -2; q <= 2; q++) {
    for (let r = -2; r <= 2; r++) {
      if (Math.abs(q + r) > 2) continue;
      const id = `h:${q},${r}`;
      const vertexIds = CORNERS.map(([du,dv]) => {
        const u = 2*q + r + du, v = 3*r + dv, key = vertexId(u,v);
        if (!vertices.has(key)) vertices.set(key, { id:key, u, v });
        return key;
      });
      const edgeIds = vertexIds.map((a,i) => {
        const b = vertexIds[(i+1)%vertexIds.length], key = edgeId(a,b);
        let edge = edges.get(key);
        if (!edge) { edge = { id:key, vertexIds:[a,b].sort() as [string,string], hexIds:[] }; edges.set(key,edge); }
        edge.hexIds.push(id);
        return key;
      });
      cells.push({id,q,r,vertexIds,edgeIds});
    }
  }
  const hexes = cells.map(cell => ({...cell, neighborIds: cell.edgeIds.flatMap(key => edges.get(key)!.hexIds.filter(id => id !== cell.id)).sort()}));
  return {hexes, vertices:[...vertices.values()].sort((a,b)=>compareIds(a.id,b.id)), edges:[...edges.values()].sort((a,b)=>compareIds(a.id,b.id))};
}
