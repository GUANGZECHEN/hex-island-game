import { createIslandBoard } from '../board/geometry.ts';
import { generateBoardSetup, type BoardSetup } from '../board/setup.ts';

export const RESOURCES = ['lumber', 'brick', 'wool', 'grain', 'ore'] as const;
export type Resource = typeof RESOURCES[number];
export type Hand = Record<Resource, number>;
export type Development = 'knight' | 'monopoly' | 'road-building' | 'invention' | 'victory-point';
export interface Player {
  id: string; seat: number; hand: Hand; cards: { type: Development; boughtTurn: number }[];
  roads: number; settlements: number; cities: number; knights: number;
}
export interface Building { playerId: string; kind: 'settlement' | 'city' }
export interface TradeOffer { id: string; proposer: string; targets: string[]; give: Hand; receive: Hand; }
export interface GameState {
  version: 1; board: BoardSetup; players: Player[]; bank: Hand; deck: Development[];
  randomState: number; playedCards: Development[]; startingSeat: number; currentSeat: number; turn: number;
  phase: 'setup-settlement' | 'setup-road' | 'roll' | 'discard' | 'robber' | 'steal' | 'action' | 'free-road' | 'finished'; setupStep: number;
  longestHolder: string | null; armyHolder: string | null; playedDevelopment: boolean; resumePhase: 'roll' | 'action' | null; freeRoads: number; winner: string | null;
  offer: TradeOffer | null; dice: [number, number] | null; discards: Record<string, number>; victims: string[];
  pendingSettlement: string | null; buildings: Record<string, Building>; roads: Record<string, string>;
}
export type SetupCommand = { type: 'place-settlement'; playerId: string; vertexId: string } | { type: 'place-road'; playerId: string; edgeId: string };
const emptyHand = (): Hand => ({ lumber: 0, brick: 0, wool: 0, grain: 0, ore: 0 });

/** Stateful Mulberry32 stream retained in game state, for host-owned game randomness. */
export function nextRandom(state: number): { state: number; value: number } {
  state = (state + 0x6d2b79f5) >>> 0;
  let x = state; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
  return { state, value: (x ^ (x >>> 14)) >>> 0 };
}
export function drawIndex(state: number, bound: number): { state: number; index: number } {
  const limit = 0x100000000 - (0x100000000 % bound);
  for (let attempt = 0; attempt < 128; attempt++) {
    const draw = nextRandom(state); state = draw.state;
    if (draw.value < limit) return { state, index: draw.value % bound };
  }
  throw new Error('Random index generation exhausted.');
}
/** Host-supplied entropy supports private outcomes without deriving them from the public board seed. */
export function secureIndex(random: () => number, bound: number): { state?: undefined; index: number } {
  const limit = 0x100000000 - 0x100000000 % bound;
  for (let i=0; i<128; i++) { const value=random(); if (!Number.isInteger(value) || value<0 || value>0xffffffff) throw new Error('Invalid entropy.'); if (value<limit) return {index:value%bound}; }
  throw new Error('Random index generation exhausted.');
}
export function createGame(seed: number, ids: readonly string[], secureRandom?: () => number): GameState {
  if (ids.length < 3 || ids.length > 4 || ids.some(id => typeof id !== 'string' || !id) || new Set(ids).size !== ids.length) throw new Error('A game requires three or four distinct player IDs.');
  const board = generateBoardSetup(seed);
  let randomState = seed;
  const deck: Development[] = [...Array<Development>(14).fill('knight'), ...Array<Development>(2).fill('monopoly'), ...Array<Development>(2).fill('road-building'), ...Array<Development>(2).fill('invention'), ...Array<Development>(5).fill('victory-point')];
  for (let i = deck.length - 1; i > 0; i--) {
    const draw = secureRandom ? secureIndex(secureRandom, i + 1) : drawIndex(randomState, i + 1); randomState = draw.state ?? randomState;
    [deck[i], deck[draw.index]] = [deck[draw.index], deck[i]];
  }
  const start = secureRandom ? secureIndex(secureRandom, ids.length) : drawIndex(randomState, ids.length); randomState = start.state ?? randomState;
  return { version: 1, board, players: ids.map((id, seat) => ({ id, seat, hand: emptyHand(), cards: [], roads: 15, settlements: 5, cities: 4, knights: 0 })), bank: { lumber: 19, brick: 19, wool: 19, grain: 19, ore: 19 }, deck, randomState, playedCards: [], startingSeat: start.index, currentSeat: start.index, turn: 0, phase: 'setup-settlement', setupStep: 0, longestHolder: null, armyHolder: null, playedDevelopment: false, resumePhase: null, freeRoads: 0, winner: null, offer: null, dice: null, discards: {}, victims: [], pendingSettlement: null, buildings: {}, roads: {} };
}
export function publicVictoryPoints(state: GameState, id: string): number {
  return Object.values(state.buildings).filter(building => building.playerId === id).reduce((sum, building) => sum + (building.kind === 'city' ? 2 : 1), 0) + (state.longestHolder === id ? 2 : 0) + (state.armyHolder === id ? 2 : 0);
}
/** Validate and apply one setup command without changing the supplied state. */
export function applySetupCommand(original: GameState, command: SetupCommand): GameState {
  if (!original || !command || original.players[original.currentSeat]?.id !== command.playerId) throw new Error('Not the active player.');
  const state = structuredClone(original), board = createIslandBoard(), player = state.players[state.currentSeat];
  if (command.type === 'place-settlement' && state.phase === 'setup-settlement') {
    const vertex = board.vertices.find(v => v.id === command.vertexId);
    if (!vertex || state.buildings[vertex.id] || player.settlements <= 0) throw new Error('Invalid settlement location.');
    const adjoining = board.edges.filter(edge => edge.vertexIds.includes(vertex.id)).flatMap(edge => edge.vertexIds.filter(id => id !== vertex.id));
    if (adjoining.some(id => state.buildings[id])) throw new Error('Settlement violates distance rule.');
    state.buildings[vertex.id] = { playerId: player.id, kind: 'settlement' }; player.settlements--;
    state.pendingSettlement = vertex.id;
    if (state.setupStep >= state.players.length) {
      for (const hex of board.hexes.filter(hex => hex.vertexIds.includes(vertex.id))) {
        const resource = state.board.hexes.find(item => item.hexId === hex.id)!.resource;
        if (resource && state.bank[resource] > 0) { state.bank[resource]--; player.hand[resource]++; }
      }
    }
    state.phase = 'setup-road';
  } else if (command.type === 'place-road' && state.phase === 'setup-road') {
    const edge = board.edges.find(edge => edge.id === command.edgeId);
    if (!edge || !state.pendingSettlement || !edge.vertexIds.includes(state.pendingSettlement) || state.roads[edge.id] || player.roads <= 0) throw new Error('Invalid setup road.');
    state.roads[edge.id] = player.id; player.roads--; state.pendingSettlement = null; state.setupStep++;
    const n = state.players.length;
    if (state.setupStep === 2 * n) { state.phase = 'roll'; state.currentSeat = state.startingSeat; state.turn = 1; }
    else { const offset = state.setupStep < n ? state.setupStep : 2 * n - 1 - state.setupStep; state.currentSeat = (state.startingSeat + offset) % n; state.phase = 'setup-settlement'; }
  } else throw new Error('Command is not allowed in this phase.');
  return state;
}
