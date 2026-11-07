import type { Development, GameState, Resource } from '../rules/state.ts';

export type PlayableDevelopment = Exclude<Development,'victory-point'>;
const PLAY_ORDER: readonly PlayableDevelopment[] = ['knight','road-building','invention','monopoly'];

export function playableDevelopmentTypes(state:GameState, playerId:string):PlayableDevelopment[] {
  const player=state.players.find(p=>p.id===playerId);
  if(!player)return [];
  return PLAY_ORDER.filter(type=>player.cards.some(card=>card.type===type&&card.boughtTurn<state.turn));
}

export function bankTradeRate(state:GameState, playerId:string, resource:Resource):2|3|4 {
  const owns=(kind:string)=>state.board.ports.some(port=>port.type===kind&&port.vertexIds.some(vertexId=>state.buildings[vertexId]?.playerId===playerId));
  if(owns(resource))return 2;
  if(owns('generic'))return 3;
  return 4;
}
