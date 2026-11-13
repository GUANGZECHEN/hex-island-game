import { applySetupCommand, type GameState, type SetupCommand } from '../rules/state.ts';
import { applyTurnCommand, type TurnCommand } from '../rules/turn.ts';
import { applyBuildCommand, type BuildCommand } from '../rules/build.ts';
import { applyEconomyCommand, type EconomyCommand } from '../rules/economy.ts';
import type { AuthorityRecovery } from './recovery.ts';

const MAX_MESSAGE_BYTES = 16384;
const idPattern = /^[A-Za-z0-9_-]{1,80}$/;
type Command = SetupCommand | TurnCommand | BuildCommand | EconomyCommand;
const setupTypes = new Set(['place-settlement','place-road']);
const turnTypes = new Set(['roll','discard','move-robber','steal','end-turn']);
const reversibleTypes = new Set(['place-settlement','place-road','build-road','build-settlement','build-city','bank-trade','free-road']);
const buildTypes = new Set(['build-road','build-settlement','build-city']);
const economyTypes = new Set(['bank-trade','offer','cancel-offer','accept-offer','reject-offer','buy-card','play-card','free-road','stop-free-roads','claim-victory']);
export interface PublicTradeSummary { revision:number; proposer:string; accepter:string; giveCount:number; receiveCount:number }
const handSize=(hand:Record<string,number>)=>Object.values(hand).reduce((sum,count)=>sum+count,0);
const fields: Record<string,string[]> = {
 'place-settlement':['vertexId'],'place-road':['edgeId'],undo:[],roll:[],discard:['cards'],'move-robber':['hexId'],steal:['victimId'],'end-turn':[],
 'build-road':['edgeId'],'build-settlement':['vertexId'],'build-city':['vertexId'],'bank-trade':['give','receive','rate'],
 offer:['id','targets','give','receive'],'cancel-offer':['id'],'accept-offer':['id'],'reject-offer':['id'],'buy-card':[],
 'play-card':['card','resources','resource'],'free-road':['edgeId'],'stop-free-roads':[],'claim-victory':[]
};
/** Public state is shared with every player and spectator; private trade details remain viewer-scoped. */
function publicProjection(state:GameState, viewer?:string, tradeSummary:PublicTradeSummary|null=null, undoPlayerId:string|null=null) {
 return {version:state.version,board:state.board,players:state.players.map(p=>({id:p.id,name:p.id,seat:p.seat,resources:Object.values(p.hand).reduce((a,b)=>a+b,0),developmentCards:p.cards.length,roads:p.roads,settlements:p.settlements,cities:p.cities,knights:p.knights})),bank:state.bank,deckCount:state.deck.length,playedCards:state.playedCards,startingSeat:state.startingSeat,currentSeat:state.currentSeat,turn:state.turn,phase:state.phase,setupStep:state.setupStep,pendingSettlement:state.pendingSettlement,buildings:state.buildings,roads:state.roads,longestHolder:state.longestHolder,armyHolder:state.armyHolder,dice:state.dice,discards:state.discards,victims:state.victims,freeRoads:state.freeRoads,winner:state.winner,offer:viewer&&state.offer&&(state.offer.proposer===viewer||state.offer.targets.includes(viewer))?state.offer:null,undoPlayerId,tradeSummary};
}
/** Only public quantities and this viewer's own cards are serialized. */
export function projectState(state:GameState, viewer:string, revision:number, gameId:string, tradeSummary:PublicTradeSummary|null=null) {
 const self=state.players.find(p=>p.id===viewer);if(!self)throw new Error('Unknown viewer.');
 return {protocol:1 as const,gameId,revision,public:publicProjection(state,viewer,tradeSummary),private:{hand:self.hand,cards:self.cards}};
}
/** Spectators receive the same public board state but never a player's private hand/cards or private trade offer. */
export function projectSpectatorState(state:GameState, revision:number, gameId:string, tradeSummary:PublicTradeSummary|null=null) {
 return {protocol:1 as const,gameId,revision,public:publicProjection(state,undefined,tradeSummary),private:null};
}
/** Peer-to-seat binding is established by the room layer, never from the payload. */
export class HostAuthority {
 private revision=0; private seen=new Set<string>(); private lastTradeSummary:PublicTradeSummary|null=null; private discardBaseRevision:number|null=null; private lastUndo:{playerId:string;previous:GameState}|null=null;
 private gameId:string; private state:GameState; private random:()=>number;
 constructor(gameId:string,state:GameState,random:()=>number,revision=0){if(!idPattern.test(gameId)||!Number.isSafeInteger(revision)||revision<0)throw new Error('Invalid game authority.');this.gameId=gameId;this.state=structuredClone(state);this.random=random;this.revision=revision;this.discardBaseRevision=state.phase==='discard'?revision:null;}
 static fromRecovery(value:AuthorityRecovery,random:()=>number):HostAuthority {
  if(!value||value.version!==1||typeof value.gameId!=='string'||!idPattern.test(value.gameId)||!Number.isSafeInteger(value.revision)||value.revision<0||!value.state||value.state.version!==1)throw new Error('Invalid saved authority.');
  return new HostAuthority(value.gameId,value.state,random,value.revision);
 }
 checkpoint():AuthorityRecovery {return {version:1,gameId:this.gameId,revision:this.revision,state:structuredClone(this.state)};}
 currentRevision():number{return this.revision;}
 snapshot(playerId:string){const result=projectState(this.state,playerId,this.revision,this.gameId,this.lastTradeSummary);result.public.undoPlayerId=this.lastUndo?.playerId??null;return structuredClone(result);}
 spectatorSnapshot(){const result=projectSpectatorState(this.state,this.revision,this.gameId,this.lastTradeSummary);result.public.undoPlayerId=this.lastUndo?.playerId??null;return structuredClone(result);}
 receive(boundPlayer:string, text:string): {ok:boolean;code?:string;revision:number} {
  const reject=(code:string)=>({ok:false,code,revision:this.revision});
  if(typeof text!=='string'||new TextEncoder().encode(text).length>MAX_MESSAGE_BYTES)return reject('malformed');
  let message:Record<string,unknown>;try{message=JSON.parse(text);}catch{return reject('malformed');}
  if(!message||typeof message!=='object'||Array.isArray(message)||Object.keys(message).sort().join(',')!=='command,commandId,gameId,protocol,revision,sender')return reject('malformed');
  if(message.protocol!==1||message.gameId!==this.gameId||message.sender!==boundPlayer||!this.state.players.some(p=>p.id===boundPlayer))return reject('unauthorized');
  if(typeof message.commandId!=='string'||!idPattern.test(message.commandId))return reject('malformed');
  const dedupe=`${boundPlayer}:${message.commandId}`;
  if(this.seen.has(dedupe))return reject('duplicate');
  const command=message.command as Record<string,unknown>;
  if(!command||typeof command!=='object'||Array.isArray(command)||typeof command.type!=='string'||!Object.hasOwn(fields,command.type)||command.playerId!==boundPlayer||Object.keys(command).some(k=>!['type','playerId',...fields[command.type as string]].includes(k)))return reject('malformed');
  const revision=typeof message.revision==='number'?message.revision:NaN;
  const concurrentDiscard=command.type==='discard'&&this.state.phase==='discard'&&!!this.state.discards[boundPlayer]&&this.discardBaseRevision!==null&&Number.isSafeInteger(revision)&&revision>=this.discardBaseRevision&&revision<=this.revision;
  if(!Number.isSafeInteger(revision)||(revision!==this.revision&&!concurrentDiscard))return reject('stale');
  if(command.type==='undo'){
   if(revision!==this.revision)return reject('stale');
   if(!this.lastUndo||this.lastUndo.playerId!==boundPlayer)return reject('illegal');
   this.state=structuredClone(this.lastUndo.previous);
   this.lastUndo=null;this.discardBaseRevision=null;this.lastTradeSummary=null;
   this.seen.add(dedupe);this.revision++;return {ok:true,revision:this.revision};
  }
  const reversible=reversibleTypes.has(command.type);
  const before=reversible?structuredClone(this.state):null;
  let pendingTrade:Omit<PublicTradeSummary,'revision'>|null=null;
  if(command.type==='accept-offer'&&this.state.offer){
   const offer=this.state.offer;
   pendingTrade={proposer:offer.proposer,accepter:boundPlayer,giveCount:handSize(offer.give),receiveCount:handSize(offer.receive)};
  }
  try{
   if(setupTypes.has(command.type))this.state=applySetupCommand(this.state,command as SetupCommand);
   else if(turnTypes.has(command.type))this.state=applyTurnCommand(this.state,command as TurnCommand,this.random);
   else if(buildTypes.has(command.type))this.state=applyBuildCommand(this.state,command as BuildCommand);
   else if(economyTypes.has(command.type))this.state=applyEconomyCommand(this.state,command as EconomyCommand);
   else return reject('malformed');
  }catch{return reject('illegal');}
  this.lastUndo=before?{playerId:boundPlayer,previous:before}:null;
  this.seen.add(dedupe);this.revision++;
  if(command.type==='roll'&&this.state.phase==='discard')this.discardBaseRevision=this.revision;
  else if(this.state.phase!=='discard')this.discardBaseRevision=null;
  this.lastTradeSummary=pendingTrade?{...pendingTrade,revision:this.revision}:null;return {ok:true,revision:this.revision};
 }
}
