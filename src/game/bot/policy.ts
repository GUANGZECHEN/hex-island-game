import { publicVictoryPoints, type GameState, type SetupCommand } from '../rules/state.ts';
import type { TurnCommand } from '../rules/turn.ts';
import type { BuildCommand } from '../rules/build.ts';
import type { EconomyCommand } from '../rules/economy.ts';
import {
 affordableAction,bestRoad,bestRobberHex,bestSettlement,bestVictim,chooseBankTrade,chooseDiscard,COSTS,
 chooseInventionResources,monopolyResource,savingGoal,shouldPlayKnight,shouldPlayRoadBuilding,tradeOfferWorthAccepting,
} from './strategy.ts';

export type BotCommand = SetupCommand | TurnCommand | BuildCommand | EconomyCommand;

function playableCards(state:GameState,botId:string){
 const player=state.players.find(item=>item.id===botId);
 if(!player||state.playedDevelopment)return [] as Array<'knight'|'road-building'|'monopoly'|'invention'>;
 return [...new Set(player.cards.filter(card=>card.boughtTurn<state.turn&&card.type!=='victory-point').map(card=>card.type))] as Array<'knight'|'road-building'|'monopoly'|'invention'>;
}

/** Deterministic strategy bot. It uses public board information plus its own private hand, never opponents' hidden resource identities. */
export function chooseBotCommand(state:GameState,botId:string):BotCommand|null {
 const player=state.players.find(item=>item.id===botId);
 if(!player||state.phase==='finished')return null;

 if(state.offer?.targets.includes(botId)&&state.offer.proposer!==botId){
  return {type:tradeOfferWorthAccepting(state,botId)?'accept-offer':'reject-offer',playerId:botId,id:state.offer.id};
 }

 const required=state.discards[botId];
 if(required&&state.phase==='discard')return {type:'discard',playerId:botId,cards:chooseDiscard(state,botId,required)};

 if(state.players[state.currentSeat]?.id!==botId)return null;

 if(state.phase==='setup-settlement'){
  const vertexId=bestSettlement(state,botId,true);return vertexId?{type:'place-settlement',playerId:botId,vertexId}:null;
 }
 if(state.phase==='setup-road'){
  const edgeId=bestRoad(state,botId,true);return edgeId?{type:'place-road',playerId:botId,edgeId}:null;
 }
 if(state.phase==='roll')return {type:'roll',playerId:botId};
 if(state.phase==='robber'){
  const hexId=bestRobberHex(state,botId);return hexId?{type:'move-robber',playerId:botId,hexId}:null;
 }
 if(state.phase==='steal'){
  const victimId=bestVictim(state);return victimId?{type:'steal',playerId:botId,victimId}:null;
 }
 if(state.phase==='free-road'){
  const edgeId=bestRoad(state,botId,true);
  return edgeId?{type:'free-road',playerId:botId,edgeId}:{type:'stop-free-roads',playerId:botId};
 }
 if(state.phase!=='action')return null;

 if(publicVictoryPoints(state,botId)+player.cards.filter(card=>card.type==='victory-point').length>=10)return {type:'claim-victory',playerId:botId};

 const playable=playableCards(state,botId);
 if(playable.includes('knight')&&shouldPlayKnight(state,botId))return {type:'play-card',playerId:botId,card:'knight'};
 if(playable.includes('invention')){
  const resources=chooseInventionResources(state,botId);
  if(resources)return {type:'play-card',playerId:botId,card:'invention',resources};
 }
 if(playable.includes('monopoly')){
  const choice=monopolyResource(state,botId);
  if(choice.count>=3||(choice.count>=2&&publicVictoryPoints(state,botId)>=7))return {type:'play-card',playerId:botId,card:'monopoly',resource:choice.resource};
 }
 if(playable.includes('road-building')&&player.roads>0&&shouldPlayRoadBuilding(state,botId))return {type:'play-card',playerId:botId,card:'road-building'};

 const reserve=savingGoal(state,botId);
 if(reserve){
  if(reserve.kind==='settlement'&&reserve.missing===0&&reserve.targetId)return {type:'build-settlement',playerId:botId,vertexId:reserve.targetId};
  if(reserve.kind==='city'&&reserve.missing===0&&reserve.targetId)return {type:'build-city',playerId:botId,vertexId:reserve.targetId};
  const trade=chooseBankTrade(state,botId,reserve.cost);if(trade)return trade;
  if(reserve.kind==='expansion'&&reserve.roadId&&player.roads>0&&player.hand.lumber>=COSTS.road.lumber&&player.hand.brick>=COSTS.road.brick)return {type:'build-road',playerId:botId,edgeId:reserve.roadId};
  return {type:'end-turn',playerId:botId};
 }

 const action=affordableAction(state,botId);
 if(action?.type==='city'&&action.id)return {type:'build-city',playerId:botId,vertexId:action.id};
 if(action?.type==='settlement'&&action.id)return {type:'build-settlement',playerId:botId,vertexId:action.id};
 if(action?.type==='card')return {type:'buy-card',playerId:botId};
 if(action?.type==='road'&&action.id)return {type:'build-road',playerId:botId,edgeId:action.id};

 const trade=chooseBankTrade(state,botId);if(trade)return trade;
 return {type:'end-turn',playerId:botId};
}
