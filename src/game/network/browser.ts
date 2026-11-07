import { RoomClient, RoomError } from '../../rooms';
import { HostSession } from './session';
import type { projectState } from './authority';
import { isTwoPlayerQa } from './qa';

type Snapshot = ReturnType<typeof projectState>;
type Callbacks = { snapshot:(value:Snapshot,playerId:string)=>void; status:(message:string)=>void };
export interface BrowserGame { submit:(command:Record<string,unknown>,revision:number)=>void }
const token=()=>{const bytes=crypto.getRandomValues(new Uint8Array(32));return btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');};
const random=()=>crypto.getRandomValues(new Uint32Array(1))[0];
const el=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
/** Bind a host-only authority to authenticated Cloudflare room relays. */
export function initializeNetwork(callbacks:Callbacks):BrowserGame {
 let role:'host'|'guest'|null=null,host:HostSession|null=null,client:RoomClient,playerId='',room='',gameId='',counter=0,hostReady=false,open=false;
 let acceptedGameId='',acceptedRevision=-1,awaitingSnapshot=false,syncAttempts=0,syncTimer:number|null=null;
 const rawEndpoints=((import.meta.env.VITE_SIGNALING_URLS as string|undefined)??(import.meta.env.VITE_SIGNALING_URL as string|undefined)??'')
  .split(',').map(value=>value.trim().replace(/\/$/,'')).filter(Boolean);
 const endpoints=rawEndpoints.filter(value=>{try{const u=new URL(value);return !u.username&&!u.password&&!u.search&&!u.hash&&(u.protocol==='https:'||(u.protocol==='http:'&&['localhost','127.0.0.1'].includes(u.hostname)));}catch{return false;}});
 const allowed=endpoints.length>0;
 const status=(s:string)=>{el('network-status').textContent=s;callbacks.status(s);};
 const clearSyncTimer=()=>{if(syncTimer!==null){window.clearTimeout(syncTimer);syncTimer=null;}};
 const setSynchronizing=(value:boolean,message?:string)=>{
  awaitingSnapshot=value;
  document.body.classList.toggle('network-resyncing',value);
  el('game').setAttribute('aria-busy',String(value));
  if(message)status(message);
 };
 const syncKey=()=>room?`hex-game:${room}`:'';
 const saveSyncPoint=(snapshot:Snapshot)=>{const key=syncKey();if(key)sessionStorage.setItem(key,JSON.stringify({gameId:snapshot.gameId,revision:snapshot.revision}));};
 const requestSync=()=>{
  if(role!=='guest'||!open||!playerId)return;
  try{send('host',JSON.stringify({protocol:1,type:'sync'}));}catch{return;}
  if(!awaitingSnapshot)return;
  clearSyncTimer();
  if(syncAttempts>=5){status('Connected, but game state could not resynchronize. Use Rejoin previous room to retry.');return;}
  syncAttempts++;
  syncTimer=window.setTimeout(()=>requestSync(),1200);
 };
 const showLobby=(data:unknown)=>{
  const lobby=data as {seats?:unknown;qaTwoPlayers?:unknown};
  if(!lobby||!Array.isArray(lobby.seats)||typeof lobby.qaTwoPlayers!=='boolean')return;
  const seats=lobby.seats as Array<{id?:unknown;connected?:unknown;ready?:unknown}>;
  el('qa-indicator').hidden=!lobby.qaTwoPlayers;
  el('lobby').textContent=seats.map(s=>`${String(s.id)}: ${s.connected?'connected':'disconnected'}, ${s.ready?'ready':'not ready'}`).join(' | ');
  if(role==='host'&&host){
   const validCount=lobby.qaTwoPlayers?seats.length===2:seats.length>=3&&seats.length<=4;
   const allReady=validCount&&seats.every(s=>s.connected===true&&s.ready===true);
   const start=el<HTMLButtonElement>('room-start');
   start.disabled=!allReady;
   if(allReady&&el('network-status').textContent?.includes('required'))status('All players are ready. You can start the game.');
  }
 };
 const publish=(event:unknown)=>{const x=event as {type:string;lobby?:unknown;data?:Snapshot};if(x.type==='lobby')showLobby(x.lobby);if(x.type==='snapshot'&&x.data){gameId=x.data.gameId;callbacks.snapshot(x.data,'Player 1');}};
 const send=(peer:string,data:string)=>client.send(peer,data);
 client=new RoomClient(allowed?endpoints:['http://127.0.0.1:1'],{status,error:status,peer:(id,_status,isOpen)=>{
  if(!isOpen)status(`Connecting peer: ${_status}`);
  if(role==='guest'&&id==='host'){
   if(isOpen&&!open){
    open=true;
    if(acceptedRevision>=0)setSynchronizing(true,'Room connection restored. Synchronizing game state…');
    const credential=sessionStorage.getItem(`hex-seat:${room}`)??'';
    send('host',JSON.stringify({protocol:1,type:'hello',token:credential}));
   }else if(!isOpen&&open){
    open=false;clearSyncTimer();
    if(acceptedRevision>=0)setSynchronizing(true,'Host connection interrupted. Automatic reconnect is in progress.');
    else status('Host connection interrupted. Automatic reconnect is in progress.');
   }
  }
  if(role==='host'&&!isOpen)host?.disconnect(id);
 },remove:id=>{if(role==='host')host?.disconnect(id);else if(id==='host'){open=false;clearSyncTimer();if(acceptedRevision>=0)setSynchronizing(true,'Host connection interrupted. Automatic reconnect is in progress.');else status('Host connection interrupted. Automatic reconnect is in progress.');}},message:(id,text)=>{
  if(role==='host'){host?.receive(id,text);return;}
  if(role!=='guest'||id!=='host'||text.length>16384)return;
  let message:{protocol?:number;type?:string;data?:unknown};try{message=JSON.parse(text);}catch{return;}
  if(message.protocol!==1)return;
  if(message.type==='seat'){
   const value=message.data as {id?:unknown;token?:unknown};
   if(typeof value?.id==='string'&&typeof value.token==='string'&&/^[A-Za-z0-9_-]{43}$/.test(value.token)){
    playerId=value.id;sessionStorage.setItem(`hex-seat:${room}`,value.token);
    if(awaitingSnapshot)status(`Seat restored as ${playerId}. Synchronizing game state…`);
    else status(`Connected as ${playerId}.`);
    requestSync();
   }
  }
  else if(message.type==='lobby')showLobby(message.data);
  else if(message.type==='snapshot'&&playerId){
   const snapshot=message.data as Snapshot;
   if(snapshot?.protocol===1&&typeof snapshot.gameId==='string'&&Number.isSafeInteger(snapshot.revision)){
    if(acceptedGameId&&snapshot.gameId!==acceptedGameId){if(awaitingSnapshot)requestSync();return;}
    if(snapshot.revision<acceptedRevision){if(awaitingSnapshot)requestSync();return;}
    acceptedGameId=snapshot.gameId;acceptedRevision=snapshot.revision;gameId=snapshot.gameId;saveSyncPoint(snapshot);
    clearSyncTimer();syncAttempts=0;setSynchronizing(false);callbacks.snapshot(snapshot,playerId);status(`Connected as ${playerId}.`);
   }
  }
  else if(message.type==='error'||message.type==='rejection')status(`Room action rejected: ${String((message.data as {code?:string})?.code??message.data)}`);
 }});
 if(isTwoPlayerQa(location.search)){
  const qaWindow=window as Window & {__hexQaDropRoomConnection?:()=>void;__hexQaReconnectCount?:()=>number};
  qaWindow.__hexQaDropRoomConnection=()=>client.qaDropConnection();
  qaWindow.__hexQaReconnectCount=()=>client.qaReconnects();
 }
 el<HTMLButtonElement>('room-create').disabled=!allowed;
 el('room-create').onclick=async()=>{try{const mapSeed=el<HTMLInputElement>('room-seed');if(!mapSeed.value||!mapSeed.validity.valid)throw new Error('Choose a valid board map seed.');el('room-map-controls').hidden=false;role='host';playerId='Player 1';host=new HostSession(send,publish,token,random,{qaTwoPlayers:isTwoPlayerQa(location.search)});const invite=await client.create();hostReady=false;el('room-ready').textContent='Mark ready';el<HTMLInputElement>('room-invite').value=invite;el('room-ready').hidden=false;el('room-start').hidden=false;el<HTMLButtonElement>('room-start').disabled=true;host.setHostReady(false);status('Room created. Share the invitation privately.');}catch(error){status(error instanceof RoomError ? error.message : 'Signaling WebSocket connection or authentication failed.');}};
 el('room-ready').onclick=()=>{try{const nextReady=!hostReady;if(role==='host'&&host)host.setHostReady(nextReady);else if(role==='guest')send('host',JSON.stringify({protocol:1,type:'ready',ready:nextReady}));else throw new Error('No room.');hostReady=nextReady;el('room-ready').textContent=hostReady?'Mark not ready':'Mark ready';}catch{status('Could not update readiness.');}};
 el('room-start').onclick=()=>{
  try{
   const seed=el<HTMLInputElement>('room-seed');
   if(!seed.value||!seed.validity.valid)throw new Error('Enter a valid board seed.');
   if(role!=='host'||!host)throw new Error('Only the host can start the game.');
   host.start(seed.valueAsNumber);
   el('room-ready').hidden=true;
   el('room-start').hidden=true;
   status('Game started. Continue on the board below.');
   requestAnimationFrame(()=>el('game').scrollIntoView({behavior:'smooth',block:'start'}));
  }catch(e){status(e instanceof Error?e.message:'Could not start.');}
 };
 async function join(roomId:string,capability:string,rejoining=false){
  role='guest';el('room-map-controls').hidden=true;room=roomId;open=false;hostReady=false;playerId='';clearSyncTimer();syncAttempts=0;
  if(!rejoining){acceptedGameId='';acceptedRevision=-1;gameId='';setSynchronizing(false);}
  else{
   try{
    const saved=JSON.parse(sessionStorage.getItem(`hex-game:${roomId}`)??'null') as {gameId?:unknown;revision?:unknown}|null;
    if(saved&&typeof saved.gameId==='string'&&Number.isSafeInteger(saved.revision)){acceptedGameId=saved.gameId;acceptedRevision=Number(saved.revision);}
   }catch{}
   if(acceptedRevision>=0)setSynchronizing(true,'Rejoining room. Synchronizing game state…');
  }
  el('room-ready').textContent='Mark ready';el('room-ready').hidden=false;el('room-start').hidden=true;sessionStorage.setItem('hex-room',JSON.stringify({room:roomId,capability}));
  try{await client.join(roomId,capability);}catch{clearSyncTimer();status('Could not join the room.');}
 }
 el('qa-indicator').hidden=!isTwoPlayerQa(location.search);
 const params=new URLSearchParams(location.hash.slice(1)),fragment=params.get('join');if(fragment){history.replaceState(null,'',location.pathname+location.search);const parts=fragment.split('.');if(parts.length===2&&parts.every(x=>/^[A-Za-z0-9_-]{43}$/.test(x)))void join(parts[0],parts[1]);else status('Invalid invitation.');}
 el('room-reconnect').onclick=()=>{try{const saved=JSON.parse(sessionStorage.getItem('hex-room')??'null') as {room:string;capability:string}|null;if(!saved)throw new Error('No room to rejoin.');void join(saved.room,saved.capability,true);}catch(e){status(e instanceof Error?e.message:'Could not rejoin.');}};
 if(!allowed)status('Automatic rooms unavailable: signaling endpoint is not configured.');
 return {submit(command,revision){if(awaitingSnapshot)throw new Error('Game state is synchronizing.');if(!gameId||!playerId)throw new Error('Game is not connected.');const commandId=`${Date.now().toString(36)}-${++counter}-${token().slice(0,12)}`;if(role==='host'){const result=host!.submit(command,commandId,revision);if(!result.ok)throw new Error(`Command rejected: ${result.code}`);}else if(role==='guest'){send('host',JSON.stringify({protocol:1,type:'command',command:JSON.stringify({protocol:1,gameId,revision,commandId,sender:playerId,command:{...command,playerId}})}));}else throw new Error('Not in a room.');}};
}
