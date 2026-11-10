import { createIslandBoard } from '../board/geometry.ts';
import { longestRoute } from '../rules/build.ts';
import { bankTradeRate, legalTargetIds } from '../rules/legal.ts';
import { publicVictoryPoints, RESOURCES, type GameState, type Hand, type Resource } from '../rules/state.ts';
import type { EconomyCommand } from '../rules/economy.ts';

export const PIPS:Readonly<Record<number,number>>={2:1,3:2,4:3,5:4,6:5,8:5,9:4,10:3,11:2,12:1};
export const COSTS={
 road:{lumber:1,brick:1,wool:0,grain:0,ore:0},
 settlement:{lumber:1,brick:1,wool:1,grain:1,ore:0},
 city:{lumber:0,brick:0,wool:0,grain:2,ore:3},
 card:{lumber:0,brick:0,wool:1,grain:1,ore:1},
} as const satisfies Record<string,Hand>;

const BASE_WEIGHT:Readonly<Record<Resource,number>>={grain:1.3,ore:1.25,brick:1.05,lumber:1,wool:.9};
const blank=():Hand=>({lumber:0,brick:0,wool:0,grain:0,ore:0});
const size=(hand:Hand)=>RESOURCES.reduce((sum,r)=>sum+hand[r],0);
export const affordable=(hand:Hand,cost:Hand)=>RESOURCES.every(r=>hand[r]>=cost[r]);
const clamp=(value:number,min:number,max:number)=>Math.max(min,Math.min(max,value));

function geometry(state:GameState){return createIslandBoard(state.board.layout);}
function setupById(state:GameState){return new Map(state.board.hexes.map(hex=>[hex.hexId,hex]));}
function hexesAtVertex(state:GameState,vertexId:string){
 const board=geometry(state);return board.hexes.filter(hex=>hex.vertexIds.includes(vertexId));
}
function adjacentVertices(state:GameState,vertexId:string){
 const board=geometry(state);return board.edges.filter(edge=>edge.vertexIds.includes(vertexId)).flatMap(edge=>edge.vertexIds.filter(id=>id!==vertexId));
}
function distanceLegalSettlement(state:GameState,vertexId:string){
 return !state.buildings[vertexId]&&!adjacentVertices(state,vertexId).some(id=>state.buildings[id]);
}
export function buildableSettlementVertices(state:GameState,playerId:string){
 const board=geometry(state);
 return board.vertices.filter(vertex=>distanceLegalSettlement(state,vertex.id)&&board.edges.some(edge=>edge.vertexIds.includes(vertex.id)&&state.roads[edge.id]===playerId)).map(vertex=>vertex.id);
}
export function upgradableCityVertices(state:GameState,playerId:string){
 return Object.entries(state.buildings).filter(([,b])=>b.playerId===playerId&&b.kind==='settlement').map(([id])=>id);
}
export function buildableRoadEdges(state:GameState,playerId:string){
 const board=geometry(state);
 return board.edges.filter(edge=>!state.roads[edge.id]&&edge.vertexIds.some(vertex=>{
  const occupant=state.buildings[vertex];
  if(occupant)return occupant.playerId===playerId;
  return board.edges.some(other=>other.vertexIds.includes(vertex)&&state.roads[other.id]===playerId);
 })).map(edge=>edge.id);
}

export function productionProfile(state:GameState,playerId:string):Hand {
 const result=blank(),board=geometry(state),setup=setupById(state);
 for(const [vertexId,building] of Object.entries(state.buildings)){
  if(building.playerId!==playerId)continue;
  const multiplier=building.kind==='city'?2:1;
  for(const hex of board.hexes.filter(item=>item.vertexIds.includes(vertexId))){
   const tile=setup.get(hex.id);if(tile?.resource&&tile.token)result[tile.resource]+=multiplier*(PIPS[tile.token]??0);
  }
 }
 return result;
}
function boardResourcePips(state:GameState):Hand {
 const result=blank();for(const hex of state.board.hexes)if(hex.resource&&hex.token)result[hex.resource]+=PIPS[hex.token]??0;return result;
}
function scarcityMultiplier(state:GameState,resource:Resource){
 const totals=boardResourcePips(state),mean=RESOURCES.reduce((sum,r)=>sum+totals[r],0)/RESOURCES.length;
 return clamp(mean/Math.max(1,totals[resource]),.82,1.28);
}
function ownedNumbers(state:GameState,playerId:string){
 const result=new Set<number>(),board=geometry(state),setup=setupById(state);
 for(const [vertexId,b] of Object.entries(state.buildings))if(b.playerId===playerId)for(const hex of board.hexes.filter(h=>h.vertexIds.includes(vertexId))){const token=setup.get(hex.id)?.token;if(token)result.add(token);}
 return result;
}
function portBonus(state:GameState,playerId:string,vertexId:string,candidateProduction:Hand){
 const port=state.board.ports.find(item=>item.vertexIds.includes(vertexId));if(!port)return 0;
 if(port.type==='generic')return 1.1;
 const profile=productionProfile(state,playerId),resource=port.type as Resource;
 return .6+Math.min(2.4,(profile[resource]+candidateProduction[resource])*.22);
}

/** Opening/expansion settlement score: production first, then scarcity, wheat/ore, diversity, complementary resources and usable ports. */
export function settlementScore(state:GameState,playerId:string,vertexId:string):number {
 const setup=setupById(state),profile=productionProfile(state,playerId),numbers=ownedNumbers(state,playerId),candidate=blank();
 let score=0;const unique=new Set<Resource>();
 for(const hex of hexesAtVertex(state,vertexId)){
  const tile=setup.get(hex.id);if(!tile?.resource||!tile.token)continue;
  const resource=tile.resource,pips=PIPS[tile.token]??0;unique.add(resource);candidate[resource]+=pips;
  score+=pips*BASE_WEIGHT[resource]*scarcityMultiplier(state,resource);
  if(profile[resource]===0)score+=resource==='grain'?1.7:resource==='ore'?1.45:.7;
  if(!numbers.has(tile.token))score+=.28;
 }
 score+=unique.size*.42;
 if(candidate.grain>0&&candidate.ore>0)score+=.7;
 if((candidate.lumber>0&&candidate.brick>0)&&profile.lumber+profile.brick<5)score+=.45;
 score+=portBonus(state,playerId,vertexId,candidate);
 return score;
}
export function cityScore(state:GameState,playerId:string,vertexId:string):number {
 const setup=setupById(state);let score=5.5;
 for(const hex of hexesAtVertex(state,vertexId)){
  const tile=setup.get(hex.id);if(tile?.resource&&tile.token)score+=(PIPS[tile.token]??0)*BASE_WEIGHT[tile.resource]*scarcityMultiplier(state,tile.resource);
 }
 return score;
}

function potentialSettlements(state:GameState,playerId:string){
 return geometry(state).vertices.filter(vertex=>distanceLegalSettlement(state,vertex.id)).map(vertex=>({id:vertex.id,score:settlementScore(state,playerId,vertex.id)}));
}
function roadDistanceToTargets(state:GameState,playerId:string,edgeId:string){
 const board=geometry(state),edge=board.edges.find(item=>item.id===edgeId);if(!edge)return 0;
 const targets=potentialSettlements(state,playerId);if(!targets.length)return 0;
 const dist=new Map<string,number>(),queue:Array<{id:string;d:number}>=[];
 for(const vertex of edge.vertexIds){dist.set(vertex,0);queue.push({id:vertex,d:0});}
 while(queue.length){
  queue.sort((a,b)=>a.d-b.d);const current=queue.shift()!;if(current.d!==dist.get(current.id)||current.d>4)continue;
  const occupant=state.buildings[current.id];if(current.d>0&&occupant&&occupant.playerId!==playerId)continue;
  for(const nextEdge of board.edges.filter(item=>item.vertexIds.includes(current.id))){
   if(nextEdge.id===edgeId)continue;
   const owner=state.roads[nextEdge.id];if(owner&&owner!==playerId)continue;
   const next=nextEdge.vertexIds[0]===current.id?nextEdge.vertexIds[1]:nextEdge.vertexIds[0],step=owner===playerId?0:1,nd=current.d+step;
   if(nd<(dist.get(next)??99)){dist.set(next,nd);queue.push({id:next,d:nd});}
  }
 }
 return Math.max(0,...targets.map(target=>target.score/(1+1.45*(dist.get(target.id)??5))));
}
export function roadScore(state:GameState,playerId:string,edgeId:string):number {
 const before=longestRoute(state,playerId),copy=structuredClone(state);copy.roads[edgeId]=playerId;
 const after=longestRoute(copy,playerId),opponentBest=Math.max(0,...state.players.filter(p=>p.id!==playerId).map(p=>longestRoute(state,p.id)));
 let score=roadDistanceToTargets(state,playerId,edgeId)+Math.max(0,after-before)*.9;
 if(after>=5&&after>opponentBest)score+=3.5;
 else if(after>=4&&after>=opponentBest-1)score+=1.5;
 return score;
}
export function bestSettlement(state:GameState,playerId:string,setup=false):string|null {
 const ids=setup?legalTargetIds(state,playerId,'settlement'):buildableSettlementVertices(state,playerId);
 return ids.sort((a,b)=>settlementScore(state,playerId,b)-settlementScore(state,playerId,a)||a.localeCompare(b))[0]??null;
}
export function bestCity(state:GameState,playerId:string):string|null {
 return upgradableCityVertices(state,playerId).sort((a,b)=>cityScore(state,playerId,b)-cityScore(state,playerId,a)||a.localeCompare(b))[0]??null;
}
export function bestRoad(state:GameState,playerId:string,setupOrFree=false):string|null {
 const ids=setupOrFree?legalTargetIds(state,playerId,'road'):buildableRoadEdges(state,playerId);
 return ids.sort((a,b)=>roadScore(state,playerId,b)-roadScore(state,playerId,a)||a.localeCompare(b))[0]??null;
}

export function threatScore(state:GameState,playerId:string){
 const player=state.players.find(p=>p.id===playerId)!;
 return publicVictoryPoints(state,playerId)*3+player.knights*.7+longestRoute(state,playerId)*.3+size(player.hand)*.12;
}
export function bestRobberHex(state:GameState,botId:string):string|null {
 const ids=legalTargetIds(state,botId,'robber'),board=geometry(state),setup=setupById(state);
 const score=(hexId:string)=>{
  const hex=board.hexes.find(item=>item.id===hexId)!;const tile=setup.get(hexId),pips=tile?.token?PIPS[tile.token]??0:0;
  let total=0;
  for(const vertexId of hex.vertexIds){
   const building=state.buildings[vertexId];if(!building)continue;
   const mult=building.kind==='city'?2:1;
   if(building.playerId===botId)total-=pips*mult*3.2;
   else total+=pips*mult*(1+.06*threatScore(state,building.playerId));
  }
  if(tile?.resource==='grain'||tile?.resource==='ore')total+=.4*pips;
  const victims=new Set(hex.vertexIds.map(v=>state.buildings[v]?.playerId).filter((id):id is string=>!!id&&id!==botId));
  if([...victims].some(id=>size(state.players.find(p=>p.id===id)!.hand)>0))total+=1.2;
  return total;
 };
 return ids.sort((a,b)=>score(b)-score(a)||a.localeCompare(b))[0]??null;
}
export function bestVictim(state:GameState):string|null {
 return [...state.victims].sort((a,b)=>threatScore(state,b)-threatScore(state,a)||a.localeCompare(b))[0]??null;
}

function strategicGoalCosts(state:GameState,playerId:string){
 const player=state.players.find(p=>p.id===playerId)!;const goals:Array<{cost:Hand;score:number;kind:string}>=[];
 const city=bestCity(state,playerId);if(city&&player.cities>0)goals.push({cost:COSTS.city,score:7+cityScore(state,playerId,city)*.65,kind:'city'});
 const settlement=bestSettlement(state,playerId);if(settlement&&player.settlements>0)goals.push({cost:COSTS.settlement,score:6.5+settlementScore(state,playerId,settlement)*.48,kind:'settlement'});
 if(state.deck.length) {
  const profile=productionProfile(state,playerId),armyGap=Math.max(0,...state.players.filter(p=>p.id!==playerId).map(p=>p.knights))-player.knights;
  goals.push({cost:COSTS.card,score:8.4+(profile.ore+profile.grain+profile.wool-(profile.lumber+profile.brick))*.08+(armyGap>=0&&player.knights>=1?1:0),kind:'card'});
 }
 const road=bestRoad(state,playerId);if(road&&player.roads>0)goals.push({cost:COSTS.road,score:3.5+roadScore(state,playerId,road)*.62,kind:'road'});
 return goals;
}
function missingCount(hand:Hand,cost:Hand){return RESOURCES.reduce((sum,r)=>sum+Math.max(0,cost[r]-hand[r]),0);}
function preferredGoal(state:GameState,playerId:string){
 const hand=state.players.find(p=>p.id===playerId)!.hand;
 return strategicGoalCosts(state,playerId).sort((a,b)=>(b.score/(1+missingCount(hand,b.cost)))-(a.score/(1+missingCount(hand,a.cost)))||b.score-a.score)[0]??null;
}
function cardValue(state:GameState,playerId:string,resource:Resource){
 const player=state.players.find(p=>p.id===playerId)!,profile=productionProfile(state,playerId),goal=preferredGoal(state,playerId);
 let value=BASE_WEIGHT[resource]*scarcityMultiplier(state,resource);
 if(goal&&player.hand[resource]<goal.cost[resource])value+=1.7;
 if(profile[resource]===0)value+=.35;
 if(profile[resource]>=8)value-=.18;
 if(bankTradeRate(state,playerId,resource)===2)value-=.12;
 return Math.max(.35,value);
}
export function chooseDiscard(state:GameState,playerId:string,required:number):Hand {
 const player=state.players.find(p=>p.id===playerId)!;const result=blank(),left={...player.hand};let remaining=required;
 while(remaining>0){
  const resource=[...RESOURCES].filter(r=>left[r]>0).sort((a,b)=>cardValue(state,playerId,a)-cardValue(state,playerId,b)||left[b]-left[a]||a.localeCompare(b))[0];
  if(!resource)break;result[resource]++;left[resource]--;remaining--;
 }
 return result;
}
export function chooseBankTrade(state:GameState,playerId:string):EconomyCommand|null {
 const player=state.players.find(p=>p.id===playerId)!;
 const goals=strategicGoalCosts(state,playerId).filter(g=>missingCount(player.hand,g.cost)>0).sort((a,b)=>(b.score/(1+missingCount(player.hand,b.cost)))-(a.score/(1+missingCount(player.hand,a.cost))));
 for(const goal of goals){
  const receives=RESOURCES.filter(r=>player.hand[r]<goal.cost[r]&&state.bank[r]>0).sort((a,b)=>cardValue(state,playerId,b)-cardValue(state,playerId,a));
  for(const receive of receives){
   const gives=[...RESOURCES].filter(give=>give!==receive).map(give=>({give,rate:bankTradeRate(state,playerId,give)})).filter(x=>player.hand[x.give]-goal.cost[x.give]>=x.rate).sort((a,b)=>cardValue(state,playerId,a.give)-cardValue(state,playerId,b.give)||a.rate-b.rate);
   if(gives[0])return {type:'bank-trade',playerId,give:gives[0].give,receive,rate:gives[0].rate};
  }
 }
 return null;
}
export function chooseInventionResources(state:GameState,playerId:string):Resource[]|null {
 const player=state.players.find(p=>p.id===playerId)!;
 const goals=strategicGoalCosts(state,playerId).filter(g=>{const missing=missingCount(player.hand,g.cost);return missing>0&&missing<=2;}).sort((a,b)=>b.score-a.score);
 for(const goal of goals){
  const result:Resource[]=[];for(const r of RESOURCES)for(let i=0;i<Math.max(0,goal.cost[r]-player.hand[r]);i++)if(state.bank[r]-result.filter(x=>x===r).length>0)result.push(r);
  if(result.length===missingCount(player.hand,goal.cost)){
   while(result.length<2){const extra=[...RESOURCES].filter(r=>state.bank[r]-result.filter(x=>x===r).length>0).sort((a,b)=>cardValue(state,playerId,b)-cardValue(state,playerId,a))[0];if(!extra)break;result.push(extra);}
   if(result.length===2)return result;
  }
 }
 return null;
}
export function monopolyResource(state:GameState,playerId:string):{resource:Resource;count:number} {
 const player=state.players.find(p=>p.id===playerId)!;
 const ranked=RESOURCES.map(resource=>({resource,count:19-state.bank[resource]-player.hand[resource]})).sort((a,b)=>(b.count*cardValue(state,playerId,b.resource))-(a.count*cardValue(state,playerId,a.resource))||a.resource.localeCompare(b.resource));
 return ranked[0];
}
export function shouldPlayKnight(state:GameState,playerId:string){
 const player=state.players.find(p=>p.id===playerId)!;const maxOther=Math.max(0,...state.players.filter(p=>p.id!==playerId).map(p=>p.knights)),next=player.knights+1;
 const armySwing=next>=3&&next>maxOther&&state.armyHolder!==playerId;
 const robber=geometry(state).hexes.find(h=>h.id===state.board.robberHexId),setup=setupById(state);let blocked=0;
 if(robber){const pips=setup.get(robber.id)?.token?PIPS[setup.get(robber.id)!.token!]??0:0;for(const v of robber.vertexIds){const b=state.buildings[v];if(b?.playerId===playerId)blocked+=pips*(b.kind==='city'?2:1);}}
 const leader=Math.max(0,...state.players.filter(p=>p.id!==playerId).map(p=>publicVictoryPoints(state,p.id)));
 return armySwing||blocked>=4||leader>=publicVictoryPoints(state,playerId)+2;
}
export function shouldPlayRoadBuilding(state:GameState,playerId:string){
 const road=bestRoad(state,playerId,true)??bestRoad(state,playerId);if(!road)return false;
 return roadScore(state,playerId,road)>=4.8||longestRoute(state,playerId)>=3;
}
export function tradeOfferWorthAccepting(state:GameState,playerId:string){
 const offer=state.offer,player=state.players.find(p=>p.id===playerId);if(!offer||!player)return false;
 if(!RESOURCES.every(r=>player.hand[r]>=offer.receive[r]))return false;
 const received=RESOURCES.reduce((sum,r)=>sum+offer.give[r]*cardValue(state,playerId,r),0),given=RESOURCES.reduce((sum,r)=>sum+offer.receive[r]*cardValue(state,playerId,r),0);
 const proposerVp=publicVictoryPoints(state,offer.proposer),ownVp=publicVictoryPoints(state,playerId),threshold=proposerVp>=8||proposerVp>=ownVp+2?1.25:.92;
 return received>=given*threshold;
}
export function affordableAction(state:GameState,playerId:string):{type:'city'|'settlement'|'road'|'card';id?:string;score:number}|null {
 const player=state.players.find(p=>p.id===playerId)!;const choices:Array<{type:'city'|'settlement'|'road'|'card';id?:string;score:number}>=[];
 const city=bestCity(state,playerId);if(city&&player.cities>0&&affordable(player.hand,COSTS.city))choices.push({type:'city',id:city,score:7+cityScore(state,playerId,city)*.65});
 const settlement=bestSettlement(state,playerId);if(settlement&&player.settlements>0&&affordable(player.hand,COSTS.settlement))choices.push({type:'settlement',id:settlement,score:6.5+settlementScore(state,playerId,settlement)*.48});
 if(state.deck.length&&affordable(player.hand,COSTS.card)){const goal=strategicGoalCosts(state,playerId).find(g=>g.kind==='card');choices.push({type:'card',score:goal?.score??8.4});}
 const road=bestRoad(state,playerId);if(road&&player.roads>0&&affordable(player.hand,COSTS.road))choices.push({type:'road',id:road,score:3.5+roadScore(state,playerId,road)*.62});
 return choices.sort((a,b)=>b.score-a.score||a.type.localeCompare(b.type))[0]??null;
}
