import { createIslandBoard, type BoardLayout } from './geometry.ts';

export type Terrain = 'forest' | 'hills' | 'pasture' | 'fields' | 'mountains' | 'desert';
export type Resource = 'lumber' | 'brick' | 'wool' | 'grain' | 'ore' | null;
export type NumberToken = 2 | 3 | 4 | 5 | 6 | 8 | 9 | 10 | 11 | 12;
export interface HexSetup { hexId: string; terrain: Terrain; resource: Resource; token: NumberToken | null }
export interface BoardSetup { seed: number; version: 'mulberry32-fy-rejection-v2'; layout: BoardLayout; robberHexId: string; hexes: readonly HexSetup[]; ports: readonly Port[] }

export type PortType = Exclude<Resource, null> | 'generic';
export interface Port { edgeId: string; vertexIds: readonly [string, string]; type: PortType }
export const GENERATOR_VERSION = 'mulberry32-fy-rejection-v2' as const;
export const MAX_TOKEN_SHUFFLES = 1000;
export const RESOURCE_BY_TERRAIN: Readonly<Record<Terrain, Resource>> = Object.freeze({forest:'lumber',hills:'brick',pasture:'wool',fields:'grain',mountains:'ore',desert:null});

const STANDARD_TERRAINS: readonly Terrain[] = ['forest','forest','forest','forest','hills','hills','hills','pasture','pasture','pasture','pasture','fields','fields','fields','fields','mountains','mountains','mountains','desert'];
const EXPANDED_TERRAINS: readonly Terrain[] = [...STANDARD_TERRAINS,'forest','hills','pasture','mountains','desert'];
const STANDARD_TOKENS: readonly NumberToken[] = [2,3,3,4,4,5,5,6,6,8,8,9,9,10,10,11,11,12];
const EXPANDED_TOKENS: readonly NumberToken[] = [...STANDARD_TOKENS,4,5,6,9];
const RANDOM_RANGE = 0x100000000;
const STANDARD_PORT_TYPES: readonly PortType[] = ['generic','generic','generic','generic','lumber','brick','wool','grain','ore'];
const EXPANDED_PORT_TYPES: readonly PortType[] = ['generic','generic','generic','generic','generic','generic','lumber','brick','wool','grain','ore'];

/** Walk the canonical coast as a cycle, starting with its smallest edge and vertex IDs. */
export function coastalPortSlots(layout:BoardLayout='standard') {
  const coast = createIslandBoard(layout).edges.filter(edge => edge.hexIds.length === 1);
  const byVertex = new Map<string, typeof coast>();
  for (const edge of coast) for (const vertex of edge.vertexIds) byVertex.set(vertex, [...(byVertex.get(vertex) ?? []), edge]);
  const first = coast[0];
  let current = first, vertex = first.vertexIds[0];
  const ordered: typeof coast = [];
  for (let i = 0; i < coast.length; i++) {
    ordered.push(current);
    vertex = current.vertexIds[0] === vertex ? current.vertexIds[1] : current.vertexIds[0];
    const next = byVertex.get(vertex)?.find(edge => edge.id !== current.id);
    if (!next) throw new Error('Invalid coastline topology.');
    current = next;
  }
  if (current.id !== first.id || new Set(ordered.map(edge => edge.id)).size !== coast.length) throw new Error('Invalid coastline cycle.');
  const indices=layout==='expanded-5-6'?[0,3,6,9,12,15,18,21,24,27,30]:[0,3,6,10,13,16,20,23,26];
  return indices.map(index => ordered[index]);
}

/** Mulberry32 v1: produces a repeatable uint32 stream, not cryptographic randomness. */
function randomSource(seed: number): () => number {
  let state=seed;
  return () => { state=(state+0x6d2b79f5)>>>0; let x=state; x=Math.imul(x^(x>>>15),x|1); x^=x+Math.imul(x^(x>>>7),x|61); return (x^(x>>>14))>>>0; };
}
function shuffle<T>(values: readonly T[], random: () => number): T[] {
  const result=[...values];
  for(let i=result.length-1;i>0;i--){
    const n=i+1, limit=RANDOM_RANGE-(RANDOM_RANGE%n); let draw: number | undefined;
    for(let tries=0;tries<128;tries++){const value=random();if(value<limit){draw=value%n;break;}}
    if(draw===undefined)throw new Error('Unable to generate an unbiased shuffle index within 128 draws.');
    [result[i],result[draw]]=[result[draw],result[i]];
  }
  return result;
}

/** Deterministically generates a setup in board hex order, or fails rather than relaxing adjacency. */
export function generateBoardSetup(seed: number,layout:BoardLayout='standard'): BoardSetup {
  if(!Number.isInteger(seed)||seed<0||seed>0xffffffff)throw new RangeError('Seed must be an unsigned 32-bit integer.');
  const random=randomSource(seed), board=createIslandBoard(layout);
  const terrains=layout==='expanded-5-6'?EXPANDED_TERRAINS:STANDARD_TERRAINS;
  const tokenPool=layout==='expanded-5-6'?EXPANDED_TOKENS:STANDARD_TOKENS;
  const portPool=layout==='expanded-5-6'?EXPANDED_PORT_TYPES:STANDARD_PORT_TYPES;
  const terrain=shuffle(terrains,random);
  const numbered=board.hexes.filter((_,index)=>terrain[index]!=='desert');
  const deserts=board.hexes.filter((_,index)=>terrain[index]==='desert');
  for(let attempt=0;attempt<MAX_TOKEN_SHUFFLES;attempt++){
    const tokens=shuffle(tokenPool,random), tokenById=new Map(numbered.map((hex,index)=>[hex.id,tokens[index]]));
    const red=(token: NumberToken | undefined): boolean => token===6||token===8;
    if(numbered.some(hex=>red(tokenById.get(hex.id))&&hex.neighborIds.some(id=>red(tokenById.get(id)))))continue;
    const portTypes = shuffle(portPool, random);
    const ports = coastalPortSlots(layout).map((edge, index) => ({edgeId:edge.id, vertexIds:edge.vertexIds, type:portTypes[index]}));
    return {seed,version:GENERATOR_VERSION,layout,robberHexId:deserts[0].id,ports,hexes:board.hexes.map((hex,index)=>({hexId:hex.id,terrain:terrain[index],resource:RESOURCE_BY_TERRAIN[terrain[index]],token:tokenById.get(hex.id)??null}))};
  }
  throw new Error(`Unable to generate non-adjacent red tokens within ${MAX_TOKEN_SHUFFLES} shuffles.`);
}
