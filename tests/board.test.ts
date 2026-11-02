import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createIslandBoard} from '../src/game/board/geometry.ts';
import {createBoardView} from '../src/game/board/presentation.ts';

test('radius-two axial island has unique deterministic topology',()=>{
 const board=createIslandBoard();assert.equal(board.hexes.length,19);assert.equal(board.vertices.length,54);assert.equal(board.edges.length,72);
 for(const items of [board.hexes,board.vertices,board.edges])assert.equal(new Set(items.map(x=>x.id)).size,items.length);
 assert.deepEqual(createIslandBoard(),board);
 const coordinates=board.hexes.map(({q,r})=>[q,r]);const expected:number[][]=[];for(let q=-2;q<=2;q++)for(let r=-2;r<=2;r++)if(Math.max(Math.abs(q),Math.abs(r),Math.abs(q+r))<=2)expected.push([q,r]);assert.deepEqual(coordinates,expected);
 for(const h of board.hexes){assert.equal(h.id,`h:${h.q},${h.r}`);assert.equal(new Set(h.vertexIds).size,6);assert.equal(new Set(h.edgeIds).size,6);}
});
test('neighbor counts and shared edges and corners are consistent in both directions',()=>{
 const board=createIslandBoard(),hexes=new Map(board.hexes.map(h=>[h.id,h])),edges=new Map(board.edges.map(e=>[e.id,e]));
 assert.deepEqual([3,4,6].map(n=>board.hexes.filter(h=>h.neighborIds.length===n).length),[6,6,7]);
 assert.equal(board.edges.filter(e=>e.hexIds.length===2).length,42);assert.equal(board.edges.filter(e=>e.hexIds.length===1).length,30);
 for(const hex of board.hexes)for(const neighborId of hex.neighborIds){const neighbor=hexes.get(neighborId)!;assert.ok(neighbor.neighborIds.includes(hex.id));const sharedEdges=hex.edgeIds.filter(id=>neighbor.edgeIds.includes(id));const sharedVertices=hex.vertexIds.filter(id=>neighbor.vertexIds.includes(id));assert.equal(sharedEdges.length,1);assert.equal(sharedVertices.length,2);const edge=edges.get(sharedEdges[0])!;assert.deepEqual([...edge.vertexIds].sort(),sharedVertices.sort());assert.deepEqual([...edge.hexIds].sort(),[hex.id,neighbor.id].sort());}
 for(const edge of board.edges){assert.ok(edge.hexIds.length===1||edge.hexIds.length===2);for(const id of edge.hexIds)assert.ok(hexes.get(id)!.edgeIds.includes(edge.id));}
});
test('view maps every hex, corner and edge to finite consistent coordinates',()=>{
 const board=createIslandBoard(),view=createBoardView(board),vertexPoints=new Map(view.vertices.map(v=>[v.id,v.point]));
 assert.equal(view.hexes.length,19);assert.equal(view.vertices.length,54);assert.equal(view.edges.length,72);
 for(const value of view.viewBox.split(' ').map(Number))assert.ok(Number.isFinite(value));
 for(const hex of view.hexes){assert.equal(hex.points.length,6);for(const p of [hex.center,...hex.points])assert.ok(Number.isFinite(p.x)&&Number.isFinite(p.y));}
 for(const edge of view.edges){for(const point of [edge.start,edge.end])assert.ok(Number.isFinite(point.x)&&Number.isFinite(point.y));const logical=board.edges.find(e=>e.id===edge.id)!;assert.deepEqual(edge.start,vertexPoints.get(logical.vertexIds[0]));assert.deepEqual(edge.end,vertexPoints.get(logical.vertexIds[1]));}
});
