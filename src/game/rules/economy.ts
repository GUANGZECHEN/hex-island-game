import { applyBuildCommand } from './build.ts';
import { publicVictoryPoints, RESOURCES, type Development, type GameState, type Hand, type Resource } from './state.ts';
export type EconomyCommand =
 | { type:'bank-trade'; playerId:string; give:Resource; receive:Resource; rate:2|3|4 }
 | { type:'offer'; playerId:string; id:string; targets:string[]; give:Hand; receive:Hand }
 | { type:'cancel-offer'; playerId:string; id:string }
 | { type:'accept-offer' | 'reject-offer'; playerId:string; id:string }
 | { type:'buy-card'; playerId:string }
 | { type:'play-card'; playerId:string; card:Exclude<Development,'victory-point'>; resources?:Resource[]; resource?:Resource }
 | { type:'free-road'; playerId:string; edgeId:string }
 | { type:'stop-free-roads'; playerId:string }
 | { type:'claim-victory'; playerId:string };
const validResource = (x: unknown): x is Resource => typeof x === 'string' && RESOURCES.includes(x as Resource);
const validHand = (x: Hand) => !!x && Object.keys(x).sort().join(',') === [...RESOURCES].sort().join(',') && RESOURCES.every(r => Number.isInteger(x[r]) && x[r] >= 0);
const handSize = (x: Hand) => RESOURCES.reduce((n,r)=>n+x[r],0);
function transfer(from:Hand,to:Hand,cards:Hand) {
 if (!validHand(cards) || RESOURCES.some(r=>from[r]<cards[r])) throw new Error('Insufficient resources.');
 for(const r of RESOURCES){from[r]-=cards[r];to[r]+=cards[r];}
}
function updateArmy(state:GameState) {
 const max=Math.max(...state.players.map(p=>p.knights));
 const leaders=state.players.filter(p=>p.knights===max && max>=3);
 state.armyHolder=leaders.length===1?leaders[0].id:leaders.some(p=>p.id===state.armyHolder)?state.armyHolder:null;
}
export function applyEconomyCommand(original:GameState, command:EconomyCommand):GameState {
 let state=structuredClone(original);const player=state.players.find(p=>p.id===command.playerId),active=state.players[state.currentSeat];
 if(!player || state.phase==='finished')throw new Error('Unknown player or finished game.');
 if(command.type==='accept-offer' || command.type==='reject-offer') {
  const offer=state.offer;
  if(state.phase!=='action'||!offer||offer.id!==command.id||!offer.targets.includes(player.id)||offer.proposer!==active.id)throw new Error('Offer is stale or not addressed to player.');
  if(command.type==='accept-offer'){transfer(active.hand,player.hand,offer.give);transfer(player.hand,active.hand,offer.receive);state.offer=null;}
  else {offer.targets=offer.targets.filter(id=>id!==player.id);if(!offer.targets.length)state.offer=null;}
  return state;
 }
 if(player.id!==active.id)throw new Error('Not the active player.');
 if(command.type==='claim-victory') {
  if(state.phase==='setup-settlement'||state.phase==='setup-road'||publicVictoryPoints(state,player.id)+player.cards.filter(c=>c.type==='victory-point').length<10)throw new Error('Victory requirements not met.');
  state.phase='finished';state.winner=player.id;state.offer=null;return state;
 }
 if(command.type==='free-road' && state.phase==='free-road') {
  state.phase='action';state=applyBuildCommand(state,{type:'build-road',playerId:player.id,edgeId:command.edgeId,free:true},true);state.freeRoads--;
  state.phase=state.freeRoads>0 && state.players[state.currentSeat].roads>0?'free-road':state.resumePhase!;
  if(state.phase!=='free-road')state.resumePhase=null;
  return state;
 }
 if(command.type==='stop-free-roads' && state.phase==='free-road'){state.phase=state.resumePhase!;state.resumePhase=null;state.freeRoads=0;return state;}
 if(command.type==='play-card' && (state.phase==='roll'||state.phase==='action')) {
  if(state.playedDevelopment)throw new Error('A development card was already played this turn.');
  const index=player.cards.findIndex(c=>c.type===command.card && c.boughtTurn<state.turn);
  if(index<0)throw new Error('Card unavailable or purchased this turn.');
  if(command.card==='invention') {
   if(!Array.isArray(command.resources)||command.resources.length!==2||!command.resources.every(validResource))throw new Error('Choose two resources.');
   const cards=Object.fromEntries(RESOURCES.map(r=>[r,command.resources!.filter(x=>x===r).length])) as Hand;transfer(state.bank,player.hand,cards);
  } else if(command.card==='monopoly') {
   if(!validResource(command.resource))throw new Error('Choose a resource.');
   for(const other of state.players)if(other.id!==player.id){player.hand[command.resource]+=other.hand[command.resource];other.hand[command.resource]=0;}
  } else if(command.card==='knight') {state.resumePhase=state.phase;state.phase='robber';player.knights++;updateArmy(state);}
  else if(command.card==='road-building') { if(player.roads>0){state.resumePhase=state.phase;state.phase='free-road';state.freeRoads=Math.min(2,player.roads);} }
  else throw new Error('Invalid card.');
  player.cards.splice(index,1);state.playedCards.push(command.card);state.playedDevelopment=true;return state;
 }
 if(state.phase!=='action')throw new Error('Action phase required.');
 if(command.type==='bank-trade') {
  if(!validResource(command.give)||!validResource(command.receive)||command.give===command.receive||![2,3,4].includes(command.rate))throw new Error('Invalid bank trade.');
  const owns=(kind:string)=>state.board.ports.some(port=>port.type===kind&&port.vertexIds.some(v=>state.buildings[v]?.playerId===player.id));
  if(command.rate===2&&!owns(command.give)||command.rate===3&&!owns('generic'))throw new Error('Port unavailable.');
  const give=Object.fromEntries(RESOURCES.map(r=>[r,r===command.give?command.rate:0])) as Hand,receive=Object.fromEntries(RESOURCES.map(r=>[r,r===command.receive?1:0])) as Hand;
  transfer(player.hand,state.bank,give);transfer(state.bank,player.hand,receive);
 } else if(command.type==='offer') {
  if(typeof command.id!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(command.id)||!Array.isArray(command.targets)||!command.targets.length||new Set(command.targets).size!==command.targets.length||command.targets.some(id=>id===player.id||!state.players.some(p=>p.id===id))||!validHand(command.give)||!validHand(command.receive)||!handSize(command.give)||!handSize(command.receive)||RESOURCES.some(r=>command.give[r]>player.hand[r]))throw new Error('Invalid offer.');
  state.offer={id:command.id,proposer:player.id,targets:[...command.targets],give:{...command.give},receive:{...command.receive}};
 } else if(command.type==='cancel-offer') {if(state.offer?.id!==command.id)throw new Error('Offer is stale.');state.offer=null;}
 else if(command.type==='buy-card') {
  if(!state.deck.length)throw new Error('Development deck is empty.');
  transfer(player.hand,state.bank,{lumber:0,brick:0,wool:1,grain:1,ore:1});player.cards.push({type:state.deck.shift()!,boughtTurn:state.turn});
 } else throw new Error('Command is not allowed in this phase.');
 return state;
}
