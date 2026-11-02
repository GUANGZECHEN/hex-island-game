import './style.css';
import { createIslandBoard } from './game/board/geometry';
import { createBoardView } from './game/board/presentation';
import { renderIslandBoard } from './game/board/render';
import { createGame, RESOURCES, type GameState, type Hand, type Resource, type Development } from './game/rules/state';
import { applySetupCommand } from './game/rules/state';
import { applyTurnCommand } from './game/rules/turn';
import { applyBuildCommand } from './game/rules/build';
import { applyEconomyCommand } from './game/rules/economy';

const el = <T extends HTMLElement>(id:string) => document.getElementById(id) as T;
let state:GameState | null=null, viewer='', targetMode:'settlement'|'road'|'city'|'robber'|null=null, log:string[]=[];
const byId=(id:string)=>state!.players.find(p=>p.id===id)!;
function handoff(id:string){viewer=id;el('game').hidden=true;el('pass').hidden=false;el('pass-message').textContent=`Pass the device to ${id}.`;} 
function commit(next:GameState, description:string){const old=state!;state=next;log.unshift(description);targetMode=null;if(old.currentSeat!==next.currentSeat)handoff(next.players[next.currentSeat].id);render();}
function attempt(f:()=>void){try{f();el('game-error').textContent='';}catch(error){el('game-error').textContent=error instanceof Error?error.message:'Action failed.';}}
function button(parent:HTMLElement,label:string,action:()=>void){const b=document.createElement('button');b.type='button';b.textContent=label;b.onclick=()=>attempt(action);parent.append(b);return b;}
function select(parent:HTMLElement,label:string,options:readonly string[]):HTMLSelectElement{const wrapper=document.createElement('label');wrapper.textContent=label;const input=document.createElement('select');for(const value of options){const option=document.createElement('option');option.value=value;option.textContent=value;input.append(option);}wrapper.append(input);parent.append(wrapper);return input;}
function counts(parent:HTMLElement,label:string):()=>Hand{const field=document.createElement('fieldset');const legend=document.createElement('legend');legend.textContent=label;field.append(legend);const controls={} as Record<Resource,HTMLInputElement>;for(const r of RESOURCES){const l=document.createElement('label');l.textContent=r;const i=document.createElement('input');i.type='number';i.min='0';i.step='1';i.value='0';l.append(i);field.append(l);controls[r]=i;}parent.append(field);return ()=>Object.fromEntries(RESOURCES.map(r=>[r,Number(controls[r].value)])) as Hand;}
function moveTarget(id:string){if(!state)return;const current=state.players[state.currentSeat].id;if(viewer!==current)return;
 if(targetMode==='settlement')commit(state.phase==='setup-settlement'?applySetupCommand(state,{type:'place-settlement',playerId:viewer,vertexId:id}):applyBuildCommand(state,{type:'build-settlement',playerId:viewer,vertexId:id}),`${viewer} placed a settlement.`);
 else if(targetMode==='city')commit(applyBuildCommand(state,{type:'build-city',playerId:viewer,vertexId:id}),`${viewer} upgraded a city.`);
 else if(targetMode==='road')commit(state.phase==='setup-road'?applySetupCommand(state,{type:'place-road',playerId:viewer,edgeId:id}):state.phase==='free-road'?applyEconomyCommand(state,{type:'free-road',playerId:viewer,edgeId:id}):applyBuildCommand(state,{type:'build-road',playerId:viewer,edgeId:id}),`${viewer} placed a road.`);
 else if(targetMode==='robber')commit(applyTurnCommand(state,{type:'move-robber',playerId:viewer,hexId:id}),`${viewer} moved the robber.`);
}
function drawBoard(){const s=state!,container=el('board');renderIslandBoard(container,s.board);const svg=container.querySelector('svg')!;const view=createBoardView(createIslandBoard());const NS='http://www.w3.org/2000/svg';
 for(const edge of view.edges){const owner=s.roads[edge.id];if(!owner&&targetMode!=='road')continue;const line=document.createElementNS(NS,'line');for(const [k,v] of Object.entries({x1:edge.start.x,y1:edge.start.y,x2:edge.end.x,y2:edge.end.y}))line.setAttribute(k,String(v));line.setAttribute('class',owner?`game-road player-${byId(owner).seat+1}`:'game-target');if(owner){const title=document.createElementNS(NS,'title');title.textContent=`${owner} road, ${edge.id}`;line.append(title);}if(!owner){line.setAttribute('tabindex','0');line.setAttribute('role','button');line.setAttribute('aria-label',`Road target ${edge.id}`);line.onclick=()=>attempt(()=>moveTarget(edge.id));line.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();attempt(()=>moveTarget(edge.id));}};}svg.append(line);}
 for(const vertex of view.vertices){const owner=s.buildings[vertex.id];if(!owner&&targetMode!=='settlement'&&targetMode!=='city')continue;const node=document.createElementNS(NS,'circle');node.setAttribute('cx',String(vertex.point.x));node.setAttribute('cy',String(vertex.point.y));node.setAttribute('r',owner?'.15':'.12');node.setAttribute('class',owner?`game-building player-${byId(owner.playerId).seat+1}`:'game-target');if(owner){const title=document.createElementNS(NS,'title');title.textContent=`${owner.playerId} ${owner.kind}, ${vertex.id}`;node.append(title);}if(!owner||targetMode==='city'){node.setAttribute('tabindex','0');node.setAttribute('role','button');node.setAttribute('aria-label',`Building target ${vertex.id}`);node.onclick=()=>attempt(()=>moveTarget(vertex.id));node.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();attempt(()=>moveTarget(vertex.id));}};}svg.append(node);if(owner){const mark=document.createElementNS(NS,'text');mark.setAttribute('x',String(vertex.point.x));mark.setAttribute('y',String(vertex.point.y));mark.setAttribute('text-anchor','middle');mark.setAttribute('dominant-baseline','central');mark.setAttribute('class','piece-label');mark.textContent=String(byId(owner.playerId).seat+1);svg.append(mark);}}
 if(targetMode==='robber')for(const group of Array.from(svg.querySelectorAll<SVGGElement>('[data-hex-id]'))){group.setAttribute('tabindex','0');group.setAttribute('role','button');group.setAttribute('aria-label',`Move robber to ${group.dataset.hexId}`);group.onclick=()=>attempt(()=>moveTarget(group.dataset.hexId!));group.onkeydown=(e:KeyboardEvent)=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();attempt(()=>moveTarget(group.dataset.hexId!));}};}
 // The interactive overlay is keyboard-accessible; the separate text lists describe every cell and port.
 svg.removeAttribute('aria-hidden');svg.setAttribute('aria-label','Island board');
}
function render(){if(!state)return;const s=state,active=s.players[s.currentSeat],actor=byId(viewer);el('game-status').textContent=`Seed ${s.board.seed}. ${active.id}'s turn; phase: ${s.phase}${s.dice?`; dice ${s.dice.join(' + ')}`:''}${s.winner?`; winner: ${s.winner}`:''}.`;
 el('players').textContent=s.players.map(p=>`${p.id}: ${Object.values(s.buildings).filter(b=>b.playerId===p.id).reduce((n,b)=>n+(b.kind==='city'?2:1),0)} building VP, ${p.roads} roads, ${p.settlements} settlements, ${p.cities} cities remaining, ${RESOURCES.reduce((n,r)=>n+p.hand[r],0)} resources, ${p.cards.length} cards`).join(' | ');
 el('bank').textContent=`Bank: ${RESOURCES.map(r=>`${r} ${s.bank[r]}`).join(', ')}; development deck: ${s.deck.length}.`;el('bonuses').textContent=`Longest route: ${s.longestHolder??'none'}; largest army: ${s.armyHolder??'none'}.`;
 el('hand').textContent=RESOURCES.map(r=>`${r}: ${actor.hand[r]}`).join(', ');el('cards').textContent=actor.cards.map(c=>`${c.type}${c.boughtTurn===s.turn?' (new)':''}`).join(', ')||'No development cards.';
 el('log').replaceChildren(...log.slice(0,30).map(text=>{const li=document.createElement('li');li.textContent=text;return li;}));
 drawBoard();const actions=el('actions');actions.replaceChildren();const targets=el('targets');targets.textContent=targetMode?`Select a ${targetMode} target on the board.`:'';
 const mode=(value:typeof targetMode)=>{targetMode=value;render();};
 if(s.discards[viewer]&&s.phase==='discard'){const get=counts(actions,`Discard exactly ${s.discards[viewer]} cards`);button(actions,'Discard',()=>commit(applyTurnCommand(s,{type:'discard',playerId:viewer,cards:get()}),`${viewer} discarded.`));}
 if(s.offer?.targets.includes(viewer)){button(actions,'Accept trade',()=>commit(applyEconomyCommand(s,{type:'accept-offer',playerId:viewer,id:s.offer!.id}),`${viewer} accepted a trade.`));button(actions,'Reject trade',()=>commit(applyEconomyCommand(s,{type:'reject-offer',playerId:viewer,id:s.offer!.id}),`${viewer} rejected a trade.`));}
 if(viewer!==active.id)return;
 if(s.phase==='setup-settlement')button(actions,'Place settlement',()=>mode('settlement'));
 if(s.phase==='setup-road'||s.phase==='free-road'){button(actions,'Place road',()=>mode('road'));if(s.phase==='free-road')button(actions,'Finish free roads',()=>commit(applyEconomyCommand(s,{type:'stop-free-roads',playerId:viewer}),'Free road effect finished.'));}
 if(s.phase==='roll')button(actions,'Roll dice',()=>commit(applyTurnCommand(s,{type:'roll',playerId:viewer}),`${viewer} rolled.`));
 if(s.phase==='robber')button(actions,'Move robber',()=>mode('robber'));
 if(s.phase==='steal'){const victim=select(actions,'Choose victim',s.victims);button(actions,'Steal',()=>commit(applyTurnCommand(s,{type:'steal',playerId:viewer,victimId:victim.value}),`${viewer} stole a resource.`));}
 if(s.phase==='action'){
  for(const [name,m] of [['Build road','road'],['Build settlement','settlement'],['Upgrade city','city']] as const)button(actions,name,()=>mode(m));
  button(actions,'Buy development card',()=>commit(applyEconomyCommand(s,{type:'buy-card',playerId:viewer}),`${viewer} bought a development card.`));
  const give=select(actions,'Bank trade: give',RESOURCES), receive=select(actions,'Receive',RESOURCES), rate=select(actions,'Rate',['4','3','2']);button(actions,'Trade with bank',()=>commit(applyEconomyCommand(s,{type:'bank-trade',playerId:viewer,give:give.value as Resource,receive:receive.value as Resource,rate:Number(rate.value) as 2|3|4}),`${viewer} traded with the bank.`));
  const opponent=select(actions,'Offer trade to',s.players.filter(p=>p.id!==viewer).map(p=>p.id)), offered=counts(actions,'Offer these cards'), wanted=counts(actions,'Request these cards');button(actions,'Make offer',()=>commit(applyEconomyCommand(s,{type:'offer',playerId:viewer,id:`${s.turn}-${log.length}`,targets:[opponent.value],give:offered(),receive:wanted()}),`${viewer} proposed a trade.`));
  if(s.offer)button(actions,'Cancel offer',()=>commit(applyEconomyCommand(s,{type:'cancel-offer',playerId:viewer,id:s.offer!.id}),`${viewer} cancelled a trade.`));
  button(actions,'End turn',()=>commit(applyTurnCommand(s,{type:'end-turn',playerId:viewer}),`${viewer} ended the turn.`));
 }
 if(s.phase==='action'||s.phase==='roll'){
  const card=select(actions,'Development card',['knight','road-building','invention','monopoly']);const resource=select(actions,'Effect resource',RESOURCES),second=select(actions,'Second invention resource',RESOURCES);
  button(actions,'Play card',()=>commit(applyEconomyCommand(s,{type:'play-card',playerId:viewer,card:card.value as Exclude<Development,'victory-point'>,resource:resource.value as Resource,resources:[resource.value as Resource,second.value as Resource]}),`${viewer} played ${card.value}.`));
 }
 if(!['setup-settlement','setup-road','finished'].includes(s.phase))button(actions,'Claim victory',()=>commit(applyEconomyCommand(s,{type:'claim-victory',playerId:viewer}),`${viewer} won.`));
}
el('start').onclick=()=>attempt(()=>{const input=el<HTMLInputElement>('seed');if(!input.value||!input.validity.valid)throw new Error('Enter a valid seed.');const n=Number(el<HTMLSelectElement>('seats').value);state=createGame(input.valueAsNumber,Array.from({length:n},(_,i)=>`Player ${i+1}`));log=[];handoff(state.players[state.currentSeat].id);render();});
el('reveal').onclick=()=>{el('pass').hidden=true;el('game').hidden=false;render();};
el('switch-player').onclick=()=>{if(!state)return;const next=prompt(`Pass to which player? ${state.players.map(p=>p.id).join(', ')}`);if(next&&state.players.some(p=>p.id===next)){handoff(next);render();}};
