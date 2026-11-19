import { shipsRemaining, SHIP_COST } from '../rules/build.ts';
import { legalTargetIds } from '../rules/legal.ts';
import type { GameState } from '../rules/state.ts';
import { affordable } from './icons.ts';

export interface ShipActionAvailability {
  remaining: number;
  enabled: boolean;
  reason: string | null;
}

/** Ship command visibility is separate from eligibility: explain why a player
 * cannot build instead of silently removing the action when there is no target.
 * The host-authoritative reducer remains the final validator of placement.
 */
export function shipActionAvailability(state: GameState, playerId: string): ShipActionAvailability {
  const remaining=shipsRemaining(state,playerId);
  const blocked=(reason:string):ShipActionAvailability=>({remaining,enabled:false,reason});
  if(state.mode!=='classic'||!state.rules?.ships)
    return blocked('Harbor ships must be enabled by the host in the lobby before the game.');
  if(state.phase!=='action'||state.players[state.currentSeat]?.id!==playerId)
    return blocked('Build ships during your action phase.');
  const hand=state.players.find(player=>player.id===playerId)?.hand;
  if(!hand)return blocked('No active player hand.');
  if(remaining===0)return blocked('Both of your ships have already been built.');
  if(!affordable(hand,SHIP_COST))return blocked('Need 3 wood, 3 brick and 3 ore.');
  if(!state.board.ports.some(port=>port.vertexIds.some(vertex=>state.buildings[vertex]?.playerId===playerId)))
    return blocked('Build a settlement or city on a port first.');
  if(!legalTargetIds(state,playerId,'ship').length)
    return blocked('Connect your own road to a free port vertex, with settlement spacing.');
  return {remaining,enabled:true,reason:null};
}
