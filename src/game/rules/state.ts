import { boardPlayerRange, createIslandBoard, type BoardLayout } from '../board/geometry.ts';
import { GENERATOR_VERSION, generateBoardSetup, type BoardSetup } from '../board/setup.ts';

import { beginHarbor, createHarborState, type GameMode, type HarborState } from './harbor.ts';
import { usesTradeStations } from './trade-stations.ts';
import { validateOptionalRules, type OptionalRules } from './optional-rules.ts';

export const RESOURCES = ['lumber', 'brick', 'wool', 'grain', 'ore'] as const;
export type Resource = typeof RESOURCES[number];
export type Hand = Record<Resource, number>;
export type Development = 'knight' | 'monopoly' | 'road-building' | 'invention' | 'victory-point';
export interface RollPayout {
  turn: number;
  dice: [number, number];
  playerId: string;
  gains: Record<string, number>;
}
export interface Player {
  id: string; seat: number; hand: Hand; cards: { type: Development; boughtTurn: number }[];
  roads: number; settlements: number; cities: number; knights: number;
}
export interface Building { playerId: string; kind: 'settlement' | 'city' | 'ship' }
export interface TradeOffer { id: string; proposer: string; targets: string[]; give: Hand; receive: Hand; }
export interface GameState {
  mode?:GameMode; harbor?:HarborState; rules?:OptionalRules;
  lastRollPayout?: RollPayout;
  catchUpReward?: {turn:number;playerId:string;gains:Hand};
  version: 1; board: BoardSetup; players: Player[];
  /** Signed accounting ledger anchored at 19 per resource, not a limit on supply. */
  bank: Hand; deck: Development[];
  randomState: number; playedCards: Development[]; startingSeat: number; currentSeat: number; turn: number;
  phase: 'setup-settlement' | 'setup-city' | 'setup-road' | 'roll' | 'discard' | 'robber' | 'pirate' | 'steal' | 'action' | 'free-road' | 'finished'; setupStep: number;
  longestHolder: string | null; armyHolder: string | null; playedDevelopment: boolean; resumePhase: 'roll' | 'action' | null; freeRoads: number; winner: string | null;
  offer: TradeOffer | null; dice: [number, number] | null; discards: Record<string, number>; victims: string[];
  setupRoadEdges?:string[]; pendingSettlement: string | null; buildings: Record<string, Building>; roads: Record<string, string>;
}
export type SetupCommand = { type: 'place-settlement'|'place-city'; playerId: string; vertexId: string } | { type: 'place-road'; playerId: string; edgeId: string };
export function isTwinCapes(state:Partial<Pick<GameState,'board'>>):boolean {
  return state.board?.layout==='twin-capes';
}
/** Only the original Twin Capes board uses the harbor-blocking pirate. */
export function usesHarborPirate(state: Partial<Pick<GameState,'board'>>): boolean {
  return isTwinCapes(state) && state.board?.version === GENERATOR_VERSION;
}
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
export function createGame(seed: number, ids: readonly string[], secureRandom?: () => number, options?: { qaTwoPlayers?: boolean; boardLayout?: BoardLayout; mode?:GameMode; rules?:OptionalRules }): GameState {
  const mode=options?.mode??'classic';
  if(mode!=='classic'&&mode!=='harbor-coop')throw new Error('Invalid game mode.');
  const rules=validateOptionalRules(options?.rules);
  if(mode==='harbor-coop'&&(rules.catchUp||rules.ships))throw new Error('Classic optional rules are not available in Harbor Co-op.');
  if(mode==='harbor-coop'&&(ids.length!==2||(options?.boardLayout??'standard')!=='standard'))throw new Error('Harbor Co-op requires two players on the standard board.');
  const boardLayout=options?.boardLayout??'standard';
  const {min,max}=boardPlayerRange(boardLayout);
  const validCount=ids.length>=min&&ids.length<=max;
  if(!validCount||ids.some(id=>typeof id!=='string'||!id)||new Set(ids).size!==ids.length){
    const requirement={
      standard:'The standard board requires two to four distinct player IDs.',
      'expanded-5-6':'The 5–6 player board requires five or six distinct player IDs.',
      'twin-capes':'Twin Capes requires two to six distinct player IDs.',
    };
    throw new Error(requirement[boardLayout]);
  }
  const board = generateBoardSetup(seed,boardLayout);
  if(isTwinCapes({board}))rules.ships=true;
  let randomState = seed;
  const deck: Development[] = mode==='harbor-coop'?[]:[...Array<Development>(14).fill('knight'), ...Array<Development>(2).fill('monopoly'), ...Array<Development>(2).fill('road-building'), ...Array<Development>(2).fill('invention'), ...Array<Development>(5).fill('victory-point')];
  for (let i = deck.length - 1; i > 0; i--) {
    const draw = secureRandom ? secureIndex(secureRandom, i + 1) : drawIndex(randomState, i + 1); randomState = draw.state ?? randomState;
    [deck[i], deck[draw.index]] = [deck[draw.index], deck[i]];
  }
  const start = secureRandom ? secureIndex(secureRandom, ids.length) : drawIndex(randomState, ids.length); randomState = start.state ?? randomState;
  const game:GameState = { version: 1, rules, board, players: ids.map((id, seat) => ({ id, seat, hand: emptyHand(), cards: [], roads: 15, settlements: 5, cities: 4, knights: 0 })), bank: { lumber: 19, brick: 19, wool: 19, grain: 19, ore: 19 }, deck, randomState, playedCards: [], startingSeat: start.index, currentSeat: start.index, turn: 0, phase: 'setup-settlement', setupStep: 0, longestHolder: null, armyHolder: null, playedDevelopment: false, resumePhase: null, freeRoads: 0, winner: null, offer: null, dice: null, discards: {}, victims: [], pendingSettlement: null, buildings: {}, roads: {} };
  if(mode==='harbor-coop'){game.mode=mode;game.harbor=createHarborState();for(const p of game.players)for(const r of ['lumber','brick','wool','grain'] as const){p.hand[r]++;game.bank[r]--;}game.setupRoadEdges=[];game.phase=game.currentSeat===1?'setup-city':'setup-settlement';beginHarbor(game);}
  return game;
}
export function publicVictoryPoints(state: GameState, id: string): number {
  return Object.values(state.buildings).filter(building => building.playerId === id).reduce((sum, building) => sum + (building.kind === 'city' ? 2 : 1), 0) + (state.longestHolder === id ? 2 : 0) + (state.armyHolder === id ? 2 : 0);
}
/** Advance a complete snake placement (two roads for the builder, no roads for the city player). */
function advanceSetup(state:GameState):void {
 state.pendingSettlement=null;if(usesTradeStations(state))state.setupRoadEdges=[];state.setupStep++;
 const n=state.players.length;
 if(state.setupStep===2*n){state.phase='roll';state.currentSeat=state.startingSeat;state.turn=1;beginHarbor(state);}
 else {const offset=state.setupStep<n?state.setupStep:2*n-1-state.setupStep;state.currentSeat=(state.startingSeat+offset)%n;state.phase=usesTradeStations(state)&&state.currentSeat===1?'setup-city':'setup-settlement';}
}
/** Validate and apply one setup command without changing the supplied state. */
export function applySetupCommand(original:GameState,command:SetupCommand):GameState {
 if(!original||!command||original.players[original.currentSeat]?.id!==command.playerId)throw new Error('Not the active player.');
 const state=structuredClone(original),board=createIslandBoard(state.board.layout, state.board.version),player=state.players[state.currentSeat];
 const city=usesTradeStations(state)&&player.seat===1;
 if((command.type==='place-settlement'&&!city&&state.phase==='setup-settlement')||(command.type==='place-city'&&city&&state.phase==='setup-city')){
  const vertex=board.vertices.find(v=>v.id===command.vertexId);
  if(!vertex||state.buildings[vertex.id]||(city?player.cities:player.settlements)<=0)throw new Error('Invalid starting building location.');
  const adjoining=board.edges.filter(e=>e.vertexIds.includes(vertex.id)).flatMap(e=>e.vertexIds.filter(id=>id!==vertex.id));
  if(adjoining.some(id=>state.buildings[id]))throw new Error('Settlement violates distance rule.');
  state.buildings[vertex.id]={playerId:player.id,kind:city?'city':'settlement'};
  if(city)player.cities--;else player.settlements--;
  state.pendingSettlement=vertex.id;
  if(state.setupStep>=state.players.length)for(const hex of board.hexes.filter(h=>h.vertexIds.includes(vertex.id))){
   const resource=state.board.hexes.find(item=>item.hexId===hex.id)!.resource;
   if(resource){const count=city?2:1;state.bank[resource]-=count;player.hand[resource]+=count;}
  }
  if(city)advanceSetup(state);else{state.phase='setup-road';if(usesTradeStations(state))state.setupRoadEdges=[];}
 }else if(command.type==='place-road'&&state.phase==='setup-road'){
  const edge=board.edges.find(e=>e.id===command.edgeId);
  const anchors=new Set([state.pendingSettlement]);
  if(usesTradeStations(state))for(const id of state.setupRoadEdges??[])for(const v of board.edges.find(e=>e.id===id)?.vertexIds??[])anchors.add(v);
  if(!edge||!state.pendingSettlement||!edge.vertexIds.some(id=>anchors.has(id))||state.roads[edge.id]||player.roads<=0)throw new Error('Invalid setup road.');
  state.roads[edge.id]=player.id;player.roads--;
  if(usesTradeStations(state)){state.setupRoadEdges!.push(edge.id);if(state.setupRoadEdges!.length<2)return state;}
  advanceSetup(state);
 }else throw new Error('Command is not allowed in this phase.');
 return state;
}
