import { RESOURCES, type GameState } from '../rules/state.ts';
import { canShip, shippingRoute, partnersConnected, portName, emptyCargo, type HarborCommand } from '../rules/harbor.ts';
import { resourceIcon } from './icons.ts';
import '../../harbor.css';

/** Public order board; controls can spend only this viewer's own private resources. */
export function renderHarborPanel(host:HTMLElement,state:GameState,viewer:string,send:(c:HarborCommand)=>void,name:(id:string)=>string):void {
 host.replaceChildren();host.hidden=state.mode!=='harbor-coop';if(host.hidden||!state.harbor)return;
 const h=state.harbor,player=state.players.find(p=>p.id===viewer);
 const canAct=!!player&&state.players[state.currentSeat].id===viewer&&state.phase==='action'&&h.outcome==='playing';
 const add=(tag:string,text:string,parent:HTMLElement=host)=>{const e=document.createElement(tag);e.textContent=text;parent.append(e);return e;};
 add('h3','Harbor orders · Co-op');
 const progress=add('p',`Round ${h.round} · Ships ${h.completed}/${h.goal} · Missed ${h.missed}/${h.maxMisses}`);progress.className='harbor-progress';progress.setAttribute('role','status');
 host.dataset.outcome=h.outcome;host.dataset.completed=String(h.completed);host.dataset.round=String(h.round);
 if(h.outcome!=='playing'){const result=add('p',h.outcome==='won'?'TEAM VICTORY — all six ships supplied!':'The fleet has left — try again together.');result.className='harbor-result';result.setAttribute('role','alert');}
 if(!h.orders.length&&state.phase.startsWith('setup'))add('p','Ships arrive after both players finish their starting settlements.');
 for(const order of h.orders){
  const card=document.createElement('article');card.className='harbor-order';card.dataset.orderId=order.id;card.dataset.portId=order.portId;host.append(card);
  const head=document.createElement('div');head.className='harbor-order-heading';card.append(head);
  add('strong',`${portName(state,order.portId)} · ${order.title}`,head);
  const time=add('span',`${Math.max(0,order.dueRound-h.round+1)} rounds left`,head);if(order.dueRound-h.round<2)time.className='harbor-urgent';
  const cargo=document.createElement('div');cargo.className='harbor-cargo';card.append(cargo);
  for(const r of RESOURCES)if(order.demand[r]>0){const amount=document.createElement('span');amount.setAttribute('aria-label',`${r} ${order.loaded[r]} of ${order.demand[r]}`);amount.append(resourceIcon(r),document.createTextNode(`${order.loaded[r]}/${order.demand[r]}`));cargo.append(amount);}
  if(player){const port=state.board.ports.find(p=>p.edgeId===order.portId)!;const route=shippingRoute(state,viewer,port.vertexIds);add('p',route.missing===0?'Connected to your settlements':Number.isFinite(route.missing)?`Roads needed: ${route.missing}`:'Place a settlement to start your route',card);}
  if(canAct&&canShip(state,viewer,order.portId)){
   const controls=document.createElement('div');controls.className='harbor-load-controls';card.append(controls);
   for(const r of RESOURCES){const amount=Math.min(player!.hand[r],order.demand[r]-order.loaded[r]);if(amount<1)continue;
    const b=document.createElement('button');b.type='button';b.dataset.loadResource=r;b.append(resourceIcon(r),document.createTextNode(`Load ${amount}`));b.title=`Load ${amount} ${r} at ${portName(state,order.portId)}`;
    b.onclick=()=>send({type:'harbor-load',playerId:viewer,orderId:order.id,cards:{...emptyCargo(),[r]:amount}});controls.append(b);
   }
   if(!controls.childElementCount)add('p','Waiting for the missing supplies.',card);
  }
 }
 const partner=state.players.find(p=>p.id!==viewer);
 if(canAct&&partner){
  if(partnersConnected(state,viewer,partner.id)){
   add('h4',`Send to ${name(partner.id)}`);const gifts=document.createElement('div');gifts.className='harbor-load-controls';host.append(gifts);
   for(const r of RESOURCES)if(player!.hand[r]>0){const b=document.createElement('button');b.type='button';b.append(resourceIcon(r),document.createTextNode('1'));b.title=`Send one ${r} to ${name(partner.id)}`;b.onclick=()=>send({type:'harbor-send',playerId:viewer,recipient:partner.id,cards:{...emptyCargo(),[r]:1}});gifts.append(b);}
  }else add('p','Connect both settlements with roads to exchange supplies.');
 }
 const event=add('p',h.event);event.className='harbor-event';
 const rules=document.createElement('details');const summary=document.createElement('summary');summary.textContent='Co-op rules';rules.append(summary);host.append(rules);
 add('p','Supply 6 ships before missing 3. One round is one turn for each partner; setup is untimed. Each ship waits 9 rounds. Reach its numbered port from your settlement along either player’s roads, then load your own cards during your action turn. Cargo can be added in parts. Delivered or expired cargo returns to the bank.',rules);
 add('p','Keep your own hand and buildings. Roads form a shared transport/building network. Connected partners can send resources or trade. Seven still requires discards and moving the robber, but never steals from your teammate. Monopoly takes up to 2 chosen cards from the bank; victory-point cards are replaced by Year of Plenty. Longest Road/Largest Army and individual 10-point wins do not decide this mode. Loaded or sent cargo cannot be undone.',rules);
}
