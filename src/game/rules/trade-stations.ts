import { createIslandBoard } from '../board/geometry.ts';
import { RESOURCES, type GameState, type Hand } from './state.ts';

export interface TradeStation {
  vertexId: string;
  builtBy: string;
  /** Global authoritative turn number of each partner's most recent send. */
  lastSentTurns: Record<string, number>;
}
export const STATION_COST: Readonly<Hand> = Object.freeze({lumber:1,brick:1,wool:1,grain:1,ore:0});
export function usesTradeStations(state: Pick<GameState,'mode'|'harbor'>): boolean {
  return state.mode === 'harbor-coop' && state.harbor?.version === 2;
}
/** A station is attached to a shared junction, not a producing/VP building. */
export function isTradeJunction(state: Pick<GameState,'board'|'players'|'roads'>, vertexId: string): boolean {
  const board = createIslandBoard(state.board.layout);
  if (!board.vertices.some(vertex => vertex.id === vertexId) || state.players.length !== 2) return false;
  const owners = new Set(board.edges.filter(edge => edge.vertexIds.includes(vertexId)).map(edge => state.roads[edge.id]));
  return state.players.every(player => owners.has(player.id));
}
export function tradeStationIds(state: GameState): string[] {
  if (!usesTradeStations(state)) return [];
  return createIslandBoard(state.board.layout).vertices.map(v=>v.id).filter(id=>!state.harbor!.stations?.[id] && isTradeJunction(state,id));
}
export function availableTradeStations(state: GameState, playerId: string): TradeStation[] {
  if (!usesTradeStations(state) || state.phase !== 'action' || state.players[state.currentSeat]?.id !== playerId) return [];
  return Object.values(state.harbor!.stations ?? {}).filter(station =>
    station.lastSentTurns[playerId] !== state.turn && isTradeJunction(state,station.vertexId));
}
export function buildTradeStation(state: GameState, playerId: string, vertexId: string): void {
  if (!usesTradeStations(state) || !isTradeJunction(state,vertexId) || state.harbor!.stations?.[vertexId]) {
    throw new Error('Build a trade station where one road from each partner meets.');
  }
  const player = state.players.find(p=>p.id===playerId)!;
  if (RESOURCES.some(r=>player.hand[r]<STATION_COST[r])) throw new Error('A station costs one lumber, brick, wool and grain.');
  for (const r of RESOURCES) {player.hand[r]-=STATION_COST[r];state.bank[r]+=STATION_COST[r];}
  state.harbor!.stations ??= {};
  state.harbor!.stations[vertexId] = {vertexId,builtBy:playerId,lastSentTurns:{}};
}
/** Call only after the common active-player, card and recipient checks. */
export function spendStationSend(state: GameState, playerId: string, stationId: string | undefined, cards: Hand): void {
  if (RESOURCES.reduce((n,r)=>n+cards[r],0)!==1) throw new Error('Each station sends exactly one resource card per player turn.');
  const station = availableTradeStations(state,playerId).find(s=>s.vertexId===stationId);
  if (!station) throw new Error('Choose an unused trade station for this turn.');
  station.lastSentTurns[playerId]=state.turn;
}
