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

export interface ExpansionTarget {
 vertexId:string;
 importance:number;
 roadDistance:number;
 priority:number;
 pathEdgeIds:string[];
 nextRoadId:string|null;
}

function expansionPath(state:GameState,playerId:string,targetId:string):{roadDistance:number;pathEdgeIds:string[]}|null {
 const board=geometry(state),starts=new Set<string>();
 for(const [vertexId,building] of Object.entries(state.buildings))if(building.playerId===playerId)starts.add(vertexId);
 for(const [edgeId,owner] of Object.entries(state.roads))if(owner===playerId){
  const edge=board.edges.find(item=>item.id===edgeId);if(edge)for(const vertexId of edge.vertexIds)starts.add(vertexId);
 }
 if(!starts.size)return null;
 const best=new Map<string,{cost:number;path:string[]}>(),queue:Array<{vertexId:string;cost:number;path:string[]}>=Array.from(starts).map(vertexId=>({vertexId,cost:0,path:[]}));
 for(const item of queue)best.set(item.vertexId,{cost:0,path:[]});
 while(queue.length){
  queue.sort((a,b)=>a.cost-b.cost||a.path.join('|').localeCompare(b.path.join('|'))||a.vertexId.localeCompare(b.vertexId));
  const current=queue.shift()!,known=best.get(current.vertexId);
  if(!known||known.cost!==current.cost||known.path.join('|')!==current.path.join('|'))continue;
  if(current.vertexId===targetId)return {roadDistance:current.cost,pathEdgeIds:current.path};
  const blocker=state.buildings[current.vertexId];
  if(blocker&&blocker.playerId!==playerId)continue;
  const adjacent=board.edges.filter(edge=>edge.vertexIds.includes(current.vertexId)).sort((a,b)=>a.id.localeCompare(b.id));
  for(const edge of adjacent){
   const owner=state.roads[edge.id];if(owner&&owner!==playerId)continue;
   const next=edge.vertexIds[0]===current.vertexId?edge.vertexIds[1]:edge.vertexIds[0];
   const nextBuilding=state.buildings[next];if(nextBuilding&&nextBuilding.playerId!==playerId&&next!==targetId)continue;
   const step=owner===playerId?0:1,newCost=current.cost+step,newPath=owner===playerId?current.path:[...current.path,edge.id],previous=best.get(next);
   const better=!previous||newCost<previous.cost||(newCost===previous.cost&&newPath.join('|')<previous.path.join('|'));
   if(better){best.set(next,{cost:newCost,path:newPath});queue.push({vertexId:next,cost:newCost,path:newPath});}
  }
 }
 return null;
}

/**
 * Rank several settlement expansion targets by tile importance and the number of
 * new roads still required. Recomputed every decision so blocked/stolen targets
 * automatically disappear and the bot falls through to the next candidate.
 */
export function rankExpansionTargets(state:GameState,playerId:string):ExpansionTarget[] {
 const legalRoads=new Set(buildableRoadEdges(state,playerId));
 return geometry(state).vertices
  .filter(vertex=>distanceLegalSettlement(state,vertex.id))
  .map(vertex=>{
   const path=expansionPath(state,playerId,vertex.id);if(!path)return null;
   const importance=settlementScore(state,playerId,vertex.id),roadDistance=path.roadDistance;
   const nextRoadId=path.pathEdgeIds.find(edgeId=>!state.roads[edgeId]&&legalRoads.has(edgeId))??null;
   const priority=importance/(1+.58*roadDistance)+(roadDistance===0?2.2:0);
   return {vertexId:vertex.id,importance,roadDistance,priority,pathEdgeIds:path.pathEdgeIds,nextRoadId};
  })
  .filter((target):target is ExpansionTarget=>!!target)
  .sort((a,b)=>b.priority-a.priority||b.importance-a.importance||a.roadDistance-b.roadDistance||a.vertexId.localeCompare(b.vertexId));
}

export function roadDistanceToTargets(state:GameState,playerId:string,edgeId:string){
 const target=rankExpansionTargets(state,playerId).find(item=>item.nextRoadId===edgeId);
 return target?.priority??0;
}
export function roadSettlementValue(state:GameState,playerId:string,edgeId:string):number {
 const target=rankExpansionTargets(state,playerId).find(item=>item.nextRoadId===edgeId);
 return target?target.importance/(1+.4*Math.max(0,target.roadDistance-1)):0;
}
export function roadScore(state:GameState,playerId:string,edgeId:string):number {
 const target=rankExpansionTargets(state,playerId).find(item=>item.nextRoadId===edgeId);
 if(!target)return 0;
 const before=longestRoute(state,playerId),copy=structuredClone(state);copy.roads[edgeId]=playerId;
 const after=longestRoute(copy,playerId),opponentBest=Math.max(0,...state.players.filter(p=>p.id!==playerId).map(p=>longestRoute(state,p.id)));
 let score=target.priority+Math.max(0,after-before)*.18;
 if(after>=5&&after>opponentBest)score+=.8;
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
 if(state.phase==='setup-road'){
  const ids=legalTargetIds(state,playerId,'road');
  return ids.sort((a,b)=>roadScore(state,playerId,b)-roadScore(state,playerId,a)||a.localeCompare(b))[0]??null;
 }
 const target=rankExpansionTargets(state,playerId).find(item=>item.roadDistance>0&&item.nextRoadId);
 if(target?.nextRoadId)return target.nextRoadId;
 if(setupOrFree&&state.phase==='free-road'){
  const ids=legalTargetIds(state,playerId,'road');
  return ids.sort((a,b)=>roadScore(state,playerId,b)-roadScore(state,playerId,a)||a.localeCompare(b))[0]??null;
 }
 return null;
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
 const settlement=bestSettlement(state,playerId);if(settlement&&player.settlements>0)goals.push({cost:COSTS.settlement,score:14+settlementScore(state,playerId,settlement)*.72,kind:'settlement'});
 const city=bestCity(state,playerId);if(city&&player.cities>0)goals.push({cost:COSTS.city,score:12+cityScore(state,playerId,city)*.72,kind:'city'});
 if(state.deck.length) {
  const profile=productionProfile(state,playerId),armyGap=Math.max(0,...state.players.filter(p=>p.id!==playerId).map(p=>p.knights))-player.knights;
  goals.push({cost:COSTS.card,score:5.2+(profile.ore+profile.grain+profile.wool-(profile.lumber+profile.brick))*.05+(armyGap>=0&&player.knights>=2?.7:0),kind:'card'});
 }
 const road=bestRoad(state,playerId),target=rankExpansionTargets(state,playerId).find(item=>item.nextRoadId===road);
 if(road&&target&&player.roads>0)goals.push({cost:COSTS.road,score:2+target.priority*.5,kind:'road'});
 return goals;
}
export function missingCount(hand:Hand,cost:Hand){return RESOURCES.reduce((sum,r)=>sum+Math.max(0,cost[r]-hand[r]),0);}
function preferredGoal(state:GameState,playerId:string){
 const hand=state.players.find(p=>p.id===playerId)!.hand;
 return strategicGoalCosts(state,playerId).sort((a,b)=>(b.score/(1+missingCount(hand,b.cost)))-(a.score/(1+missingCount(hand,a.cost)))||b.score-a.score)[0]??null;
}
export interface SavingGoal {kind:'settlement'|'city';cost:Hand;missing:number;targetId:string}
/**
 * Resource reservation begins only after a settlement target is actually
 * connected and legal to build. Before that point, roads advance the ranked
 * expansion plan. A ready city can still be taken immediately.
 */
export function savingGoal(state:GameState,playerId:string):SavingGoal|null {
 const player=state.players.find(p=>p.id===playerId);if(!player)return null;
 const settlement=bestSettlement(state,playerId);
 if(settlement&&player.settlements>0)return {kind:'settlement',cost:{...COSTS.settlement},missing:missingCount(player.hand,COSTS.settlement),targetId:settlement};
 const city=bestCity(state,playerId);
 if(city&&player.cities>0)return {kind:'city',cost:{...COSTS.city},missing:missingCount(player.hand,COSTS.city),targetId:city};
 return null;
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
export function chooseBankTrade(state:GameState,playerId:string,reservedCost?:Hand):EconomyCommand|null {
 const player=state.players.find(p=>p.id===playerId)!;
 const goals=reservedCost?[{cost:reservedCost,score:100,kind:'reserved'}]:strategicGoalCosts(state,playerId).filter(g=>missingCount(player.hand,g.cost)>0).sort((a,b)=>(b.score/(1+missingCount(player.hand,b.cost)))-(a.score/(1+missingCount(player.hand,a.cost))));
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
 const target=rankExpansionTargets(state,playerId).find(item=>item.roadDistance>0&&item.nextRoadId);
 return !!target&&target.priority>=3.2;
}
export function tradeOfferWorthAccepting(state:GameState,playerId:string){
 const offer=state.offer,player=state.players.find(p=>p.id===playerId);if(!offer||!player)return false;
 if(!RESOURCES.every(r=>player.hand[r]>=offer.receive[r]))return false;
 const received=RESOURCES.reduce((sum,r)=>sum+offer.give[r]*cardValue(state,playerId,r),0),given=RESOURCES.reduce((sum,r)=>sum+offer.receive[r]*cardValue(state,playerId,r),0);
 const proposerVp=publicVictoryPoints(state,offer.proposer),ownVp=publicVictoryPoints(state,playerId),threshold=proposerVp>=8||proposerVp>=ownVp+2?1.25:.92;
 return received>=given*threshold;
}
export function affordableAction(state:GameState,playerId:string):{type:'city'|'settlement'|'card';id?:string;score:number}|null {
 const player=state.players.find(p=>p.id===playerId)!;const choices:Array<{type:'city'|'settlement'|'card';id?:string;score:number}>=[];
 const settlement=bestSettlement(state,playerId);if(settlement&&player.settlements>0&&affordable(player.hand,COSTS.settlement))choices.push({type:'settlement',id:settlement,score:14+settlementScore(state,playerId,settlement)*.72});
 const city=bestCity(state,playerId);if(city&&player.cities>0&&affordable(player.hand,COSTS.city))choices.push({type:'city',id:city,score:12+cityScore(state,playerId,city)*.72});
 if(state.deck.length&&affordable(player.hand,COSTS.card)){const goal=strategicGoalCosts(state,playerId).find(g=>g.kind==='card');choices.push({type:'card',score:goal?.score??5.2});}
 return choices.sort((a,b)=>b.score-a.score||a.type.localeCompare(b.type))[0]??null;
}
