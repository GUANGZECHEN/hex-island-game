import type { Board } from './geometry.ts';
import type { BoardSetup } from './setup.ts';
export interface Point { x:number; y:number }
export interface BoardView { viewBox:string; hexes: readonly {id:string; center:Point; points:readonly Point[]; placeholder:string}[]; vertices:readonly {id:string; point:Point}[]; edges:readonly {id:string; start:Point; end:Point}[] }

/** Presentation uses floating point only after topology identities have been established. */
export function createBoardView(board: Board): BoardView {
  const vertices = board.vertices.map(vertex => ({id:vertex.id, point:{x:vertex.u*Math.sqrt(3)/2,y:vertex.v/2}}));
  const points = new Map(vertices.map(vertex=>[vertex.id,vertex.point]));
  const getPoint = (id:string):Point => {const point=points.get(id);if(!point)throw new Error(`Missing board vertex ${id}`);return point;};
  const hexes = board.hexes.map((hex,index)=>({id:hex.id,center:{x:Math.sqrt(3)*(hex.q+hex.r/2),y:1.5*hex.r},points:hex.vertexIds.map(getPoint),placeholder:String.fromCharCode(65+index%5)}));
  const edges = board.edges.map(edge=>({id:edge.id,start:getPoint(edge.vertexIds[0]),end:getPoint(edge.vertexIds[1])}));
  if (!vertices.length) throw new Error('Cannot present an empty board');
  const xs=vertices.map(v=>v.point.x), ys=vertices.map(v=>v.point.y), padding=0.18;
  const minX=Math.min(...xs)-padding,minY=Math.min(...ys)-padding;
  return {viewBox:`${minX} ${minY} ${Math.max(...xs)-minX+padding} ${Math.max(...ys)-minY+padding}`,hexes,vertices,edges};
}

/** Match setup assignments to geometry by stable hex ID before rendering. */
export function createSetupView(board: Board, setup: BoardSetup) {
  const view = createBoardView(board);
  const assignments = new Map(setup.hexes.map(hex => [hex.hexId, hex]));
  if (assignments.size !== view.hexes.length || setup.hexes.length !== view.hexes.length) throw new Error('Setup does not match board geometry.');
  return { ...view, hexes: view.hexes.map(hex => {
    const assignment = assignments.get(hex.id);
    if (!assignment) throw new Error(`Missing setup for ${hex.id}.`);
    return { ...hex, ...assignment, robber: hex.id === setup.robberHexId };
  }) };
}
