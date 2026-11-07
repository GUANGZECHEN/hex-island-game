import './style.css';
import { ACTION_PATHS, DEVELOPMENT_LABELS, affordable, developmentChip, developmentIcon, icon, resourceChip, resourceIcon, type ActionIcon } from './game/ui/icons';
import { legalTargetIds, type TargetMode } from './game/ui/targets';
import { incomingTradeView, type TradeAmount } from './game/ui/trade';
import { bankTradeRate, playableDevelopmentTypes } from './game/ui/interactions';
import { initializeNetwork, type BrowserGame } from './game/network/browser';
import type { projectState } from './game/network/authority';
import { createIslandBoard } from './game/board/geometry';
import { generateBoardSetup } from './game/board/setup';
import { createBoardView } from './game/board/presentation';
import { renderIslandBoard } from './game/board/render';
import { createGame, publicVictoryPoints, RESOURCES, type GameState, type Hand, type Resource, type Development } from './game/rules/state';
import { applySetupCommand as localSetup } from './game/rules/state';
import { applyTurnCommand as localTurn } from './game/rules/turn';
import { applyBuildCommand as localBuild } from './game/rules/build';
import { applyEconomyCommand as localEconomy } from './game/rules/economy';

const el = <T extends HTMLElement>(id:string) => document.getElementById(id) as T;
let remote:BrowserGame | null=null, networkRevision=0, projection:ReturnType<typeof projectState> | null=null;
let activePanel:'actions'|'cards'|'trade'|'status'='actions';
let state:GameState | null=null, viewer='', targetMode:TargetMode|null=null, log:string[]=[];
const applySetupCommand = (s:GameState, c:Parameters<typeof localSetup>[1]) => remote ? (remote.submit(c,networkRevision), null) : localSetup(s,c);
const applyTurnCommand = (s:GameState, c:Parameters<typeof localTurn>[1]) => remote ? (remote.submit(c,networkRevision), null) : localTurn(s,c);
const applyBuildCommand = (s:GameState, c:Parameters<typeof localBuild>[1]) => remote ? (remote.submit(c,networkRevision), null) : localBuild(s,c);
const applyEconomyCommand = (s:GameState, c:Parameters<typeof localEconomy>[1]) => remote ? (remote.submit(c,networkRevision), null) : localEconomy(s,c);
const byId=(id:string)=>state!.players.find(p=>p.id===id)!;
function handoff(id:string){viewer=id;el('game').hidden=true;el('pass').hidden=false;el('pass-message').textContent=`Pass the device to ${id}.`;} 
function commit(next:GameState | null, description:string){if(!next)return;const old=state!;state=next;log.unshift(description);targetMode=null;if(old.currentSeat!==next.currentSeat)handoff(next.players[next.currentSeat].id);render();}
function attempt(f:()=>void){try{f();el('game-error').textContent='';}catch(error){el('game-error').textContent=error instanceof Error?error.message:'Action failed.';}}
function button(parent:HTMLElement,label:string,action:()=>void){const b=document.createElement('button');b.type='button';b.textContent=label;b.onclick=()=>attempt(action);parent.append(b);return b;}
function select(parent:HTMLElement,label:string,options:readonly string[]):HTMLSelectElement{const wrapper=document.createElement('label');wrapper.textContent=label;const input=document.createElement('select');for(const value of options){const option=document.createElement('option');option.value=value;option.textContent=value;input.append(option);}wrapper.append(input);parent.append(wrapper);return input;}
function resourceAmounts(parent:HTMLElement,amounts:readonly TradeAmount[]){for(const amount of amounts)parent.append(resourceChip(amount.resource,amount.count));}
function incomingTradeCard(parent:HTMLElement,offer:NonNullable<GameState['offer']>){
 const view=incomingTradeView(offer,viewer);if(!view)return;
 const card=document.createElement('section');card.className='incoming-trade';card.setAttribute('aria-label',`Trade offer from ${view.proposer}`);
 const title=document.createElement('h2');title.textContent=`Trade offer from ${view.proposer}`;card.append(title);
 const receive=document.createElement('div');receive.className='trade-offer-row';const receiveLabel=document.createElement('strong');receiveLabel.textContent='You receive';const receiveResources=document.createElement('span');receiveResources.className='trade-offer-resources';resourceAmounts(receiveResources,view.receive);receive.append(receiveLabel,receiveResources);
 const give=document.createElement('div');give.className='trade-offer-row';const giveLabel=document.createElement('strong');giveLabel.textContent='You give';const giveResources=document.createElement('span');giveResources.className='trade-offer-resources';resourceAmounts(giveResources,view.give);give.append(giveLabel,giveResources);
 card.append(receive,give);parent.append(card);
}
function action(parent:HTMLElement,label:string,symbol:ActionIcon,run:()=>void,cost?:Partial<Record<Resource,number>>,hand?:Hand){
 const b=button(parent,'',run);b.className='action-button';const text=document.createElement('span');text.className='action-label';text.textContent=label;b.append(icon(ACTION_PATHS[symbol]),text);
 if(cost){const list=document.createElement('span');list.className='action-cost';for(const resource of RESOURCES){const amount=cost[resource];if(amount)list.append(resourceChip(resource,amount));}b.append(list);if(hand&&!affordable(hand,cost)){b.disabled=true;b.title='Not enough resources';b.setAttribute('aria-label',`${label}: not enough resources`);}}
 return b;
}
function setPanel(panel:'actions'|'cards'|'trade'|'status') {activePanel=panel;for(const button of Array.from(document.querySelectorAll<HTMLButtonElement>('[data-panel]')))button.setAttribute('aria-pressed',String(button.dataset.panel===panel));el('actions').hidden=panel!=='actions';el('card-actions').hidden=panel!=='cards';el('trade-actions').hidden=panel!=='trade';el('status-panel').hidden=panel!=='status';}
function enterGame(){document.body.classList.add('playing');if(remote){el('reconnect-holder').append(el('room-reconnect'));el('turn-card').append(el('qa-indicator'));}else el('connection-summary').textContent='Local game';}
function connectionStatus(value:string){const lower=value.toLowerCase();el('connection-summary').textContent=lower.includes('paused')||lower.includes('unavailable')||lower.includes('failed')?'Disconnected · rejoin may be required':lower.includes('reconnected')?'Reconnected':lower.includes('reconnect')||lower.includes('interrupted')?'Reconnecting…':lower.includes('connected')||lower.includes('started')?'Connected':lower.includes('connecting')?'Connecting…':'';}
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
 const b=button(parent,'',run);b.className='action-button development-action-button';const text=document.createElement('span');text.className='action-label';text.textContent=label;b.append(developmentIcon(card),text);return b;
}
function renderDevelopmentCards(parent:HTMLElement,cards:GameState['players'][number]['cards'],turn:number){
 parent.replaceChildren();for(const type of Object.keys(DEVELOPMENT_LABELS) as Development[]){const owned=cards.filter(card=>card.type===type);if(!owned.length)continue;parent.append(developmentChip(type,owned.length,owned.filter(card=>card.boughtTurn===turn).length));}
}
function renderRoomMapPreview(){
 const input=el<HTMLInputElement>('room-seed'),preview=el('room-map-preview');if(!input.value||!input.validity.valid){preview.textContent='Enter a valid map seed.';return;}
 renderIslandBoard(preview,generateBoardSetup(input.valueAsNumber));const svg=preview.querySelector('svg');if(svg){svg.removeAttribute('aria-hidden');svg.setAttribute('aria-label',`Preview of map seed ${input.value}`);}
}
function moveTarget(id:string){if(!state)return;const current=state.players[state.currentSeat].id;if(viewer!==current)return;
 if(targetMode==='settlement')commit(state.phase==='setup-settlement'?applySetupCommand(state,{type:'place-settlement',playerId:viewer,vertexId:id}):applyBuildCommand(state,{type:'build-settlement',playerId:viewer,vertexId:id}),`${viewer} placed a settlement.`);
 else if(targetMode==='city')commit(applyBuildCommand(state,{type:'build-city',playerId:viewer,vertexId:id}),`${viewer} upgraded a city.`);
 else if(targetMode==='road')commit(state.phase==='setup-road'?applySetupCommand(state,{type:'place-road',playerId:viewer,edgeId:id}):state.phase==='free-road'?applyEconomyCommand(state,{type:'free-road',playerId:viewer,edgeId:id}):applyBuildCommand(state,{type:'build-road',playerId:viewer,edgeId:id}),`${viewer} placed a road.`);
 else if(targetMode==='robber')commit(applyTurnCommand(state,{type:'move-robber',playerId:viewer,hexId:id}),`${viewer} moved the robber.`);
}
function renderPlayerStrip(s:GameState,activeId:string){
 const strip=el('player-strip');strip.replaceChildren();
 for(const player of s.players){
  const publicPlayer=projection?.public.players.find(p=>p.id===player.id);
  const handCount=publicPlayer?.resources ?? RESOURCES.reduce((sum,r)=>sum+player.hand[r],0);
  const developmentCount=publicPlayer?.developmentCards ?? player.cards.length;
  const publicVp=publicVictoryPoints(s,player.id);
  const card=document.createElement('div');
  card.className=`player-summary player-${player.seat+1}${player.id===activeId?' active-player':''}${player.id===viewer?' local-player':''}`;
  card.setAttribute('aria-label',`${player.id}${player.id===viewer?', you':''}: ${handCount} resource cards, ${developmentCount} development cards, ${publicVp} public victory points${player.id===activeId?', current turn':''}`);
  const marker=document.createElement('span');marker.className='player-marker';marker.textContent=String(player.seat+1);marker.setAttribute('aria-hidden','true');
  const name=document.createElement('span');name.className='player-summary-name';name.textContent=player.id===viewer?`${player.id} · You`:player.id;
  const stats=document.createElement('span');stats.className='player-public-stats';
  const hand=document.createElement('span');hand.className='player-stat player-hand-count';hand.title='Resource cards';hand.append(icon(ACTION_PATHS.hand,'icon player-stat-icon'),document.createTextNode(String(handCount)));
  const dev=document.createElement('span');dev.className='player-stat player-dev-count';dev.title='Development cards';dev.append(icon(ACTION_PATHS.card,'icon player-stat-icon'),document.createTextNode(String(developmentCount)));
  const vp=document.createElement('span');vp.className='player-stat player-vp-count';vp.title='Public victory points';vp.append(icon(ACTION_PATHS.victory,'icon player-stat-icon'),document.createTextNode(String(publicVp)));
  stats.append(hand,dev,vp);card.append(marker,name,stats);
  if(player.id===activeId){const turn=document.createElement('span');turn.className='player-turn-badge';turn.textContent='Turn';card.append(turn);}
  strip.append(card);
 }
}
function drawBoard(){
 const s=state!,container=el('board');renderIslandBoard(container,s.board);const svg=container.querySelector('svg')!;const view=createBoardView(createIslandBoard());const NS='http://www.w3.org/2000/svg';
 const legal=targetMode?new Set(legalTargetIds(s,viewer,targetMode)):new Set<string>();
 for(const edge of view.edges){
  const owner=s.roads[edge.id];
  if(owner){
   const line=document.createElementNS(NS,'line');for(const [k,v] of Object.entries({x1:edge.start.x,y1:edge.start.y,x2:edge.end.x,y2:edge.end.y}))line.setAttribute(k,String(v));
   line.setAttribute('class',`game-road player-${byId(owner).seat+1}`);const title=document.createElementNS(NS,'title');title.textContent=`${owner} road, ${edge.id}`;line.append(title);svg.append(line);continue;
  }
  if(targetMode!=='road'||!legal.has(edge.id))continue;
  const line=document.createElementNS(NS,'line');for(const [k,v] of Object.entries({x1:edge.start.x,y1:edge.start.y,x2:edge.end.x,y2:edge.end.y}))line.setAttribute(k,String(v));
  line.setAttribute('class','game-target game-target-road');line.setAttribute('data-legal-target','road');line.setAttribute('tabindex','0');line.setAttribute('role','button');line.setAttribute('aria-label',`Legal road target ${edge.id}`);
  line.onclick=()=>attempt(()=>moveTarget(edge.id));line.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();attempt(()=>moveTarget(edge.id));}};svg.append(line);
 }
 for(const vertex of view.vertices){
  const owner=s.buildings[vertex.id],cityTarget=targetMode==='city'&&legal.has(vertex.id);
  if(owner){
   const node=document.createElementNS(NS,owner.kind==='city'?'rect':'circle');
   if(owner.kind==='city'){node.setAttribute('x',String(vertex.point.x-.15));node.setAttribute('y',String(vertex.point.y-.15));node.setAttribute('width','.3');node.setAttribute('height','.3');}
   else{node.setAttribute('cx',String(vertex.point.x));node.setAttribute('cy',String(vertex.point.y));node.setAttribute('r','.15');}
   node.setAttribute('class',`game-building player-${byId(owner.playerId).seat+1}${cityTarget?' game-target-city':''}`);
   const title=document.createElementNS(NS,'title');title.textContent=`${owner.playerId} ${owner.kind}, ${vertex.id}`;node.append(title);
   if(cityTarget){node.setAttribute('data-legal-target','city');node.setAttribute('tabindex','0');node.setAttribute('role','button');node.setAttribute('aria-label',`Legal city upgrade ${vertex.id}`);node.onclick=()=>attempt(()=>moveTarget(vertex.id));node.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();attempt(()=>moveTarget(vertex.id));}};}
   svg.append(node);
   const mark=document.createElementNS(NS,'text');mark.setAttribute('x',String(vertex.point.x));mark.setAttribute('y',String(vertex.point.y));mark.setAttribute('text-anchor','middle');mark.setAttribute('dominant-baseline','central');mark.setAttribute('class','piece-label');mark.textContent=String(byId(owner.playerId).seat+1);svg.append(mark);continue;
  }
  if(targetMode!=='settlement'||!legal.has(vertex.id))continue;
  const node=document.createElementNS(NS,'circle');node.setAttribute('cx',String(vertex.point.x));node.setAttribute('cy',String(vertex.point.y));node.setAttribute('r','.14');node.setAttribute('class','game-target game-target-vertex');node.setAttribute('data-legal-target','settlement');node.setAttribute('tabindex','0');node.setAttribute('role','button');node.setAttribute('aria-label',`Legal settlement target ${vertex.id}`);
  node.onclick=()=>attempt(()=>moveTarget(vertex.id));node.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();attempt(()=>moveTarget(vertex.id));}};svg.append(node);
 }
 if(targetMode==='robber')for(const group of Array.from(svg.querySelectorAll<SVGGElement>('[data-hex-id]'))){
  const id=group.dataset.hexId!;if(!legal.has(id))continue;group.classList.add('robber-target');group.setAttribute('data-legal-target','robber');group.setAttribute('tabindex','0');group.setAttribute('role','button');group.setAttribute('aria-label',`Legal robber target ${id}`);
  group.onclick=()=>attempt(()=>moveTarget(id));group.onkeydown=(e:KeyboardEvent)=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();attempt(()=>moveTarget(id));}};
 }
 svg.removeAttribute('aria-hidden');svg.setAttribute('aria-label','Island board');
}
function render(){if(!state)return;const s=state,active=s.players[s.currentSeat],actor=byId(viewer);el('game-status').textContent=`Seed ${s.board.seed}.${remote ? ` Revision ${networkRevision}.` : ''} ${active.id}'s turn; phase: ${s.phase}${s.dice?`; dice ${s.dice.join(' + ')}`:''}${s.winner?`; winner: ${s.winner}`:''}.`;
 renderPlayerStrip(s,active.id);
 el('players').textContent=s.players.map(p=>`${p.id}: ${publicVictoryPoints(s,p.id)} public VP${p.id===viewer?` (${publicVictoryPoints(s,p.id)+p.cards.filter(c=>c.type==='victory-point').length} total)`:''}, ${p.roads} roads, ${p.settlements} settlements, ${p.cities} cities remaining, ${projection?.public.players.find(x=>x.id===p.id)?.resources ?? RESOURCES.reduce((n,r)=>n+p.hand[r],0)} resources, ${projection?.public.players.find(x=>x.id===p.id)?.developmentCards ?? p.cards.length} cards`).join(' | ');
 const bank=el('bank');bank.replaceChildren(document.createTextNode('Bank: '),...RESOURCES.map(r=>resourceChip(r,s.bank[r])),document.createTextNode(` · Deck: ${projection?.public.deckCount ?? s.deck.length}`));el('bonuses').textContent=`Longest route: ${s.longestHolder??'none'}; largest army: ${s.armyHolder??'none'}.`;
 el('hand').replaceChildren(...RESOURCES.map(r=>resourceChip(r,actor.hand[r])));renderDevelopmentCards(el('cards'),actor.cards,s.turn);
 el('log').replaceChildren(...log.slice(0,30).map(text=>{const li=document.createElement('li');li.textContent=text;return li;}));
 el('turn-hint').textContent=s.phase==='finished'?'Game over.':s.discards[viewer]&&s.phase==='discard'?'Choose cards to discard.':s.offer?.targets.includes(viewer)?'A trade offer needs your response.':s.phase==='discard'?'Waiting for players to discard.':viewer===active.id?'Your turn · choose an action.':`Waiting for ${active.id}.`;
 drawBoard();const actions=el('actions'),trade=el('trade-actions'),cards=el('card-actions');actions.replaceChildren();trade.replaceChildren();cards.replaceChildren();const targets=el('targets');targets.replaceChildren();
 if(targetMode){const description=document.createElement('p');description.textContent=`Select a highlighted ${targetMode} target on the board.`;targets.append(description);const cancel=button(targets,'Cancel selection',()=>{targetMode=null;render();});cancel.className='target-cancel';const choices=legalTargetIds(s,viewer,targetMode);if(choices.length){const choice=select(targets,'Legal target',choices);button(targets,'Use target',()=>moveTarget(choice.value));}else{const none=document.createElement('p');none.textContent='No legal targets are available.';targets.append(none);}}

 const mode=(value:typeof targetMode)=>{targetMode=value;render();};
 const grid=document.createElement('div');grid.className='action-grid';actions.append(grid);
 if(s.discards[viewer]&&s.phase==='discard'){const get=counts(actions,`Discard exactly ${s.discards[viewer]} cards`,actor.hand);action(grid,'Discard','trade',()=>commit(applyTurnCommand(s,{type:'discard',playerId:viewer,cards:get()}),`${viewer} discarded.`));}
 if(s.offer?.targets.includes(viewer)){activePanel='actions';incomingTradeCard(actions,s.offer);action(grid,'Accept trade','trade',()=>commit(applyEconomyCommand(s,{type:'accept-offer',playerId:viewer,id:s.offer!.id}),`${viewer} accepted a trade.`));action(grid,'Reject trade','trade',()=>commit(applyEconomyCommand(s,{type:'reject-offer',playerId:viewer,id:s.offer!.id}),`${viewer} rejected a trade.`));}
 if(viewer!==active.id){setPanel(activePanel);return;}
 if(s.phase==='setup-settlement')action(grid,'Place settlement','settlement',()=>mode('settlement'));
 if(s.phase==='setup-road'||s.phase==='free-road'){action(grid,'Place road','road',()=>mode('road'));if(s.phase==='free-road')action(grid,'Finish free roads','end',()=>commit(applyEconomyCommand(s,{type:'stop-free-roads',playerId:viewer}),'Free road effect finished.'));}
 if(s.phase==='roll')action(grid,'Roll dice','dice',()=>commit(applyTurnCommand(s,{type:'roll',playerId:viewer}),`${viewer} rolled.`));
 if(s.phase==='robber')action(grid,'Move robber','settlement',()=>mode('robber'));
 if(s.phase==='steal'){const victim=select(actions,'Choose victim',s.victims);action(grid,'Steal','trade',()=>commit(applyTurnCommand(s,{type:'steal',playerId:viewer,victimId:victim.value}),`${viewer} stole a resource.`));}
 if(s.phase==='action'){
  action(grid,'End turn','end',()=>commit(applyTurnCommand(s,{type:'end-turn',playerId:viewer}),`${viewer} ended the turn.`));
  action(grid,'Build road','road',()=>mode('road'),{lumber:1,brick:1},actor.hand);
  action(grid,'Build settlement','settlement',()=>mode('settlement'),{lumber:1,brick:1,wool:1,grain:1},actor.hand);
  action(grid,'Upgrade city','city',()=>mode('city'),{grain:2,ore:3},actor.hand);
  const give=select(trade,'Bank trade: give',RESOURCES),receive=select(trade,'Receive',RESOURCES),rateHint=document.createElement('p');rateHint.className='trade-rate-hint';trade.append(rateHint);
  const syncRate=()=>{if(receive.value===give.value)receive.value=RESOURCES.find(resource=>resource!==give.value)!;rateHint.textContent=`Current rate: ${bankTradeRate(s,viewer,give.value as Resource)} ${give.value} → 1 ${receive.value}`;};give.onchange=syncRate;receive.onchange=syncRate;syncRate();
  action(trade,'Trade with bank','trade',()=>commit(applyEconomyCommand(s,{type:'bank-trade',playerId:viewer,give:give.value as Resource,receive:receive.value as Resource,rate:bankTradeRate(s,viewer,give.value as Resource)}),`${viewer} traded with the bank.`));
  const domestic=document.createElement('details'),summary=document.createElement('summary');summary.textContent='Offer to another player';domestic.append(summary);trade.append(domestic);
  const opponent=select(domestic,'Offer trade to',s.players.filter(p=>p.id!==viewer).map(p=>p.id)), offered=counts(domestic,'Offer these cards',actor.hand), wanted=counts(domestic,'Request these cards');action(domestic,'Make offer','trade',()=>commit(applyEconomyCommand(s,{type:'offer',playerId:viewer,id:`${s.turn}-${log.length}`,targets:[opponent.value],give:offered(),receive:wanted()}),`${viewer} proposed a trade.`));
  if(s.offer)action(trade,'Cancel offer','end',()=>commit(applyEconomyCommand(s,{type:'cancel-offer',playerId:viewer,id:s.offer!.id}),`${viewer} cancelled a trade.`));
 }
 if(s.phase==='action'){
  const buy=action(cards,'Buy development card','card',()=>{activePanel='cards';commit(applyEconomyCommand(s,{type:'buy-card',playerId:viewer}),`${viewer} bought a development card.`);},{wool:1,grain:1,ore:1},actor.hand);
  if((projection?.public.deckCount ?? s.deck.length)===0){buy.disabled=true;buy.title='Development deck is empty';}
 }
 if(s.phase==='action'||s.phase==='roll'){
  const playable=playableDevelopmentTypes(s,viewer),play=(card:Exclude<Development,'victory-point'>,extra:Partial<{resource:Resource;resources:Resource[]}>= {})=>{activePanel='actions';commit(applyEconomyCommand(s,{type:'play-card',playerId:viewer,card,...extra}),`${viewer} played ${DEVELOPMENT_LABELS[card]}.`);};
  if(!playable.length){const note=document.createElement('p');note.className='development-note';note.textContent=actor.cards.some(card=>card.boughtTurn===s.turn)?'New development cards become playable on your next turn.':'No playable development cards.';cards.append(note);}
  if(playable.includes('knight'))developmentAction(cards,'Play Knight','knight',()=>play('knight'));
  if(playable.includes('road-building'))developmentAction(cards,'Play Road Building','road-building',()=>play('road-building'));
  if(playable.includes('monopoly')){const box=document.createElement('div');box.className='development-effect';const resource=select(box,'Monopoly resource',RESOURCES);developmentAction(box,'Play Monopoly','monopoly',()=>play('monopoly',{resource:resource.value as Resource}));cards.append(box);}
  if(playable.includes('invention')){const box=document.createElement('div');box.className='development-effect';const first=select(box,'First resource',RESOURCES),second=select(box,'Second resource',RESOURCES);developmentAction(box,'Play Year of Plenty','invention',()=>play('invention',{resources:[first.value as Resource,second.value as Resource]}));cards.append(box);}
 }
 if(!['setup-settlement','setup-road','finished'].includes(s.phase)&&publicVictoryPoints(s,viewer)+actor.cards.filter(card=>card.type==='victory-point').length>=10)action(grid,'Claim victory','end',()=>commit(applyEconomyCommand(s,{type:'claim-victory',playerId:viewer}),`${viewer} won.`));
 setPanel(activePanel);
}
el('start').onclick=()=>attempt(()=>{const input=el<HTMLInputElement>('seed');if(!input.value||!input.validity.valid)throw new Error('Enter a valid seed.');const n=Number(el<HTMLSelectElement>('seats').value);remote=null;projection=null;el('switch-player').hidden=false;state=createGame(input.valueAsNumber,Array.from({length:n},(_,i)=>`Player ${i+1}`));log=[];activePanel='actions';enterGame();handoff(state.players[state.currentSeat].id);render();});
el('reveal').onclick=()=>{el('pass').hidden=true;el('game').hidden=false;render();};
el('switch-player').onclick=()=>{if(!state||remote)return;const next=prompt(`Pass to which player? ${state.players.map(p=>p.id).join(', ')}`);if(next&&state.players.some(p=>p.id===next)){handoff(next);render();}};

for(const tab of Array.from(document.querySelectorAll<HTMLButtonElement>('[data-panel]'))){if(tab.dataset.panel==='trade')tab.prepend(icon(ACTION_PATHS.trade));if(tab.dataset.panel==='cards')tab.prepend(icon(ACTION_PATHS.card));tab.onclick=()=>setPanel(tab.dataset.panel as 'actions'|'cards'|'trade'|'status');}
const roomSeed=el<HTMLInputElement>('room-seed');roomSeed.addEventListener('input',renderRoomMapPreview);
el('room-randomize-map').onclick=()=>{roomSeed.value=String(crypto.getRandomValues(new Uint32Array(1))[0]);renderRoomMapPreview();};renderRoomMapPreview();

const network=initializeNetwork({status:connectionStatus,reset:()=>{
  projection=null;networkRevision=0;state=null;targetMode=null;log=[];el('game').hidden=true;
},snapshot:(value,playerId)=>{
  if(projection&&value.gameId===projection.gameId&&value.revision<=networkRevision)return;
  if(!projection || value.revision!==networkRevision)log.unshift(`Game updated to revision ${value.revision}.`);projection=value;networkRevision=value.revision;viewer=playerId;remote=network;targetMode=null;
  const pub=value.public;
  state={version:pub.version,board:pub.board,players:pub.players.map(p=>({id:p.id,seat:p.seat,hand:p.id===playerId?value.private.hand:{lumber:0,brick:0,wool:0,grain:0,ore:0},cards:p.id===playerId?value.private.cards:[],roads:p.roads,settlements:p.settlements,cities:p.cities,knights:p.knights})),bank:pub.bank,deck:[],randomState:0,playedCards:pub.playedCards,startingSeat:pub.startingSeat,currentSeat:pub.currentSeat,turn:pub.turn,phase:pub.phase,setupStep:pub.setupStep,pendingSettlement:pub.pendingSettlement,buildings:pub.buildings,roads:pub.roads,longestHolder:pub.longestHolder,armyHolder:pub.armyHolder,playedDevelopment:false,resumePhase:null,freeRoads:pub.freeRoads,winner:pub.winner,offer:pub.offer,dice:pub.dice,discards:pub.discards,victims:pub.victims};
  el('pass').hidden=true;el('game').hidden=false;el('switch-player').hidden=true;enterGame();render();
}});
