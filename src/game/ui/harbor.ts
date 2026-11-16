import { usesTradeStations, availableTradeStations } from '../rules/trade-stations.ts';
import { RESOURCES, type GameState } from '../rules/state.ts';
import { canShip, shippingRoute, partnersConnected, portName, emptyCargo, harborOrderDifficulty, type HarborCommand } from '../rules/harbor.ts';
import { resourceIcon } from './icons.ts';
import '../../harbor.css';

/** Public order board; controls can spend only this viewer's own private resources. */
export function renderHarborPanel(host:HTMLElement,state:GameState,viewer:string,send:(c:HarborCommand)=>void,name:(id:string)=>string):void {
 host.replaceChildren();host.hidden=state.mode!=='harbor-coop';if(host.hidden||!state.harbor)return;
 const h=state.harbor,modern=usesTradeStations(state),player=state.players.find(p=>p.id===viewer);
 const canAct=!!player&&state.players[state.currentSeat].id===viewer&&state.phase==='action'&&h.outcome==='playing';
 const add=(tag:string,text:string,parent:HTMLElement=host)=>{const e=document.createElement(tag);e.textContent=text;parent.append(e);return e;};
 add('h3','Harbor orders · Co-op');
 const progress=add('p',`Round ${h.round} · Ships ${h.completed}/${h.goal}${modern?` · Orders ${h.nextOrder}/12`:""} · Missed ${h.missed}/${h.maxMisses}`);progress.className='harbor-progress';progress.setAttribute('role','status');
 host.dataset.outcome=h.outcome;host.dataset.completed=String(h.completed);host.dataset.round=String(h.round);
 if(h.outcome!=='playing'){const result=add('p',h.outcome==='won'?`TEAM VICTORY — ${h.completed} ships supplied!`:'The fleet has left — try again together.');result.className='harbor-result';result.setAttribute('role','alert');}
 if(modern){
  if(state.phase.startsWith('setup'))add('p','Player 1: settlement + 2 roads, twice. Player 2: city only, twice. Deadlines wait until setup is complete.');
  if(h.outcome==='playing')add('p',h.nextOrder<12?`Next order: round ${harborOrderDifficulty(h.nextOrder).arrivalRound}. Complete 10 of 12 to win.`:'All 12 orders have arrived. Deliver the remaining cargo.');
 }
 if(!modern&&!h.orders.length&&state.phase.startsWith('setup'))add('p','Ships arrive after both players finish their starting settlements.');
 for(const order of h.orders){
  const card=document.createElement('article');card.className='harbor-order';card.dataset.orderId=order.id;card.dataset.portId=order.portId;host.append(card);
  const head=document.createElement('div');head.className='harbor-order-heading';card.append(head);
  add('strong',`${portName(state,order.portId)} · ${order.title}`,head);
  const time=add('span',`${Math.max(0,order.dueRound-h.round+1)} rounds left`,head);if(order.dueRound-h.round<2)time.className='harbor-urgent';
  const cargo=document.createElement('div');cargo.className='harbor-cargo';card.append(cargo);
  for(const r of RESOURCES)if(order.demand[r]>0){const amount=document.createElement('span');amount.setAttribute('aria-label',`${r} ${order.loaded[r]} of ${order.demand[r]}`);amount.append(resourceIcon(r),document.createTextNode(`${order.loaded[r]}/${order.demand[r]}`));cargo.append(amount);}
  if(player){const port=state.board.ports.find(p=>p.edgeId===order.portId)!;const route=shippingRoute(state,viewer,port.vertexIds);add('p',route.missing===0?(modern?'Connected by your own roads':'Connected to your settlements'):Number.isFinite(route.missing)?`${modern?'Own roads':'Roads'} needed: ${route.missing}`:modern?'No available route through your own roads; expand from another settlement.':'Place a settlement to start your route',card);}
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
 if(modern){
  const stations=Object.values(h.stations??{});add('h4',`Trade stations · ${stations.length}`);
  if(!stations.length)add('p','Connect one road of each color at a junction, then build Station in Actions (1 wood + 1 brick + 1 wool + 1 grain).');
  const available=new Set(availableTradeStations(state,viewer).map(s=>s.vertexId));
  for(const [index,station] of stations.entries()){
   const row=document.createElement('section');row.className='harbor-station';row.dataset.stationId=station.vertexId;host.append(row);
   add('strong',`Station ${index+1}`,row);
   const used=station.lastSentTurns[viewer]===state.turn;
   add('p',!player?'Each partner may send one card on their turn.':used?'Sent this turn · refreshes on your next turn.':'1 resource card per player turn.',row);
   if(canAct&&partner&&available.has(station.vertexId)){
    const gifts=document.createElement('div');gifts.className='harbor-load-controls';row.append(gifts);
    for(const r of RESOURCES)if(player!.hand[r]>0){
     const b=document.createElement('button');b.type='button';b.dataset.sendResource=r;b.append(resourceIcon(r),document.createTextNode('1'));
     b.title=`Send one ${r} to ${name(partner.id)} at station ${index+1}`;b.setAttribute('aria-label',b.title);
     b.onclick=()=>send({type:'harbor-send',playerId:viewer,recipient:partner.id,stationId:station.vertexId,cards:{...emptyCargo(),[r]:1}});gifts.append(b);
    }
   }
  }
 }else if(canAct&&partner){
  if(partnersConnected(state,viewer,partner.id)){
   add('h4',`Send to ${name(partner.id)}`);const gifts=document.createElement('div');gifts.className='harbor-load-controls';host.append(gifts);
   for(const r of RESOURCES)if(player!.hand[r]>0){const b=document.createElement('button');b.type='button';b.append(resourceIcon(r),document.createTextNode('1'));b.title=`Send one ${r} to ${name(partner.id)}`;b.onclick=()=>send({type:'harbor-send',playerId:viewer,recipient:partner.id,cards:{...emptyCargo(),[r]:1}});gifts.append(b);}
  }else add('p','Connect both settlements with roads to exchange supplies.');
 }
 const event=add('p',h.event);event.className='harbor-event';
 const rules=document.createElement('details');const summary=document.createElement('summary');summary.textContent='Co-op rules';rules.append(summary);host.append(rules);
 if(modern){
  add('p','Deliver 10 of 12 orders. Order 1 arrives during setup: two resource types, one card each, seven team rounds to deliver. New orders arrive on rounds 1, 4, 7, …, 34. Total cards rise from 2 to 13. Deadlines decrease 7, 7, 6, 6, 5, 5, 4, 4, 3, 3, 3, 3 rounds; setup is untimed. A round is one turn per partner. Three misses make victory impossible.',rules);
  add('p','A trade station costs 1 lumber, brick, wool and grain, and must sit at a vertex with roads from both players. Either player may pay to build it. It does not produce resources or award points and can coexist with a home. Each station lets each player send one resource card during their own action turn. Ordinary offers cannot bypass this limit. Load requires an unbroken route from your own settlement/city using only your roads. A trade station transfers cards, not access to your partner’s roads.',rules);
 }else add('p','Legacy campaign: supply 6 ships before missing 3. Two ships wait nine rounds each. Connected partners may send resources freely. Restart to use trade stations and the twelve-order campaign.',rules);
 if(modern)add('p','Roll 7: no discards, even with more than 7 cards. Each partner receives one random resource from the bank and play continues in the action phase. Do not move the robber or steal. The two rewards may match. Empty bank stock cannot be awarded. Knight does not grant this bonus.',rules);
 add('p','Keep your own hand and buildings. Seven and Knight never steal from your partner. Monopoly takes up to 2 chosen resources from the bank. Construction may be safely undone; sent or loaded cargo cannot.',rules);
}
