import { createIslandBoard } from '../board/geometry.ts';
import { RESOURCES, type GameState, type Hand, type Resource } from './state.ts';

export type GameMode = 'classic' | 'harbor-coop';
export interface HarborOrder { id:string; portId:string; title:string; demand:Hand; loaded:Hand; dueRound:number }
export interface HarborState {
 version:1; round:number; completed:number; missed:number; goal:number; maxMisses:number;
 nextOrder:number; orders:HarborOrder[]; outcome:'playing'|'won'|'lost'; event:string;
}
export type HarborCommand =
 | {type:'harbor-load';playerId:string;orderId:string;cards:Hand}
 | {type:'harbor-send';playerId:string;recipient:string;cards:Hand};
export const HARBOR_RULES = Object.freeze({ goal:6, maxMisses:3, activeOrders:2, deadlineRounds:9 });
export const emptyCargo=():Hand=>({lumber:0,brick:0,wool:0,grain:0,ore:0});
export const isHarbor=(s:Pick<GameState,'mode'>)=>s.mode==='harbor-coop';
export function createHarborState():HarborState {
 return {version:1,round:1,completed:0,missed:0,goal:HARBOR_RULES.goal,maxMisses:HARBOR_RULES.maxMisses,nextOrder:0,orders:[],outcome:'playing',event:'Connect your settlements to the numbered harbors. Supply six ships together.'};
}
export function portName(state:Pick<GameState,'board'>,portId:string):string { return `P${state.board.ports.findIndex(p=>p.edgeId===portId)+1}`; }
/** All built team roads carry cargo. Missing edges cost one new road, useful for hints and the local bot. */
export function shippingRoute(state:Pick<GameState,'board'|'buildings'|'roads'>,playerId:string,destinations:readonly string[]):{missing:number;path:string[]} {
 const board=createIslandBoard(state.board.layout),dist=new Map<string,number>(),paths=new Map<string,string[]>(),queue:string[]=[];
 for(const [v,b] of Object.entries(state.buildings))if(b.playerId===playerId){dist.set(v,0);paths.set(v,[]);queue.push(v);}
 while(queue.length){
  queue.sort((a,b)=>dist.get(a)!-dist.get(b)!||a.localeCompare(b));const v=queue.shift()!,cost=dist.get(v)!;
  if(destinations.includes(v))return {missing:cost,path:paths.get(v)!};
  for(const edge of board.edges.filter(e=>e.vertexIds.includes(v))){const other=edge.vertexIds.find(x=>x!==v)!,next=cost+(state.roads[edge.id]?0:1);
   if(next<(dist.get(other)??Infinity)){dist.set(other,next);paths.set(other,[...paths.get(v)!,edge.id]);if(!queue.includes(other))queue.push(other);}
  }
 }
 return {missing:Infinity,path:[]};
}
export function canShip(state:Pick<GameState,'board'|'buildings'|'roads'>,playerId:string,portId:string):boolean {
 const port=state.board.ports.find(p=>p.edgeId===portId);return !!port&&shippingRoute(state,playerId,port.vertexIds).missing===0;
}
export function partnersConnected(state:Pick<GameState,'board'|'buildings'|'roads'>,a:string,b:string):boolean {
 return a!==b&&shippingRoute(state,a,Object.entries(state.buildings).filter(([,p])=>p.playerId===b).map(([v])=>v)).missing===0;
}
const RECIPES:readonly {title:string;needs:Partial<Hand>}[]=[
 {title:'Relief ship',needs:{grain:2,wool:1}}, {title:'Builder supply',needs:{lumber:2,brick:1}},
 {title:'Foundry supply',needs:{ore:2,lumber:1}}, {title:'Village provisions',needs:{grain:1,wool:1,brick:1}},
 {title:'Dock repairs',needs:{brick:2,lumber:1}}, {title:'Sail makers',needs:{wool:2,grain:1}},
];
function nextOrder(state:GameState):HarborOrder {
 const h=state.harbor!,serial=h.nextOrder++;
 const occupied=new Set(h.orders.map(o=>o.portId));
 const ports=state.board.ports.filter(p=>!occupied.has(p.edgeId)).map(p=>({p,d:Math.min(...state.players.map(player=>shippingRoute(state,player.id,p.vertexIds).missing))}));
 ports.sort((a,b)=>a.d-b.d||a.p.edgeId.localeCompare(b.p.edgeId));
 // Early ships favor attainable ports; later ships add geographical variety. No game entropy is consumed.
 const pool=ports.slice(0,serial<2?3:5),index=((state.board.seed>>>0)+serial*7)%pool.length;
 const port=pool[index]!.p,recipe=RECIPES[((state.board.seed>>>0)+serial)%RECIPES.length];
 return {id:`ship-${serial+1}`,portId:port.edgeId,title:recipe.title,demand:{...emptyCargo(),...recipe.needs},loaded:emptyCargo(),dueRound:h.round+HARBOR_RULES.deadlineRounds-1};
}
function fillOrders(state:GameState):void {
 const h=state.harbor!;while(h.outcome==='playing'&&h.orders.length<HARBOR_RULES.activeOrders)h.orders.push(nextOrder(state));
}
export function beginHarbor(state:GameState):void { if(isHarbor(state)&&state.harbor&&!state.harbor.orders.length)fillOrders(state); }
/** Advance only once after BOTH players have completed a turn. Setup never consumes deadlines. */
export function advanceHarbor(state:GameState):void {
 if(!isHarbor(state)||!state.harbor||state.harbor.outcome!=='playing')return;
 const h=state.harbor;const round=Math.floor((state.turn-1)/2)+1;if(round<=h.round)return;h.round=round;
 const expired=h.orders.filter(o=>o.dueRound<round);
 for(const order of expired){for(const r of RESOURCES)state.bank[r]+=order.loaded[r];h.missed++;}
 h.orders=h.orders.filter(o=>o.dueRound>=round);
 if(expired.length)h.event=`${expired.length} ship${expired.length>1?'s':''} departed unfilled. Missed ${h.missed}/${h.maxMisses}.`;
 if(h.missed>=h.maxMisses){h.outcome='lost';state.phase='finished';state.offer=null;h.event='The fleet has left. You lost together — try a new route next game.';return;}
 fillOrders(state);
}
function checkedCards(cards:Hand):boolean {
 return !!cards&&typeof cards==='object'&&!Array.isArray(cards)&&Object.keys(cards).sort().join(',')===[...RESOURCES].sort().join(',')&&RESOURCES.every(r=>Number.isSafeInteger(cards[r])&&cards[r]>=0)&&RESOURCES.some(r=>cards[r]>0);
}
export function applyHarborCommand(original:GameState,command:HarborCommand):GameState {
 if(!isHarbor(original)||!original.harbor||original.harbor.outcome!=='playing'||original.phase!=='action'||original.players[original.currentSeat].id!==command.playerId)throw new Error('Your Harbor Co-op action turn is required.');
 const state=structuredClone(original),player=state.players[state.currentSeat],h=state.harbor!;
 if(!checkedCards(command.cards)||RESOURCES.some(r=>command.cards[r]>player.hand[r]))throw new Error('Choose resources available in your own hand.');
 if(command.type==='harbor-load'){
  const order=h.orders.find(o=>o.id===command.orderId);if(!order||!canShip(state,player.id,order.portId))throw new Error('Connect your settlement to this harbor using team roads.');
  if(RESOURCES.some(r=>command.cards[r]>order.demand[r]-order.loaded[r]))throw new Error('The ship does not need those resources.');
  for(const r of RESOURCES){player.hand[r]-=command.cards[r];order.loaded[r]+=command.cards[r];}
  h.event=`${player.id} loaded supplies at ${portName(state,order.portId)}.`;
  if(RESOURCES.every(r=>order.loaded[r]===order.demand[r])){
   for(const r of RESOURCES)state.bank[r]+=order.loaded[r];h.orders=h.orders.filter(o=>o.id!==order.id);h.completed++;
   h.event=`Ship completed at ${portName(state,order.portId)}! ${h.completed}/${h.goal} supplied.`;
   if(h.completed>=h.goal){h.outcome='won';state.phase='finished';state.offer=null;h.event='All six ships supplied. You won together!';}
   else fillOrders(state);
  }
 }else if(command.type==='harbor-send'){
  const other=state.players.find(p=>p.id===command.recipient);if(!other||!partnersConnected(state,player.id,other.id))throw new Error('Connect both players with team roads before sending supplies.');
  for(const r of RESOURCES){player.hand[r]-=command.cards[r];other.hand[r]+=command.cards[r];}h.event=`${player.id} sent supplies to ${other.id}.`;
 }else throw new Error('Unknown harbor command.');
 return state;
}
/** Old Classic saves omit mode. Reject invalid new coop saves instead of changing their rules. */
export function validateHarborState(state:GameState):void {
 if(state.mode!==undefined&&state.mode!=='classic'&&state.mode!=='harbor-coop')throw new Error('Invalid saved game mode.');
 if(!isHarbor(state)){if(state.harbor)throw new Error('Classic save contains cooperative state.');return;}
 const h=state.harbor;
 if(state.players.length!==2||state.board.layout!=='standard'||!h||h.version!==1||h.goal!==HARBOR_RULES.goal||h.maxMisses!==HARBOR_RULES.maxMisses||!['playing','won','lost'].includes(h.outcome)||![h.round,h.completed,h.missed,h.nextOrder].every(n=>Number.isSafeInteger(n)&&n>=0)||h.round<1||!Array.isArray(h.orders)||h.orders.length>HARBOR_RULES.activeOrders||new Set(h.orders.map(o=>o.id)).size!==h.orders.length)throw new Error('Invalid saved Harbor Co-op state.');
 if((h.outcome!=='playing')!==(state.phase==='finished')||(h.outcome==='won'&&h.completed<h.goal)||(h.outcome==='lost'&&h.missed<h.maxMisses))throw new Error('Invalid cooperative outcome.');
 for(const order of h.orders){if(typeof order.id!=='string'||!/^ship-\d+$/.test(order.id)||!state.board.ports.some(p=>p.edgeId===order.portId)||!Number.isSafeInteger(order.dueRound)||order.dueRound<1||!checkedCards(order.demand)||!order.loaded||RESOURCES.some(r=>!Number.isSafeInteger(order.loaded[r])||order.loaded[r]<0||order.loaded[r]>order.demand[r]))throw new Error('Invalid saved harbor cargo.');}
}
