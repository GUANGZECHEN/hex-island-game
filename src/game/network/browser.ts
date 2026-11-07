import { RoomClient, RoomError, type CheckpointMeta, type StoredCheckpoint } from '../../rooms';
import { HostSession } from './session';
import type { projectState } from './authority';
import { parseSessionRecovery } from './recovery';
import { isTwoPlayerQa } from './qa';

type Snapshot = ReturnType<typeof projectState>;
type Callbacks = { snapshot:(value:Snapshot,playerId:string)=>void; status:(message:string)=>void; reset?:()=>void };
export interface BrowserGame { submit:(command:Record<string,unknown>,revision:number)=>void }
type SavedRoom = {version:1;role:'host'|'guest';room:string;capability:string};

const token=()=>{const bytes=crypto.getRandomValues(new Uint8Array(32));return btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');};
const random=()=>crypto.getRandomValues(new Uint32Array(1))[0];
const el=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
const ROOM_STORAGE='hex-room-recovery-v1';
const safeGet=(key:string)=>{try{return localStorage.getItem(key)??sessionStorage.getItem(key)}catch{return null}};
const safeSet=(key:string,value:string)=>{try{localStorage.setItem(key,value)}catch{}try{sessionStorage.setItem(key,value)}catch{}};
const seatKey=(room:string)=>`hex-seat:${room}`;
const gameKey=(room:string)=>`hex-game:${room}`;
const saveRoom=(value:SavedRoom)=>safeSet(ROOM_STORAGE,JSON.stringify(value));
const loadRoom=():SavedRoom|null=>{
 try{
  const current=JSON.parse(safeGet(ROOM_STORAGE)??'null') as Partial<SavedRoom>|null;
  if(current?.version===1&&(current.role==='host'||current.role==='guest')&&typeof current.room==='string'&&typeof current.capability==='string')return current as SavedRoom;
  const legacy=JSON.parse(sessionStorage.getItem('hex-room')??'null') as {room?:unknown;capability?:unknown}|null;
  if(legacy&&typeof legacy.room==='string'&&typeof legacy.capability==='string')return {version:1,role:'guest',room:legacy.room,capability:legacy.capability};
 }catch{}
 return null;
};

/** Bind a host-only authority to authenticated Cloudflare room relays. */
export function initializeNetwork(callbacks:Callbacks):BrowserGame {
 let role:'host'|'guest'|null=null,host:HostSession|null=null,client:RoomClient,playerId='',room='',gameId='',counter=0,hostReady=false,open=false;
 let acceptedGameId='',acceptedRevision=-1,awaitingSnapshot=false,syncAttempts=0,syncTimer:number|null=null;
 let recoveryMode=false,recoveryItems:CheckpointMeta[]=[],pendingResumeId='',bootstrapCheckpointId='',lastLobbySeats:Array<{id?:unknown;connected?:unknown;ready?:unknown}>=[];
 const pendingHostMessages:Array<{id:string;text:string}>=[];
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
 const saveSyncPoint=(snapshot:Snapshot)=>{if(room)safeSet(gameKey(room),JSON.stringify({gameId:snapshot.gameId,revision:snapshot.revision}));};
 const requestSync=()=>{
  if(role!=='guest'||!open||!playerId)return;
  try{send('host',JSON.stringify({protocol:1,type:'sync'}));}catch{return;}
  if(!awaitingSnapshot)return;
  clearSyncTimer();
  if(syncAttempts>=5){status('Connected, but game state could not resynchronize. Use Rejoin previous room to retry.');return;}
  syncAttempts++;
  syncTimer=window.setTimeout(()=>requestSync(),1200);
 };

 const renderRecovery=()=>{
  const panel=el('room-recovery-panel'),options=el('room-recovery-options'),message=el('room-recovery-status');
  if(role!=='host'||!recoveryMode||!recoveryItems.length){panel.hidden=true;options.replaceChildren();return;}
  panel.hidden=false;options.replaceChildren();
  const allConnected=host?.allSeatsConnected()??false;
  message.textContent=allConnected?'All original players are connected. Choose a saved state to continue.':'Saved game found. Reconnect all original players before resuming.';
  for(const item of recoveryItems){
   const button=document.createElement('button');button.type='button';button.className='recovery-option';
   const point=item.round===0?'setup':`round ${item.round}`;
   button.textContent=`${item.latest?'Resume latest':'Resume'} · ${point} · revision ${item.revision}`;
   button.disabled=!allConnected||!!pendingResumeId;
   button.onclick=()=>{try{pendingResumeId=item.id;renderRecovery();status('Loading saved game…');client.loadCheckpoint(item.id);}catch(error){pendingResumeId='';renderRecovery();status(error instanceof Error?error.message:'Could not load saved game.');}};
   options.append(button);
  }
 };

 const showLobby=(data:unknown)=>{
  const lobby=data as {seats?:unknown;qaTwoPlayers?:unknown;recovering?:unknown};
  if(!lobby||!Array.isArray(lobby.seats)||typeof lobby.qaTwoPlayers!=='boolean')return;
  const seats=lobby.seats as Array<{id?:unknown;connected?:unknown;ready?:unknown}>;
  lastLobbySeats=seats;
  el('qa-indicator').hidden=!lobby.qaTwoPlayers;
  el('lobby').textContent=seats.map(s=>`${String(s.id)}: ${s.connected?'connected':'disconnected'}, ${s.ready?'ready':'not ready'}`).join(' | ');
  if(role==='guest'&&lobby.recovering===true&&playerId){
   clearSyncTimer();syncAttempts=0;setSynchronizing(true,`Seat restored as ${playerId}. Waiting for host to resume saved game.`);
   el('room-ready').hidden=true;
  }
  if(role==='host'&&host){
   if(recoveryMode||lobby.recovering===true){el('room-ready').hidden=true;el('room-start').hidden=true;renderRecovery();return;}
   const validCount=lobby.qaTwoPlayers?seats.length===2:seats.length>=3&&seats.length<=4;
   const allReady=validCount&&seats.every(s=>s.connected===true&&s.ready===true);
   const start=el<HTMLButtonElement>('room-start');
   start.disabled=!allReady;
   if(allReady&&el('network-status').textContent?.includes('required'))status('All players are ready. You can start the game.');
  }
 };
 const publish=(event:unknown)=>{
  const x=event as {type:string;lobby?:unknown;data?:unknown;revision?:unknown;round?:unknown;replace?:unknown};
  if(x.type==='lobby')showLobby(x.lobby);
  if(x.type==='snapshot'&&x.data){const snapshot=x.data as Snapshot;gameId=snapshot.gameId;callbacks.snapshot(snapshot,'Player 1');}
  if(x.type==='checkpoint'&&x.data&&Number.isSafeInteger(x.revision)&&Number.isSafeInteger(x.round)&&typeof x.replace==='boolean'){
   try{client.saveCheckpoint(JSON.stringify(x.data),Number(x.revision),Number(x.round),x.replace);}catch{status('Game continues, but the recovery checkpoint could not be saved.');}
  }
 };
 const send=(peer:string,data:string)=>client.send(peer,data);
 const flushPendingHostMessages=()=>{if(!host)return;for(const item of pendingHostMessages.splice(0))host.receive(item.id,item.text);};

 const handleCheckpoint=(item:StoredCheckpoint)=>{
  let recovery;
  try{recovery=parseSessionRecovery(JSON.parse(item.data));}catch{pendingResumeId='';status('Saved game data is invalid.');renderRecovery();return;}
  if(!host&&bootstrapCheckpointId===item.id){
   recoveryMode=true;
   host=HostSession.fromRecovery(send,publish,token,random,recovery);
   bootstrapCheckpointId='';
   flushPendingHostMessages();
   el('room-ready').hidden=true;el('room-start').hidden=true;
   status('Saved game found. Reconnect all original players, then choose a checkpoint.');
   renderRecovery();
   return;
  }
  if(host&&pendingResumeId===item.id){
   try{
    callbacks.reset?.();acceptedGameId='';acceptedRevision=-1;networkResetForResume();
    host.resume(recovery);recoveryMode=false;pendingResumeId='';el('room-recovery-panel').hidden=true;
    status('Saved game resumed.');
   }catch(error){pendingResumeId='';status(error instanceof Error?error.message:'Could not resume saved game.');renderRecovery();}
  }
 };
 const networkResetForResume=()=>{clearSyncTimer();syncAttempts=0;setSynchronizing(false);};

 client=new RoomClient(allowed?endpoints:['http://127.0.0.1:1'],{
  status,error:status,
  checkpoints:items=>{
   if(role!=='host')return;
   recoveryItems=[...items].sort((a,b)=>Number(b.latest)-Number(a.latest)||b.savedAt-a.savedAt);
   if(!recoveryItems.length){recoveryMode=false;status('No saved game was found for this room.');renderRecovery();return;}
   recoveryMode=true;renderRecovery();
   if(!host){bootstrapCheckpointId=recoveryItems.find(item=>item.latest)?.id??recoveryItems[0].id;client.loadCheckpoint(bootstrapCheckpointId);}
  },
  checkpoint:handleCheckpoint,
  peer:(id,_status,isOpen)=>{
   if(!isOpen)status(`Connecting peer: ${_status}`);
   if(role==='guest'&&id==='host'){
    if(isOpen&&!open){
     open=true;
     if(acceptedRevision>=0)setSynchronizing(true,'Room connection restored. Synchronizing game state…');
     const credential=safeGet(seatKey(room))??'';
     send('host',JSON.stringify({protocol:1,type:'hello',token:credential}));
    }else if(!isOpen&&open){
     open=false;clearSyncTimer();
     if(acceptedRevision>=0)setSynchronizing(true,'Host connection interrupted. Automatic reconnect is in progress.');
     else status('Host connection interrupted. Automatic reconnect is in progress.');
    }
   }
   if(role==='host'&&!isOpen)host?.disconnect(id);
  },
  remove:id=>{
   if(role==='host')host?.disconnect(id);
   else if(id==='host'){open=false;clearSyncTimer();if(acceptedRevision>=0)setSynchronizing(true,'Host connection interrupted. Automatic reconnect is in progress.');else status('Host connection interrupted. Automatic reconnect is in progress.');}
  },
  message:(id,text)=>{
   if(role==='host'){if(host)host.receive(id,text);else pendingHostMessages.push({id,text});return;}
   if(role!=='guest'||id!=='host'||text.length>16384)return;
   let message:{protocol?:number;type?:string;data?:unknown};try{message=JSON.parse(text);}catch{return;}
   if(message.protocol!==1)return;
   if(message.type==='seat'){
    const value=message.data as {id?:unknown;token?:unknown};
    if(typeof value?.id==='string'&&typeof value.token==='string'&&/^[A-Za-z0-9_-]{43}$/.test(value.token)){
     playerId=value.id;safeSet(seatKey(room),value.token);
     if(awaitingSnapshot)status(`Seat restored as ${playerId}. Synchronizing game state…`);
     else status(`Connected as ${playerId}.`);
     requestSync();
    }
   }
   else if(message.type==='resume'){
    const value=message.data as {gameId?:unknown;revision?:unknown};
    if(typeof value?.gameId==='string'&&Number.isSafeInteger(value.revision)){
     callbacks.reset?.();acceptedGameId=value.gameId;acceptedRevision=-1;gameId=value.gameId;setSynchronizing(true,'Saved game selected. Restoring game state…');
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
  }
 });

 if(isTwoPlayerQa(location.search)){
  const qaWindow=window as Window & {__hexQaDropRoomConnection?:()=>void;__hexQaReconnectCount?:()=>number};
  qaWindow.__hexQaDropRoomConnection=()=>client.qaDropConnection();
  qaWindow.__hexQaReconnectCount=()=>client.qaReconnects();
 }

 const clearRecoveryUi=()=>{recoveryMode=false;recoveryItems=[];pendingResumeId='';bootstrapCheckpointId='';el('room-recovery-panel').hidden=true;el('room-recovery-options').replaceChildren();};
 el<HTMLButtonElement>('room-create').disabled=!allowed;
 el('room-create').onclick=async()=>{
  try{
   const mapSeed=el<HTMLInputElement>('room-seed');if(!mapSeed.value||!mapSeed.validity.valid)throw new Error('Choose a valid board map seed.');
   clearRecoveryUi();role='host';playerId='Player 1';host=new HostSession(send,publish,token,random,{qaTwoPlayers:isTwoPlayerQa(location.search)});
   const invite=await client.create();const info=client.connectionInfo();if(!info||info.role!=='host')throw new Error('Host room capability was unavailable.');
   room=info.room;saveRoom({version:1,role:'host',room:info.room,capability:info.token});
   hostReady=false;el('room-ready').textContent='Mark ready';el<HTMLInputElement>('room-invite').value=invite;el('room-ready').hidden=false;el('room-start').hidden=false;el<HTMLButtonElement>('room-start').disabled=true;host.setHostReady(false);status('Room created. Share the invitation privately.');
  }catch(error){status(error instanceof RoomError ? error.message : error instanceof Error?error.message:'Signaling WebSocket connection or authentication failed.');}
 };
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
  clearRecoveryUi();role='guest';el('room-map-controls').hidden=true;room=roomId;open=false;hostReady=false;playerId='';clearSyncTimer();syncAttempts=0;
  saveRoom({version:1,role:'guest',room:roomId,capability});
  if(!rejoining){acceptedGameId='';acceptedRevision=-1;gameId='';setSynchronizing(false);}
  else{
   try{
    const saved=JSON.parse(safeGet(gameKey(roomId))??'null') as {gameId?:unknown;revision?:unknown}|null;
    if(saved&&typeof saved.gameId==='string'&&Number.isSafeInteger(saved.revision)){acceptedGameId=saved.gameId;acceptedRevision=Number(saved.revision);}
   }catch{}
   if(acceptedRevision>=0)setSynchronizing(true,'Rejoining room. Synchronizing game state…');
  }
  el('room-ready').textContent='Mark ready';el('room-ready').hidden=false;el('room-start').hidden=true;
  try{await client.join(roomId,capability);}catch{clearSyncTimer();status('Could not join the room.');}
 }

 async function restoreHost(roomId:string,capability:string){
  role='host';room=roomId;playerId='Player 1';open=false;hostReady=false;host=null;pendingHostMessages.splice(0);recoveryMode=true;recoveryItems=[];pendingResumeId='';bootstrapCheckpointId='';callbacks.reset?.();
  el('room-map-controls').hidden=false;el('room-ready').hidden=true;el('room-start').hidden=true;el('room-recovery-panel').hidden=false;el('room-recovery-status').textContent='Reconnecting hosted room and looking for saved games…';el('room-recovery-options').replaceChildren();
  try{await client.restoreHost(roomId,capability);saveRoom({version:1,role:'host',room:roomId,capability});status('Hosted room reconnected. Looking for saved games…');client.requestCheckpoints();}
  catch{status('Could not rejoin the hosted room.');}
 }

 el('qa-indicator').hidden=!isTwoPlayerQa(location.search);
 const params=new URLSearchParams(location.hash.slice(1)),fragment=params.get('join');if(fragment){history.replaceState(null,'',location.pathname+location.search);const parts=fragment.split('.');if(parts.length===2&&parts.every(x=>/^[A-Za-z0-9_-]{43}$/.test(x)))void join(parts[0],parts[1]);else status('Invalid invitation.');}
 el('room-reconnect').onclick=()=>{const saved=loadRoom();if(!saved){status('No room to rejoin.');return;}if(saved.role==='host')void restoreHost(saved.room,saved.capability);else void join(saved.room,saved.capability,true);};
 if(!allowed)status('Automatic rooms unavailable: signaling endpoint is not configured.');
 return {submit(command,revision){if(awaitingSnapshot)throw new Error('Game state is synchronizing.');if(!gameId||!playerId)throw new Error('Game is not connected.');const commandId=`${Date.now().toString(36)}-${++counter}-${token().slice(0,12)}`;if(role==='host'){const result=host!.submit(command,commandId,revision);if(!result.ok)throw new Error(`Command rejected: ${result.code}`);}else if(role==='guest'){send('host',JSON.stringify({protocol:1,type:'command',command:JSON.stringify({protocol:1,gameId,revision,commandId,sender:playerId,command:{...command,playerId}})}));}else throw new Error('Not in a room.');}};
}
