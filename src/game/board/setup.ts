import { createIslandBoard, type BoardLayout, type Board, type Hex } from './geometry.ts';

export type Terrain = 'forest' | 'hills' | 'pasture' | 'fields' | 'mountains' | 'desert';
export type Resource = 'lumber' | 'brick' | 'wool' | 'grain' | 'ore' | null;
export type NumberToken = 2 | 3 | 4 | 5 | 6 | 8 | 9 | 10 | 11 | 12;
export interface HexSetup { hexId: string; terrain: Terrain; resource: Resource; token: NumberToken | null }
export interface BoardSetup { seed: number; version: 'mulberry32-fy-rejection-v2'; layout: BoardLayout; robberHexId: string; piratePortEdgeId?: string; hexes: readonly HexSetup[]; ports: readonly Port[] }

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
  if (layout === 'twin-capes') {
    const count = TWIN_PORTS_PER_CAPE.length * 2;
    return Array.from({ length: count }, (_, i) => ordered[Math.round(i * ordered.length / count)]);
  }
  const indices=layout==='expanded-5-6'?[0,3,6,9,12,15,18,21,24,27,30]:[0,3,6,10,13,16,20,23,26];
  return indices.map(index => ordered[index]);
}

/** Mulberry32 v1: produces a repeatable uint32 stream, not cryptographic randomness. */
function randomSource(seed: number): () => number {
  let state=seed;
  return () => { state=(state+0x6d2b79f5)>>>0; let x=state; x=Math.imul(x^(x>>>15),x|1); x^=x+Math.imul(x^(x>>>7),x|61); return (x^(x>>>14))>>>0; };
}
function randomIndex(n: number, random: () => number): number {
  const limit = RANDOM_RANGE - RANDOM_RANGE % n;
  for (let tries = 0; tries < 128; tries++) {
    const draw = random();
    if (draw < limit) return draw % n;
  }
  throw new Error('Unable to generate an unbiased shuffle index within 128 draws.');
}

function shuffle<T>(values: readonly T[], random: () => number): T[] {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const draw = randomIndex(i + 1, random);
    [result[i],result[draw]] = [result[draw],result[i]];
  }
  return result;
}

const TWIN_TERRAINS: readonly Terrain[] = ['forest', 'hills', 'pasture', 'fields', 'mountains'];
const TWIN_PORTS_PER_CAPE: readonly PortType[] = ['generic', 'generic', 'generic', 'lumber', 'brick', 'wool', 'grain', 'ore'];
const CAPE_TOKENS: readonly NumberToken[] = [2,3,3,4,4,5,5,6,6,8,9,10,10,11];
const MIRRORED_CAPE_TOKENS = CAPE_TOKENS.map(token => (14 - token) as NumberToken);
// One resource gets two hexes, the others three. Each resource yields 8–10
// probability pips per cape; weak or strong rolls cannot all land on one resource.
const CAPE_PIP_GROUPS = [[5,3], [5,4,1], [5,3,2], [4,3,2], [4,3,2]] as const;
const isRed = (token: NumberToken) => token === 6 || token === 8;

function populateCape(cells: readonly Hex[], pool: readonly NumberToken[], scarce: Terrain, random: () => number): HexSetup[] {
  const redIds = new Set<string>();
  for (const hex of shuffle(cells, random)) {
    if (hex.neighborIds.some(id => redIds.has(id))) continue;
    redIds.add(hex.id);
    if (redIds.size === 3) break;
  }
  // On either cape every independent pair leaves room for a third red token.
  if (redIds.size !== 3) throw new Error('Twin Capes has no room for its three separated red tokens.');
  const high = shuffle(pool.filter(isRed), random);
  const regular = shuffle(pool.filter(token => !isRed(token)), random);
  const terrains = [scarce, ...shuffle(TWIN_TERRAINS.filter(terrain => terrain !== scarce), random)];
  const byPip: Terrain[][] = Array.from({ length: 6 }, () => []);
  CAPE_PIP_GROUPS.forEach((group, i) => {
    for (const pips of group) byPip[pips].push(terrains[i]);
  });
  const assignments = byPip.map(bucket => shuffle(bucket, random));
  return cells.map(hex => {
    const token = (redIds.has(hex.id) ? high : regular).pop()!;
    const terrain = assignments[6 - Math.abs(7 - token)].pop()!;
    return { hexId: hex.id, terrain, resource: RESOURCE_BY_TERRAIN[terrain], token };
  });
}

function twinCapesSetup(seed: number, board: Board, random: () => number): BoardSetup {
  const [westScarce, eastScarce] = shuffle(TWIN_TERRAINS, random);
  const flip = randomIndex(2, random) === 1;
  const west = populateCape(board.hexes.filter(hex => hex.q < 0), flip ? MIRRORED_CAPE_TOKENS : CAPE_TOKENS, westScarce, random);
  const east = populateCape(board.hexes.filter(hex => hex.q > 0), flip ? CAPE_TOKENS : MIRRORED_CAPE_TOKENS, eastScarce, random);
  const neck = board.hexes.find(hex => hex.q === 0 && hex.r === 0)!;
  const neckToken = randomIndex(2, random) === 0 ? 4 : 10;
  const bridge: HexSetup = { hexId: neck.id, terrain: westScarce, resource: RESOURCE_BY_TERRAIN[westScarce], token: neckToken };
  // The canonical coast runs around one cape and then its opposite. Shuffle
  // the two halves separately to give both capes every trade specialty.
  const portTypes = [...shuffle(TWIN_PORTS_PER_CAPE, random), ...shuffle(TWIN_PORTS_PER_CAPE, random)];
  const ports = coastalPortSlots('twin-capes').map((edge, i) => ({ edgeId: edge.id, vertexIds: edge.vertexIds, type: portTypes[i] }));
  return { seed, version: GENERATOR_VERSION, layout: 'twin-capes', robberHexId: '',
    piratePortEdgeId: ports[randomIndex(ports.length, random)].edgeId, ports, hexes: [...west, bridge, ...east] };
}

/** Deterministically generates a setup in board hex order, or fails rather than relaxing adjacency. */
export function generateBoardSetup(seed: number,layout:BoardLayout='standard'): BoardSetup {
  if(!Number.isInteger(seed)||seed<0||seed>0xffffffff)throw new RangeError('Seed must be an unsigned 32-bit integer.');
  const random=randomSource(seed), board=createIslandBoard(layout);
  if (layout === 'twin-capes') return twinCapesSetup(seed, board, random);
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
