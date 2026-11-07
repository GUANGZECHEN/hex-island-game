import './style.css';
import { RoomClient } from './rooms';
import { initializeBoardUI } from './game/board/ui';
import { parseRoomLaunch } from './game/network/launch';

initializeBoardUI();
function el<T extends HTMLElement>(id:string):T {const e=document.getElementById(id);if(!e)throw Error('Missing UI element');return e as T;}
const status=el<HTMLElement>('status'),error=el<HTMLElement>('error'),list=el<HTMLUListElement>('peers'),target=el<HTMLSelectElement>('target'),send=el<HTMLButtonElement>('send'),create=el<HTMLButtonElement>('create'),copy=el<HTMLButtonElement>('copy'),message=el<HTMLInputElement>('message'),messages=el<HTMLUListElement>('messages');
const rawEndpoints=((import.meta.env.VITE_SIGNALING_URLS as string|undefined)??(import.meta.env.VITE_SIGNALING_URL as string|undefined)??'')
 .split(',').map(value=>value.trim().replace(/\/$/,'')).filter(Boolean);
const endpoints=rawEndpoints.filter(value=>{try{const u=new URL(value);return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password&&!u.search&&!u.hash&&(u.protocol!=='http:'||['localhost','127.0.0.1'].includes(u.hostname));}catch{return false;}});
let invite='';const entries=new Map<string,{li:HTMLLIElement;option:HTMLOptionElement}>();
const inviteField=el<HTMLInputElement>('invite'),inviteLabel=el<HTMLLabelElement>('invite-label');
const launch=parseRoomLaunch(location.hash),creatorCapability=launch.kind==='creator'?launch.capability:'';
if(launch.kind!=='public')history.replaceState(null,'',location.pathname+location.search);
const creatorMode=launch.kind==='creator';
create.hidden=!creatorMode;copy.hidden=!creatorMode;inviteField.hidden=!creatorMode;inviteLabel.hidden=!creatorMode;
const client=new RoomClient(endpoints.length?endpoints:['http://127.0.0.1:1'],{status:s=>status.textContent=s,error:s=>error.textContent=s,peer:(id,s,open)=>{let e=entries.get(id);if(!e){e={li:document.createElement('li'),option:document.createElement('option')};e.option.value=id;e.option.textContent=id==='host'?'Host':`Guest ${entries.size+1}`;list.append(e.li);target.append(e.option);entries.set(id,e);}e.li.textContent=`${e.option.textContent}: ${s}`;e.option.disabled=!open;refresh();},remove:id=>{const e=entries.get(id);e?.li.remove();e?.option.remove();entries.delete(id);refresh();},message:(id,text)=>add(id==='host'?'Host':'Guest',text)});
function refresh(){send.disabled=!Array.from(target.options).some(x=>!x.disabled);if(target.selectedOptions[0]?.disabled){const next=Array.from(target.options).find(x=>!x.disabled);if(next)target.value=next.value;}}
function add(who:string,text:string){const li=document.createElement('li');li.textContent=`${who}: ${text}`;messages.append(li);}
async function run(f:()=>Promise<void>){error.textContent='';try{await f();}catch(e){error.textContent=e instanceof Error?e.message:'Operation failed.';}}
create.disabled=endpoints.length===0||!creatorCapability;
status.textContent=!endpoints.length?'Automatic rooms unavailable: signaling endpoint is not configured. Manual mode remains available.':creatorMode?'Private host diagnostics ready.':'Open a private invitation to join, or use your private host link to create a room.';
create.onclick=()=>void run(async()=>{create.disabled=true;invite='';inviteField.value='';copy.disabled=true;try{invite=await client.create(creatorCapability);inviteField.value=invite;copy.disabled=false;status.textContent='Private room created. Copy the invite link.';}finally{create.disabled=endpoints.length===0||!creatorCapability;}});
copy.onclick=()=>void run(async()=>{if(!navigator.clipboard)throw Error('Clipboard unavailable. Use a browser with clipboard support.');await navigator.clipboard.writeText(invite);status.textContent='Invite link copied.';});
el('disconnect').onclick=()=>{client.reset();invite='';inviteField.value='';copy.disabled=true;messages.replaceChildren();status.textContent=!endpoints.length?'Automatic rooms unavailable: signaling endpoint is not configured.':creatorMode?'Disconnected. Private host diagnostics remain available.':'Disconnected.';error.textContent='';};
el<HTMLFormElement>('message-form').onsubmit=event=>{event.preventDefault();if(!message.value)return;try{client.send(target.value,message.value);add('You',message.value);message.value='';}catch(e){error.textContent=e instanceof Error?e.message:'Send failed.';}};
if(launch.kind==='invite'){if(endpoints.length===0)error.textContent='Automatic rooms unavailable: signaling endpoint is not configured.';else void run(async()=>{create.disabled=true;await client.join(launch.room,launch.capability);});}else if(launch.kind==='invalid')error.textContent='Invalid private room link.';
