import { createIslandBoard } from '../board/geometry.ts';
import { bankTradeRate, legalTargetIds } from '../rules/legal.ts';
import { publicVictoryPoints, RESOURCES, type GameState, type Hand, type Resource, type SetupCommand } from '../rules/state.ts';
import type { TurnCommand } from '../rules/turn.ts';
import type { BuildCommand } from '../rules/build.ts';
import type { EconomyCommand } from '../rules/economy.ts';

export type BotCommand = SetupCommand | TurnCommand | BuildCommand | EconomyCommand;

const ROAD:Hand={lumber:1,brick:1,wool:0,grain:0,ore:0};
const SETTLEMENT:Hand={lumber:1,brick:1,wool:1,grain:1,ore:0};
const CITY:Hand={lumber:0,brick:0,wool:0,grain:2,ore:3};
const CARD:Hand={lumber:0,brick:0,wool:1,grain:1,ore:1};
const PIPS:Readonly<Record<number,number>>={2:1,3:2,4:3,5:4,6:5,8:5,9:4,10:3,11:2,12:1};

const size=(hand:Hand)=>RESOURCES.reduce((sum,resource)=>sum+hand[resource],0);
const affordable=(hand:Hand,cost:Hand)=>RESOURCES.every(resource=>hand[resource]>=cost[resource]);
const blankHand=():Hand=>({lumber:0,brick:0,wool:0,grain:0,ore:0});

function chooseDiscard(state:GameState,botId:string,required:number):Hand {
 const player=state.players.find(item=>item.id===botId);
 if(!player)throw new Error('Unknown bot.');
 const result=blankHand(),ordered=[...RESOURCES].sort((a,b)=>player.hand[b]-player.hand[a]||a.localeCompare(b));
 let left=required;
 for(const resource of ordered){const take=Math.min(left,player.hand[resource]);result[resource]=take;left-=take;if(left===0)break;}
 return result;
}

function bestSettlement(state:GameState,botId:string):string|null {
 const legal=legalTargetIds(state,botId,'settlement');
 if(!legal.length)return null;
 const board=createIslandBoard(state.board.layout),setup=new Map(state.board.hexes.map(hex=>[hex.hexId,hex]));
 const score=(vertexId:string)=>{
  const adjacent=board.hexes.filter(hex=>hex.vertexIds.includes(vertexId));
  const resources=new Set<Resource>();
  let total=0;
  for(const hex of adjacent){const item=setup.get(hex.id)!;if(item.resource)resources.add(item.resource);if(item.token)total+=PIPS[item.token]??0;}
  if(state.board.ports.some(port=>port.vertexIds.includes(vertexId)))total+=1;
  return total+resources.size*.6;
 };
 return [...legal].sort((a,b)=>score(b)-score(a)||a.localeCompare(b))[0];
}

function bestRobberHex(state:GameState,botId:string):string|null {
 const legal=legalTargetIds(state,botId,'robber');
 if(!legal.length)return null;
 const board=createIslandBoard(state.board.layout),setup=new Map(state.board.hexes.map(hex=>[hex.hexId,hex]));
 const score=(hexId:string)=>{
  const hex=board.hexes.find(item=>item.id===hexId)!;let total=setup.get(hexId)?.token ? PIPS[setup.get(hexId)!.token!]??0 : 0;
  for(const vertexId of hex.vertexIds){const building=state.buildings[vertexId];if(!building)continue;total+=building.playerId===botId?-4:building.kind==='city'?6:3;}
  return total;
 };
 return [...legal].sort((a,b)=>score(b)-score(a)||a.localeCompare(b))[0];
}

function playableCards(state:GameState,botId:string){
 const player=state.players.find(item=>item.id===botId);
 if(!player||state.playedDevelopment)return [] as Array<'knight'|'road-building'|'monopoly'|'invention'>;
 return [...new Set(player.cards.filter(card=>card.boughtTurn<state.turn&&card.type!=='victory-point').map(card=>card.type))] as Array<'knight'|'road-building'|'monopoly'|'invention'>;
}

function inventionResources(state:GameState,botId:string):Resource[]|null {
 const player=state.players.find(item=>item.id===botId)!;
 const ordered=[...RESOURCES].sort((a,b)=>player.hand[a]-player.hand[b]||state.bank[b]-state.bank[a]||a.localeCompare(b));
 for(const first of ordered){
  if(state.bank[first]>=2)return [first,first];
  if(state.bank[first]>=1){const second=ordered.find(resource=>state.bank[resource]>=1&&resource!==first);if(second)return [first,second];}
 }
 return null;
}

function monopolyResource(state:GameState,botId:string):Resource {
 const player=state.players.find(item=>item.id===botId)!;
 return [...RESOURCES].sort((a,b)=>player.hand[a]-player.hand[b]||a.localeCompare(b))[0];
}

function chooseBankTrade(state:GameState,botId:string):EconomyCommand|null {
 const player=state.players.find(item=>item.id===botId)!;
 for(const cost of [CITY,SETTLEMENT,CARD,ROAD]){
  for(const receive of RESOURCES){
   if(player.hand[receive]>=cost[receive]||state.bank[receive]<1)continue;
   for(const give of RESOURCES){
    if(give===receive)continue;
    const rate=bankTradeRate(state,botId,give);
    if(player.hand[give]-cost[give]>=rate)return {type:'bank-trade',playerId:botId,give,receive,rate};
   }
  }
 }
 return null;
}

/** Deterministic local test-bot policy. It returns one legal-intent command at a time. */
export function chooseBotCommand(state:GameState,botId:string):BotCommand|null {
 const player=state.players.find(item=>item.id===botId);
 if(!player||state.phase==='finished')return null;

 if(state.offer?.targets.includes(botId)&&state.offer.proposer!==botId){
  const canPay=RESOURCES.every(resource=>player.hand[resource]>=state.offer!.receive[resource]);
  const receives=size(state.offer.give),gives=size(state.offer.receive);
  return {type:canPay&&receives>=gives?'accept-offer':'reject-offer',playerId:botId,id:state.offer.id};
 }

 const required=state.discards[botId];
 if(required&&state.phase==='discard')return {type:'discard',playerId:botId,cards:chooseDiscard(state,botId,required)};

 if(state.players[state.currentSeat]?.id!==botId)return null;

 if(state.phase==='setup-settlement'){
  const vertexId=bestSettlement(state,botId);return vertexId?{type:'place-settlement',playerId:botId,vertexId}:null;
 }
 if(state.phase==='setup-road'){
  const edgeId=legalTargetIds(state,botId,'road').sort()[0];return edgeId?{type:'place-road',playerId:botId,edgeId}:null;
 }
 if(state.phase==='roll')return {type:'roll',playerId:botId};
 if(state.phase==='robber'){
  const hexId=bestRobberHex(state,botId);return hexId?{type:'move-robber',playerId:botId,hexId}:null;
 }
 if(state.phase==='steal'){
  const victimId=[...state.victims].sort((a,b)=>{
   const ah=state.players.find(item=>item.id===a)!,bh=state.players.find(item=>item.id===b)!;
   return size(bh.hand)-size(ah.hand)||a.localeCompare(b);
  })[0];
  return victimId?{type:'steal',playerId:botId,victimId}:null;
 }
 if(state.phase==='free-road'){
  const edgeId=legalTargetIds(state,botId,'road').sort()[0];
  return edgeId?{type:'free-road',playerId:botId,edgeId}:{type:'stop-free-roads',playerId:botId};
 }
 if(state.phase!=='action')return null;

 if(publicVictoryPoints(state,botId)+player.cards.filter(card=>card.type==='victory-point').length>=10)return {type:'claim-victory',playerId:botId};

 const playable=playableCards(state,botId);
 if(playable.includes('knight'))return {type:'play-card',playerId:botId,card:'knight'};
 if(playable.includes('road-building')&&player.roads>0)return {type:'play-card',playerId:botId,card:'road-building'};
 if(playable.includes('invention')){const resources=inventionResources(state,botId);if(resources)return {type:'play-card',playerId:botId,card:'invention',resources};}
 if(playable.includes('monopoly'))return {type:'play-card',playerId:botId,card:'monopoly',resource:monopolyResource(state,botId)};

 const city=legalTargetIds(state,botId,'city').sort()[0];
 if(city&&affordable(player.hand,CITY))return {type:'build-city',playerId:botId,vertexId:city};
 const settlement=legalTargetIds(state,botId,'settlement').sort()[0];
 if(settlement&&affordable(player.hand,SETTLEMENT))return {type:'build-settlement',playerId:botId,vertexId:settlement};
 const road=legalTargetIds(state,botId,'road').sort()[0];
 if(road&&affordable(player.hand,ROAD))return {type:'build-road',playerId:botId,edgeId:road};
 if(state.deck.length&&affordable(player.hand,CARD))return {type:'buy-card',playerId:botId};
 const trade=chooseBankTrade(state,botId);if(trade)return trade;
 return {type:'end-turn',playerId:botId};
}
