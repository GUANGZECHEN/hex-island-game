import { usesTradeStations, stationCost } from './game/rules/trade-stations';
import './style.css';
import { HULL_STRIPE, playerMarker, playerSailSvg } from './game/ui/player-emblem.ts';
import { renderHarborPanel } from './game/ui/harbor';
import { applyHarborCommand as localHarbor, isHarbor, partnersConnected, type GameMode, type HarborCommand } from './game/rules/harbor';
import './compact-actions.css';
import { setCompactActionLabel } from './game/ui/compact-actions';
import { BoardRendererController } from './game/board/three/controller';
import { logRollPayout, ownPayoutLabel, type GameLogEntry } from './game/ui/roll-payout.ts';
import { DiceSound } from './game/ui/dice-sound.ts';
import { matchMusicScene } from './game/music-outcome.ts';
import { GameMusic } from './game/ui/music.ts';
import { RoomMusicControls } from './game/ui/room-music-controls.ts';
import { ACTION_WINDOW_MS, clockParticipants, effectiveActionResetActors, formatClockSeconds, remainingClockSeconds, timeoutCommand } from './game/rules/turn-clock.ts';
import { shipActionLabel } from './game/ui/ship-action.ts';
import { SHIP_COST, shipsRemaining, usesHarborShips } from './game/rules/build.ts';
import { describeRoll, isNewRoll, type RollPresentation } from './game/board/three/roll-presentation';
import { stableBoardFitHeight } from './game/ui/board-fit';
import type { BoardCameraView } from './game/board/three/renderer';
import { ACTION_PATHS, DEVELOPMENT_LABELS, DEVELOPMENT_PATHS, developmentChip, developmentIcon, icon, resourceChip, resourceIcon, type ActionIcon } from './game/ui/icons';
import { adjacentPlacementHexes, type PlacementKind } from './game/board/target-feedback';
import type { TargetMode } from './game/ui/targets';
import { ALL_OTHER_PLAYERS, incomingTradeView, missingTradeResources, tradeTargetsForSelection, type TradeAmount } from './game/ui/trade';
import { bankTradeRate } from './game/ui/interactions';
import { createActionAvailabilityReader, type ActionAvailability } from './game/ui/action-availability';
import { initializeNetwork, type BrowserGame, type RoomTableLobby } from './game/network/browser';
import type { projectState, projectSpectatorState } from './game/network/authority';
import { createIslandBoard } from './game/board/geometry';
import { generateBoardSetup } from './game/board/setup';
import { createLocalRoomSettings, type LocalRoomSettings } from './game/ui/local-room';
import { createBoardView } from './game/board/presentation';
import { paintGrainPreview, renderIslandBoard } from './game/board/render';
import { createGame, isTwinCapes, usesHarborPirate, publicVictoryPoints, RESOURCES, type GameState, type Hand, type Resource, type Development } from './game/rules/state';
import { applySetupCommand as localSetup } from './game/rules/state';
import { applyTurnCommand as localTurn } from './game/rules/turn';
import { applyBuildCommand as localBuild, longestRoute } from './game/rules/build';
import { derivePublicActivity, turnAnnouncement, type PublicActivityState } from './game/ui/activity';
import { usesDevelopmentCards, applyEconomyCommand as localEconomy } from './game/rules/economy';
import { chooseBotCommand } from './game/bot/policy';
import { applyBotCommand } from './game/bot/runner';

const el = <T extends HTMLElement>(id:string) => document.getElementById(id) as T;
const diceSound=new DiceSound(el<HTMLButtonElement>('sound-toggle'));
const music=new GameMusic();
const roomMusic = new RoomMusicControls(music);
let localMusicRound = 0;
let remote:BrowserGame | null=null, networkRevision=0, projection:(ReturnType<typeof projectState>|ReturnType<typeof projectSpectatorState>) | null=null;
let localRoomOpen=false,activeLocalRoom:LocalRoomSettings|null=null;
let state:GameState | null=null, viewer='', targetMode:TargetMode|null=null, discardSubmitted=false, log:GameLogEntry[]=[], publicActivity='', lastTurnCue='', pendingActivityAlert='', pendingRollPresentation:RollPresentation|null=null, lastWinnerAlert='', turnAlertTimer:number|null=null, activityAlertTimer:number|null=null, victoryAlertTimer:number|null=null, localBotIds=new Set<string>(), botTimer:number|null=null, botTurnKey='', botActionCount=0;
let pendingSupplement:RollPresentation['supplement'];
let supplementTimer:number|null=null;
let rollGeneration=0,rollPlaying=false;
const loggedSupplements=new Set<string>();
function boardVisible():boolean {
 if(el('game').hidden||document.hidden)return false;
 const rect=el('board').getBoundingClientRect();
 return rect.width>0&&rect.height>0&&rect.bottom>0&&rect.right>0&&rect.top<window.innerHeight&&rect.left<window.innerWidth;
}
function logSupplement(key:string,reward:GameState['catchUpReward']|null|undefined,name:(id:string)=>string):void {
 if(!reward||loggedSupplements.has(key))return;
 const items=RESOURCES.filter(resource=>reward.gains[resource]>0).map(resource=>`${reward.gains[resource]} ${resource}`);
 if(!items.length)return;
 loggedSupplements.add(key);log.unshift(`${name(reward.playerId)} gained supplement: ${items.join(', ')}.`);
}
function clearSupplement():void {
 rollGeneration++;rollPlaying=false;pendingSupplement=undefined;
 if(supplementTimer!==null){window.clearTimeout(supplementTimer);supplementTimer=null;}
 document.querySelector('.supplement-alert')?.remove();
}
function showSupplement():void {
 if(!pendingSupplement||!boardVisible()||!state||el('board').querySelector('.turn-alert,.activity-alert,.victory-alert'))return;
 const reward=pendingSupplement;pendingSupplement=undefined;
 const player=state.players.find(p=>p.id===reward.playerId);
 const alert=document.createElement('div');alert.className=`supplement-alert player-${(player?.seat??0)+1}`;
 alert.setAttribute('role','status');alert.setAttribute('aria-live','polite');
 const title=document.createElement('strong');title.textContent=`${playerName(reward.playerId)} gained supplement`;
 const items=document.createElement('span');items.className='supplement-resources';
 for(const resource of RESOURCES){const count=reward.gains[resource]??0;if(count<=0)continue;
  const item=document.createElement('span');item.dataset.resource=resource;item.setAttribute('aria-label',`${count} ${resource}`);
  item.append(resourceIcon(resource),document.createTextNode(`+${count}`));items.append(item);
 }
 alert.append(title,items);el('board').append(alert);
 supplementTimer=window.setTimeout(()=>{alert.remove();supplementTimer=null;scheduleLocalBot();},2200);
}
function presentationVisibilityChanged():void {showSupplement();scheduleLocalBot();}
document.addEventListener('visibilitychange',presentationVisibilityChanged);
window.addEventListener('scroll',presentationVisibilityChanged,{passive:true,capture:true});
window.addEventListener('resize',presentationVisibilityChanged,{passive:true});
new MutationObserver(presentationVisibilityChanged).observe(el('board'),{childList:true});
/** The host alone decides remote expiry. */
let remoteActionClock:{playerId:string;deadlineAt:number;paused:boolean;remainingMs:number}|null=null;
let localPaused=false,localPauseAt=0;
let pendingClockCommand:{type:string;playerId:string}|null=null;
const isPaused=()=>remote?projection?.public.paused===true:localPaused;
const localActionDeadlines=new Map<string,number>();

function syncLocalActionClock(resetActors:string[]=[]):void {
 if(!state||remote){localActionDeadlines.clear();return;}
 const participants=clockParticipants(state);
 for(const id of localActionDeadlines.keys())if(!participants.includes(id))localActionDeadlines.delete(id);
 for(const id of participants)if(!localActionDeadlines.has(id)||resetActors.includes(id))localActionDeadlines.set(id,Date.now()+ACTION_WINDOW_MS);
}
function actionClockDisplay():void {
 const tag=el<HTMLElement>('turn-action-clock');
 if(!state||state.phase==='finished'){tag.hidden=true;return;}
 const now=Date.now();
 const clock=remote
  ?remoteActionClock
  :[...localActionDeadlines].sort((a,b)=>a[1]-b[1]).map(([playerId,deadlineAt])=>({playerId,deadlineAt}))[0]??null;
 if(!clock){tag.hidden=true;return;}
 const remaining=remote&&remoteActionClock?.paused?remoteActionClock.remainingMs:clock.deadlineAt-(localPaused&&!remote?localPauseAt:now);
 const seconds=remainingClockSeconds(remaining),player=state.players.find(p=>p.id===clock.playerId);
 const name=playerName(clock.playerId);
 tag.hidden=false;
 el('turn-action-clock-player').textContent=isPaused()?`Paused · ${name}`:name;
 const pauseButton=el<HTMLButtonElement>('turn-clock-pause');pauseButton.hidden=!!remote&&!remote.canPause();pauseButton.textContent=isPaused()?'Resume':'Pause';pauseButton.setAttribute('aria-pressed',String(isPaused()));
 el('turn-action-clock-seconds').textContent=formatClockSeconds(seconds);
 tag.classList.toggle('running-out',seconds<=10);
 tag.setAttribute('aria-label',`${isPaused()?'Paused. ':''}${name} has ${seconds} seconds left to act`);
 const seat=player?.seat??0;
 tag.style.setProperty('--clock-seat-color',PLAYER_PIECE_PALETTE[seat]?.body??'#456d61');
}
function localTimedAction():void {
 if(remote||localPaused||!state||state.phase==='finished')return;
 const closest=[...localActionDeadlines].sort((a,b)=>a[1]-b[1])[0];
 if(!closest||closest[1]>Date.now())return;
 const [playerId]=closest,command=timeoutCommand(state,playerId);
 if(!command){localActionDeadlines.set(playerId,Date.now()+ACTION_WINDOW_MS);return;}
 try{
  const next=command.type==='place-settlement'||command.type==='place-city'||command.type==='place-road'
   ?localSetup(state,command):command.type==='stop-free-roads'?localEconomy(state,command):localTurn(state,command as Parameters<typeof localTurn>[1]);
  pendingLocalUndo=null;pendingClockCommand=command;
  commit(next,`${playerName(playerId)} ran out of time; automatic ${command.type}.`);
 }catch(error){
  localActionDeadlines.set(playerId,Date.now()+ACTION_WINDOW_MS);
  el('game-error').textContent=error instanceof Error?error.message:'Automatic action failed.';
 }
}

let renderedRoadOwners=new Map<string,string>(),renderedBuildings=new Map<string,string>(),renderedRobberHex='';
const BOT_DELAY_MS=2000,BOT_ACTION_LIMIT=20;
const PLAYER_PIECE_PALETTE=[{body:'#2868b2',edge:'#174679'},{body:'#c74a42',edge:'#8f2b27'},{body:'#f27ebd',edge:'#993a70'},{body:'#8b55a1',edge:'#633675'},{body:'#d48826',edge:'#9a5d12'},{body:'#2b9295',edge:'#176b70'}] as const;
const reversibleActions=new Set(['place-settlement','place-city','harbor-build-station','place-road','build-road','build-settlement','build-city','build-ship','bank-trade','free-road']);
let localUndoState:GameState|null=null,localUndoPlayerId='',localUndoDeadlines:Map<string,number>|null=null,pendingLocalUndo:{state:GameState;playerId:string;deadlines:Map<string,number>}|null=null;
function applyWithLocalUndo<C extends {type:string;playerId:string}>(s:GameState,c:C,apply:(s:GameState,c:C)=>GameState):GameState|null{
 if(isPaused())throw new Error('Game is paused.');
 if(remote){remote.submit(c,networkRevision);return null;}
 const result=apply(s,c);
 pendingClockCommand=c;
 pendingLocalUndo=reversibleActions.has(c.type)?{state:structuredClone(s),playerId:c.playerId,deadlines:new Map(localActionDeadlines)}:null;
 return result;
}
const applySetupCommand = (s:GameState, c:Parameters<typeof localSetup>[1]) => applyWithLocalUndo(s,c,localSetup);
const applyTurnCommand = (s:GameState, c:Parameters<typeof localTurn>[1]) => applyWithLocalUndo(s,c,localTurn);
const applyBuildCommand = (s:GameState, c:Parameters<typeof localBuild>[1]) => applyWithLocalUndo(s,c,localBuild);
const applyEconomyCommand = (s:GameState, c:Parameters<typeof localEconomy>[1]) => applyWithLocalUndo(s,c,localEconomy);
const applyHarborCommand=(s:GameState,c:HarborCommand)=>applyWithLocalUndo(s,c,localHarbor);
const localBoardChoice=(): 'auto'|'twin-capes' => el<HTMLSelectElement>('local-board-version').value==='twin-capes'?'twin-capes':'auto';
const localMode=()=>el<HTMLSelectElement>('local-game-mode').value as GameMode;
const localOptionalRules=()=>({catchUp:localMode()==='classic'&&el<HTMLInputElement>('local-rule-catch-up').checked,
 ships:localMode()==='classic'&&el<HTMLInputElement>('local-rule-ships').checked});
const byId=(id:string)=>state!.players.find(p=>p.id===id)!;
const playerName=(id:string)=>projection?.public.players.find(p=>p.id===id)?.name||id;
function activityState(s:GameState):PublicActivityState {
 return {players:s.players.map(player=>{const publicPlayer=projection?.public.players.find(p=>p.id===player.id);return {id:player.id,name:playerName(player.id),resources:publicPlayer?.resources ?? RESOURCES.reduce((sum,resource)=>sum+player.hand[resource],0),developmentCards:publicPlayer?.developmentCards ?? player.cards.length};}),currentSeat:s.currentSeat,turn:s.turn,phase:s.phase,dice:s.dice,victims:s.victims,board:s.board,roads:s.roads,buildings:s.buildings,playedCards:s.playedCards,bank:s.bank,deckCount:projection?.public.deckCount ?? s.deck.length};
}
function handoff(id:string){viewer=id;el('game').hidden=true;el('pass').hidden=false;el('pass-message').textContent=`Pass the device to ${id}.`;} 
function centralActivity(message:string){return /built a ship|built a road|built a settlement|upgraded a settlement|bought a development card|moved the robber|moved the pirate|stole 1 card|played |traded /i.test(message);}
function commit(next:GameState | null, description:string){if(!next)return;if(!remote){localUndoState=pendingLocalUndo?.state??null;localUndoPlayerId=pendingLocalUndo?.playerId??'';localUndoDeadlines=pendingLocalUndo?.deadlines??null;pendingLocalUndo=null;}const old=state!,beforeActivity=activityState(old);state=next;if(!remote){syncLocalActionClock(pendingClockCommand?effectiveActionResetActors(old,pendingClockCommand):[]);pendingClockCommand=null;}const afterActivity=activityState(next),message=(next.harbor&&next.harbor.event!==old.harbor?.event?next.harbor.event:null)??derivePublicActivity(beforeActivity,afterActivity)??description;if(message){log.unshift(message);publicActivity=message;if(centralActivity(message))pendingActivityAlert=message;}if(next.lastRollPayout?.turn!==old.lastRollPayout?.turn)logRollPayout(log,next.lastRollPayout,next.players,playerName);if(isNewRoll(old,next)&&next.dice){clearSupplement();pendingRollPresentation=describeRoll(old,next.dice,next);logSupplement(`local:${next.turn}`,next.catchUpReward,playerName);}targetMode=null;if(old.currentSeat!==next.currentSeat&&localBotIds.size===0&&next.phase!=='finished')handoff(next.players[next.currentSeat].id);if(isHarbor(next)&&!localBotIds.size&&next.phase!=='finished'){const nextViewer=next.phase==='discard'?Object.keys(next.discards)[0]:old.phase==='discard'?next.players[next.currentSeat].id:null;if(nextViewer&&nextViewer!==viewer)handoff(nextViewer);}render();}
function attempt(f:()=>void){try{f();el('game-error').textContent='';}catch(error){el('game-error').textContent=error instanceof Error?error.message:'Action failed.';}}
function clearBotTimer(){if(botTimer!==null){window.clearTimeout(botTimer);botTimer=null;}}
function botDescription(command:ReturnType<typeof chooseBotCommand>,before:GameState){if(!command)return 'Bot acted.';if(command.type==='accept-offer'&&before.offer)return domesticTradeMessage(before.offer,command.playerId);if(command.type==='reject-offer')return `${playerName(command.playerId)} rejected a trade.`;return `${playerName(command.playerId)} acted.`;}
function pendingLocalBot(s:GameState):string|null{
 if(isHarbor(s)&&s.phase==='discard'&&s.discards[viewer])return null;
 for(const botId of localBotIds)if(s.discards[botId])return botId;
 if(s.phase==='action'){const tradeBot=[...localBotIds].find(botId=>s.offer?.targets.includes(botId));if(tradeBot)return tradeBot;}
 const active=s.players[s.currentSeat]?.id;return active&&localBotIds.has(active)?active:null;
}
function botPresentationBlocked():boolean {
 return boardVisible()&&(rollPlaying||!!pendingSupplement||supplementTimer!==null);
}
function runLocalBotStep(){
 botTimer=null;if(remote||localPaused||localBotIds.size===0||!state||state.phase==='finished'||botPresentationBlocked())return;
 const botId=pendingLocalBot(state);if(!botId)return;
 const key=`${state.turn}:${state.currentSeat}:${botId}`;if(key!==botTurnKey){botTurnKey=key;botActionCount=0;}
 let command=chooseBotCommand(state,botId);if(!command)return;
 if(botActionCount>=BOT_ACTION_LIMIT){
  if(state.players[state.currentSeat]?.id===botId&&state.phase==='action')command={type:'end-turn',playerId:botId};
  else{log.unshift(`${playerName(botId)} action limit reached; automation paused.`);publicActivity=`${playerName(botId)} automation paused.`;render();return;}
 }
 botActionCount++;const before=state,description=botDescription(command,before);pendingLocalUndo=null;const next=applyBotCommand(before,command);pendingClockCommand=command;commit(next,description);
}
function scheduleLocalBot(){
 if(remote||localPaused||localBotIds.size===0||!state||state.phase==='finished'||botTimer!==null||botPresentationBlocked())return;
 if(!pendingLocalBot(state))return;
 botTimer=window.setTimeout(runLocalBotStep,BOT_DELAY_MS);
}
function button(parent:HTMLElement,label:string,action:()=>void){const b=document.createElement('button');b.type='button';b.textContent=label;b.onclick=()=>{if(!b.disabled)attempt(action);};parent.append(b);return b;}
function select(parent:HTMLElement,label:string,options:readonly string[]):HTMLSelectElement{const wrapper=document.createElement('label');wrapper.textContent=label;const input=document.createElement('select');for(const value of options){const option=document.createElement('option');option.value=value;option.textContent=value;input.append(option);}wrapper.append(input);parent.append(wrapper);return input;}
function playerSelect(parent:HTMLElement,label:string,ids:readonly string[]):HTMLSelectElement{const wrapper=document.createElement('label');wrapper.textContent=label;const input=document.createElement('select');for(const id of ids){const option=document.createElement('option');option.value=id;option.textContent=playerName(id);input.append(option);}wrapper.append(input);parent.append(wrapper);return input;}
const draftCounts=new Map<string,Hand>(),draftChoices=new Map<string,Resource>();
const tradeDrafts=new Map<string,{recipient:string;open:boolean}>();
function resourceChoice(parent:HTMLElement,label:string,initial:Resource=RESOURCES[0],onChange:()=>void=()=>{}):()=>Resource{
 const field=document.createElement('fieldset');field.className='resource-choice-group';const legend=document.createElement('legend');legend.textContent=label;field.append(legend);const key=`${viewer}:${label}`;let selected=draftChoices.get(key)??initial;
 const buttons=new Map<Resource,HTMLButtonElement>();
 const refresh=()=>{for(const [resource,button] of buttons)button.setAttribute('aria-pressed',String(resource===selected));};
 for(const resource of RESOURCES){const choice=document.createElement('button');choice.type='button';choice.className='resource-choice-button';choice.title=resource;choice.setAttribute('aria-label',`Choose ${resource}`);choice.append(resourceIcon(resource));choice.onclick=()=>{if(field.disabled)return;selected=resource;draftChoices.set(key,resource);refresh();onChange();};buttons.set(resource,choice);field.append(choice);}
 refresh();parent.append(field);return ()=>selected;
}
function bankTradeButtons(parent:HTMLElement,s:GameState,actor:GameState['players'][number],availability:ActionAvailability,reason:string){
 const section=document.createElement('section');section.className='bank-trade-section';const title=document.createElement('h2');title.textContent='Bank / port trades';const hint=document.createElement('p');hint.className='trade-rate-hint';hint.textContent=usesHarborPirate(s)?'The pirate closes the marked harbor. Your other ports and the bank still offer trades.':'Rates update automatically when you build on a port.';const grid=document.createElement('div');grid.className='bank-trade-grid';section.append(title,hint,grid);
 for(const give of RESOURCES){const rate=bankTradeRate(s,viewer,give);for(const receive of RESOURCES){if(receive===give||!availability.bankTrades[`${give}:${receive}`]?.enabled)continue;const tradeButton=document.createElement('button');tradeButton.type='button';tradeButton.className=`bank-trade-button bank-trade-rate-${rate}`;tradeButton.dataset.rate=String(rate);tradeButton.setAttribute('aria-label',`Trade ${rate} ${give} for 1 ${receive}`);tradeButton.title=`${rate} ${give} → 1 ${receive}`;
   const from=document.createElement('span');from.className='bank-trade-side';const rateBadge=document.createElement('span');rateBadge.className='bank-trade-rate';rateBadge.textContent=String(rate);from.append(rateBadge,resourceIcon(give));
   const arrow=document.createElement('span');arrow.className='bank-trade-arrow';arrow.textContent='→';arrow.setAttribute('aria-hidden','true');const to=document.createElement('span');to.className='bank-trade-side';to.append(resourceIcon(receive));
   tradeButton.append(from,arrow,to);setAvailability(tradeButton,availability.bankTrades[`${give}:${receive}`],reason==='Unavailable in this phase or with current resources'?(s.phase!=='action'?'Trade during the action phase':actor.hand[give]<rate?`Need ${rate} ${give}`:s.bank[receive]<1?`Bank has no ${receive}`:reason):reason);
   tradeButton.onclick=()=>{if(!tradeButton.disabled)attempt(()=>commit(applyEconomyCommand(s,{type:'bank-trade',playerId:viewer,give,receive,rate}),`${viewer} traded with the bank.`));};grid.append(tradeButton);
 }}
 if(grid.childElementCount>0)parent.append(section);
}

const availabilityLabels=new WeakMap<HTMLButtonElement,{title:string;description:string}>();
function setAvailability(button:HTMLButtonElement,availability:{enabled:boolean},reason:string){
 const original=availabilityLabels.get(button)??{title:button.title,description:button.getAttribute('aria-description')??''};availabilityLabels.set(button,original);
 button.disabled=!availability.enabled;
 button.title=button.disabled?reason:original.title;
 const description=[original.description,button.disabled?reason:''].filter(Boolean).join('. ');
 if(description)button.setAttribute('aria-description',description);else button.removeAttribute('aria-description');
}

function resourceAmounts(parent:HTMLElement,amounts:readonly TradeAmount[]){for(const amount of amounts)parent.append(resourceChip(amount.resource,amount.count));}
function domesticTradeMessage(offer:NonNullable<GameState['offer']>,accepter:string){const give=RESOURCES.reduce((sum,r)=>sum+offer.give[r],0),receive=RESOURCES.reduce((sum,r)=>sum+offer.receive[r],0);return `${playerName(offer.proposer)} traded ${give} card${give===1?'':'s'} for ${receive} card${receive===1?'':'s'} with ${playerName(accepter)}.`;}
function incomingTradeCard(parent:HTMLElement,offer:NonNullable<GameState['offer']>,hand:Hand){
 const view=incomingTradeView(offer,viewer);if(!view)return;
 const card=document.createElement('section');card.className='incoming-trade';card.setAttribute('aria-label',`${view.isBroadcast?'Broadcast trade':'Trade offer'} from ${view.proposer}`);
 const title=document.createElement('h2');title.textContent=`${view.isBroadcast?'Open trade':'Trade offer'} from ${playerName(view.proposer)}`;card.append(title);
 if(view.isBroadcast){const note=document.createElement('p');note.className='trade-broadcast-note';note.textContent=`Sent to ${view.recipientCount} players · first to accept completes the trade.`;card.append(note);}
 const receive=document.createElement('div');receive.className='trade-offer-row';const receiveLabel=document.createElement('strong');receiveLabel.textContent='You receive';const receiveResources=document.createElement('span');receiveResources.className='trade-offer-resources';resourceAmounts(receiveResources,view.receive);receive.append(receiveLabel,receiveResources);
 const give=document.createElement('div');give.className='trade-offer-row';const giveLabel=document.createElement('strong');giveLabel.textContent='You give';const giveResources=document.createElement('span');giveResources.className='trade-offer-resources';resourceAmounts(giveResources,view.give);give.append(giveLabel,giveResources);
 card.append(receive,give);
 const missing=missingTradeResources(hand,offer.receive);
 if(missing.length){
  const note=document.createElement('p');note.className='trade-insufficient';
  note.textContent=`To accept, you still need ${missing.map(({resource,count})=>`${count} ${resource}`).join(', ')}.`;
  card.append(note);
 }
 parent.append(card);
}
type ActionCost=Partial<Hand>|0;
function action(parent:HTMLElement,label:string,symbol:ActionIcon,run:()=>void,cost?:ActionCost){
 const b=button(parent,'',run);b.className=`action-button action-${symbol}`;b.dataset.action=symbol;const text=document.createElement('span');text.className='action-label';setCompactActionLabel(b,text,label);b.append(icon(ACTION_PATHS[symbol]),text);
 if(cost!==undefined){
  const list=document.createElement('span');list.className='action-cost';
  if(cost===0){
   b.setAttribute('aria-description','Cost: 0');
   list.textContent='0';
  }else{
   const resources=RESOURCES.filter(resource=>cost[resource]);
   b.setAttribute('aria-description',`Cost: ${resources.map(resource=>`${cost[resource]} ${resource}`).join(', ')}`);
   for(const resource of resources)list.append(resourceChip(resource,cost[resource]!));
  }
  b.append(list);
 }
 return b;
}
function enterGame(newMatch:boolean){
 if(newMatch){draftCounts.clear();draftChoices.clear();tradeDrafts.clear();}
 const wasConfiguring=document.body.classList.contains('room-configuring');
 document.body.classList.add('playing');
 document.body.classList.remove('room-configuring');
 if(remote)document.body.classList.add('room-running');
 el('turn-card').hidden=false;el('board-ledger').hidden=false;
 el('game').querySelector<HTMLElement>('.board-view-toolbar')!.hidden=false;
 el('game').querySelector<HTMLElement>('.board-help')!.textContent='Choose an action, then select a highlighted target on the board.';
 const local=!remote&&activeLocalRoom!==null;
 el('local-restart').hidden=!local;el('pass-local-restart').hidden=!local;
 if(remote){el('reconnect-holder').append(el('room-reconnect'));el('turn-card').append(el('qa-indicator'));}
 else el('connection-summary').textContent=localBotIds.size?`Local game · ${localBotIds.size} test bot${localBotIds.size===1?'':'s'} enabled`:'Local game';
 // The setup-to-game transition changes the shell; fit once for this new layout.
 if(wasConfiguring){boardFitReady=false;scheduleDesktopBoardFit();}
}
// Set the board's desktop height at entry or a true viewport resize, never on
// every game action. Trade controls can scroll the document and must not resize
// the board (and its camera) during a transaction.
let boardFitScheduled=false,boardFitReady=false;
function fitBoardToDesktopViewport(){
 boardFitScheduled=false;
 const stage=el('game').querySelector<HTMLElement>('.board-stage');
 if(!stage||el('game').hidden)return;
 if(window.innerWidth<=1100){stage.style.removeProperty('--board-fit-height');boardFitReady=true;return;}
 // Scroll-invariant document coordinates: rect.top alone changes as users scroll.
 const top=stage.getBoundingClientRect().top+window.scrollY;
 stage.style.setProperty('--board-fit-height',`${stableBoardFitHeight(window.innerHeight,top)}px`);
 boardFitReady=true;
}
function scheduleDesktopBoardFit(){
 if(boardFitReady||boardFitScheduled)return;
 boardFitScheduled=true;
 window.requestAnimationFrame(fitBoardToDesktopViewport);
}
function onViewportSizeChange(){boardFitReady=false;scheduleDesktopBoardFit();}
window.addEventListener('resize',onViewportSizeChange);
window.visualViewport?.addEventListener('resize',onViewportSizeChange);

function connectionStatus(value:string){const lower=value.toLowerCase();el('connection-summary').textContent=lower.includes('watching')?'Spectating':lower.includes('paused')||lower.includes('unavailable')||lower.includes('failed')?'Disconnected · rejoin may be required':lower.includes('reconnected')?'Reconnected':lower.includes('reconnect')||lower.includes('interrupted')?'Reconnecting…':lower.includes('connected')||lower.includes('started')?'Connected':lower.includes('connecting')?'Connecting…':'';}
function counts(parent:HTMLElement,label:string,max?:Hand,onChange:()=>void=()=>{},disabledReason=''):()=>Hand{
 const field=document.createElement('fieldset');field.disabled=!!disabledReason;if(disabledReason){field.title=disabledReason;field.setAttribute('aria-description',disabledReason);}const legend=document.createElement('legend');legend.textContent=label;field.append(legend);field.className='resource-stepper-grid';
 const key=`${viewer}:${label}`,saved=draftCounts.get(key);const values=Object.fromEntries(RESOURCES.map(resource=>[resource,Math.min(saved?.[resource]??0,max?.[resource]??99)])) as Hand;if(!field.disabled)draftCounts.set(key,values);
 for(const resource of RESOURCES){
  const row=document.createElement('div');row.className='resource-stepper';
  const name=document.createElement('span');name.className='resource-stepper-name';name.append(resourceIcon(resource),document.createTextNode(resource));
  const minus=document.createElement('button');minus.type='button';minus.className='stepper-button';minus.textContent='−';minus.setAttribute('aria-label',`Remove one ${resource}`);
  const count=document.createElement('span');count.className='stepper-count';count.textContent='0';count.setAttribute('aria-live','polite');
  const plus=document.createElement('button');plus.type='button';plus.className='stepper-button';plus.textContent='+';plus.setAttribute('aria-label',`Add one ${resource}`);
  const refresh=()=>{count.textContent=String(values[resource]);minus.disabled=values[resource]===0;plus.disabled=values[resource]>=(max?.[resource]??99);};
  minus.onclick=()=>{if(field.disabled)return;values[resource]=Math.max(0,values[resource]-1);refresh();onChange();};
  plus.onclick=()=>{if(field.disabled)return;values[resource]=Math.min(max?.[resource]??99,values[resource]+1);refresh();onChange();};
  row.append(name,minus,count,plus);field.append(row);refresh();
 }
 parent.append(field);return ()=>({...values});
}
function developmentAction(parent:HTMLElement,label:string,card:Exclude<Development,'victory-point'>,run:()=>void){
 const b=button(parent,'',run);b.className=`action-button development-action-button development-${card}`;b.dataset.development=card;const text=document.createElement('span');text.className='action-label';setCompactActionLabel(b,text,label);b.append(developmentIcon(card),text);return b;
}
function renderDevelopmentCards(parent:HTMLElement,cards:GameState['players'][number]['cards'],turn:number){
 parent.replaceChildren();for(const type of Object.keys(DEVELOPMENT_LABELS) as Development[]){const owned=cards.filter(card=>card.type===type);if(!owned.length)continue;parent.append(developmentChip(type,owned.length,owned.filter(card=>card.boughtTurn===turn).length));}
}
function playerStat(path:string,count:number|string,title:string,className:string,label?:string){
 const item=document.createElement('span');item.className=`player-stat ${className}`;item.title=title;item.setAttribute('aria-label',`${title}: ${count}`);
 if(label){const tag=document.createElement('span');tag.className='player-stat-label';tag.textContent=label;item.append(tag);}
 item.append(icon(path,'icon player-stat-icon'),document.createTextNode(String(count)));return item;
}
function shipSupplyStat(s:GameState,playerId:string,className:string){
 const remaining=shipsRemaining(s,playerId);
 return remaining===Infinity?playerStat(ACTION_PATHS.ship,'∞','Unlimited ships',className,'Ship'):playerStat(ACTION_PATHS.ship,remaining,'Ships remaining (max 2)',className,'Ship');
}
function renderPieceSupply(player:GameState['players'][number]){
 const supply=el('piece-supply');supply.replaceChildren();
 const title=document.createElement('strong');title.textContent='Pieces left';supply.append(title,
  playerStat(ACTION_PATHS.road,player.roads,'Roads remaining','supply-road','R'),
  playerStat(ACTION_PATHS.settlement,player.settlements,'Settlements remaining','supply-settlement','S'),
  playerStat(ACTION_PATHS.city,player.cities,'Cities remaining','supply-city','C'));
 if(state&&usesHarborShips(state))supply.append(shipSupplyStat(state,player.id,'supply-ship'));
}
let lobbyPreviewBoard: ReturnType<typeof generateBoardSetup>|null=null;
function renderRoomMapPreview(){
 const input=el<HTMLInputElement>('room-seed'),preview=el('room-map-preview');if(!input.value||!input.validity.valid){preview.textContent='Enter a valid map seed.';return;}
 const boardVersion=el<HTMLSelectElement>('room-board-version').value;
 const setup=generateBoardSetup(input.valueAsNumber,boardVersion==='twin-capes'||boardVersion==='expanded-5-6'?boardVersion:'standard',input.dataset.generatorVersion);
 renderIslandBoard(preview,setup);const svg=preview.querySelector('svg');if(svg){svg.removeAttribute('aria-hidden');svg.setAttribute('aria-label',`Preview of map seed ${input.value}`);}
 // Reuse the live Three.js renderer from lobby through gameplay.
 if(document.body.classList.contains('room-configuring')){
  lobbyPreviewBoard=setup;
  if(!boardRenderer)boardRenderer=new BoardRendererController(el('board'),drawSvgBoard,id=>attempt(()=>moveTarget(id)),rememberedBoardCamera);
  boardRenderer.update({board:setup,roads:{},buildings:{},players:[],targetMode:null,legalTargets:[],harborPorts:el<HTMLSelectElement>('room-game-mode').value==='harbor-coop'});
  scheduleDesktopBoardFit();
 }
}
function enterNetworkRoom(){
 document.body.classList.add('playing','room-table','room-configuring');
 document.body.classList.remove('room-running');
 const sidebar=el('game').querySelector<HTMLElement>('.board-command-column')!;
 const room=el('room-section');
 if(room.parentElement!==sidebar)sidebar.insertBefore(room,el('turn-card'));
 el('pass').hidden=true;el('game').hidden=false;
 if(!state){
  el('turn-card').hidden=true;el('private-hand-card').hidden=true;
  el('board-action-pane').hidden=true;el('board-trade-pane').hidden=true;
  el('board-ledger').hidden=true;el('harbor-panel').hidden=true;
  el('game').querySelector<HTMLElement>('.board-view-toolbar')!.hidden=true;
  el('game').querySelector<HTMLElement>('.board-help')!.textContent='Map preview · The selected map will be used for the next game.';
  el('turn-banner').textContent='Choose your island';
  el('public-action').textContent='The host selects the mode and map here. Everyone sees the same preview.';
  renderRoomMapPreview();
 }
 scheduleDesktopBoardFit();
}
function renderNetworkLobby(view:RoomTableLobby){
 if(!view.started||view.recovering){
  roomMusic.setScene('lobby');
  enterNetworkRoom();
 }
 document.body.classList.toggle('room-configuring',!view.started||view.recovering);
 document.body.classList.toggle('room-running',view.started&&!view.recovering);
 if(view.started&&!view.recovering)return;
 if(el('room-reconnect').parentElement===el('reconnect-holder'))el('room-section').append(el('room-reconnect'));
 // Preserve the WebGL canvas and camera as players join or become ready.
 const strip=el('player-strip');strip.replaceChildren();
 strip.dataset.playerCount=String(view.seats.length);
 for(const [index,seat] of view.seats.entries()){
  const row=document.createElement('div');row.className=`player-summary player-${index+1}`;row.dataset.seat=String(index+1);
  const marker = playerMarker(index);
  const name=document.createElement('strong');name.className='player-summary-name';name.textContent=seat.name;
  const readiness=document.createElement('span');readiness.className='room-seat-readiness';readiness.textContent=seat.connected?(seat.ready?'✓ Ready':'Not ready'):'Disconnected';
  row.append(marker,name,readiness);strip.append(row);
 }
 el('turn-card').hidden=true;el('private-hand-card').hidden=true;el('board-action-pane').hidden=true;el('board-trade-pane').hidden=true;
 el('board-ledger').hidden=true;el('harbor-panel').hidden=true;
 el('game').querySelector<HTMLElement>('.board-view-toolbar')!.hidden=true;
 el('turn-banner').textContent=view.recovering?'Recovering saved room':view.started?'Resuming game':view.mode==='harbor-coop'?'Harbor Co-op · room setup':'Classic · room setup';
 el('public-action').textContent=view.recovering?'Waiting for original players to reconnect.':`${view.seats.length} seated · ${view.spectators} spectating · Host chooses mode and map · Catch-up ${view.rules.catchUp?'ON':'OFF'} · ${view.boardLayout==='twin-capes'?'Unlimited ships':`Ships ${view.rules.ships?'ON':'OFF'}`}`;
 renderRoomMapPreview();
 scheduleDesktopBoardFit();
}
document.addEventListener('hex-room-map-updated',renderRoomMapPreview);
function moveTarget(id:string){if(!state||isPaused())return;const current=state.players[state.currentSeat].id;if(viewer!==current)return;
 if(targetMode==='settlement')commit(state.phase==='setup-settlement'?applySetupCommand(state,{type:'place-settlement',playerId:viewer,vertexId:id}):applyBuildCommand(state,{type:'build-settlement',playerId:viewer,vertexId:id}),`${viewer} placed a settlement.`);
 else if(targetMode==='city')commit(state.phase==='setup-city'?applySetupCommand(state,{type:'place-city',playerId:viewer,vertexId:id}):applyBuildCommand(state,{type:'build-city',playerId:viewer,vertexId:id}),`${viewer} upgraded a city.`);
 else if(targetMode==='road')commit(state.phase==='setup-road'?applySetupCommand(state,{type:'place-road',playerId:viewer,edgeId:id}):state.phase==='free-road'?applyEconomyCommand(state,{type:'free-road',playerId:viewer,edgeId:id}):applyBuildCommand(state,{type:'build-road',playerId:viewer,edgeId:id}),`${viewer} placed a road.`);
 else if(targetMode==='station')commit(applyHarborCommand(state,{type:'harbor-build-station',playerId:viewer,vertexId:id}),`${viewer} built a trade station.`);
  else if(targetMode==='ship')commit(applyBuildCommand(state,{type:'build-ship',playerId:viewer,vertexId:id}),`${playerName(viewer)} built a ship.`);
 else if(targetMode==='pirate')commit(applyTurnCommand(state,{type:'move-pirate',playerId:viewer,edgeId:id}),`${playerName(viewer)} moved the pirate.`);
 else if(targetMode==='robber')commit(applyTurnCommand(state,{type:'move-robber',playerId:viewer,hexId:id}),`${viewer} moved the robber.`);
}
function flashTurnCue(s:GameState){const game=el('game');if(game.hidden||s.phase==='finished')return;const key=`${s.turn}:${s.currentSeat}`;if(key===lastTurnCue)return;lastTurnCue=key;const banner=el('turn-banner'),card=el('player-strip').querySelector<HTMLElement>('.active-player');for(const target of [banner,card]){if(!target)continue;target.classList.remove('turn-cue-flash');void target.offsetWidth;target.classList.add('turn-cue-flash');target.addEventListener('animationend',()=>target.classList.remove('turn-cue-flash'),{once:true});}
 const active=s.players[s.currentSeat],board=el('board');board.querySelector('.turn-alert')?.remove();if(turnAlertTimer!==null){window.clearTimeout(turnAlertTimer);turnAlertTimer=null;}
 const alert=document.createElement('div');alert.className=`turn-alert player-${active.seat+1}`;alert.setAttribute('role','alert');alert.setAttribute('aria-live','assertive');
 const lead=document.createElement('span');lead.className='turn-alert-lead';lead.textContent=active.id===viewer?'YOUR TURN':'NEXT TURN';
 const name=document.createElement('strong');name.className='turn-alert-name';name.textContent=playerName(active.id);alert.append(lead,name);board.append(alert);
 turnAlertTimer=window.setTimeout(()=>{alert.classList.add('turn-alert-out');turnAlertTimer=window.setTimeout(()=>{alert.remove();turnAlertTimer=null;},260);},2200);
}
type ActivityMotionKind='development'|'card-buy'|'build'|'robber'|'pirate'|'trade'|'generic';
function activityMotionKind(message:string):ActivityMotionKind {
 if(/played (Knight|Road Building|Year of Plenty|Monopoly)/i.test(message))return 'development';
 if(/bought a development card/i.test(message))return 'card-buy';
 if(/built a road|built a settlement|upgraded a settlement/i.test(message))return 'build';
 if(/moved the pirate/i.test(message))return 'pirate';
 if(/moved the robber|stole 1 card/i.test(message))return 'robber';
 if(/traded /i.test(message))return 'trade';
 return 'generic';
}
function playedDevelopment(message:string):Development|null {
 for(const [card,label] of Object.entries(DEVELOPMENT_LABELS) as [Development,string][])if(card!=='victory-point'&&message.toLowerCase().includes(`played ${label.toLowerCase()}`))return card;
 return null;
}
function motionCard(card:Development|null,label:string){
 const visual=document.createElement('span');visual.className=`motion-card${card?` motion-card-${card}`:' motion-card-hidden'}`;visual.setAttribute('aria-hidden','true');
 const face=document.createElement('span');face.className='motion-card-face';face.append(card?developmentIcon(card):icon(ACTION_PATHS.card,'icon motion-card-icon'));
 const caption=document.createElement('span');caption.className='motion-card-caption';caption.textContent=label;face.append(caption);visual.append(face);return visual;
}
function showActivityAlert(s:GameState){
 if(!pendingActivityAlert||el('game').hidden)return;
 const activity=pendingActivityAlert;pendingActivityAlert='';
 const board=el('board');board.querySelector('.activity-alert')?.remove();if(activityAlertTimer!==null){window.clearTimeout(activityAlertTimer);activityAlertTimer=null;}
 const active=s.players[s.currentSeat],kind=activityMotionKind(activity),alert=document.createElement('div');alert.className=`activity-alert activity-${kind} player-${active.seat+1}`;alert.dataset.motionKind=kind;alert.setAttribute('role','status');alert.setAttribute('aria-live','polite');
 const lead=document.createElement('span');lead.className='activity-alert-lead';lead.textContent=kind==='development'?'CARD PLAY':kind==='card-buy'?'NEW CARD':kind==='build'?'BUILD':kind==='pirate'?'PIRATE':kind==='robber'?'ROBBER':kind==='trade'?'TRADE':'TABLE ACTION';
 const message=document.createElement('strong');message.className='activity-alert-message';message.textContent=activity;
 if(kind==='development'){const card=playedDevelopment(activity);alert.append(lead,motionCard(card,card?DEVELOPMENT_LABELS[card]:'Development card'),message);}
 else if(kind==='card-buy')alert.append(lead,motionCard(null,'Development card'),message);
 else alert.append(lead,message);
 board.append(alert);
 const hold=kind==='development'||kind==='card-buy'?1900:1700;
 activityAlertTimer=window.setTimeout(()=>{alert.classList.add('activity-alert-out');activityAlertTimer=window.setTimeout(()=>{alert.remove();activityAlertTimer=null;},240);},hold);
}
function showVictoryAlert(s:GameState){
 if(s.harbor&&s.harbor.outcome!=='playing'){
  const key='harbor-'+s.harbor.outcome;if(lastWinnerAlert===key||el('game').hidden)return;lastWinnerAlert=key;
  el('board').querySelector('.turn-alert')?.remove();el('board').querySelector('.activity-alert')?.remove();
  const alert=document.createElement('div');alert.className='victory-alert player-1';alert.setAttribute('role','alert');
  const title=document.createElement('strong');title.className='victory-alert-name';title.textContent=s.harbor.outcome==='won'?'TEAM VICTORY':'TRY AGAIN TOGETHER';
  const note=document.createElement('span');note.className='victory-alert-note';note.textContent=s.harbor.event;alert.append(title,note);el('board').append(alert);
  victoryAlertTimer=window.setTimeout(()=>{alert.remove();victoryAlertTimer=null;},5000);return;
 }

 if(!s.winner||lastWinnerAlert===s.winner||el('game').hidden)return;
 const winner=s.players.find(player=>player.id===s.winner);if(!winner)return;lastWinnerAlert=s.winner;
 if(turnAlertTimer!==null){window.clearTimeout(turnAlertTimer);turnAlertTimer=null;}
 if(activityAlertTimer!==null){window.clearTimeout(activityAlertTimer);activityAlertTimer=null;}
 if(victoryAlertTimer!==null){window.clearTimeout(victoryAlertTimer);victoryAlertTimer=null;}
 const board=el('board');board.querySelector('.turn-alert')?.remove();board.querySelector('.activity-alert')?.remove();board.querySelector('.victory-alert')?.remove();
 const alert=document.createElement('div');alert.className=`victory-alert player-${winner.seat+1}`;alert.setAttribute('role','alert');alert.setAttribute('aria-live','assertive');
 const burst=document.createElement('div');burst.className='victory-burst';burst.setAttribute('aria-hidden','true');
 const vectors=[[-190,-120],[-120,-165],[-45,-180],[45,-175],[125,-150],[195,-95],[205,-10],[175,75],[110,135],[35,160],[-45,155],[-120,135],[-185,80],[-210,5],[-165,-55],[155,-35]];
 vectors.forEach(([x,y],index)=>{const piece=document.createElement('span');piece.className='victory-confetti';piece.style.setProperty('--x',`${x}px`);piece.style.setProperty('--y',`${y}px`);piece.style.setProperty('--r',`${(index%2?1:-1)*(75+index*19)}deg`);piece.style.setProperty('--delay',`${(index%5)*45}ms`);burst.append(piece);});
 const lead=document.createElement('span');lead.className='victory-alert-lead';lead.textContent='VICTORY';
 const name=document.createElement('strong');name.className='victory-alert-name';name.textContent=`${playerName(s.winner)} WINS!`;
 const note=document.createElement('span');note.className='victory-alert-note';note.textContent='Game over';
 alert.append(burst,lead,name,note);board.append(alert);
 victoryAlertTimer=window.setTimeout(()=>{alert.classList.add('victory-alert-out');victoryAlertTimer=window.setTimeout(()=>{alert.remove();victoryAlertTimer=null;},520);},5000);
}
function playerAward(label:string,pathData:string,className:string){
 const badge=document.createElement('span');badge.className=`player-award ${className}`;badge.setAttribute('aria-label',label);badge.title=label;
 badge.append(icon(pathData,'icon player-award-icon'),document.createTextNode(label));return badge;
}
function renderPlayerStrip(s:GameState,activeId:string){
 const strip=el('player-strip');strip.replaceChildren();strip.dataset.playerCount=String(s.players.length);
 for(const player of s.players){
  const publicPlayer=projection?.public.players.find(p=>p.id===player.id);
  const handCount=publicPlayer?.resources ?? RESOURCES.reduce((sum,r)=>sum+player.hand[r],0);
  const developmentCount=publicPlayer?.developmentCards ?? player.cards.length;
  const publicVp=publicVictoryPoints(s,player.id),routeLength=longestRoute(s,player.id);
  const card=document.createElement('div');
  card.className=`player-summary player-${player.seat+1}${player.id===activeId?' active-player':''}${player.id===viewer?' local-player':''}`;
  card.dataset.seat=String(player.seat+1);
  card.setAttribute('aria-label',`${playerName(player.id)}${player.id===viewer?', you':''}: ${handCount} resource cards, ${usesDevelopmentCards(s)?`${developmentCount} development cards, ${player.knights} knights played, `:''}${publicVp} public victory points, ${player.roads} roads, ${player.settlements} settlements, ${player.cities} cities remaining, longest road ${routeLength}${usesDevelopmentCards(s)&&s.armyHolder===player.id?', largest army holder':''}${player.id===activeId?', current turn':''}`);

  const header=document.createElement('div');header.className='player-summary-header';
  const marker = playerMarker(player.seat);
  const name=document.createElement('span');name.className='player-summary-name';const shown=playerName(player.id);name.textContent=player.id===viewer?`${shown} · You`:shown;
  header.append(marker,name);
  if(player.id===activeId){const turn=document.createElement('span');turn.className='player-turn-badge';turn.textContent='Turn';header.append(turn);}

  const publicStats=document.createElement('div');publicStats.className='player-public-stats';
  publicStats.append(
   playerStat(ACTION_PATHS.victory,publicVp,'Public victory points','player-vp-count','VP'),
   playerStat(ACTION_PATHS.hand,handCount,'Resource cards','player-hand-count')
  );
  if(usesDevelopmentCards(s)){publicStats.append(playerStat(ACTION_PATHS.card,developmentCount,'Development cards','player-dev-count'),playerStat(DEVELOPMENT_PATHS.knight,player.knights,'Knights played','player-knight-count','K'));if(s.armyHolder===player.id)publicStats.lastElementChild?.classList.add('largest-army-holder');}

  const pieces=document.createElement('div');pieces.className='player-piece-stats';
  pieces.append(
   playerStat(ACTION_PATHS.road,player.roads,'Roads remaining','player-road-left','R'),
   playerStat(ACTION_PATHS.settlement,player.settlements,'Settlements remaining','player-settlement-left','S'),
   playerStat(ACTION_PATHS.city,player.cities,'Cities remaining','player-city-left','C'),
   playerStat(ACTION_PATHS.road,routeLength,'Longest road length','player-longest-road','LR')
  );
  if(s.longestHolder===player.id)pieces.lastElementChild?.classList.add('award-holder');
  if(usesHarborShips(s))pieces.append(shipSupplyStat(s,player.id,'player-ship-count'));
  const awards=document.createElement('div');awards.className='player-awards';
  if(s.longestHolder===player.id)awards.append(playerAward('Longest Road',ACTION_PATHS.road,'award-road'));
  if(usesDevelopmentCards(s)&&s.armyHolder===player.id)awards.append(playerAward('Largest Army',DEVELOPMENT_PATHS.knight,'award-army'));
  card.append(header,publicStats,pieces);if(awards.childElementCount)card.append(awards);strip.append(card);
 }
}
let boardRenderer:BoardRendererController|null=null,rememberedBoardCamera:BoardCameraView|null=null;
function drawBoard(legalTargets:readonly string[]){
 if(!state)return;
 if(!boardRenderer)boardRenderer=new BoardRendererController(el('board'),drawSvgBoard,id=>attempt(()=>moveTarget(id)),rememberedBoardCamera);
 boardRenderer.update({board:state.board,roads:state.roads,buildings:state.buildings,
  players:state.players.map(p=>({id:p.id,name:playerName(p.id),seat:p.seat,color:PLAYER_PIECE_PALETTE[p.seat]?.body??'#68767b'})),
  stations:state.harbor?.stations,harborPorts:isHarbor(state),placementPlayerId:viewer,targetMode,legalTargets});
}
function drawSvgBoard(legalTargets:readonly string[]){
 const s=state,container=el('board');if(!s){if(lobbyPreviewBoard)renderIslandBoard(container,lobbyPreviewBoard);return;}renderIslandBoard(container,s.board);const svg=container.querySelector('svg')!;const topology=createIslandBoard(s.board.layout,s.board.version),view=createBoardView(topology);const NS='http://www.w3.org/2000/svg';
 const legal=new Set(legalTargets);
 const roadPiece=(edge:typeof view.edges[number],owner:string,fresh=false)=>{
   const seat=byId(owner).seat+1,piece=document.createElementNS(NS,'g');
   piece.setAttribute('class',`game-road-piece player-${seat}${fresh?' game-piece-enter':''}`);piece.setAttribute('data-road-id',edge.id);
   const title=document.createElementNS(NS,'title');title.textContent=`${playerName(owner)} road, ${edge.id}`;piece.append(title);
   const roadLine=(className:string)=>{const line=document.createElementNS(NS,'line');for(const [k,v] of Object.entries({x1:edge.start.x,y1:edge.start.y,x2:edge.end.x,y2:edge.end.y}))line.setAttribute(k,String(v));line.setAttribute('class',className);line.setAttribute('pathLength','1');piece.append(line);};
   roadLine('game-road-shadow');roadLine(`game-road player-${seat}`);roadLine('game-road-highlight');
   return piece;
 };
 const buildingPiece=(vertex:typeof view.vertices[number],owner:GameState['buildings'][string],fresh=false,cityTarget=false)=>{
   const seat=byId(owner.playerId).seat+1,palette=PLAYER_PIECE_PALETTE[seat-1]??PLAYER_PIECE_PALETTE[0],x=vertex.point.x,y=vertex.point.y;
   const piece=document.createElementNS(NS,'g');
   piece.setAttribute('class',`game-building-piece game-building-${owner.kind} player-${seat}${cityTarget?' game-target-city':''}${fresh?' game-piece-enter':''}`);
   piece.setAttribute('data-building-kind',owner.kind);piece.setAttribute('data-vertex-id',vertex.id);piece.setAttribute('data-board-x',String(x));piece.setAttribute('data-board-y',String(y));
   const title=document.createElementNS(NS,'title');title.textContent=`${playerName(owner.playerId)} ${owner.kind}, ${vertex.id}`;piece.append(title);
   const shadow=document.createElementNS(NS,'ellipse');shadow.setAttribute('cx',String(x));shadow.setAttribute('cy',String(y+.22));shadow.setAttribute('rx',owner.kind==='city'?'.31':owner.kind==='ship'?'.26':'.23');shadow.setAttribute('ry','.065');shadow.setAttribute('class','game-building-shadow');piece.append(shadow);
   const shell=document.createElementNS(NS,'path');shell.setAttribute('class','game-building-shell');shell.setAttribute('fill',palette.body);shell.setAttribute('stroke',palette.edge);shell.setAttribute('stroke-width','.045');shell.setAttribute('stroke-linejoin','round');
   const accent=document.createElementNS(NS,'path');accent.setAttribute('class','game-building-accent');accent.setAttribute('fill','none');accent.setAttribute('stroke','#ffffff');accent.setAttribute('stroke-width','.035');accent.setAttribute('stroke-linecap','round');accent.setAttribute('stroke-linejoin','round');accent.setAttribute('opacity','.68');
   const detail=document.createElementNS(NS,'path');detail.setAttribute('class','game-building-detail');detail.setAttribute('fill','none');detail.setAttribute('stroke','#173027');detail.setAttribute('stroke-width','.03');detail.setAttribute('stroke-linecap','round');detail.setAttribute('stroke-linejoin','round');detail.setAttribute('opacity','.9');
   if(owner.kind==='settlement'){
    shell.setAttribute('d',`M${x-.24} ${y+.19}V${y-.03}L${x} ${y-.25}L${x+.24} ${y-.03}V${y+.19}Z`);
    accent.setAttribute('d',`M${x-.27} ${y-.02}L${x} ${y-.28}L${x+.27} ${y-.02}`);
    detail.setAttribute('d',`M${x-.055} ${y+.19}V${y+.02}H${x+.055}V${y+.19}M${x-.16} ${y+.02}h.07v.07h-.07zM${x+.09} ${y+.02}h.07v.07h-.07z`);
   }else if(owner.kind==='ship'){
    shell.setAttribute('d', `M${x-.34} ${y+.055}Q${x} ${y+.12} ${x+.34} ${y+.055}L${x+.22} ${y+.25}H${x-.2}Z`);
    accent.setAttribute('d', `M${x-.15} ${y+.08}V${y-.44}`);
    accent.setAttribute('stroke', '#69553c'); accent.setAttribute('opacity', '1');
    detail.setAttribute('d', `M${x-.275} ${y+.133}Q${x} ${y+.18} ${x+.273} ${y+.133}`);
    detail.setAttribute('class', 'game-ship-stripe'); detail.setAttribute('stroke', HULL_STRIPE);
    detail.setAttribute('stroke-width', '.04'); detail.setAttribute('opacity', '1');
   }else{
    shell.setAttribute('d',`M${x-.33} ${y+.2}V${y-.07}H${x-.14}V${y-.19}H${x-.055}V${y-.31}H${x+.09}V${y-.19}H${x+.19}V${y-.07}H${x+.33}V${y+.2}Z`);
    accent.setAttribute('d',`M${x-.35} ${y-.07}H${x-.14}M${x-.14} ${y-.07}V${y-.2}H${x-.055}M${x+.09} ${y-.2}H${x+.19}V${y-.07}H${x+.35}`);
    detail.setAttribute('d',`M${x-.06} ${y+.2}V${y+.03}H${x+.06}V${y+.2}M${x-.23} ${y+.02}h.08v.08h-.08zM${x+.15} ${y+.02}h.08v.08h-.08zM${x-.015} ${y-.255}h.065`);
   }
   piece.append(shadow,shell,accent,detail);
   if (owner.kind === 'ship') {
    const sail = playerSailSvg(seat - 1);
    sail.setAttribute('x', String(x - .19)); sail.setAttribute('y', String(y - .45));
    sail.setAttribute('width', '.51'); sail.setAttribute('height', '.51');
    piece.append(sail);
   }
   return piece;
 };
 const stationPiece=(vertex:typeof view.vertices[number])=>{
  const label=document.createElementNS(NS,'g');label.setAttribute('class','trade-station-piece');label.setAttribute('data-station-id',vertex.id);
  const y=vertex.point.y-(s.buildings[vertex.id]?.kind==='city'?.47:.32),x=vertex.point.x+.12;
  const booth=document.createElementNS(NS,'path');booth.setAttribute('d',`M${x-.12} ${y+.1}v-.14h.24v.14zM${x-.15} ${y-.04}l.06-.1h.18l.06.1z`);booth.setAttribute('fill','#319b8c');booth.setAttribute('stroke','#fff7d2');booth.setAttribute('stroke-width','.035');label.append(booth);
  return label;
 };
 for(const edge of view.edges){
  const owner=s.roads[edge.id];
  if(owner){
   svg.append(roadPiece(edge,owner,renderedRoadOwners.get(edge.id)!==owner));continue;
  }
  if(targetMode!=='road'||!legal.has(edge.id))continue;
  const line=document.createElementNS(NS,'line');for(const [k,v] of Object.entries({x1:edge.start.x,y1:edge.start.y,x2:edge.end.x,y2:edge.end.y}))line.setAttribute(k,String(v));
  line.setAttribute('class','game-target game-target-road');line.setAttribute('data-legal-target','road');line.setAttribute('data-target-id',edge.id);line.setAttribute('tabindex','0');line.setAttribute('role','button');line.setAttribute('aria-label',`Legal road target ${edge.id}`);
  line.onclick=()=>attempt(()=>moveTarget(edge.id));line.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();attempt(()=>moveTarget(edge.id));}};svg.append(line);
 }
 for(const vertex of view.vertices){
  const owner=s.buildings[vertex.id],cityTarget=targetMode==='city'&&legal.has(vertex.id);
  if(owner){
   const piece=buildingPiece(vertex,owner,renderedBuildings.get(vertex.id)!==`${owner.playerId}:${owner.kind}`,cityTarget);
   if(cityTarget){piece.setAttribute('data-legal-target','city');piece.setAttribute('data-target-id',vertex.id);piece.setAttribute('tabindex','0');piece.setAttribute('role','button');piece.setAttribute('aria-label',`Legal city upgrade ${vertex.id}`);piece.onclick=()=>attempt(()=>moveTarget(vertex.id));piece.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();attempt(()=>moveTarget(vertex.id));}};}
   svg.append(piece);continue;
  }
  if((targetMode!=='settlement'&&targetMode!=='ship'&&!(targetMode==='city'&&s.phase==='setup-city'))||!legal.has(vertex.id))continue;
  const node=document.createElementNS(NS,'circle');node.setAttribute('cx',String(vertex.point.x));node.setAttribute('cy',String(vertex.point.y));node.setAttribute('r','.14');node.setAttribute('class','game-target game-target-vertex');node.setAttribute('data-legal-target',targetMode!);node.setAttribute('data-target-id',vertex.id);node.setAttribute('tabindex','0');node.setAttribute('role','button');node.setAttribute('aria-label',`Legal ${targetMode} target ${vertex.id}`);
  node.onclick=()=>attempt(()=>moveTarget(vertex.id));node.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();attempt(()=>moveTarget(vertex.id));}};svg.append(node);
 }
 for(const station of Object.values(s.harbor?.stations??{})){
  const vertex=view.vertices.find(v=>v.id===station.vertexId);if(!vertex)continue;
  svg.append(stationPiece(vertex));
 }
 if(targetMode==='station')for(const vertex of view.vertices){
  if(!legal.has(vertex.id))continue;const node=document.createElementNS(NS,'circle');
  node.setAttribute('cx',String(vertex.point.x));node.setAttribute('cy',String(vertex.point.y));node.setAttribute('r','.19');node.setAttribute('class','game-target game-target-vertex');node.setAttribute('data-legal-target','station');node.setAttribute('data-target-id',vertex.id);node.setAttribute('tabindex','0');node.setAttribute('role','button');node.setAttribute('aria-label',`Trade station junction ${vertex.id}`);
  node.onclick=()=>attempt(()=>moveTarget(vertex.id));node.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();attempt(()=>moveTarget(vertex.id));}};svg.append(node);
 }
 const robberMarker=svg.querySelector<SVGGElement>('.robber-marker');if(robberMarker&&renderedRobberHex!==s.board.robberHexId)robberMarker.classList.add('robber-marker-enter');
 if(targetMode==='pirate'||targetMode==='robber')for(const group of Array.from(svg.querySelectorAll<SVGGElement>(targetMode==='pirate'?'[data-port-edge]':'[data-hex-id]'))){
  const id=targetMode==='pirate'?group.dataset.portEdge:group.dataset.hexId;
  if(!id||!legal.has(id))continue;
  group.classList.add(`${targetMode}-target`);group.setAttribute('data-legal-target',targetMode);group.setAttribute('data-target-id',id);group.setAttribute('tabindex','0');group.setAttribute('role','button');
  group.setAttribute('aria-label',targetMode==='pirate'?`Move pirate to ${group.querySelector('title')?.textContent??'harbor'}`:`Legal robber target ${id}`);
  group.onclick=()=>attempt(()=>moveTarget(id));group.onkeydown=(e:KeyboardEvent)=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();attempt(()=>moveTarget(id));}};
 }
 renderedRoadOwners=new Map(Object.entries(s.roads));renderedBuildings=new Map<string,string>(Object.entries(s.buildings).map(([id,building])=>[id,`${building.playerId}:${building.kind}`] as [string,string]));renderedRobberHex=s.board.robberHexId;
 if(isHarbor(s))s.board.ports.forEach((port,index)=>{const group=Array.from(svg.querySelectorAll<SVGGElement>('[data-port-edge]')).find(n=>n.dataset.portEdge===port.edgeId),face=group?.querySelector('.port-face');if(face){const tag=document.createElementNS(NS,'text');tag.setAttribute('class','harbor-port-label');tag.setAttribute('y','-.49');tag.textContent=`P${index+1}`;face.append(tag);}});
 svg.removeAttribute('aria-hidden');svg.setAttribute('aria-label','Island board');
 return (id:string,kind:PlacementKind)=>{
  let ghost:SVGGElement;
  if(kind==='road'){
   const edge=view.edges.find(edge=>edge.id===id);if(!edge)return null;
   ghost=roadPiece(edge,viewer);ghost.removeAttribute('data-road-id');
  }else{
   const vertex=view.vertices.find(vertex=>vertex.id===id);if(!vertex)return null;
   ghost=kind==='station'?stationPiece(vertex):buildingPiece(vertex,{kind,playerId:viewer});
   for(const attr of ['data-station-id','data-vertex-id','data-building-kind'])ghost.removeAttribute(attr);
  }
  ghost.dataset.placementPreview=kind;ghost.dataset.previewTarget=id;
  ghost.setAttribute('aria-hidden','true');svg.append(ghost);
  for(const hexId of adjacentPlacementHexes(topology,kind,id)){
   svg.querySelector(`[data-hex-id="${hexId}"]`)?.classList.add('placement-neighbor');
  }
  paintGrainPreview(svg, topology, kind, id);
  return ghost;
 };
}
function render(){if(!state)return;const s=state,active=s.players[s.currentSeat],actor=s.players.find(player=>player.id===viewer)??null,spectating=remote!==null&&!actor;
 // A shared hot-seat device celebrates the table winner. A solo player with bots hears their own result.
 const musicListener=remote?(actor?.id??null):(activeLocalRoom?.humanId??s.winner??viewer);
 roomMusic.setScene(matchMusicScene(s,musicListener),projection?`online:${projection.gameId}`:`local:${localMusicRound}`);
 const chooseMap=el<HTMLButtonElement>('game-change-map');if(!chooseMap.hidden)chooseMap.textContent=s.phase==='finished'?'Next match · choose mode and map':'Abort game · choose mode and map';el('game-status').textContent=`Seed ${s.board.seed}.${remote ? ` Revision ${networkRevision}.` : ''} ${playerName(active.id)}'s turn; phase: ${s.phase}${s.dice?`; dice ${s.dice.join(' + ')}`:''}${s.winner?`; winner: ${s.winner}`:''}.`;
 el('turn-banner').textContent=isHarbor(s)?`Harbor Co-op · Round ${s.harbor!.round} · ${s.harbor!.outcome==='playing'?playerName(active.id)+"'s turn":s.harbor!.outcome==='won'?'Team victory':'Game over'}`:turnAnnouncement(activityState(s));
 el('classic-how-to-play').hidden=isHarbor(s);
 el('mainland-how-to-play').hidden=isTwinCapes(s);el('twin-capes-how-to-play').hidden=!isTwinCapes(s);
 el('twin-capes-robber-help').hidden=usesHarborPirate(s);el('twin-capes-pirate-help').hidden=!usesHarborPirate(s);
 renderHarborPanel(el('harbor-panel'),s,viewer,c=>attempt(()=>commit(applyHarborCommand(s,c),'Supplies delivered.')),playerName);
 el('public-action').textContent=publicActivity||'Game ready.';
 renderPlayerStrip(s,active.id);
 const handCard=el('private-hand-card');handCard.hidden=spectating;handCard.classList.toggle('active-hand',!spectating&&viewer===active.id);
 if(actor)renderPieceSupply(actor);else el('piece-supply').replaceChildren();
 el('players').textContent=s.players.map(p=>`${playerName(p.id)}: ${publicVictoryPoints(s,p.id)} public VP${usesDevelopmentCards(s)&&p.id===viewer?` (${publicVictoryPoints(s,p.id)+p.cards.filter(c=>c.type==='victory-point').length} total)`:''}${usesDevelopmentCards(s)?`, ${p.knights} knights played${s.armyHolder===p.id?' (Largest Army)':''}`:''}, longest road ${longestRoute(s,p.id)}, ${p.roads} roads, ${p.settlements} settlements, ${p.cities} cities remaining, ${projection?.public.players.find(x=>x.id===p.id)?.resources ?? RESOURCES.reduce((n,r)=>n+p.hand[r],0)} resources${usesDevelopmentCards(s)?`, ${projection?.public.players.find(x=>x.id===p.id)?.developmentCards ?? p.cards.length} cards`:''}`).join(' | ');
 const bank=el('bank');bank.replaceChildren(document.createTextNode('Bank: '),...RESOURCES.map(r=>resourceChip(r,s.bank[r])),...(usesDevelopmentCards(s)?[document.createTextNode(` · Deck: ${projection?.public.deckCount ?? s.deck.length}`)]:[]));el('bonuses').textContent=`Longest route: ${s.longestHolder?playerName(s.longestHolder):'none'}${usesDevelopmentCards(s)?`; largest army: ${s.armyHolder?playerName(s.armyHolder):'none'}`:''}.`;el('cards').hidden=!usesDevelopmentCards(s);
 if(actor){el('hand').replaceChildren(...RESOURCES.map(r=>resourceChip(r,actor.hand[r])));if(usesDevelopmentCards(s))renderDevelopmentCards(el('cards'),actor.cards,s.turn);else el('cards').replaceChildren();}else{el('hand').replaceChildren();el('cards').replaceChildren();}
 const payout=el('roll-payout'),receipt=s.lastRollPayout;
 payout.hidden=!actor||!receipt;
 if(actor&&receipt){
  payout.dataset.turn=String(receipt.turn);payout.dataset.gain=String(receipt.gains[actor.id]);
  const label=ownPayoutLabel(receipt,actor.id);if(payout.textContent!==label)payout.textContent=label;
 }else{payout.textContent='';delete payout.dataset.turn;delete payout.dataset.gain;}
 el('log').replaceChildren(...log.slice(0,30).map(entry=>{
  const li=document.createElement('li');
  if(typeof entry==='string')li.textContent=entry;
  else{li.dataset.rollTurn=String(entry.rollTurn);li.textContent=entry.text;}
  return li;
 }));
 el('turn-hint').textContent=isPaused()?(remote?'Paused by host.':'Game paused.'):spectating?'Spectator mode · live public view.':s.phase==='finished'?'Game over.':s.discards[viewer]&&s.phase==='discard'?(discardSubmitted?'Your discard is submitted. Waiting for everyone else.':'Choose cards to discard.'):s.offer?.targets.includes(viewer)?'A trade offer needs your response.':s.phase==='discard'?'Waiting for players to discard.':viewer===active.id?'Your turn · choose an action.':localBotIds.has(active.id)?`${playerName(active.id)} is acting…`:`Waiting for ${playerName(active.id)}.`;
 if(!isPaused()&&viewer===active.id&&s.phase==='pirate')el('turn-hint').textContent='Choose a harbor for the pirate.';
 if(!isPaused()&&usesTradeStations(s)&&s.phase.startsWith('setup'))el('turn-hint').textContent=active.seat===0?`${playerName(active.id)}: settlement + 2 roads${s.phase==='setup-road'?` · ${2-(s.setupRoadEdges?.length??0)} road(s) left`:''}.`:`${playerName(active.id)}: city only · no starting roads.`;
 const canUndo=remote?projection?.public.undoPlayerId===viewer:localUndoState!==null&&localUndoPlayerId===viewer;
 const context={paused:isPaused(),canUndo,deckCount:projection?.public.deckCount ?? s.deck.length,discardSubmitted};
 const availability=actor?createActionAvailabilityReader(s,viewer,context):null,base=availability?.();
 if(targetMode&&(!base||!base[targetMode].enabled))targetMode=null;
 const legalTargets=targetMode&&availability?availability.targetIds(targetMode):[];
 drawBoard(legalTargets);actionClockDisplay();if(!boardFitReady)scheduleDesktopBoardFit();flashTurnCue(s);
 if(pendingRollPresentation&&!el('game').hidden){
  if(turnAlertTimer!==null){window.clearTimeout(turnAlertTimer);turnAlertTimer=null;}
  el('board').querySelector('.turn-alert')?.remove();
  const event=pendingRollPresentation,generation=rollGeneration;
  if(boardRenderer){rollPlaying=true;boardRenderer.playRoll(event,()=>{if(generation!==rollGeneration)return;rollPlaying=false;pendingSupplement=event.supplement;showSupplement();scheduleLocalBot();});}diceSound.playRoll();pendingRollPresentation=null;
 }
 showActivityAlert(s);showVictoryAlert(s);showSupplement();scheduleLocalBot();const actions=el('actions'),trade=el('trade-actions');actions.replaceChildren();trade.replaceChildren();actions.dataset.phase=s.phase;trade.dataset.phase=s.phase;const targets=el('targets');targets.replaceChildren();
 const actionPane=el('board-action-pane'),tradePane=el('board-trade-pane');
 actionPane.hidden=spectating;tradePane.hidden=spectating;
 el('harbor-panel').inert=isPaused();
 if(spectating||!actor||!availability||!base)return;
 const reason=isPaused()?'Game paused':s.phase==='finished'?'Game over':viewer!==active.id?'Waiting for your turn':'Unavailable in this phase or with current resources';
 const apply=(b:HTMLButtonElement,a:{enabled:boolean},why=reason)=>setAvailability(b,a,why);
 if(targetMode){
  const description=document.createElement('p');description.textContent=targetMode==='pirate'?'Choose an open harbor. Its trade rate closes until the pirate moves again.':`Click or tap a highlighted ${targetMode} target on the board.`;targets.append(description);
  const cancel=button(targets,'Cancel selection',()=>{targetMode=null;render();});cancel.className='target-cancel';
  if(!legalTargets.length){const none=document.createElement('p');none.textContent='No legal targets are available.';targets.append(none);}
 }
 const mode=(value:typeof targetMode)=>{targetMode=value;render();};
 const grid=document.createElement('div');grid.className='action-grid';actions.append(grid);
 const add=(label:string,symbol:ActionIcon,run:()=>void,a:{visible:boolean;enabled:boolean},cost?:Partial<Record<Resource,number>>)=>{
  if(!a.visible||!a.enabled)return null;const b=action(grid,label,symbol,run,cost);const detail=reason==='Unavailable in this phase or with current resources'?(label.startsWith('Build')||label.startsWith('Place')||label==='Upgrade city'?'No legal target or insufficient resources':label==='Roll dice'?'Roll at the start of your turn':label==='End turn'?'End your turn during the action phase':label==='Move robber'?'Move the robber when required':label==='Finish free roads'?'Available during free road placement':label==='Claim victory'?'Need enough victory points':label==='Buy development card'?'Need resources and cards in the deck':label==='Steal'?'Choose an eligible victim':label==='Discard'?'Select the required number of cards':reason):reason;apply(b,a,detail);return b;
 };
 add('Roll dice','dice',()=>commit(applyTurnCommand(s,{type:'roll',playerId:viewer}),`${viewer} rolled.`),base.roll);
  const learning=document.createElement('section');learning.className='learn-action-panel';const learningTitle=document.createElement('h2');learningTitle.textContent=usesDevelopmentCards(s)?'Build & Development · Resource costs':'Build · Resource costs';const learningGrid=document.createElement('div');learningGrid.className='learn-action-grid';learning.append(learningTitle,learningGrid);actions.append(learning);
  const roadIsFree=s.phase==='setup-road'||s.phase==='free-road';
  const settlementIsFree=s.phase==='setup-settlement';
  const cityIsFree=s.phase==='setup-city';
  const learningAction=(label:string,symbol:ActionIcon,run:()=>void,a:{visible:boolean;enabled:boolean},cost:ActionCost,why:string)=>{const b=action(learningGrid,label,symbol,run,cost);apply(b,a,why);};
  learningAction('Build road','road',()=>mode('road'),base.road,roadIsFree?0:{lumber:1,brick:1},
   roadIsFree?'Need your turn and a legal road location':'Need your turn, a legal road location, and 1 wood + 1 brick');
  learningAction('Build settlement','settlement',()=>mode('settlement'),base.settlement,settlementIsFree?0:{lumber:1,brick:1,wool:1,grain:1},
   settlementIsFree?'Need your turn and a legal settlement location':'Need your turn, a legal settlement location, and 1 wood + 1 brick + 1 wool + 1 grain');
  learningAction('Upgrade house to city','city',()=>mode('city'),base.city,cityIsFree?0:{grain:2,ore:3},
   cityIsFree?'Need your turn and a legal starting city location':'Need your turn, an eligible settlement, 2 grain + 3 ore');
  if(usesDevelopmentCards(s))learningAction('Buy development card','card',()=>commit(applyEconomyCommand(s,{type:'buy-card',playerId:viewer}),`${playerName(viewer)} bought a development card.`),base.buyDevelopment,{wool:1,grain:1,ore:1},'Need your turn, a card in the deck, 1 wool + 1 grain + 1 ore');
 add('Build trade station','trade',()=>mode('station'),base.station,stationCost(s));
 if(base.ship.enabled){const b=add(shipActionLabel(s,viewer),'ship',()=>mode('ship'),base.ship,SHIP_COST);if(b)b.dataset.shipAvailability='ready';}
 add('End turn','end',()=>commit(applyTurnCommand(s,{type:'end-turn',playerId:viewer}),`${viewer} ended the turn.`),base.endTurn);
 add('Move pirate','pirate',()=>mode('pirate'),base.pirate);
 add('Move robber','settlement',()=>mode('robber'),base.robber);
 add('Finish free roads','end',()=>commit(applyEconomyCommand(s,{type:'stop-free-roads',playerId:viewer}),'Free road effect finished.'),base.finishFreeRoads);
 add('Claim victory','end',()=>commit(applyEconomyCommand(s,{type:'claim-victory',playerId:viewer}),`${viewer} won.`),base.claimVictory);
 if(!isPaused()&&s.phase==='steal'&&viewer===active.id&&s.victims.length>0){
  const victim=playerSelect(actions,'Choose victim',s.victims);
  const selectedVictim=availability({victimId:victim.value}).steal;
  const steal=add('Steal','trade',()=>commit(applyTurnCommand(s,{type:'steal',playerId:viewer,victimId:victim.value}),`${viewer} stole a resource.`),selectedVictim);
  victim.disabled=!selectedVictim.enabled;if(victim.disabled){victim.title=reason;victim.setAttribute('aria-description',reason);}
  victim.onchange=()=>{if(steal)apply(steal,availability({victimId:victim.value}).steal);};
 }
 if(discardSubmitted&&s.phase==='discard'){const note=document.createElement('p');note.className='discard-submitted';note.textContent='Discard submitted. Waiting for the other players…';actions.append(note);}
 if(!isPaused()&&s.phase==='discard'&&!discardSubmitted&&!!s.discards[viewer]){
  let discardButton:HTMLButtonElement|null=null;
  const get=counts(actions,`Discard exactly ${s.discards[viewer]??0} cards`,actor.hand,()=>{if(discardButton)apply(discardButton,availability({discard:get()}).discard,'Select the required number of cards');});
  const discardGrid=document.createElement('div');discardGrid.className='action-grid';actions.append(discardGrid);
  discardButton=action(discardGrid,'Discard','trade',()=>commit(applyTurnCommand(s,{type:'discard',playerId:viewer,cards:get()}),`${viewer} discarded.`));
  apply(discardButton,availability({discard:get()}).discard,'Select the required number of cards');
 }

 const appendUndoAction=()=>{if(base.undo.visible&&base.undo.enabled){const undoRow=document.createElement('div');undoRow.className='action-grid undo-action-row';actions.append(undoRow);const undo=action(undoRow,'Undo last action','end',()=>{
  if(remote){remote.submit({type:'undo',playerId:viewer},networkRevision);return;}
  if(!localUndoState)throw new Error('Nothing safe to undo.');
  const previous=structuredClone(localUndoState);pendingLocalUndo=null;localUndoState=null;localUndoPlayerId='';
  if(localUndoDeadlines){localActionDeadlines.clear();for(const [id,deadline] of localUndoDeadlines)localActionDeadlines.set(id,deadline);}localUndoDeadlines=null;
  commit(previous,`${playerName(viewer)} undid the last action.`);
 });apply(undo,base.undo,'Nothing available to undo');}};
 if(s.offer?.targets.includes(viewer))incomingTradeCard(trade,s.offer,actor.hand);
 if(base.acceptOffer.enabled||base.rejectOffer.enabled){const response=document.createElement('div');response.className='action-grid trade-response-grid';trade.append(response);
  if(base.acceptOffer.enabled){const b=action(response,'Accept trade','trade',()=>{const message=domesticTradeMessage(s.offer!,viewer);commit(applyEconomyCommand(s,{type:'accept-offer',playerId:viewer,id:s.offer!.id}),message);});apply(b,base.acceptOffer,'Cannot accept this offer');}
  if(base.rejectOffer.enabled){const b=action(response,'Reject trade','trade',()=>commit(applyEconomyCommand(s,{type:'reject-offer',playerId:viewer,id:s.offer!.id}),`${viewer} rejected a trade.`));apply(b,base.rejectOffer);}
 }
 if(s.phase==='action'&&viewer===active.id&&!isPaused())bankTradeButtons(trade,s,actor,base,reason);
 const eligibleTradePlayers=s.players.filter(p=>p.id!==viewer&&(!isHarbor(s)||partnersConnected(s,viewer,p.id)));
 const tradePlayerIds=[viewer,...eligibleTradePlayers.map(p=>p.id)];
 if(base.offer.visible&&!isPaused()&&s.phase==='action'&&viewer===active.id&&eligibleTradePlayers.length>0&&RESOURCES.some(r=>actor.hand[r]>0)){
  const draft=tradeDrafts.get(viewer)??{recipient:ALL_OTHER_PLAYERS,open:false};
  tradeDrafts.set(viewer,draft);
  const domestic=document.createElement('details'),summary=document.createElement('summary');domestic.className='domestic-trade-card';summary.textContent='Offer trade';domestic.append(summary);domestic.open=draft.open;domestic.ontoggle=()=>{if(domestic.isConnected)draft.open=domestic.open;};trade.append(domestic);
  const recipientLabel=document.createElement('label');recipientLabel.textContent='Offer trade to';const opponent=document.createElement('select');opponent.className='trade-recipient-select';opponent.setAttribute('aria-label','Trade recipient');opponent.dataset.tradeRecipient='true';
  const allPlayers=document.createElement('option');allPlayers.value=ALL_OTHER_PLAYERS;allPlayers.textContent='All other players';opponent.append(allPlayers);
  for(const player of eligibleTradePlayers){const option=document.createElement('option');option.value=player.id;option.textContent=playerName(player.id);opponent.append(option);}opponent.value=draft.recipient;if(!opponent.value)opponent.value=ALL_OTHER_PLAYERS;const canDraftOffer=!isPaused()&&s.phase==='action'&&viewer===active.id;const draftReason=canDraftOffer?'':isPaused()?'Game paused':'Trade during your action phase';opponent.disabled=!canDraftOffer;if(draftReason){opponent.title=draftReason;opponent.setAttribute('aria-description',draftReason);}recipientLabel.append(opponent);domestic.append(recipientLabel);
  let offerButton:HTMLButtonElement;const refreshOffer=()=>{if(offerButton)apply(offerButton,availability({offer:{targets:tradeTargetsForSelection(opponent.value,tradePlayerIds,viewer),give:offered(),receive:wanted()}}).offer,'Select a valid recipient and cards to offer and request');};
  const offered=counts(domestic,'Offer these cards',actor.hand,refreshOffer,draftReason),wanted=counts(domestic,'Request these cards',undefined,refreshOffer,draftReason);opponent.onchange=()=>{draft.recipient=opponent.value;refreshOffer();};
  offerButton=action(domestic,'Make offer','trade',()=>{const selected=tradeTargetsForSelection(opponent.value,tradePlayerIds,viewer);const broadcast=opponent.value===ALL_OTHER_PLAYERS;commit(applyEconomyCommand(s,{type:'offer',playerId:viewer,id:`${s.turn}-${log.length}`,targets:selected,give:offered(),receive:wanted()}),broadcast?`${viewer} offered a trade to all other players.`:`${viewer} offered a trade to ${playerName(selected[0])}.`);});refreshOffer();
 }
 if(s.offer?.proposer===viewer&&s.offer.targets.length>1){const note=document.createElement('p');note.className='trade-broadcast-status';note.textContent=`Offer sent to ${s.offer.targets.length} players · first valid acceptance wins.`;trade.append(note);}
 if(base.cancelOffer.enabled){const b=action(trade,'Cancel offer','end',()=>commit(applyEconomyCommand(s,{type:'cancel-offer',playerId:viewer,id:s.offer!.id}),`${viewer} cancelled a trade.`));apply(b,base.cancelOffer);}
 if(usesDevelopmentCards(s)){
  const play=(card:Exclude<Development,'victory-point'>,extra:Partial<{resource:Resource;resources:Resource[]}>= {})=>commit(applyEconomyCommand(s,{type:'play-card',playerId:viewer,card,...extra}),`${viewer} played ${DEVELOPMENT_LABELS[card]}.`);
  const section=document.createElement('section');section.className='development-actions-inline';const heading=document.createElement('h2');heading.textContent='Development cards';const cardGrid=document.createElement('div');cardGrid.className='action-grid development-action-grid';section.append(heading,cardGrid);
  for(const [label,card,a] of [['Play Knight','knight',base.knight],['Play Road Building','road-building',base.roadBuilding]] as const){if(a.enabled){const b=developmentAction(cardGrid,label,card,()=>play(card));apply(b,a);}}
  if(base.monopoly.enabled){const box=document.createElement('div');box.className='development-effect';const resource=resourceChoice(box,'Choose Monopoly resource');const b=developmentAction(box,'Play Monopoly','monopoly',()=>play('monopoly',{resource:resource()}));apply(b,base.monopoly);box.querySelectorAll('fieldset').forEach(field=>field.disabled=!base.monopoly.enabled);section.append(box);}
  const bankSelection:Resource[]=[];for(const resource of RESOURCES)for(let i=0;i<Math.min(s.bank[resource],2)&&bankSelection.length<2;i++)bankSelection.push(resource);
  if(bankSelection.length===2&&availability({invention:bankSelection}).yearOfPlenty.enabled){const box=document.createElement('div');box.className='development-effect';let b:HTMLButtonElement;const refresh=()=>{if(b)apply(b,availability({invention:[first(),second()]}).yearOfPlenty,'Choose two resources available in the bank');};const first=resourceChoice(box,'First resource',RESOURCES[0],refresh),second=resourceChoice(box,'Second resource',RESOURCES[0],refresh);b=developmentAction(box,'Play Year of Plenty','invention',()=>play('invention',{resources:[first(),second()]}));refresh();section.append(box);}
  if(cardGrid.childElementCount||section.querySelector('.development-effect'))actions.append(section);
 }
 appendUndoAction();
}
function refreshLocalMapPreview(){
 if(!localRoomOpen)return;
 const input=el<HTMLInputElement>('seed'),preview=el('local-map-preview');
 const bots=Number(el<HTMLSelectElement>('local-bot-count').value),selected=Number(el<HTMLSelectElement>('seats').value);
 const count=bots>0?bots+1:selected;
 const boardLabel=localBoardChoice()==='twin-capes'?'Twin Capes · 25 land hexes · two lakes · unlimited ship supply':count>=5?'expanded 24-hex board':'standard 19-hex board';
 el('local-board-layout').textContent=`${count} players · ${boardLabel}`;
 if(!input.value||!input.validity.valid){preview.textContent='Enter a valid map seed.';return;}
 try{
  const settings=createLocalRoomSettings(input.valueAsNumber,selected,bots,localMode(),localOptionalRules(),localBoardChoice());
  renderIslandBoard(preview,generateBoardSetup(settings.seed,settings.boardLayout));
  const svg=preview.querySelector('svg');
  if(svg){svg.removeAttribute('aria-hidden');svg.setAttribute('aria-label',`Local map preview, seed ${settings.seed}, ${count} players`);}
 }catch(error){preview.textContent=error instanceof Error?error.message:'Invalid local room settings.';}
}
function startLocalRound(settings:LocalRoomSettings){
 localMusicRound++;
 clearBotTimer();remote=null;projection=null;networkRevision=0;localPaused=false;localPauseAt=0;localActionDeadlines.clear();pendingClockCommand=null;
 localUndoState=null;localUndoPlayerId='';localUndoDeadlines=null;pendingLocalUndo=null;targetMode=null;
 renderedRoadOwners=new Map();renderedBuildings=new Map();renderedRobberHex='';
 localBotIds=new Set(settings.botIds);
 botTurnKey='';botActionCount=0;viewer='';
 state=createGame(settings.seed,settings.ids,undefined,{boardLayout:settings.boardLayout,mode:settings.mode,rules:settings.rules});
 remoteActionClock=null;syncLocalActionClock();
 clearSupplement();loggedSupplements.clear();log=[];publicActivity='New local game started.';lastTurnCue='';pendingActivityAlert='';pendingRollPresentation=null;boardRenderer?.clearRoll();lastWinnerAlert='';
 for(const timer of [turnAlertTimer,activityAlertTimer,victoryAlertTimer])if(timer!==null)window.clearTimeout(timer);
 turnAlertTimer=null;activityAlertTimer=null;victoryAlertTimer=null;
 for(const selector of ['.turn-alert','.activity-alert','.victory-alert'])document.querySelector(selector)?.remove();
 el('switch-player').hidden=settings.botCount>0;
 enterGame(true);
 if(settings.humanId){viewer=settings.humanId;el('pass').hidden=true;el('game').hidden=false;render();}
 else{handoff(state.players[state.currentSeat].id);render();}
}
el('local-room-create').onclick=()=>{
 localRoomOpen=true;
 roomMusic.setScene('lobby');
 el('local-room-create').hidden=true;
 el('local-room-lobby').hidden=false;
 refreshLocalMapPreview();
};
el('start').onclick=()=>attempt(()=>{
 if(!localRoomOpen)throw new Error('Create a local room first.');
 const seed=el<HTMLInputElement>('seed');
 if(!seed.value||!seed.validity.valid)throw new Error('Enter a valid map seed.');
 const settings=createLocalRoomSettings(seed.valueAsNumber,Number(el<HTMLSelectElement>('seats').value),Number(el<HTMLSelectElement>('local-bot-count').value),localMode(),localOptionalRules(),localBoardChoice());
 activeLocalRoom=settings;startLocalRound(settings);
});
const restartLocal=()=>{
 if(remote||!activeLocalRoom||!state)return;
 if(!window.confirm('Restart this local game? All progress will be lost. The map, players and bots will stay the same.'))return;
 startLocalRound(activeLocalRoom);
};
el('local-restart').onclick=restartLocal;
el('pass-local-restart').onclick=restartLocal;
el<HTMLInputElement>('seed').addEventListener('input',refreshLocalMapPreview);
el('local-randomize-map').onclick=()=>{
 el<HTMLInputElement>('seed').value=String(crypto.getRandomValues(new Uint32Array(1))[0]);
 refreshLocalMapPreview();
};
el('reveal').onclick=()=>{el('pass').hidden=true;el('game').hidden=false;render();};
el('switch-player').onclick=()=>{if(!state||remote||localBotIds.size)return;const next=prompt(`Pass to which player? ${state.players.map(p=>p.id).join(', ')}`);if(next&&state.players.some(p=>p.id===next)){handoff(next);render();}};

const localBotCount=el<HTMLSelectElement>('local-bot-count'),localSeats=el<HTMLSelectElement>('seats');localBotCount.onchange=()=>{const count=Number(localBotCount.value);if(count>0){localSeats.value=String(count+1);localSeats.disabled=true;localSeats.title='Player count follows the selected number of bots.';}else{localSeats.disabled=false;localSeats.title='';}refreshLocalMapPreview();};localSeats.addEventListener('change',refreshLocalMapPreview);
const localBoardSelect=el<HTMLSelectElement>('local-board-version'),localShips=el<HTMLInputElement>('local-rule-ships');
let standardLocalShips=localShips.checked;
localShips.addEventListener('change',()=>{if(!localShips.disabled)standardLocalShips=localShips.checked;});
const updateLocalMode=()=>{
 const coop=localMode()==='harbor-coop';
 for(const option of Array.from(localBotCount.options))option.disabled=coop&&Number(option.value)>1;
 if(coop){localSeats.value='2';if(Number(localBotCount.value)>1)localBotCount.value='1';}
 localSeats.disabled=coop||Number(localBotCount.value)>0;
 localBoardSelect.disabled=coop;
 if(coop)localBoardSelect.value='auto';
 const twin=localBoardChoice()==='twin-capes';
 localShips.disabled=coop||twin;
 localShips.checked=!coop&&(twin||standardLocalShips);
 el<HTMLInputElement>('local-rule-catch-up').disabled=coop;
 el('local-optional-rules').classList.toggle('optional-rules-disabled',coop);
 refreshLocalMapPreview();
};
localBoardSelect.addEventListener('change',updateLocalMode);
el('local-game-mode').addEventListener('change',updateLocalMode);localBotCount.addEventListener('change',updateLocalMode);
for(const id of ['local-rule-catch-up','local-rule-ships'])el<HTMLInputElement>(id).addEventListener('change',refreshLocalMapPreview);
const roomSeed=el<HTMLInputElement>('room-seed'),roomBoardVersion=el<HTMLSelectElement>('room-board-version');roomSeed.addEventListener('input',renderRoomMapPreview);roomBoardVersion.addEventListener('change',renderRoomMapPreview);
el('room-randomize-map').onclick=()=>{roomSeed.value=String(crypto.getRandomValues(new Uint32Array(1))[0]);renderRoomMapPreview();roomSeed.dispatchEvent(new Event('change',{bubbles:true}));};renderRoomMapPreview();

const network=initializeNetwork({status:connectionStatus,enterRoom:enterNetworkRoom,lobby:renderNetworkLobby,
 musicState:roomMusic.setState, musicFrame:roomMusic.receive, musicSubscribers:roomMusic.setSubscribers, musicReset:roomMusic.resetPlayback,
 clock:pulse=>{remoteActionClock=pulse?{playerId:pulse.playerId,deadlineAt:Date.now()+Math.max(0,Math.min(ACTION_WINDOW_MS,pulse.remainingMs)),paused:pulse.paused,remainingMs:pulse.remainingMs}:null;actionClockDisplay();},
 timedOut:playerId=>{log.unshift(`${playerName(playerId)} ran out of time; automatic action.`);},
 discardPending:()=>{
 discardSubmitted=true;
 if(state?.phase==='discard')render();
},reset:()=>{
  clearSupplement();loggedSupplements.clear();remoteActionClock=null;localActionDeadlines.clear();localPaused=false;localPauseAt=0;pendingClockCommand=null;discardSubmitted=false;clearBotTimer();localBotIds=new Set();botTurnKey='';botActionCount=0;activeLocalRoom=null;localUndoState=null;localUndoPlayerId='';localUndoDeadlines=null;pendingLocalUndo=null;el('local-restart').hidden=true;el('pass-local-restart').hidden=true;renderedRoadOwners=new Map();renderedBuildings=new Map();renderedRobberHex='';projection=null;networkRevision=0;state=null;targetMode=null;log=[];publicActivity='';lastTurnCue='';pendingActivityAlert='';pendingRollPresentation=null;boardRenderer?.clearRoll();lastWinnerAlert='';if(turnAlertTimer!==null){window.clearTimeout(turnAlertTimer);turnAlertTimer=null;}if(activityAlertTimer!==null){window.clearTimeout(activityAlertTimer);activityAlertTimer=null;}if(victoryAlertTimer!==null){window.clearTimeout(victoryAlertTimer);victoryAlertTimer=null;}document.querySelector('.turn-alert')?.remove();document.querySelector('.activity-alert')?.remove();document.querySelector('.victory-alert')?.remove();el('game').hidden=!document.body.classList.contains('room-table');
},snapshot:(value,playerId)=>{
  if(projection&&value.gameId===projection.gameId&&value.revision<networkRevision)return;
  const sameGame=projection?.gameId===value.gameId;
  if(!sameGame){log=[];publicActivity='';}
  if(projection&&!sameGame){clearSupplement();loggedSupplements.clear();pendingRollPresentation=null;boardRenderer?.clearRoll();}
  const gameplayUpdate=!sameGame||value.revision>networkRevision;
  const previousPublic=(sameGame?projection?.public:null) as unknown as PublicActivityState|null;
  const tradeSummary=value.public.tradeSummary;
  const publicName=(id:string)=>value.public.players.find(player=>player.id===id)?.name||id;
  const tradeActivity=sameGame&&gameplayUpdate&&tradeSummary?.revision===value.revision?`${publicName(tradeSummary.proposer)} traded ${tradeSummary.giveCount} card${tradeSummary.giveCount===1?'':'s'} for ${tradeSummary.receiveCount} card${tradeSummary.receiveCount===1?'':'s'} with ${publicName(tradeSummary.accepter)}.`:null;
  const nextPublic=value.public as unknown as PublicActivityState;
  if(value.public.phase!=='discard'||!value.public.discards[playerId])discardSubmitted=false;
  const activity=gameplayUpdate?((value.public.harbor&&value.public.harbor.event!==(sameGame?projection?.public.harbor?.event:null)?value.public.harbor.event:null)??tradeActivity??derivePublicActivity(previousPublic,nextPublic)):null;
  if(gameplayUpdate&&projection?.gameId===value.gameId&&isNewRoll(projection.public,value.public)&&value.public.dice){clearSupplement();pendingRollPresentation=describeRoll(projection.public,value.public.dice,value.public);}
  if(activity){log.unshift(activity);publicActivity=activity;if(centralActivity(activity))pendingActivityAlert=activity;}else if(!projection&&!publicActivity)publicActivity='Game synchronized.';
  if(!sameGame||projection?.public.lastRollPayout?.turn!==value.public.lastRollPayout?.turn)logRollPayout(log,value.public.lastRollPayout,value.public.players,publicName);
  if(gameplayUpdate&&value.public.catchUpReward)logSupplement(`${value.gameId}:${value.public.catchUpReward.turn}`,value.public.catchUpReward,publicName);
  if(!projection||value.gameId!==projection.gameId||value.revision!==networkRevision)targetMode=null;
  projection=value;networkRevision=value.revision;viewer=playerId;remote=network;
  const pub=value.public;
  const privateView=value.private;
  state={mode:pub.mode,harbor:pub.harbor??undefined,rules:pub.rules,catchUpReward:pub.catchUpReward??undefined,lastRollPayout:pub.lastRollPayout??undefined,version:pub.version,board:pub.board,players:pub.players.map(p=>({id:p.id,seat:p.seat,hand:privateView&&p.id===playerId?privateView.hand:{lumber:0,brick:0,wool:0,grain:0,ore:0},cards:privateView&&p.id===playerId?privateView.cards:[],roads:p.roads,settlements:p.settlements,cities:p.cities,knights:p.knights})),bank:pub.bank,deck:[],randomState:0,playedCards:pub.playedCards,startingSeat:pub.startingSeat,currentSeat:pub.currentSeat,turn:pub.turn,phase:pub.phase,setupStep:pub.setupStep,setupRoadEdges:pub.setupRoadEdges,pendingSettlement:pub.pendingSettlement,buildings:pub.buildings,roads:pub.roads,longestHolder:pub.longestHolder,armyHolder:pub.armyHolder,playedDevelopment:pub.playedDevelopment,resumePhase:pub.resumePhase,freeRoads:pub.freeRoads,winner:pub.winner,offer:pub.offer,dice:pub.dice,discards:pub.discards,victims:pub.victims};
  el('pass').hidden=true;el('game').hidden=false;el('switch-player').hidden=true;enterGame(!sameGame);render();
}});
roomMusic.attach(network);

el('turn-clock-pause').onclick=()=>attempt(()=>{
 if(!state)return;
 if(remote){if(state.phase!=='finished')remote.setPaused(!isPaused());return;}
 if(!localPaused)localTimedAction();
 if(!state||state.phase==='finished')return;
 const now=Date.now();
 if(localPaused){for(const [id,deadline] of localActionDeadlines)localActionDeadlines.set(id,now+Math.max(0,deadline-localPauseAt));if(localUndoDeadlines)for(const [id,deadline] of localUndoDeadlines)localUndoDeadlines.set(id,now+Math.max(0,deadline-localPauseAt));localPaused=false;localPauseAt=0;}
 else{localPaused=true;localPauseAt=now;clearBotTimer();}
 render();
});
window.setInterval(()=>{localTimedAction();actionClockDisplay();},200);
