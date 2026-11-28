import { matchMusicScene } from '../music-outcome.ts';
import { applySetupCommand, RESOURCES, type GameState, type SetupCommand, type Hand } from '../rules/state.ts';
import { applyTurnCommand, type TurnCommand } from '../rules/turn.ts';
import { applyBuildCommand, type BuildCommand } from '../rules/build.ts';
import { applyEconomyCommand, type EconomyCommand } from '../rules/economy.ts';
import { applyHarborCommand, validateHarborState, type HarborCommand } from '../rules/harbor.ts';
import { validateSavedBoard, validateSavedRollPayout, type AuthorityRecovery } from './recovery.ts';
import { ACTION_WINDOW_MS, clockParticipants, effectiveActionResetActors, timeoutCommand, type TurnClockSnapshot } from '../rules/turn-clock.ts';

const MAX_MESSAGE_BYTES = 16384;
const idPattern = /^[A-Za-z0-9_-]{1,80}$/;
type Command = SetupCommand | TurnCommand | BuildCommand | EconomyCommand | HarborCommand;
const setupTypes = new Set(['place-settlement','place-city','place-road']);
const turnTypes = new Set(['roll','discard','move-robber','move-pirate','steal','end-turn']);
const reversibleTypes = new Set(['place-settlement','place-city','harbor-build-station','place-road','build-road','build-settlement','build-city','build-ship','bank-trade','free-road']);
const harborTypes=new Set(['harbor-load','harbor-send','harbor-build-station']);
const buildTypes = new Set(['build-road','build-settlement','build-city','build-ship']);
const economyTypes = new Set(['bank-trade','offer','cancel-offer','accept-offer','reject-offer','buy-card','play-card','free-road','stop-free-roads','claim-victory']);
export interface PublicTradeSummary { revision:number; proposer:string; accepter:string; giveCount:number; receiveCount:number }
const handSize=(hand:Record<string,number>)=>Object.values(hand).reduce((sum,count)=>sum+count,0);
const fields: Record<string,string[]> = {
 'harbor-load':['orderId','cards'],'harbor-send':['recipient','cards','stationId'],'harbor-build-station':['vertexId'],
 'place-settlement':['vertexId'],'place-city':['vertexId'],'place-road':['edgeId'],undo:[],roll:[],discard:['cards'],'move-robber':['hexId'],'move-pirate':['edgeId'],steal:['victimId'],'end-turn':[],
 'build-road':['edgeId'],'build-settlement':['vertexId'],'build-city':['vertexId'],'build-ship':['vertexId'],'bank-trade':['give','receive','rate'],
 offer:['id','targets','give','receive'],'cancel-offer':['id'],'accept-offer':['id'],'reject-offer':['id'],'buy-card':[],
 'play-card':['card','resources','resource'],'free-road':['edgeId'],'stop-free-roads':[],'claim-victory':[]
};
/** Public state is shared with every player and spectator; private trade details remain viewer-scoped. */
function publicProjection(state:GameState, viewer?:string, tradeSummary:PublicTradeSummary|null=null, undoPlayerId:string|null=null) {
 return {lastRollPayout:state.lastRollPayout??null,mode:state.mode??'classic',harbor:state.harbor??null,rules:state.rules??{catchUp:false,ships:false},catchUpReward:state.catchUpReward??null,playedDevelopment:state.playedDevelopment,resumePhase:state.resumePhase,version:state.version,board:state.board,players:state.players.map(p=>({id:p.id,name:p.id,seat:p.seat,resources:Object.values(p.hand).reduce((a,b)=>a+b,0),developmentCards:p.cards.length,roads:p.roads,settlements:p.settlements,cities:p.cities,knights:p.knights})),bank:state.bank,deckCount:state.deck.length,playedCards:state.playedCards,startingSeat:state.startingSeat,currentSeat:state.currentSeat,turn:state.turn,phase:state.phase,setupStep:state.setupStep,setupRoadEdges:state.setupRoadEdges,pendingSettlement:state.pendingSettlement,buildings:state.buildings,roads:state.roads,longestHolder:state.longestHolder,armyHolder:state.armyHolder,dice:state.dice,discards:state.discards,victims:state.victims,freeRoads:state.freeRoads,winner:state.winner,paused:false,offer:viewer&&state.offer&&(state.offer.proposer===viewer||state.offer.targets.includes(viewer))?state.offer:null,undoPlayerId,tradeSummary};
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
 private revision=0; private seen=new Set<string>(); private lastTradeSummary:PublicTradeSummary|null=null; private pendingDiscards:Record<string,Hand>={}; private lastUndo:{playerId:string;previous:GameState;clockDeadlines:Map<string,number>}|null=null;
 private gameId:string; private state:GameState; private random:()=>number;
 private readonly clockNow:()=>number;
 private clockDeadlines=new Map<string,number>();private clockPaused=false;private timeoutSerial=0;
 constructor(gameId:string,state:GameState,random:()=>number,revision=0,clockNow:()=>number=Date.now){if(!idPattern.test(gameId)||!Number.isSafeInteger(revision)||revision<0)throw new Error('Invalid game authority.');this.gameId=gameId;this.state=structuredClone(state);this.random=random;this.revision=revision;this.clockNow=clockNow;this.refreshClock();}
 static fromRecovery(value:AuthorityRecovery,random:()=>number,clockNow:()=>number=Date.now):HostAuthority {
  if(!value||value.version!==1||typeof value.gameId!=='string'||!idPattern.test(value.gameId)||!Number.isSafeInteger(value.revision)||value.revision<0||!value.state||value.state.version!==1)throw new Error('Invalid saved authority.');
  // Check recovered accounting separately: ledger balances may be negative, hands may not.
  const validResourceRecord=(record:Hand,nonnegative:boolean)=>!!record&&typeof record==='object'&&!Array.isArray(record)&&RESOURCES.every(r=>Number.isSafeInteger(record[r])&&(!nonnegative||record[r]>=0));
  if(!validResourceRecord(value.state.bank,false)||!Array.isArray(value.state.players)||value.state.players.some(player=>!player||!validResourceRecord(player.hand,true)))throw new Error('Invalid saved resource accounting.');
  validateHarborState(value.state);
  validateSavedBoard(value.state);
  validateSavedRollPayout(value.state);
  const restored=new HostAuthority(value.gameId,value.state,random,value.revision,clockNow);
  const pending=value.pendingDiscards??{};
  if(!pending||typeof pending!=='object'||Array.isArray(pending))throw new Error('Invalid saved pending discards.');
  for(const [playerId,cards] of Object.entries(pending)){
   if(value.state.phase!=='discard'||!value.state.discards[playerId]||!cards||typeof cards!=='object'||Array.isArray(cards)||
      Object.keys(cards).sort().join(',')!==[...RESOURCES].sort().join(',')||
      RESOURCES.some(resource=>!Number.isSafeInteger(cards[resource])||cards[resource]<0))throw new Error('Invalid saved pending discards.');
   try{applyTurnCommand(value.state,{type:'discard',playerId,cards});}catch{throw new Error('Invalid saved pending discards.');}
  }
  restored.pendingDiscards=structuredClone(pending);
  restored.refreshClock();
  if(value.clock!==undefined){
   const clock=value.clock;
   const participants=clockParticipants(restored.state,restored.pendingDiscards);
   if(!clock||typeof clock.paused!=='boolean'||!clock.remaining||typeof clock.remaining!=='object'||Array.isArray(clock.remaining)||
      Object.keys(clock.remaining).sort().join(',')!==[...participants].sort().join(',')||
      Object.values(clock.remaining).some(ms=>typeof ms!=='number'||!Number.isFinite(ms)||ms<0||ms>ACTION_WINDOW_MS)||
      (clock.paused&&restored.state.phase==='finished'))throw new Error('Invalid saved clock.');
   restored.clockPaused=clock.paused;
   restored.clockDeadlines=new Map(Object.entries(clock.remaining).map(([id,ms])=>[id,clock.paused?ms:clockNow()+ms]));
  }
  return restored;
 }
 /** Action deadlines live only in the host's authority, not in the deterministic game reducer. */
 private refreshClock(actingPlayer?:string):void {
  const participants=clockParticipants(this.state,this.pendingDiscards);
  for(const id of this.clockDeadlines.keys())if(!participants.includes(id))this.clockDeadlines.delete(id);
  for(const id of participants)if(!this.clockDeadlines.has(id)||id===actingPlayer)this.clockDeadlines.set(id,this.clockPaused?ACTION_WINDOW_MS:this.clockNow()+ACTION_WINDOW_MS);
 }
 clockStatus():TurnClockSnapshot|null {
  this.refreshClock();
  const [playerId,deadline]=[...this.clockDeadlines].sort((a,b)=>a[1]-b[1])[0]??[];
  return playerId===undefined?null:{playerId,remainingMs:Math.max(0,this.clockPaused?deadline:deadline-this.clockNow()),paused:this.clockPaused};
 }
 setPaused(paused:boolean):boolean {
  if(typeof paused!=='boolean'||this.state.phase==='finished'||this.clockPaused===paused)return false;
  this.refreshClock();
  const now=this.clockNow();
  for(const [id,deadline] of this.clockDeadlines)this.clockDeadlines.set(id,paused?Math.max(0,deadline-now):now+deadline);
  if(this.lastUndo)for(const [id,deadline] of this.lastUndo.clockDeadlines)this.lastUndo.clockDeadlines.set(id,paused?Math.max(0,deadline-now):now+deadline);
  this.clockPaused=paused;return true;
 }
 /** Only the host calls this: a timed-out player cannot indefinitely block the game. */
 advanceTimeout():{handled:boolean;pending:boolean;playerId?:string}{
  if(this.clockPaused)return {handled:false,pending:false};
  const pulse=this.clockStatus();
  if(!pulse||pulse.remainingMs>0)return {handled:false,pending:false};
  const command=timeoutCommand(this.state,pulse.playerId);
  if(!command){this.clockDeadlines.set(pulse.playerId,this.clockNow()+ACTION_WINDOW_MS);return {handled:false,pending:false};}
  const commandId=`clock-${this.revision}-${++this.timeoutSerial}`;
  const result=this.receive(pulse.playerId,JSON.stringify({protocol:1,gameId:this.gameId,revision:this.revision,commandId,sender:pulse.playerId,command}));
  if(!result.ok){this.clockDeadlines.set(pulse.playerId,this.clockNow()+ACTION_WINDOW_MS);return {handled:false,pending:false};}
  return {handled:true,pending:!!result.pending,playerId:pulse.playerId};
 }
 checkpoint():AuthorityRecovery {this.refreshClock();const now=this.clockNow();return {version:1,gameId:this.gameId,revision:this.revision,state:structuredClone(this.state),pendingDiscards:structuredClone(this.pendingDiscards),clock:{paused:this.clockPaused,remaining:Object.fromEntries([...this.clockDeadlines].map(([id,deadline])=>[id,Math.max(0,this.clockPaused?deadline:deadline-now)]))}};}
 hasPendingDiscard(playerId:string):boolean{return this.state.phase==='discard'&&Object.hasOwn(this.pendingDiscards,playerId);}
 currentRevision():number{return this.revision;}
 boardVersion(){return this.state.board.version;}
 musicScene(listenerId:string|null){return matchMusicScene(this.state,listenerId);}
 snapshot(playerId:string){const result=projectState(this.state,playerId,this.revision,this.gameId,this.lastTradeSummary);result.public.undoPlayerId=this.lastUndo?.playerId??null;result.public.paused=this.clockPaused;return structuredClone(result);}
 spectatorSnapshot(){const result=projectSpectatorState(this.state,this.revision,this.gameId,this.lastTradeSummary);result.public.undoPlayerId=this.lastUndo?.playerId??null;result.public.paused=this.clockPaused;return structuredClone(result);}
 receive(boundPlayer:string, text:string): {ok:boolean;code?:string;revision:number;pending?:boolean} {
  const reject=(code:string)=>({ok:false,code,revision:this.revision});
  if(this.clockPaused)return reject('paused');
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
  if(!Number.isSafeInteger(revision)||revision!==this.revision)return reject('stale');
  if(command.type==='discard'&&this.state.phase==='discard'){
   if(!this.state.discards[boundPlayer])return reject('illegal');
   if(this.hasPendingDiscard(boundPlayer))return reject('already-submitted');
   const cards=(command as {cards:Hand}).cards;
   try{applyTurnCommand(this.state,command as TurnCommand);}catch{return reject('illegal');}
   this.pendingDiscards[boundPlayer]=structuredClone(cards);
   this.refreshClock();
   this.seen.add(dedupe);
   if(Object.keys(this.pendingDiscards).length<Object.keys(this.state.discards).length)return {ok:true,revision:this.revision,pending:true};
   // Settle every valid discard as a single host-owned state transition.
   let resolved=this.state;
   for(const player of this.state.players){
    const amount=this.pendingDiscards[player.id];
    if(amount)resolved=applyTurnCommand(resolved,{type:'discard',playerId:player.id,cards:amount});
   }
   this.state=resolved;this.pendingDiscards={};this.lastUndo=null;this.lastTradeSummary=null;this.revision++;
   this.refreshClock();return {ok:true,revision:this.revision};
  }
  if(command.type==='undo'){
   if(revision!==this.revision)return reject('stale');
   if(!this.lastUndo||this.lastUndo.playerId!==boundPlayer)return reject('illegal');
   this.state=structuredClone(this.lastUndo.previous);
   this.clockDeadlines=new Map(this.lastUndo.clockDeadlines);
   this.lastUndo=null;this.pendingDiscards={};this.lastTradeSummary=null;
   this.seen.add(dedupe);this.revision++;this.refreshClock();return {ok:true,revision:this.revision};
  }
  const resetActors=effectiveActionResetActors(this.state,command as {type:string;playerId:string});
  const reversible=reversibleTypes.has(command.type);
  const before=reversible?structuredClone(this.state):null;
  const beforeClock=reversible?new Map(this.clockDeadlines):null;
  let pendingTrade:Omit<PublicTradeSummary,'revision'>|null=null;
  if(command.type==='accept-offer'&&this.state.offer){
   const offer=this.state.offer;
   pendingTrade={proposer:offer.proposer,accepter:boundPlayer,giveCount:handSize(offer.give),receiveCount:handSize(offer.receive)};
  }
  try{
   if(setupTypes.has(command.type))this.state=applySetupCommand(this.state,command as SetupCommand);
   else if(turnTypes.has(command.type))this.state=applyTurnCommand(this.state,command as TurnCommand,this.random);
   else if(harborTypes.has(command.type))this.state=applyHarborCommand(this.state,command as HarborCommand);
   else if(buildTypes.has(command.type))this.state=applyBuildCommand(this.state,command as BuildCommand);
   else if(economyTypes.has(command.type))this.state=applyEconomyCommand(this.state,command as EconomyCommand);
   else return reject('malformed');
  }catch{return reject('illegal');}
  this.lastUndo=before&&beforeClock?{playerId:boundPlayer,previous:before,clockDeadlines:beforeClock}:null;
  this.seen.add(dedupe);this.revision++;
  if(this.state.phase!=='discard')this.pendingDiscards={};
  this.lastTradeSummary=pendingTrade?{...pendingTrade,revision:this.revision}:null;this.refreshClock();for(const actor of resetActors)this.refreshClock(actor);return {ok:true,revision:this.revision};
 }
}
