import './style.css';
import { ACTION_PATHS, DEVELOPMENT_LABELS, DEVELOPMENT_PATHS, affordable, developmentChip, developmentIcon, icon, resourceChip, resourceIcon, type ActionIcon } from './game/ui/icons';
import { legalTargetIds, type TargetMode } from './game/ui/targets';
import { incomingTradeView, type TradeAmount } from './game/ui/trade';
import { bankTradeRate, playableDevelopmentTypes } from './game/ui/interactions';
import { initializeNetwork, type BrowserGame } from './game/network/browser';
import type { projectState, projectSpectatorState } from './game/network/authority';
import { createIslandBoard } from './game/board/geometry';
import { generateBoardSetup } from './game/board/setup';
import { createLocalRoomSettings, type LocalRoomSettings } from './game/ui/local-room';
import { createBoardView } from './game/board/presentation';
import { renderIslandBoard } from './game/board/render';
import { createGame, publicVictoryPoints, RESOURCES, type GameState, type Hand, type Resource, type Development } from './game/rules/state';
import { applySetupCommand as localSetup } from './game/rules/state';
import { applyTurnCommand as localTurn } from './game/rules/turn';
import { applyBuildCommand as localBuild, longestRoute } from './game/rules/build';
import { derivePublicActivity, turnAnnouncement, type PublicActivityState } from './game/ui/activity';
import { applyEconomyCommand as localEconomy } from './game/rules/economy';
import { chooseBotCommand } from './game/bot/policy';
import { applyBotCommand } from './game/bot/runner';

const el = <T extends HTMLElement>(id:string) => document.getElementById(id) as T;
let remote:BrowserGame | null=null, networkRevision=0, projection:(ReturnType<typeof projectState>|ReturnType<typeof projectSpectatorState>) | null=null;
let activePanel:'actions'|'trade'|'status'='actions';
let localRoomOpen=false,activeLocalRoom:LocalRoomSettings|null=null;
let state:GameState | null=null, viewer='', targetMode:TargetMode|null=null, log:string[]=[], publicActivity='', lastTurnCue='', pendingActivityAlert='', pendingProductionSummary='', lastWinnerAlert='', turnAlertTimer:number|null=null, activityAlertTimer:number|null=null, victoryAlertTimer:number|null=null, localBotIds=new Set<string>(), botTimer:number|null=null, botTurnKey='', botActionCount=0;
let renderedRoadOwners=new Map<string,string>(),renderedBuildings=new Map<string,string>(),renderedRobberHex='';
const BOT_DELAY_MS=1100,BOT_ACTION_LIMIT=20;
const PLAYER_PIECE_PALETTE=[{body:'#2868b2',edge:'#174679'},{body:'#c74a42',edge:'#8f2b27'},{body:'#4f8b51',edge:'#2f6334'},{body:'#8b55a1',edge:'#633675'},{body:'#d48826',edge:'#9a5d12'},{body:'#2b9295',edge:'#176b70'}] as const;
const reversibleActions=new Set(['place-settlement','place-road','build-road','build-settlement','build-city','bank-trade','free-road']);
let localUndoState:GameState|null=null,localUndoPlayerId='',pendingLocalUndo:{state:GameState;playerId:string}|null=null;
function applyWithLocalUndo<C extends {type:string;playerId:string}>(s:GameState,c:C,apply:(s:GameState,c:C)=>GameState):GameState|null{
 if(remote){remote.submit(c,networkRevision);return null;}
 const result=apply(s,c);
 pendingLocalUndo=reversibleActions.has(c.type)?{state:structuredClone(s),playerId:c.playerId}:null;
 return result;
}
const applySetupCommand = (s:GameState, c:Parameters<typeof localSetup>[1]) => applyWithLocalUndo(s,c,localSetup);
const applyTurnCommand = (s:GameState, c:Parameters<typeof localTurn>[1]) => applyWithLocalUndo(s,c,localTurn);
const applyBuildCommand = (s:GameState, c:Parameters<typeof localBuild>[1]) => applyWithLocalUndo(s,c,localBuild);
const applyEconomyCommand = (s:GameState, c:Parameters<typeof localEconomy>[1]) => applyWithLocalUndo(s,c,localEconomy);
const byId=(id:string)=>state!.players.find(p=>p.id===id)!;
const playerName=(id:string)=>projection?.public.players.find(p=>p.id===id)?.name||id;
function activityState(s:GameState):PublicActivityState {
 return {players:s.players.map(player=>{const publicPlayer=projection?.public.players.find(p=>p.id===player.id);return {id:player.id,name:playerName(player.id),resources:publicPlayer?.resources ?? RESOURCES.reduce((sum,resource)=>sum+player.hand[resource],0),developmentCards:publicPlayer?.developmentCards ?? player.cards.length};}),currentSeat:s.currentSeat,turn:s.turn,phase:s.phase,dice:s.dice,victims:s.victims,board:{robberHexId:s.board.robberHexId},roads:s.roads,buildings:s.buildings,playedCards:s.playedCards,bank:s.bank,deckCount:projection?.public.deckCount ?? s.deck.length};
}
function handoff(id:string){viewer=id;el('game').hidden=true;el('pass').hidden=false;el('pass-message').textContent=`Pass the device to ${id}.`;} 
function centralActivity(message:string){return /rolled dice|built a road|built a settlement|upgraded a settlement|bought a development card|moved the robber|stole 1 card|played |traded /i.test(message);}
function productionSummary(before:{players:readonly {id:string;resources:number}[]},after:{players:readonly {id:string;resources:number}[]}){
 return after.players.map(player=>`${playerName(player.id)} +${Math.max(0,player.resources-(before.players.find(old=>old.id===player.id)?.resources??player.resources))}`).join(' · ');
}
function commit(next:GameState | null, description:string){if(!next)return;if(!remote){localUndoState=pendingLocalUndo?.state??null;localUndoPlayerId=pendingLocalUndo?.playerId??'';pendingLocalUndo=null;}const old=state!,beforeActivity=activityState(old);state=next;const afterActivity=activityState(next),message=derivePublicActivity(beforeActivity,afterActivity)??description;if(message){log.unshift(message);publicActivity=message;if(centralActivity(message))pendingActivityAlert=message;}if(old.phase==='roll'&&next.dice)pendingProductionSummary=productionSummary(beforeActivity,afterActivity);targetMode=null;if(old.currentSeat!==next.currentSeat&&localBotIds.size===0)handoff(next.players[next.currentSeat].id);render();}
function attempt(f:()=>void){try{f();el('game-error').textContent='';}catch(error){el('game-error').textContent=error instanceof Error?error.message:'Action failed.';}}
function clearBotTimer(){if(botTimer!==null){window.clearTimeout(botTimer);botTimer=null;}}
function botDescription(command:ReturnType<typeof chooseBotCommand>,before:GameState){if(!command)return 'Bot acted.';if(command.type==='accept-offer'&&before.offer)return domesticTradeMessage(before.offer,command.playerId);if(command.type==='reject-offer')return `${playerName(command.playerId)} rejected a trade.`;return `${playerName(command.playerId)} acted.`;}
function pendingLocalBot(s:GameState):string|null{
 for(const botId of localBotIds)if(s.discards[botId])return botId;
 const tradeBot=[...localBotIds].find(botId=>s.offer?.targets.includes(botId));if(tradeBot)return tradeBot;
 const active=s.players[s.currentSeat]?.id;return active&&localBotIds.has(active)?active:null;
}
function runLocalBotStep(){
 botTimer=null;if(remote||localBotIds.size===0||!state||state.phase==='finished')return;
 const botId=pendingLocalBot(state);if(!botId)return;
 const key=`${state.turn}:${state.currentSeat}:${botId}`;if(key!==botTurnKey){botTurnKey=key;botActionCount=0;}
 let command=chooseBotCommand(state,botId);if(!command)return;
 if(botActionCount>=BOT_ACTION_LIMIT){
  if(state.players[state.currentSeat]?.id===botId&&state.phase==='action')command={type:'end-turn',playerId:botId};
  else{log.unshift(`${playerName(botId)} action limit reached; automation paused.`);publicActivity=`${playerName(botId)} automation paused.`;render();return;}
 }
 botActionCount++;const before=state,description=botDescription(command,before);pendingLocalUndo=null;commit(applyBotCommand(before,command),description);
}
function scheduleLocalBot(){
 if(remote||localBotIds.size===0||!state||state.phase==='finished'||botTimer!==null)return;
 if(!pendingLocalBot(state))return;
 botTimer=window.setTimeout(runLocalBotStep,BOT_DELAY_MS);
}
function button(parent:HTMLElement,label:string,action:()=>void){const b=document.createElement('button');b.type='button';b.textContent=label;b.onclick=()=>attempt(action);parent.append(b);return b;}
function select(parent:HTMLElement,label:string,options:readonly string[]):HTMLSelectElement{const wrapper=document.createElement('label');wrapper.textContent=label;const input=document.createElement('select');for(const value of options){const option=document.createElement('option');option.value=value;option.textContent=value;input.append(option);}wrapper.append(input);parent.append(wrapper);return input;}
function playerSelect(parent:HTMLElement,label:string,ids:readonly string[]):HTMLSelectElement{const wrapper=document.createElement('label');wrapper.textContent=label;const input=document.createElement('select');for(const id of ids){const option=document.createElement('option');option.value=id;option.textContent=playerName(id);input.append(option);}wrapper.append(input);parent.append(wrapper);return input;}
function resourceChoice(parent:HTMLElement,label:string,initial:Resource=RESOURCES[0]):()=>Resource{
 const field=document.createElement('fieldset');field.className='resource-choice-group';const legend=document.createElement('legend');legend.textContent=label;field.append(legend);let selected=initial;
 const buttons=new Map<Resource,HTMLButtonElement>();
 const refresh=()=>{for(const [resource,button] of buttons)button.setAttribute('aria-pressed',String(resource===selected));};
 for(const resource of RESOURCES){const choice=document.createElement('button');choice.type='button';choice.className='resource-choice-button';choice.title=resource;choice.setAttribute('aria-label',`Choose ${resource}`);choice.append(resourceIcon(resource));choice.onclick=()=>{selected=resource;refresh();};buttons.set(resource,choice);field.append(choice);}
 refresh();parent.append(field);return ()=>selected;
}
function bankTradeButtons(parent:HTMLElement,s:GameState,actor:GameState['players'][number]){
 const section=document.createElement('section');section.className='bank-trade-section';const title=document.createElement('h2');title.textContent='Bank / port trades';const hint=document.createElement('p');hint.className='trade-rate-hint';hint.textContent='Rates update automatically when you build on a port.';const grid=document.createElement('div');grid.className='bank-trade-grid';section.append(title,hint,grid);
 for(const give of RESOURCES){const rate=bankTradeRate(s,viewer,give);for(const receive of RESOURCES){if(receive===give)continue;const tradeButton=document.createElement('button');tradeButton.type='button';tradeButton.className=`bank-trade-button bank-trade-rate-${rate}`;tradeButton.dataset.rate=String(rate);tradeButton.setAttribute('aria-label',`Trade ${rate} ${give} for 1 ${receive}`);tradeButton.title=`${rate} ${give} → 1 ${receive}`;
   const from=document.createElement('span');from.className='bank-trade-side';const rateBadge=document.createElement('span');rateBadge.className='bank-trade-rate';rateBadge.textContent=String(rate);from.append(rateBadge,resourceIcon(give));
   const arrow=document.createElement('span');arrow.className='bank-trade-arrow';arrow.textContent='→';arrow.setAttribute('aria-hidden','true');const to=document.createElement('span');to.className='bank-trade-side';to.append(resourceIcon(receive));
   tradeButton.append(from,arrow,to);tradeButton.disabled=actor.hand[give]<rate||s.bank[receive]<1;
   tradeButton.onclick=()=>attempt(()=>commit(applyEconomyCommand(s,{type:'bank-trade',playerId:viewer,give,receive,rate}),`${viewer} traded with the bank.`));grid.append(tradeButton);
 }}
 parent.append(section);
}

function resourceAmounts(parent:HTMLElement,amounts:readonly TradeAmount[]){for(const amount of amounts)parent.append(resourceChip(amount.resource,amount.count));}
function domesticTradeMessage(offer:NonNullable<GameState['offer']>,accepter:string){const give=RESOURCES.reduce((sum,r)=>sum+offer.give[r],0),receive=RESOURCES.reduce((sum,r)=>sum+offer.receive[r],0);return `${playerName(offer.proposer)} traded ${give} card${give===1?'':'s'} for ${receive} card${receive===1?'':'s'} with ${playerName(accepter)}.`;}
function incomingTradeCard(parent:HTMLElement,offer:NonNullable<GameState['offer']>){
 const view=incomingTradeView(offer,viewer);if(!view)return;
 const card=document.createElement('section');card.className='incoming-trade';card.setAttribute('aria-label',`Trade offer from ${view.proposer}`);
 const title=document.createElement('h2');title.textContent=`Trade offer from ${playerName(view.proposer)}`;card.append(title);
 const receive=document.createElement('div');receive.className='trade-offer-row';const receiveLabel=document.createElement('strong');receiveLabel.textContent='You receive';const receiveResources=document.createElement('span');receiveResources.className='trade-offer-resources';resourceAmounts(receiveResources,view.receive);receive.append(receiveLabel,receiveResources);
 const give=document.createElement('div');give.className='trade-offer-row';const giveLabel=document.createElement('strong');giveLabel.textContent='You give';const giveResources=document.createElement('span');giveResources.className='trade-offer-resources';resourceAmounts(giveResources,view.give);give.append(giveLabel,giveResources);
 card.append(receive,give);parent.append(card);
}
function action(parent:HTMLElement,label:string,symbol:ActionIcon,run:()=>void,cost?:Partial<Record<Resource,number>>,hand?:Hand){
 const b=button(parent,'',run);b.className=`action-button action-${symbol}`;b.dataset.action=symbol;const text=document.createElement('span');text.className='action-label';text.textContent=label;b.append(icon(ACTION_PATHS[symbol]),text);
 if(cost){const list=document.createElement('span');list.className='action-cost';for(const resource of RESOURCES){const amount=cost[resource];if(amount)list.append(resourceChip(resource,amount));}b.append(list);if(hand&&!affordable(hand,cost)){b.disabled=true;b.title='Not enough resources';b.setAttribute('aria-label',`${label}: not enough resources`);}}
 return b;
}
function setPanel(panel:'actions'|'trade'|'status') {activePanel=panel;for(const button of Array.from(document.querySelectorAll<HTMLButtonElement>('[data-panel]')))button.setAttribute('aria-pressed',String(button.dataset.panel===panel));el('actions').hidden=panel!=='actions';el('trade-actions').hidden=panel!=='trade';el('status-panel').hidden=panel!=='status';}
function enterGame(){
 document.body.classList.add('playing');
 const local=!remote&&activeLocalRoom!==null;
 el('local-restart').hidden=!local;el('pass-local-restart').hidden=!local;
 if(remote){el('reconnect-holder').append(el('room-reconnect'));el('turn-card').append(el('qa-indicator'));}
 else el('connection-summary').textContent=localBotIds.size?`Local game · ${localBotIds.size} test bot${localBotIds.size===1?'':'s'} enabled`:'Local game';
}
function connectionStatus(value:string){const lower=value.toLowerCase();el('connection-summary').textContent=lower.includes('watching')?'Spectating':lower.includes('paused')||lower.includes('unavailable')||lower.includes('failed')?'Disconnected · rejoin may be required':lower.includes('reconnected')?'Reconnected':lower.includes('reconnect')||lower.includes('interrupted')?'Reconnecting…':lower.includes('connected')||lower.includes('started')?'Connected':lower.includes('connecting')?'Connecting…':'';}
function counts(parent:HTMLElement,label:string,max?:Hand):()=>Hand{
 const field=document.createElement('fieldset');const legend=document.createElement('legend');legend.textContent=label;field.append(legend);field.className='resource-stepper-grid';
 const values=Object.fromEntries(RESOURCES.map(resource=>[resource,0])) as Hand;
 for(const resource of RESOURCES){
  const row=document.createElement('div');row.className='resource-stepper';
  const name=document.createElement('span');name.className='resource-stepper-name';name.append(resourceIcon(resource),document.createTextNode(resource));
  const minus=document.createElement('button');minus.type='button';minus.className='stepper-button';minus.textContent='−';minus.setAttribute('aria-label',`Remove one ${resource}`);
  const count=document.createElement('span');count.className='stepper-count';count.textContent='0';count.setAttribute('aria-live','polite');
  const plus=document.createElement('button');plus.type='button';plus.className='stepper-button';plus.textContent='+';plus.setAttribute('aria-label',`Add one ${resource}`);
  const refresh=()=>{count.textContent=String(values[resource]);minus.disabled=values[resource]===0;plus.disabled=values[resource]>=(max?.[resource]??99);};
  minus.onclick=()=>{values[resource]=Math.max(0,values[resource]-1);refresh();};
  plus.onclick=()=>{values[resource]=Math.min(max?.[resource]??99,values[resource]+1);refresh();};
  row.append(name,minus,count,plus);field.append(row);refresh();
 }
 parent.append(field);return ()=>({...values});
}
function developmentAction(parent:HTMLElement,label:string,card:Exclude<Development,'victory-point'>,run:()=>void){
 const b=button(parent,'',run);b.className=`action-button development-action-button development-${card}`;b.dataset.development=card;const text=document.createElement('span');text.className='action-label';text.textContent=label;b.append(developmentIcon(card),text);return b;
}
function renderDevelopmentCards(parent:HTMLElement,cards:GameState['players'][number]['cards'],turn:number){
 parent.replaceChildren();for(const type of Object.keys(DEVELOPMENT_LABELS) as Development[]){const owned=cards.filter(card=>card.type===type);if(!owned.length)continue;parent.append(developmentChip(type,owned.length,owned.filter(card=>card.boughtTurn===turn).length));}
}
function playerStat(path:string,count:number,title:string,className:string,label?:string){
 const item=document.createElement('span');item.className=`player-stat ${className}`;item.title=title;item.setAttribute('aria-label',`${title}: ${count}`);
 if(label){const tag=document.createElement('span');tag.className='player-stat-label';tag.textContent=label;item.append(tag);}
 item.append(icon(path,'icon player-stat-icon'),document.createTextNode(String(count)));return item;
}
function renderPieceSupply(player:GameState['players'][number]){
 const supply=el('piece-supply');supply.replaceChildren();
 const title=document.createElement('strong');title.textContent='Pieces left';supply.append(title,
  playerStat(ACTION_PATHS.road,player.roads,'Roads remaining','supply-road','R'),
  playerStat(ACTION_PATHS.settlement,player.settlements,'Settlements remaining','supply-settlement','S'),
  playerStat(ACTION_PATHS.city,player.cities,'Cities remaining','supply-city','C'));
}
function renderRoomMapPreview(){
 const input=el<HTMLInputElement>('room-seed'),preview=el('room-map-preview');if(!input.value||!input.validity.valid){preview.textContent='Enter a valid map seed.';return;}
 const boardVersion=el<HTMLSelectElement>('room-board-version').value;
 renderIslandBoard(preview,generateBoardSetup(input.valueAsNumber,boardVersion==='expanded-5-6'?'expanded-5-6':'standard'));const svg=preview.querySelector('svg');if(svg){svg.removeAttribute('aria-hidden');svg.setAttribute('aria-label',`Preview of map seed ${input.value}`);}
}
document.addEventListener('hex-room-map-updated',renderRoomMapPreview);
function moveTarget(id:string){if(!state)return;const current=state.players[state.currentSeat].id;if(viewer!==current)return;
 if(targetMode==='settlement')commit(state.phase==='setup-settlement'?applySetupCommand(state,{type:'place-settlement',playerId:viewer,vertexId:id}):applyBuildCommand(state,{type:'build-settlement',playerId:viewer,vertexId:id}),`${viewer} placed a settlement.`);
 else if(targetMode==='city')commit(applyBuildCommand(state,{type:'build-city',playerId:viewer,vertexId:id}),`${viewer} upgraded a city.`);
 else if(targetMode==='road')commit(state.phase==='setup-road'?applySetupCommand(state,{type:'place-road',playerId:viewer,edgeId:id}):state.phase==='free-road'?applyEconomyCommand(state,{type:'free-road',playerId:viewer,edgeId:id}):applyBuildCommand(state,{type:'build-road',playerId:viewer,edgeId:id}),`${viewer} placed a road.`);
 else if(targetMode==='robber')commit(applyTurnCommand(state,{type:'move-robber',playerId:viewer,hexId:id}),`${viewer} moved the robber.`);
}
function flashTurnCue(s:GameState){const game=el('game');if(game.hidden||s.phase==='finished')return;const key=`${s.turn}:${s.currentSeat}`;if(key===lastTurnCue)return;lastTurnCue=key;const banner=el('turn-banner'),card=el('player-strip').querySelector<HTMLElement>('.active-player');for(const target of [banner,card]){if(!target)continue;target.classList.remove('turn-cue-flash');void target.offsetWidth;target.classList.add('turn-cue-flash');target.addEventListener('animationend',()=>target.classList.remove('turn-cue-flash'),{once:true});}
 const active=s.players[s.currentSeat],board=el('board');board.querySelector('.turn-alert')?.remove();if(turnAlertTimer!==null){window.clearTimeout(turnAlertTimer);turnAlertTimer=null;}
 const alert=document.createElement('div');alert.className=`turn-alert player-${active.seat+1}`;alert.setAttribute('role','alert');alert.setAttribute('aria-live','assertive');
 const lead=document.createElement('span');lead.className='turn-alert-lead';lead.textContent=active.id===viewer?'YOUR TURN':'NEXT TURN';
 const name=document.createElement('strong');name.className='turn-alert-name';name.textContent=playerName(active.id);alert.append(lead,name);board.append(alert);
 turnAlertTimer=window.setTimeout(()=>{alert.classList.add('turn-alert-out');turnAlertTimer=window.setTimeout(()=>{alert.remove();turnAlertTimer=null;},260);},2200);
}
type ActivityMotionKind='dice'|'development'|'card-buy'|'build'|'robber'|'trade'|'generic';
function activityMotionKind(message:string):ActivityMotionKind {
 if(/rolled dice/i.test(message))return 'dice';
 if(/played (Knight|Road Building|Year of Plenty|Monopoly)/i.test(message))return 'development';
 if(/bought a development card/i.test(message))return 'card-buy';
 if(/built a road|built a settlement|upgraded a settlement/i.test(message))return 'build';
 if(/moved the robber|stole 1 card/i.test(message))return 'robber';
 if(/traded /i.test(message))return 'trade';
 return 'generic';
}
function diceFace(value:number){
 const die=document.createElement('span');die.className='motion-die';die.dataset.value=String(value);die.setAttribute('role','img');die.setAttribute('aria-label',`Die shows ${value}`);
 const patterns:Record<number,number[]>={1:[5],2:[1,9],3:[1,5,9],4:[1,3,7,9],5:[1,3,5,7,9],6:[1,3,4,6,7,9]};
 for(let cell=1;cell<=9;cell++){const pip=document.createElement('i');pip.className='motion-die-cell';if(patterns[value]?.includes(cell))pip.classList.add('motion-die-pip');pip.setAttribute('aria-hidden','true');die.append(pip);}
 return die;
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
 const lead=document.createElement('span');lead.className='activity-alert-lead';lead.textContent=kind==='dice'?'DICE ROLL':kind==='development'?'CARD PLAY':kind==='card-buy'?'NEW CARD':kind==='build'?'BUILD':kind==='robber'?'ROBBER':kind==='trade'?'TRADE':'TABLE ACTION';
 const message=document.createElement('strong');message.className='activity-alert-message';message.textContent=activity;
 if(kind==='dice'&&s.dice){const dice=document.createElement('span');dice.className='motion-dice';dice.append(diceFace(s.dice[0]),diceFace(s.dice[1]));alert.append(lead,dice,message);if(pendingProductionSummary){const summary=document.createElement('span');summary.className='activity-production-summary';summary.textContent=pendingProductionSummary;pendingProductionSummary='';alert.append(summary);}}
 else if(kind==='development'){const card=playedDevelopment(activity);alert.append(lead,motionCard(card,card?DEVELOPMENT_LABELS[card]:'Development card'),message);}
 else if(kind==='card-buy')alert.append(lead,motionCard(null,'Development card'),message);
 else alert.append(lead,message);
 board.append(alert);
 const hold=kind==='dice'||kind==='development'||kind==='card-buy'?1900:1700;
 activityAlertTimer=window.setTimeout(()=>{alert.classList.add('activity-alert-out');activityAlertTimer=window.setTimeout(()=>{alert.remove();activityAlertTimer=null;},240);},hold);
}
function showVictoryAlert(s:GameState){
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
  card.setAttribute('aria-label',`${playerName(player.id)}${player.id===viewer?', you':''}: ${handCount} resource cards, ${developmentCount} development cards, ${player.knights} knights played, ${publicVp} public victory points, ${player.roads} roads, ${player.settlements} settlements, ${player.cities} cities remaining, longest road ${routeLength}${s.armyHolder===player.id?', largest army holder':''}${player.id===activeId?', current turn':''}`);

  const header=document.createElement('div');header.className='player-summary-header';
  const marker=document.createElement('span');marker.className='player-marker';marker.textContent=String(player.seat+1);marker.setAttribute('aria-hidden','true');
  const name=document.createElement('span');name.className='player-summary-name';const shown=playerName(player.id);name.textContent=player.id===viewer?`${shown} · You`:shown;
  header.append(marker,name);
  if(player.id===activeId){const turn=document.createElement('span');turn.className='player-turn-badge';turn.textContent='Turn';header.append(turn);}

  const publicStats=document.createElement('div');publicStats.className='player-public-stats';
  publicStats.append(
   playerStat(ACTION_PATHS.victory,publicVp,'Public victory points','player-vp-count','VP'),
   playerStat(ACTION_PATHS.hand,handCount,'Resource cards','player-hand-count'),
   playerStat(ACTION_PATHS.card,developmentCount,'Development cards','player-dev-count'),
   playerStat(DEVELOPMENT_PATHS.knight,player.knights,'Knights played','player-knight-count','K')
  );
  if(s.armyHolder===player.id)publicStats.lastElementChild?.classList.add('largest-army-holder');

  const pieces=document.createElement('div');pieces.className='player-piece-stats';
  pieces.append(
   playerStat(ACTION_PATHS.road,player.roads,'Roads remaining','player-road-left','R'),
   playerStat(ACTION_PATHS.settlement,player.settlements,'Settlements remaining','player-settlement-left','S'),
   playerStat(ACTION_PATHS.city,player.cities,'Cities remaining','player-city-left','C'),
   playerStat(ACTION_PATHS.road,routeLength,'Longest road length','player-longest-road','LR')
  );
  if(s.longestHolder===player.id)pieces.lastElementChild?.classList.add('award-holder');
  const awards=document.createElement('div');awards.className='player-awards';
  if(s.longestHolder===player.id)awards.append(playerAward('Longest Road',ACTION_PATHS.road,'award-road'));
  if(s.armyHolder===player.id)awards.append(playerAward('Largest Army',DEVELOPMENT_PATHS.knight,'award-army'));
  card.append(header,publicStats,pieces);if(awards.childElementCount)card.append(awards);strip.append(card);
 }
}
function drawBoard(){
 const s=state!,container=el('board');renderIslandBoard(container,s.board);const svg=container.querySelector('svg')!;const view=createBoardView(createIslandBoard(s.board.layout));const NS='http://www.w3.org/2000/svg';
 const legal=targetMode?new Set(legalTargetIds(s,viewer,targetMode)):new Set<string>();
 for(const edge of view.edges){
  const owner=s.roads[edge.id];
  if(owner){
   const seat=byId(owner).seat+1,piece=document.createElementNS(NS,'g'),fresh=renderedRoadOwners.get(edge.id)!==owner;
   piece.setAttribute('class',`game-road-piece player-${seat}${fresh?' game-piece-enter':''}`);piece.setAttribute('data-road-id',edge.id);
   const title=document.createElementNS(NS,'title');title.textContent=`${playerName(owner)} road, ${edge.id}`;piece.append(title);
   const roadLine=(className:string)=>{const line=document.createElementNS(NS,'line');for(const [k,v] of Object.entries({x1:edge.start.x,y1:edge.start.y,x2:edge.end.x,y2:edge.end.y}))line.setAttribute(k,String(v));line.setAttribute('class',className);line.setAttribute('pathLength','1');piece.append(line);};
   roadLine('game-road-shadow');roadLine(`game-road player-${seat}`);roadLine('game-road-highlight');svg.append(piece);continue;
  }
  if(targetMode!=='road'||!legal.has(edge.id))continue;
  const line=document.createElementNS(NS,'line');for(const [k,v] of Object.entries({x1:edge.start.x,y1:edge.start.y,x2:edge.end.x,y2:edge.end.y}))line.setAttribute(k,String(v));
  line.setAttribute('class','game-target game-target-road');line.setAttribute('data-legal-target','road');line.setAttribute('tabindex','0');line.setAttribute('role','button');line.setAttribute('aria-label',`Legal road target ${edge.id}`);
  line.onclick=()=>attempt(()=>moveTarget(edge.id));line.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();attempt(()=>moveTarget(edge.id));}};svg.append(line);
 }
 for(const vertex of view.vertices){
  const owner=s.buildings[vertex.id],cityTarget=targetMode==='city'&&legal.has(vertex.id);
  if(owner){
   const seat=byId(owner.playerId).seat+1,palette=PLAYER_PIECE_PALETTE[seat-1]??PLAYER_PIECE_PALETTE[0],fresh=renderedBuildings.get(vertex.id)!==`${owner.playerId}:${owner.kind}`,x=vertex.point.x,y=vertex.point.y;
   const piece=document.createElementNS(NS,'g');
   piece.setAttribute('class',`game-building-piece game-building-${owner.kind} player-${seat}${cityTarget?' game-target-city':''}${fresh?' game-piece-enter':''}`);
   piece.setAttribute('data-building-kind',owner.kind);piece.setAttribute('data-vertex-id',vertex.id);piece.setAttribute('data-board-x',String(x));piece.setAttribute('data-board-y',String(y));
   const title=document.createElementNS(NS,'title');title.textContent=`${playerName(owner.playerId)} ${owner.kind}, ${vertex.id}`;piece.append(title);
   const shadow=document.createElementNS(NS,'ellipse');shadow.setAttribute('cx',String(x));shadow.setAttribute('cy',String(y+.22));shadow.setAttribute('rx',owner.kind==='city'?'.31':'.23');shadow.setAttribute('ry','.065');shadow.setAttribute('class','game-building-shadow');piece.append(shadow);
   const shell=document.createElementNS(NS,'path');shell.setAttribute('class','game-building-shell');shell.setAttribute('fill',palette.body);shell.setAttribute('stroke',palette.edge);shell.setAttribute('stroke-width','.045');shell.setAttribute('stroke-linejoin','round');
   const accent=document.createElementNS(NS,'path');accent.setAttribute('class','game-building-accent');accent.setAttribute('fill','none');accent.setAttribute('stroke','#ffffff');accent.setAttribute('stroke-width','.035');accent.setAttribute('stroke-linecap','round');accent.setAttribute('stroke-linejoin','round');accent.setAttribute('opacity','.68');
   const detail=document.createElementNS(NS,'path');detail.setAttribute('class','game-building-detail');detail.setAttribute('fill','none');detail.setAttribute('stroke','#173027');detail.setAttribute('stroke-width','.03');detail.setAttribute('stroke-linecap','round');detail.setAttribute('stroke-linejoin','round');detail.setAttribute('opacity','.9');
   if(owner.kind==='settlement'){
    shell.setAttribute('d',`M${x-.24} ${y+.19}V${y-.03}L${x} ${y-.25}L${x+.24} ${y-.03}V${y+.19}Z`);
    accent.setAttribute('d',`M${x-.27} ${y-.02}L${x} ${y-.28}L${x+.27} ${y-.02}`);
    detail.setAttribute('d',`M${x-.055} ${y+.19}V${y+.02}H${x+.055}V${y+.19}M${x-.16} ${y+.02}h.07v.07h-.07zM${x+.09} ${y+.02}h.07v.07h-.07z`);
   }else{
    shell.setAttribute('d',`M${x-.33} ${y+.2}V${y-.07}H${x-.14}V${y-.19}H${x-.055}V${y-.31}H${x+.09}V${y-.19}H${x+.19}V${y-.07}H${x+.33}V${y+.2}Z`);
    accent.setAttribute('d',`M${x-.35} ${y-.07}H${x-.14}M${x-.14} ${y-.07}V${y-.2}H${x-.055}M${x+.09} ${y-.2}H${x+.19}V${y-.07}H${x+.35}`);
    detail.setAttribute('d',`M${x-.06} ${y+.2}V${y+.03}H${x+.06}V${y+.2}M${x-.23} ${y+.02}h.08v.08h-.08zM${x+.15} ${y+.02}h.08v.08h-.08zM${x-.015} ${y-.255}h.065`);
   }
   piece.append(shadow,shell,accent,detail);
   if(cityTarget){piece.setAttribute('data-legal-target','city');piece.setAttribute('tabindex','0');piece.setAttribute('role','button');piece.setAttribute('aria-label',`Legal city upgrade ${vertex.id}`);piece.onclick=()=>attempt(()=>moveTarget(vertex.id));piece.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();attempt(()=>moveTarget(vertex.id));}};}
   svg.append(piece);continue;
  }
  if(targetMode!=='settlement'||!legal.has(vertex.id))continue;
  const node=document.createElementNS(NS,'circle');node.setAttribute('cx',String(vertex.point.x));node.setAttribute('cy',String(vertex.point.y));node.setAttribute('r','.14');node.setAttribute('class','game-target game-target-vertex');node.setAttribute('data-legal-target','settlement');node.setAttribute('tabindex','0');node.setAttribute('role','button');node.setAttribute('aria-label',`Legal settlement target ${vertex.id}`);
  node.onclick=()=>attempt(()=>moveTarget(vertex.id));node.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();attempt(()=>moveTarget(vertex.id));}};svg.append(node);
 }
 const robberMarker=svg.querySelector<SVGGElement>('.robber-marker');if(robberMarker&&renderedRobberHex!==s.board.robberHexId)robberMarker.classList.add('robber-marker-enter');
 if(targetMode==='robber')for(const group of Array.from(svg.querySelectorAll<SVGGElement>('[data-hex-id]'))){
  const id=group.dataset.hexId!;if(!legal.has(id))continue;group.classList.add('robber-target');group.setAttribute('data-legal-target','robber');group.setAttribute('tabindex','0');group.setAttribute('role','button');group.setAttribute('aria-label',`Legal robber target ${id}`);
  group.onclick=()=>attempt(()=>moveTarget(id));group.onkeydown=(e:KeyboardEvent)=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();attempt(()=>moveTarget(id));}};
 }
 renderedRoadOwners=new Map(Object.entries(s.roads));renderedBuildings=new Map<string,string>(Object.entries(s.buildings).map(([id,building])=>[id,`${building.playerId}:${building.kind}`] as [string,string]));renderedRobberHex=s.board.robberHexId;
 svg.removeAttribute('aria-hidden');svg.setAttribute('aria-label','Island board');
}
function render(){if(!state)return;const s=state,active=s.players[s.currentSeat],actor=s.players.find(player=>player.id===viewer)??null,spectating=remote!==null&&!actor;el('game-status').textContent=`Seed ${s.board.seed}.${remote ? ` Revision ${networkRevision}.` : ''} ${playerName(active.id)}'s turn; phase: ${s.phase}${s.dice?`; dice ${s.dice.join(' + ')}`:''}${s.winner?`; winner: ${s.winner}`:''}.`;
 el('turn-banner').textContent=turnAnnouncement(activityState(s));
 el('public-action').textContent=publicActivity||'Game ready.';
 renderPlayerStrip(s,active.id);
 const handCard=el('private-hand-card'),tabs=el('game-tabs');handCard.hidden=spectating;tabs.hidden=spectating;handCard.classList.toggle('active-hand',!spectating&&viewer===active.id);
 if(actor)renderPieceSupply(actor);else el('piece-supply').replaceChildren();
 el('players').textContent=s.players.map(p=>`${playerName(p.id)}: ${publicVictoryPoints(s,p.id)} public VP${p.id===viewer?` (${publicVictoryPoints(s,p.id)+p.cards.filter(c=>c.type==='victory-point').length} total)`:''}, ${p.knights} knights played${s.armyHolder===p.id?' (Largest Army)':''}, longest road ${longestRoute(s,p.id)}, ${p.roads} roads, ${p.settlements} settlements, ${p.cities} cities remaining, ${projection?.public.players.find(x=>x.id===p.id)?.resources ?? RESOURCES.reduce((n,r)=>n+p.hand[r],0)} resources, ${projection?.public.players.find(x=>x.id===p.id)?.developmentCards ?? p.cards.length} cards`).join(' | ');
 const bank=el('bank');bank.replaceChildren(document.createTextNode('Bank: '),...RESOURCES.map(r=>resourceChip(r,s.bank[r])),document.createTextNode(` · Deck: ${projection?.public.deckCount ?? s.deck.length}`));el('bonuses').textContent=`Longest route: ${s.longestHolder?playerName(s.longestHolder):'none'}; largest army: ${s.armyHolder?playerName(s.armyHolder):'none'}.`;
 if(actor){el('hand').replaceChildren(...RESOURCES.map(r=>resourceChip(r,actor.hand[r])));renderDevelopmentCards(el('cards'),actor.cards,s.turn);}else{el('hand').replaceChildren();el('cards').replaceChildren();}
 el('log').replaceChildren(...log.slice(0,30).map(text=>{const li=document.createElement('li');li.textContent=text;return li;}));
 el('turn-hint').textContent=spectating?'Spectator mode · live public view.':s.phase==='finished'?'Game over.':s.discards[viewer]&&s.phase==='discard'?'Choose cards to discard.':s.offer?.targets.includes(viewer)?'A trade offer needs your response.':s.phase==='discard'?'Waiting for players to discard.':viewer===active.id?'Your turn · choose an action.':localBotIds.has(active.id)?`${playerName(active.id)} is acting…`:`Waiting for ${playerName(active.id)}.`;
 drawBoard();flashTurnCue(s);showActivityAlert(s);showVictoryAlert(s);scheduleLocalBot();const actions=el('actions'),trade=el('trade-actions');actions.replaceChildren();trade.replaceChildren();actions.dataset.phase=s.phase;trade.dataset.phase=s.phase;const targets=el('targets');targets.replaceChildren();
 if(spectating){activePanel='status';el('actions').hidden=true;el('trade-actions').hidden=true;el('status-panel').hidden=false;return;}
 if(!actor)return;
 if(targetMode){const description=document.createElement('p');description.textContent=`Select a highlighted ${targetMode} target on the board.`;targets.append(description);const cancel=button(targets,'Cancel selection',()=>{targetMode=null;render();});cancel.className='target-cancel';const choices=legalTargetIds(s,viewer,targetMode);if(choices.length){const choice=select(targets,'Legal target',choices);button(targets,'Use target',()=>moveTarget(choice.value));}else{const none=document.createElement('p');none.textContent='No legal targets are available.';targets.append(none);}}

 const mode=(value:typeof targetMode)=>{targetMode=value;render();};
 const grid=document.createElement('div');grid.className='action-grid';actions.append(grid);
 const canUndo=remote?projection?.public.undoPlayerId===viewer:localUndoState!==null&&localUndoPlayerId===viewer;
 if(canUndo)action(grid,'Undo last action','end',()=>{
  if(remote){remote.submit({type:'undo',playerId:viewer},networkRevision);return;}
  if(!localUndoState)throw new Error('Nothing safe to undo.');
  const previous=structuredClone(localUndoState);pendingLocalUndo=null;localUndoState=null;localUndoPlayerId='';
  commit(previous,`${playerName(viewer)} undid the last action.`);
 });
 if(s.discards[viewer]&&s.phase==='discard'){const get=counts(actions,`Discard exactly ${s.discards[viewer]} cards`,actor.hand);action(grid,'Discard','trade',()=>commit(applyTurnCommand(s,{type:'discard',playerId:viewer,cards:get()}),`${viewer} discarded.`));}
 if(s.offer?.targets.includes(viewer)){activePanel='actions';incomingTradeCard(actions,s.offer);action(grid,'Accept trade','trade',()=>{const message=domesticTradeMessage(s.offer!,viewer);commit(applyEconomyCommand(s,{type:'accept-offer',playerId:viewer,id:s.offer!.id}),message);});action(grid,'Reject trade','trade',()=>commit(applyEconomyCommand(s,{type:'reject-offer',playerId:viewer,id:s.offer!.id}),`${viewer} rejected a trade.`));}
 if(viewer!==active.id){setPanel(activePanel);return;}
 if(s.phase==='setup-settlement')action(grid,'Place settlement','settlement',()=>mode('settlement'));
 if(s.phase==='setup-road'||s.phase==='free-road'){action(grid,'Place road','road',()=>mode('road'));if(s.phase==='free-road')action(grid,'Finish free roads','end',()=>commit(applyEconomyCommand(s,{type:'stop-free-roads',playerId:viewer}),'Free road effect finished.'));}
 if(s.phase==='roll')action(grid,'Roll dice','dice',()=>commit(applyTurnCommand(s,{type:'roll',playerId:viewer}),`${viewer} rolled.`));
 if(s.phase==='robber')action(grid,'Move robber','settlement',()=>mode('robber'));
 if(s.phase==='steal'){const victim=playerSelect(actions,'Choose victim',s.victims);action(grid,'Steal','trade',()=>commit(applyTurnCommand(s,{type:'steal',playerId:viewer,victimId:victim.value}),`${viewer} stole a resource.`));}
 if(s.phase==='action'){
  action(grid,'End turn','end',()=>commit(applyTurnCommand(s,{type:'end-turn',playerId:viewer}),`${viewer} ended the turn.`));
  action(grid,'Build road','road',()=>mode('road'),{lumber:1,brick:1},actor.hand);
  action(grid,'Build settlement','settlement',()=>mode('settlement'),{lumber:1,brick:1,wool:1,grain:1},actor.hand);
  action(grid,'Upgrade city','city',()=>mode('city'),{grain:2,ore:3},actor.hand);
  bankTradeButtons(trade,s,actor);
  const domestic=document.createElement('details'),summary=document.createElement('summary');domestic.className='domestic-trade-card';summary.textContent='Offer to another player';domestic.append(summary);trade.append(domestic);
  const opponent=playerSelect(domestic,'Offer trade to',s.players.filter(p=>p.id!==viewer).map(p=>p.id)), offered=counts(domestic,'Offer these cards',actor.hand), wanted=counts(domestic,'Request these cards');action(domestic,'Make offer','trade',()=>commit(applyEconomyCommand(s,{type:'offer',playerId:viewer,id:`${s.turn}-${log.length}`,targets:[opponent.value],give:offered(),receive:wanted()}),`${viewer} proposed a trade.`));
  if(s.offer)action(trade,'Cancel offer','end',()=>commit(applyEconomyCommand(s,{type:'cancel-offer',playerId:viewer,id:s.offer!.id}),`${viewer} cancelled a trade.`));
 }
 if(s.phase==='action'){
  const buy=action(grid,'Buy development card','card',()=>commit(applyEconomyCommand(s,{type:'buy-card',playerId:viewer}),`${playerName(viewer)} bought a development card.`),{wool:1,grain:1,ore:1},actor.hand);
  if((projection?.public.deckCount ?? s.deck.length)===0){buy.disabled=true;buy.title='Development deck is empty';}
 }
 if(s.phase==='action'||s.phase==='roll'){
  const playable=playableDevelopmentTypes(s,viewer),play=(card:Exclude<Development,'victory-point'>,extra:Partial<{resource:Resource;resources:Resource[]}>= {})=>{activePanel='actions';commit(applyEconomyCommand(s,{type:'play-card',playerId:viewer,card,...extra}),`${viewer} played ${DEVELOPMENT_LABELS[card]}.`);};
  if(playable.length){
   const cardSection=document.createElement('section');cardSection.className='development-actions-inline';const heading=document.createElement('h2');heading.textContent='Development cards';const cardGrid=document.createElement('div');cardGrid.className='action-grid development-action-grid';cardSection.append(heading,cardGrid);actions.append(cardSection);
   if(playable.includes('knight'))developmentAction(cardGrid,'Play Knight','knight',()=>play('knight'));
   if(playable.includes('road-building'))developmentAction(cardGrid,'Play Road Building','road-building',()=>play('road-building'));
   if(playable.includes('monopoly')){const box=document.createElement('div');box.className='development-effect';const resource=resourceChoice(box,'Choose Monopoly resource');developmentAction(box,'Play Monopoly','monopoly',()=>play('monopoly',{resource:resource()}));cardSection.append(box);}
   if(playable.includes('invention')){const box=document.createElement('div');box.className='development-effect';const first=resourceChoice(box,'First resource'),second=resourceChoice(box,'Second resource');developmentAction(box,'Play Year of Plenty','invention',()=>play('invention',{resources:[first(),second()]}));cardSection.append(box);}
  }
 }
 if(!['setup-settlement','setup-road','finished'].includes(s.phase)&&publicVictoryPoints(s,viewer)+actor.cards.filter(card=>card.type==='victory-point').length>=10)action(grid,'Claim victory','end',()=>commit(applyEconomyCommand(s,{type:'claim-victory',playerId:viewer}),`${viewer} won.`));
 setPanel(activePanel);
}
function refreshLocalMapPreview(){
 if(!localRoomOpen)return;
 const input=el<HTMLInputElement>('seed'),preview=el('local-map-preview');
 const bots=Number(el<HTMLSelectElement>('local-bot-count').value),selected=Number(el<HTMLSelectElement>('seats').value);
 const count=bots>0?bots+1:selected,layout=count>=5?'expanded-5-6':'standard';
 el('local-board-layout').textContent=`${count} players · ${layout==='standard'?'standard 19-hex board':'expanded 24-hex board'}`;
 if(!input.value||!input.validity.valid){preview.textContent='Enter a valid map seed.';return;}
 try{
  const settings=createLocalRoomSettings(input.valueAsNumber,selected,bots);
  renderIslandBoard(preview,generateBoardSetup(settings.seed,settings.boardLayout));
  const svg=preview.querySelector('svg');
  if(svg){svg.removeAttribute('aria-hidden');svg.setAttribute('aria-label',`Local map preview, seed ${settings.seed}, ${count} players`);}
 }catch(error){preview.textContent=error instanceof Error?error.message:'Invalid local room settings.';}
}
function startLocalRound(settings:LocalRoomSettings){
 clearBotTimer();remote=null;projection=null;networkRevision=0;
 localUndoState=null;localUndoPlayerId='';pendingLocalUndo=null;targetMode=null;
 renderedRoadOwners=new Map();renderedBuildings=new Map();renderedRobberHex='';
 localBotIds=new Set(settings.botCount?settings.ids.slice(1):[]);
 botTurnKey='';botActionCount=0;viewer='';
 state=createGame(settings.seed,settings.ids,undefined,{boardLayout:settings.boardLayout});
 log=[];publicActivity='New local game started.';lastTurnCue='';pendingActivityAlert='';pendingProductionSummary='';lastWinnerAlert='';
 for(const timer of [turnAlertTimer,activityAlertTimer,victoryAlertTimer])if(timer!==null)window.clearTimeout(timer);
 turnAlertTimer=null;activityAlertTimer=null;victoryAlertTimer=null;
 for(const selector of ['.turn-alert','.activity-alert','.victory-alert'])document.querySelector(selector)?.remove();
 activePanel='actions';el('switch-player').hidden=settings.botCount>0;
 enterGame();
 if(settings.botCount>0){viewer='Player 1';el('pass').hidden=true;el('game').hidden=false;render();}
 else{handoff(state.players[state.currentSeat].id);render();}
}
el('local-room-create').onclick=()=>{
 localRoomOpen=true;
 el('local-room-create').hidden=true;
 el('local-room-lobby').hidden=false;
 refreshLocalMapPreview();
};
el('start').onclick=()=>attempt(()=>{
 if(!localRoomOpen)throw new Error('Create a local room first.');
 const seed=el<HTMLInputElement>('seed');
 if(!seed.value||!seed.validity.valid)throw new Error('Enter a valid map seed.');
 const settings=createLocalRoomSettings(seed.valueAsNumber,Number(el<HTMLSelectElement>('seats').value),Number(el<HTMLSelectElement>('local-bot-count').value));
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

for(const tab of Array.from(document.querySelectorAll<HTMLButtonElement>('[data-panel]'))){if(tab.dataset.panel==='actions')tab.prepend(icon(ACTION_PATHS.dice));if(tab.dataset.panel==='trade')tab.prepend(icon(ACTION_PATHS.trade));if(tab.dataset.panel==='status')tab.prepend(icon(ACTION_PATHS.hand));tab.onclick=()=>setPanel(tab.dataset.panel as 'actions'|'trade'|'status');}
const localBotCount=el<HTMLSelectElement>('local-bot-count'),localSeats=el<HTMLSelectElement>('seats');localBotCount.onchange=()=>{const count=Number(localBotCount.value);if(count>0){localSeats.value=String(count+1);localSeats.disabled=true;localSeats.title=count>=4?'Expanded 5–6 player board selected automatically.':'Standard board selected automatically.';}else{localSeats.disabled=false;localSeats.title='';}refreshLocalMapPreview();};localSeats.addEventListener('change',refreshLocalMapPreview);
const roomSeed=el<HTMLInputElement>('room-seed'),roomBoardVersion=el<HTMLSelectElement>('room-board-version');roomSeed.addEventListener('input',renderRoomMapPreview);roomBoardVersion.addEventListener('change',renderRoomMapPreview);
el('room-randomize-map').onclick=()=>{roomSeed.value=String(crypto.getRandomValues(new Uint32Array(1))[0]);renderRoomMapPreview();};renderRoomMapPreview();

const network=initializeNetwork({status:connectionStatus,reset:()=>{
  clearBotTimer();localBotIds=new Set();botTurnKey='';botActionCount=0;activeLocalRoom=null;localUndoState=null;localUndoPlayerId='';pendingLocalUndo=null;el('local-restart').hidden=true;el('pass-local-restart').hidden=true;renderedRoadOwners=new Map();renderedBuildings=new Map();renderedRobberHex='';projection=null;networkRevision=0;state=null;targetMode=null;log=[];publicActivity='';lastTurnCue='';pendingActivityAlert='';pendingProductionSummary='';lastWinnerAlert='';if(turnAlertTimer!==null){window.clearTimeout(turnAlertTimer);turnAlertTimer=null;}if(activityAlertTimer!==null){window.clearTimeout(activityAlertTimer);activityAlertTimer=null;}if(victoryAlertTimer!==null){window.clearTimeout(victoryAlertTimer);victoryAlertTimer=null;}document.querySelector('.turn-alert')?.remove();document.querySelector('.activity-alert')?.remove();document.querySelector('.victory-alert')?.remove();el('game').hidden=true;
},snapshot:(value,playerId)=>{
  if(projection&&value.gameId===projection.gameId&&value.revision<=networkRevision)return;
  const previousPublic=projection?.public as unknown as PublicActivityState|null;
  const tradeSummary=value.public.tradeSummary;
  const publicName=(id:string)=>value.public.players.find(player=>player.id===id)?.name||id;
  const tradeActivity=projection&&tradeSummary?.revision===value.revision?`${publicName(tradeSummary.proposer)} traded ${tradeSummary.giveCount} card${tradeSummary.giveCount===1?'':'s'} for ${tradeSummary.receiveCount} card${tradeSummary.receiveCount===1?'':'s'} with ${publicName(tradeSummary.accepter)}.`:null;
  const nextPublic=value.public as unknown as PublicActivityState;
  const activity=tradeActivity??derivePublicActivity(previousPublic,nextPublic);
  if(previousPublic&&previousPublic.phase==='roll'&&nextPublic.dice)pendingProductionSummary=productionSummary(previousPublic,nextPublic);
  if(activity){log.unshift(activity);publicActivity=activity;if(centralActivity(activity))pendingActivityAlert=activity;}else if(!projection&&!publicActivity)publicActivity='Game synchronized.';
  projection=value;networkRevision=value.revision;viewer=playerId;remote=network;targetMode=null;
  const pub=value.public;
  const privateView=value.private;
  state={version:pub.version,board:pub.board,players:pub.players.map(p=>({id:p.id,seat:p.seat,hand:privateView&&p.id===playerId?privateView.hand:{lumber:0,brick:0,wool:0,grain:0,ore:0},cards:privateView&&p.id===playerId?privateView.cards:[],roads:p.roads,settlements:p.settlements,cities:p.cities,knights:p.knights})),bank:pub.bank,deck:[],randomState:0,playedCards:pub.playedCards,startingSeat:pub.startingSeat,currentSeat:pub.currentSeat,turn:pub.turn,phase:pub.phase,setupStep:pub.setupStep,pendingSettlement:pub.pendingSettlement,buildings:pub.buildings,roads:pub.roads,longestHolder:pub.longestHolder,armyHolder:pub.armyHolder,playedDevelopment:false,resumePhase:null,freeRoads:pub.freeRoads,winner:pub.winner,offer:pub.offer,dice:pub.dice,discards:pub.discards,victims:pub.victims};
  el('pass').hidden=true;el('game').hidden=false;el('switch-player').hidden=true;enterGame();render();
}});
