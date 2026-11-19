import { createIslandBoard } from '../board/geometry.ts';
import { RESOURCES, type GameState, type Hand } from './state.ts';
import { isHarbor } from './harbor.ts';
import { usesTradeStations } from './trade-stations.ts';
export type BuildCommand =
  | { type: 'build-road'; playerId: string; edgeId: string; free?: boolean }
  | { type: 'build-settlement'; playerId: string; vertexId: string }
  | { type: 'build-city'; playerId: string; vertexId: string }
  | { type: 'build-ship'; playerId: string; vertexId: string };
const ROAD: Hand = {lumber:1,brick:1,wool:0,grain:0,ore:0};
const SETTLEMENT: Hand = {lumber:1,brick:1,wool:1,grain:1,ore:0};
const CITY: Hand = {lumber:0,brick:0,wool:0,grain:2,ore:3};
export const SHIP_COST: Readonly<Hand> = Object.freeze({lumber:3,brick:3,wool:0,grain:0,ore:3});
/** Every Classic player has exactly two optional harbor ship pieces per match. */
export const MAX_SHIPS_PER_PLAYER = 2;
export function shipsRemaining(state:Pick<GameState,'buildings'>, playerId:string):number {
  const built=Object.values(state.buildings).filter(building=>building.kind==='ship'&&building.playerId===playerId).length;
  return Math.max(0, MAX_SHIPS_PER_PLAYER-built);
}
function pay(state: GameState, id: string, cost: Hand) {
  const player = state.players.find(player => player.id === id)!;
  if (RESOURCES.some(resource => player.hand[resource] < cost[resource])) throw new Error('Insufficient resources.');
  for (const resource of RESOURCES) { player.hand[resource] -= cost[resource]; state.bank[resource] += cost[resource]; }
}
/** Longest trail, not simple path: edge reuse is forbidden, vertex revisits are allowed. */
export function longestRoute(state: GameState, playerId: string): number {
  const edges = createIslandBoard(state.board.layout).edges.filter(edge => state.roads[edge.id] === playerId);
  const incident = new Map<string, typeof edges>();
  for (const edge of edges) for (const vertex of edge.vertexIds) incident.set(vertex, [...(incident.get(vertex) ?? []), edge]);
  const walk = (vertex: string, used: Set<string>): number => {
    const owner = state.buildings[vertex]?.playerId;
    if (used.size && ((owner && owner !== playerId)||state.buildings[vertex]?.kind==='ship')) return 0;
    let best = 0;
    for (const edge of incident.get(vertex) ?? []) {
      if (used.has(edge.id)) continue;
      used.add(edge.id);
      const other = edge.vertexIds[0] === vertex ? edge.vertexIds[1] : edge.vertexIds[0];
      best = Math.max(best, 1 + walk(other, used));
      used.delete(edge.id);
    }
    return best;
  };
  return Math.max(0, ...[...incident.keys()].map(vertex => walk(vertex, new Set())));
}
export function updateLongestRoute(state: GameState): void {
  if(isHarbor(state)){state.longestHolder=null;return;}
  const lengths = state.players.map(player => ({ id: player.id, length: longestRoute(state, player.id) }));
  const max = Math.max(0, ...lengths.map(x => x.length));
  const leaders = lengths.filter(x => x.length === max && max >= 5);
  state.longestHolder = leaders.length === 1 ? leaders[0].id : leaders.some(x => x.id === state.longestHolder) ? state.longestHolder : null;
}
/** Apply a normal build; free roads must be authorized by an internal card effect. */
export function applyBuildCommand(original: GameState, command: BuildCommand, allowFreeRoad = false): GameState {
  const state = structuredClone(original), player = state.players[state.currentSeat], board = createIslandBoard(original.board.layout);
  if (state.phase !== 'action' || command.playerId !== player.id) throw new Error('Not the active action phase.');
  const legacyTeamSupport = isHarbor(state) && !usesTradeStations(state);
  if (command.type === 'build-road') {
    const edge = board.edges.find(edge => edge.id === command.edgeId);
    if (!edge || state.roads[edge.id] || !player.roads) throw new Error('Invalid road location or supply.');
    // Preserve recorded v1 campaigns. New cooperative roads, like Classic roads,
    // require the actor's own building or contiguous owned edge. A partner's
    // building blocks continuation through that endpoint; a station is no anchor.
    const connects = edge.vertexIds.some(vertex => {
      const occupant = state.buildings[vertex];
      if (occupant) return occupant.kind!=='ship'&&(occupant.playerId === player.id || legacyTeamSupport);
      return board.edges.some(other => other.vertexIds.includes(vertex) && (state.roads[other.id] === player.id || (legacyTeamSupport && !!state.roads[other.id])));
    });
    if (!connects) throw new Error('Road must connect to your own road or building.');
    if (command.free && !allowFreeRoad) throw new Error('Free road not authorized.');
    if (!command.free) pay(state, player.id, ROAD);
    state.roads[edge.id] = player.id; player.roads--;
  } else if (command.type === 'build-settlement') {
    const vertex = board.vertices.find(vertex => vertex.id === command.vertexId);
    if (!vertex || state.buildings[vertex.id] || !player.settlements) throw new Error('Invalid settlement location or supply.');
    const edges = board.edges.filter(edge => edge.vertexIds.includes(vertex.id));
    // Harbor v2 settlements need the builder's own adjacent road, just like Classic.
    // Only archived Harbor v1 games retain their original shared-road support.
    if (edges.some(edge => edge.vertexIds.some(id => id !== vertex.id && state.buildings[id])) || !edges.some(edge => state.roads[edge.id] === player.id || (legacyTeamSupport && !!state.roads[edge.id]))) throw new Error('Settlement is not connected or violates distance rule.');
    pay(state, player.id, SETTLEMENT); state.buildings[vertex.id] = {playerId:player.id,kind:'settlement'}; player.settlements--;
  } else if (command.type === 'build-ship') {
    if(state.mode==='harbor-coop'||!state.rules?.ships)throw new Error('Optional ships rule is disabled.');
    if(!shipsRemaining(state,player.id))throw new Error('Only two ships per player may be built.');
    const vertex=board.vertices.find(v=>v.id===command.vertexId);
    if(!vertex||state.buildings[vertex.id])throw new Error('Ship requires a vacant harbor vertex.');
    if(!state.board.ports.some(port=>port.vertexIds.includes(vertex.id)))throw new Error('Ships may only be placed at ports.');
    // Owning a port means holding any port vertex with your own settlement, city or ship.
    if(!state.board.ports.some(port=>port.vertexIds.some(id=>state.buildings[id]?.playerId===player.id)))
      throw new Error('Own a port before you can build a ship.');
    const connected=board.edges.filter(edge=>edge.vertexIds.includes(vertex.id));
    if(connected.some(edge=>edge.vertexIds.some(id=>id!==vertex.id && state.buildings[id])))
      throw new Error('Ship violates the settlement spacing rule.');
    if(!connected.some(edge=>state.roads[edge.id]===player.id))
      throw new Error('Ship must connect to one of your existing roads.');
    pay(state,player.id,SHIP_COST as Hand);
    state.buildings[vertex.id]={playerId:player.id,kind:'ship'};
  } else if (command.type === 'build-city') {
    if (state.buildings[command.vertexId]?.playerId !== player.id || state.buildings[command.vertexId]?.kind !== 'settlement' || !player.cities) throw new Error('City requires an owned settlement and available city.');
    pay(state, player.id, CITY); state.buildings[command.vertexId].kind = 'city'; player.cities--; player.settlements++;
  } else throw new Error('Unknown building command.');
  updateLongestRoute(state); return state;
}
