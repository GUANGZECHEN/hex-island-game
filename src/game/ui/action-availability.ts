import { createIslandBoard } from '../board/geometry.ts';
import { bankTradeRate, legalTargetIds, type TargetMode } from '../rules/legal.ts';
import { usesDevelopmentCards } from '../rules/economy.ts';
import { isHarbor, partnersConnected } from '../rules/harbor.ts';
import { stationCost, usesTradeStations } from '../rules/trade-stations.ts';
import { SHIP_COST, shipsRemaining } from '../rules/build.ts';
import { publicVictoryPoints, RESOURCES, type GameState, type Hand, type Resource } from '../rules/state.ts';

export interface Availability { visible: boolean; enabled: boolean }
export interface AvailabilityContext {
 paused?: boolean; canUndo?: boolean; deckCount?: number; discardSubmitted?: boolean;
 discard?: Hand; offer?: { targets: string[]; give: Hand; receive: Hand };
 invention?: Resource[]; victimId?: string;
}
export type ActionName = 'roll'|'road'|'settlement'|'city'|'station'|'ship'|'endTurn'|'undo'|'discard'|'robber'|'steal'|'finishFreeRoads'|'claimVictory'|'buyDevelopment'|'knight'|'roadBuilding'|'monopoly'|'yearOfPlenty'|'offer'|'cancelOffer'|'acceptOffer'|'rejectOffer';
export type ActionAvailability = Record<ActionName, Availability> & {bankTrades: Record<string, Availability>};

const validHand=(h:Hand|undefined):h is Hand=>!!h && typeof h==='object' && !Array.isArray(h) && Object.keys(h).sort().join(',')===[...RESOURCES].sort().join(',') && RESOURCES.every(r=>Number.isInteger(h[r])&&h[r]>=0);
const size=(h:Hand)=>RESOURCES.reduce((n,r)=>n+h[r],0);
const blank=():Hand=>({lumber:0,brick:0,wool:0,grain:0,ore:0});

/** Calculate UI availability from public information and the viewer's own private data.
 * The host still validates every command: another player's resources may have changed.
 * Never execute random commands or inspect another player's hand/cards here.
 */
export type AvailabilityDraft = Pick<AvailabilityContext,'discard'|'offer'|'invention'|'victimId'>;
export type ActionAvailabilityReader = ((draft?:AvailabilityDraft)=>ActionAvailability) & {
 targetIds(mode:TargetMode):readonly string[];
};

/** Create one reader per immutable state/render; draft updates reuse board legality. */
export function createActionAvailabilityReader(state:GameState, playerId:string, context:AvailabilityContext={}):ActionAvailabilityReader {
 const player=state.players.find(p=>p.id===playerId);
 const active=!!player&&state.players[state.currentSeat]?.id===playerId;
 const ready=!!player&&!context.paused&&state.phase!=='finished';
 const turn=ready&&active;
 const action=turn&&state.phase==='action';
 const dev=usesDevelopmentCards(state), stations=usesTradeStations(state), classic=!isHarbor(state);
 const seven=!(isHarbor(state)&&state.harbor?.version===3);
 const availability=(visible:boolean, enabled:boolean):Availability=>({visible,enabled:visible&&enabled});
 // Reducer-based target queries receive a public-only copy of other players, never their hands/cards.
 const safeState:GameState={...state,players:state.players.map(p=>p.id===playerId?p:{id:p.id,seat:p.seat,roads:p.roads,settlements:p.settlements,cities:p.cities,knights:p.knights,hand:blank(),cards:[]})};
 const canPay=(cost:Partial<Hand>)=>!!player&&RESOURCES.every(r=>player.hand[r]>=(cost[r]??0));
 const cachedTargets=new Map<TargetMode,readonly string[]>();
 const targetIds=(mode:TargetMode):readonly string[]=>{
  const cached=cachedTargets.get(mode);
  if(cached)return cached;
  if(!turn||!player)return [];
  // Skip expensive reducer/geometry scans when the phase, pieces or cost alone
  // already rule out every target. Geometry remains the reducer's decision.
  if(mode==='road'&&(!['setup-road','free-road','action'].includes(state.phase)||!player.roads||(state.phase==='action'&&!canPay({lumber:1,brick:1}))))return [];
  if(mode==='settlement'&&(!['setup-settlement','action'].includes(state.phase)||!player.settlements||(state.phase==='action'&&!canPay({lumber:1,brick:1,wool:1,grain:1}))))return [];
  if(mode==='city'&&(!['setup-city','action'].includes(state.phase)||!player.cities||(state.phase==='action'&&!canPay({grain:2,ore:3}))))return [];
  if(mode==='station'&&(!stations||state.phase!=='action'||!canPay(stationCost(state))))return [];
  if(mode==='ship'&&(!classic||!state.rules?.ships||state.phase!=='action'||!shipsRemaining(state,playerId)||!canPay(SHIP_COST)))return [];
  if(mode==='robber'&&(!seven||state.phase!=='robber'))return [];
  const ids=mode==='robber'
   ?createIslandBoard(state.board.layout).hexes.filter(hex=>hex.id!==state.board.robberHexId).map(hex=>hex.id)
   :legalTargetIds(safeState,playerId,mode);
  cachedTargets.set(mode,ids);
  return ids;
 };
 const targets=(mode:TargetMode)=>targetIds(mode).length>0;
 const card=(type:'knight'|'road-building'|'monopoly'|'invention')=>dev&&turn&&(state.phase==='roll'||state.phase==='action')&&!state.playedDevelopment&&!!player?.cards.some(c=>c.type===type&&c.boughtTurn<state.turn);
 const incoming=!!state.offer&&state.phase==='action'&&state.offer.proposer===state.players[state.currentSeat]?.id&&state.offer.targets.includes(playerId)&&(!isHarbor(state)||partnersConnected(safeState,playerId,state.offer.proposer));
 const result={
  roll:availability(true,turn&&state.phase==='roll'),
  road:availability(true,targets('road')),
  settlement:availability(true,targets('settlement')),
  city:availability(true,targets('city')),
  station:availability(stations,stations&&targets('station')),
  ship:availability(classic&&!!state.rules?.ships,classic&&!!state.rules?.ships&&targets('ship')),
  endTurn:availability(true,action), undo:availability(true,ready&&!!context.canUndo),
  discard:availability(seven,false),
  robber:availability(seven,targets('robber')),
  steal:availability(classic,false),
  finishFreeRoads:availability(dev,turn&&state.phase==='free-road'),
  claimVictory:availability(classic,turn&&state.phase!=='setup-settlement'&&state.phase!=='setup-road'&&!!player&&publicVictoryPoints(state,playerId)+player.cards.filter(c=>c.type==='victory-point').length>=10),
  buyDevelopment:availability(dev,action&&(context.deckCount??state.deck.length)>0&&!!player&&player.hand.wool>=1&&player.hand.grain>=1&&player.hand.ore>=1),
  knight:availability(dev,card('knight')), roadBuilding:availability(dev,card('road-building')),
  monopoly:availability(dev,card('monopoly')), yearOfPlenty:availability(dev,false),
  offer:availability(!stations,false),
  cancelOffer:availability(!stations,action&&!!state.offer&&state.offer.proposer===playerId),
  acceptOffer:availability(!stations,ready&&!stations&&incoming&&!!player&&!!state.offer&&RESOURCES.every(r=>player.hand[r]>=state.offer!.receive[r])),
  rejectOffer:availability(!stations,ready&&incoming),
  bankTrades:{} as Record<string,Availability>,
 };
 for(const give of RESOURCES)for(const receive of RESOURCES)if(give!==receive){
  const rate=bankTradeRate(state,playerId,give);
  result.bankTrades[`${give}:${receive}`]=availability(true,action&&!!player&&player.hand[give]>=rate&&state.bank[receive]>0);
 }
 const inventionCard=card('invention');
 const read=(draft:AvailabilityDraft={}):ActionAvailability=>{
  const selection={...context,...draft};
  const invention=selection.invention;
  const inventionValid=Array.isArray(invention)&&invention.length===2&&invention.every(r=>RESOURCES.includes(r))&&RESOURCES.every(r=>invention.filter(x=>x===r).length<=state.bank[r]);
  const offer=selection.offer;
  const offerValid=!!offer&&Array.isArray(offer.targets)&&offer.targets.length>0&&new Set(offer.targets).size===offer.targets.length&&offer.targets.every(id=>id!==playerId&&state.players.some(p=>p.id===id)&&(!isHarbor(state)||partnersConnected(safeState,playerId,id)))&&validHand(offer.give)&&validHand(offer.receive)&&size(offer.give)>0&&size(offer.receive)>0&&!!player&&RESOURCES.every(r=>offer.give[r]<=player.hand[r]);
  const discard=selection.discard;
  return {...result,
   discard:availability(seven,ready&&state.phase==='discard'&&!context.discardSubmitted&&!!state.discards[playerId]&&validHand(discard)&&!!player&&size(discard)===state.discards[playerId]&&RESOURCES.every(r=>discard[r]<=player.hand[r])),
   steal:availability(classic,turn&&state.phase==='steal'&&!!selection.victimId&&state.victims.includes(selection.victimId)),
   yearOfPlenty:availability(dev,inventionCard&&inventionValid),
   offer:availability(!stations,action&&!stations&&offerValid),
  };
 };
 return Object.assign(read,{targetIds});
}

/** Convenience wrapper for one-off queries, including draft values in context. */
export function getActionAvailability(state:GameState, playerId:string, context:AvailabilityContext={}):ActionAvailability {
 return createActionAvailabilityReader(state,playerId,context)();
}
