import { createIslandBoard } from '../board/geometry.ts';
import { RESOURCES, type GameState, type Hand, type Resource } from '../rules/state.ts';
import { canShip, shippingRoute, emptyCargo } from '../rules/harbor.ts';
import { legalTargetIds, bankTradeRate } from '../rules/legal.ts';
import { chooseDiscard, settlementScore, cityScore } from './strategy.ts';
import type { BotCommand } from './policy.ts';

/** Deterministic teammate: own hand + public orders/board only. Never inspects the partner's hand. */
export function chooseHarborBot(state:GameState,id:string):BotCommand|null {
 const self=state.players.find(p=>p.id===id),h=state.harbor;
 if(!self||!h||state.phase==='finished')return null;
 if(state.offer?.targets.includes(id))return {type:RESOURCES.every(r=>self.hand[r]>=state.offer!.receive[r])?'accept-offer':'reject-offer',playerId:id,id:state.offer.id};
 if(state.phase==='discard'&&state.discards[id])return {type:'discard',playerId:id,cards:chooseDiscard(state,id,state.discards[id])};
 if(state.players[state.currentSeat].id!==id)return null;
 const choose=(ids:string[],score:(key:string)=>number)=>ids.sort((a,b)=>score(b)-score(a)||a.localeCompare(b))[0];
 if(state.phase==='setup-settlement'){
  const vertexId=choose(legalTargetIds(state,id,'settlement'),v=>settlementScore(state,id,v)+(state.board.ports.some(p=>p.vertexIds.includes(v))?1.8:0));
  return vertexId?{type:'place-settlement',playerId:id,vertexId}:null;
 }
 const routes=h.orders.map(order=>({order,route:shippingRoute(state,id,state.board.ports.find(p=>p.edgeId===order.portId)!.vertexIds)})).sort((a,b)=>a.route.missing-b.route.missing||a.order.dueRound-b.order.dueRound);
 const road=()=>{
  const legal=legalTargetIds(state,id,'road');
  for(const item of routes){const edge=item.route.path.find(e=>!state.roads[e]&&legal.includes(e));if(edge)return edge;}
  return legal[0];
 };
 if(state.phase==='setup-road'){const edgeId=road();return edgeId?{type:'place-road',playerId:id,edgeId}:null;}
 if(state.phase==='roll')return {type:'roll',playerId:id};
 if(state.phase==='robber'){
  const geometry=createIslandBoard(state.board.layout);
  const hexId=choose(legalTargetIds(state,id,'robber'),hex=>{
   const tile=state.board.hexes.find(h=>h.hexId===hex)!;
   return -geometry.hexes.find(h=>h.id===hex)!.vertexIds.reduce((n,v)=>n+(state.buildings[v]?(state.buildings[v].kind==='city'?2:1)*(tile.token?6-Math.abs(7-tile.token):0):0),0);
  });return hexId?{type:'move-robber',playerId:id,hexId}:null;
 }
 if(state.phase==='free-road'){const edgeId=road();return edgeId?{type:'free-road',playerId:id,edgeId}:{type:'stop-free-roads',playerId:id};}
 if(state.phase!=='action')return null;
 for(const {order} of routes){if(!canShip(state,id,order.portId))continue;const cards=emptyCargo();for(const r of RESOURCES)cards[r]=Math.min(self.hand[r],order.demand[r]-order.loaded[r]);if(RESOURCES.some(r=>cards[r]>0))return {type:'harbor-load',playerId:id,orderId:order.id,cards};}
 const reachable=routes.find(x=>x.route.missing===0);
 const distant=routes.find(x=>x.route.missing>0);
 let goal:Hand=reachable?Object.fromEntries(RESOURCES.map(r=>[r,Math.max(0,reachable.order.demand[r]-reachable.order.loaded[r])])) as Hand:{...emptyCargo(),lumber:1,brick:1};
 const cards=self.cards.filter(c=>c.boughtTurn<state.turn);
 if(!state.playedDevelopment){
  if(cards.some(c=>c.type==='invention')){const resources:Resource[]=[];for(const r of [...RESOURCES].sort((a,b)=>(goal[b]-self.hand[b])-(goal[a]-self.hand[a])))while(resources.length<2&&resources.filter(x=>x===r).length<state.bank[r]&&resources.filter(x=>x===r).length<Math.max(0,goal[r]-self.hand[r]))resources.push(r);if(resources.length===2)return {type:'play-card',playerId:id,card:'invention',resources};}
  if(cards.some(c=>c.type==='monopoly')){const resource=RESOURCES.find(r=>goal[r]>self.hand[r]&&state.bank[r]>0);if(resource)return {type:'play-card',playerId:id,card:'monopoly',resource};}
  if(distant&&cards.some(c=>c.type==='road-building')&&road())return {type:'play-card',playerId:id,card:'road-building'};
  if(cards.some(c=>c.type==='knight')&&Object.keys(state.buildings).some(v=>createIslandBoard(state.board.layout).hexes.find(x=>x.id===state.board.robberHexId)?.vertexIds.includes(v)))return {type:'play-card',playerId:id,card:'knight'};
 }
 if(distant&&self.hand.lumber>0&&self.hand.brick>0){const edgeId=road();if(edgeId)return {type:'build-road',playerId:id,edgeId};}
 const settlement=choose(legalTargetIds(state,id,'settlement'),v=>settlementScore(state,id,v));
 if(settlement)return {type:'build-settlement',playerId:id,vertexId:settlement};
 const city=choose(legalTargetIds(state,id,'city'),v=>cityScore(state,id,v));if(city)return {type:'build-city',playerId:id,vertexId:city};
 if(!reachable&&distant)goal={...emptyCargo(),lumber:1,brick:1};
 for(const receive of RESOURCES){if(self.hand[receive]>=goal[receive]||state.bank[receive]<1)continue;
  for(const give of RESOURCES){const rate=bankTradeRate(state,id,give);if(give!==receive&&self.hand[give]-rate>=goal[give])return {type:'bank-trade',playerId:id,give,receive,rate};}
 }
 return {type:'end-turn',playerId:id};
}
