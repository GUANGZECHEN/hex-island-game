import { createIslandBoard } from './geometry.ts';

export type Terrain = 'forest' | 'hills' | 'pasture' | 'fields' | 'mountains' | 'desert';
export type Resource = 'lumber' | 'brick' | 'wool' | 'grain' | 'ore' | null;
export type NumberToken = 2 | 3 | 4 | 5 | 6 | 8 | 9 | 10 | 11 | 12;
export interface HexSetup { hexId: string; terrain: Terrain; resource: Resource; token: NumberToken | null }
export interface BoardSetup { seed: number; version: 'mulberry32-fy-rejection-v1'; robberHexId: string; hexes: readonly HexSetup[] }

export const GENERATOR_VERSION = 'mulberry32-fy-rejection-v1' as const;
export const MAX_TOKEN_SHUFFLES = 1000;
export const RESOURCE_BY_TERRAIN: Readonly<Record<Terrain, Resource>> = Object.freeze({forest:'lumber',hills:'brick',pasture:'wool',fields:'grain',mountains:'ore',desert:null});
const TERRAINS: readonly Terrain[] = ['forest','forest','forest','forest','hills','hills','hills','pasture','pasture','pasture','pasture','fields','fields','fields','fields','mountains','mountains','mountains','desert'];
const TOKENS: readonly NumberToken[] = [2,3,3,4,4,5,5,6,6,8,8,9,9,10,10,11,11,12];
const RANDOM_RANGE = 0x100000000;

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
export function generateBoardSetup(seed: number): BoardSetup {
  if(!Number.isInteger(seed)||seed<0||seed>0xffffffff)throw new RangeError('Seed must be an unsigned 32-bit integer.');
  const random=randomSource(seed), board=createIslandBoard(), terrain=shuffle(TERRAINS,random);
  const desertIndex=terrain.indexOf('desert'), numbered=board.hexes.filter((_,index)=>index!==desertIndex);
  for(let attempt=0;attempt<MAX_TOKEN_SHUFFLES;attempt++){
    const tokens=shuffle(TOKENS,random), tokenById=new Map(numbered.map((hex,index)=>[hex.id,tokens[index]]));
    const red=(token: NumberToken | undefined): boolean => token===6||token===8;
    if(numbered.some(hex=>red(tokenById.get(hex.id))&&hex.neighborIds.some(id=>red(tokenById.get(id)))))continue;
    return {seed,version:GENERATOR_VERSION,robberHexId:board.hexes[desertIndex].id,hexes:board.hexes.map((hex,index)=>({hexId:hex.id,terrain:terrain[index],resource:RESOURCE_BY_TERRAIN[terrain[index]],token:tokenById.get(hex.id)??null}))};
  }
  throw new Error(`Unable to generate non-adjacent red tokens within ${MAX_TOKEN_SHUFFLES} shuffles.`);
}
