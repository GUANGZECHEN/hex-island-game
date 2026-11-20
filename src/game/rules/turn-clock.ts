import { legalTargetIds } from './legal.ts';
import { RESOURCES, type GameState, type SetupCommand, type Hand } from './state.ts';
import type { TurnCommand } from './turn.ts';
import type { EconomyCommand } from './economy.ts';

export const ACTION_WINDOW_MS=30_000;
export type TurnClockSnapshot={playerId:string;remainingMs:number};

/** Only the active player is timed, except during simultaneous seven discards,
 * when everyone with an outstanding discard has their own 30-second clock. */
export function clockParticipants(state:GameState,pendingDiscards:Record<string,Hand>={}):string[]{
 if(state.phase==='finished')return [];
 if(state.phase==='discard')return state.players.filter(p=>state.discards[p.id]&&!pendingDiscards[p.id]).map(p=>p.id);
 const active=state.players[state.currentSeat];
 return active?[active.id]:[];
}

/** Deterministic, rule-validated forced progress. The caller (host authority or
 * local game) alone chooses to invoke this after an actual 30s expiry.
 * Existing reducers still validate the generated command. */
export function timeoutCommand(state:GameState,playerId:string):SetupCommand|TurnCommand|EconomyCommand|null {
 if(state.phase==='discard'&&state.discards[playerId]){
  const hand=state.players.find(p=>p.id===playerId)?.hand;
  if(!hand)return null;
  let left=state.discards[playerId];
  const cards=Object.fromEntries(RESOURCES.map(r=>{const count=Math.min(left,hand[r]);left-=count;return [r,count];})) as Hand;
  return left===0?{type:'discard',playerId,cards}:null;
 }
 if(state.players[state.currentSeat]?.id!==playerId)return null;
 if(state.phase==='setup-city'){
  const vertexId=legalTargetIds(state,playerId,'city')[0];
  return vertexId?{type:'place-city',playerId,vertexId}:null;
 }
 if(state.phase==='setup-settlement'){
  const vertexId=legalTargetIds(state,playerId,'settlement')[0];
  return vertexId?{type:'place-settlement',playerId,vertexId}:null;
 }
 if(state.phase==='setup-road'){
  const edgeId=legalTargetIds(state,playerId,'road')[0];
  return edgeId?{type:'place-road',playerId,edgeId}:null;
 }
 if(state.phase==='roll')return {type:'roll',playerId};
 if(state.phase==='robber'){
  const hexId=legalTargetIds(state,playerId,'robber')[0];
  return hexId?{type:'move-robber',playerId,hexId}:null;
 }
 if(state.phase==='steal')return state.victims[0]?{type:'steal',playerId,victimId:state.victims[0]}:null;
 if(state.phase==='free-road')return {type:'stop-free-roads',playerId};
 if(state.phase==='action')return {type:'end-turn',playerId};
 return null;
}

export function remainingClockSeconds(ms:number):number {
 return Math.max(0,Math.min(30,Math.ceil(ms/1000)));
}
