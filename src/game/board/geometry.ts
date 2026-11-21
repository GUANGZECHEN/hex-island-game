/** Logical board topology. All identities use integer lattice coordinates. */
export type BoardLayout = 'standard' | 'expanded-5-6';
export interface Vertex { id: string; u: number; v: number }
export interface Edge { id: string; vertexIds: readonly [string, string]; hexIds: readonly string[] }
export interface Hex { id: string; q: number; r: number; vertexIds: readonly string[]; edgeIds: readonly string[]; neighborIds: readonly string[] }
export interface Board { layout: BoardLayout; hexes: readonly Hex[]; vertices: readonly Vertex[]; edges: readonly Edge[] }

// Pointy-top corners in an integer lattice: x units sqrt(3)/2, y units 1/2.
const CORNERS: readonly (readonly [number, number])[] = [[0,-2],[1,-1],[1,1],[0,2],[-1,1],[-1,-1]];
const vertexId = (u: number, v: number): string => `v:${u},${v}`;
const compareIds = (a:string,b:string):number => a < b ? -1 : a > b ? 1 : 0;
const edgeId = (a: string, b: string): string => `e:${[a,b].sort().join('|')}`;

const STANDARD_COLUMNS: readonly (readonly [number, number, number])[] = [
  [-2,0,2],[-1,-1,2],[0,-2,2],[1,-2,1],[2,-2,0],
];
const EXPANDED_COLUMNS: readonly (readonly [number, number, number])[] = [
  [-2,0,2],[-1,-1,2],[0,-2,2],[1,-2,2],[2,-2,1],[3,-2,0],
];

/**
 * Standard island columns are 3-4-5-4-3.
 * The 5-6 player layout inserts one horizontal-direction column of five,
 * producing 3-4-5-5-4-3 (24 hexes total).
 */
export function createIslandBoard(layout:BoardLayout='standard'): Board {
  const vertices = new Map<string, Vertex>();
  const edges = new Map<string, { id: string; vertexIds: [string, string]; hexIds: string[] }>();
  const cells: { id: string; q: number; r: number; vertexIds: string[]; edgeIds: string[] }[] = [];
  const columns=layout==='expanded-5-6'?EXPANDED_COLUMNS:STANDARD_COLUMNS;
  for (const [q,rMin,rMax] of columns) {
    for (let r=rMin;r<=rMax;r++) {
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
  return {layout,hexes, vertices:[...vertices.values()].sort((a,b)=>compareIds(a.id,b.id)), edges:[...edges.values()].sort((a,b)=>compareIds(a.id,b.id))};
}
