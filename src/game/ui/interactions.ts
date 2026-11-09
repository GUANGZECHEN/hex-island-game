import type { Development, GameState } from '../rules/state.ts';
export { bankTradeRate } from '../rules/legal.ts';

export type PlayableDevelopment = Exclude<Development,'victory-point'>;
const PLAY_ORDER: readonly PlayableDevelopment[] = ['knight','road-building','invention','monopoly'];

export function playableDevelopmentTypes(state:GameState, playerId:string):PlayableDevelopment[] {
  const player=state.players.find(p=>p.id===playerId);
  if(!player)return [];
  return PLAY_ORDER.filter(type=>player.cards.some(card=>card.type===type&&card.boughtTurn<state.turn));
}

