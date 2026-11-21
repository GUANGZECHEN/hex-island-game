import { requestRoom, RoomError } from './room-request';
import { reconnectDelay } from './reconnect-policy';
export { RoomError } from './room-request';

type Role = 'host' | 'guest';
export type CheckpointMeta = {id:string;revision:number;round:number;savedAt:number;latest:boolean};
export type StoredCheckpoint = Omit<CheckpointMeta,'latest'> & {data:string};
type Events = {
  status: (s:string)=>void;
  error: (s:string)=>void;
  peer: (id:string, status:string, open:boolean)=>void;
  remove: (id:string)=>void;
  removeMany?: (ids:string[])=>void;
  message: (id:string,text:string)=>void;
  checkpoints?: (items:CheckpointMeta[])=>void;
  checkpoint?: (item:StoredCheckpoint)=>void;
};
type Connection = { room:string; token:string; role:Role; endpointIndex:number };

const HEARTBEAT_INTERVAL = 25_000;
const HEARTBEAT_TIMEOUT = 20_000;
const HANDSHAKE_TIMEOUT = 15_000;
const MAX_RELAY_DATA = 16384;
const MAX_CHECKPOINT_DATA = 49152;
const validPeerId = (value:unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);
const validRoomToken=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z0-9_-]{43}$/.test(value);
class RoomAttemptError extends RoomError {
  constructor(message:string, readonly retryable:boolean){super(message);}
}
const joinError=(code:unknown):RoomAttemptError=>{
  if(code==='invalid')return new RoomAttemptError('Invitation is invalid.',false);
  if(code==='expired')return new RoomAttemptError('This room has expired.',false);
  if(code==='room-full')return new RoomAttemptError('Room is temporarily full.',true);
  if(code==='host-unavailable')return new RoomAttemptError('Host is reconnecting.',true);
  return new RoomAttemptError('Room connection was temporarily unavailable.',true);
};
const validMeta=(value:unknown):value is CheckpointMeta=>{
  const x=value as Partial<CheckpointMeta>|null;
  return !!x&&typeof x.id==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(x.id)&&Number.isSafeInteger(x.revision)&&Number(x.revision)>=0&&Number.isSafeInteger(x.round)&&Number(x.round)>=0&&Number.isSafeInteger(x.savedAt)&&Number(x.savedAt)>0&&typeof x.latest==='boolean';
};

export class RoomClient {
  private ws: WebSocket | null = null;
  private peers = new Set<string>();
  private generation = 0;
  private connection: Connection | null = null;
  private reconnectTimer: number | null = null;
  private reconnectAttempt = 0;
  private qaReconnectCount = 0;
  private cancelOpen: (()=>void) | null = null;
  private wakeConnection: (()=>void) | null = null;
  private listening = false;
  private cancelJoinDelay: (()=>void) | null = null;
  private createAbort: AbortController | null = null;
  private readonly wake = ()=>{
    if(!this.connection || document.visibilityState==='hidden')return;
    if(this.wakeConnection){this.wakeConnection();return;}
    if(this.reconnectTimer!==null){this.clearReconnect();this.reconnectAttempt=Math.max(0,this.reconnectAttempt-1);this.scheduleReconnect(this.generation,0);}
  };
  private listen():void {
    if(this.listening)return;
    this.listening=true;
    window.addEventListener('online',this.wake);
    window.addEventListener('pageshow',this.wake);
    document.addEventListener('visibilitychange',this.wake);
  }
  private unlisten():void {
    if(!this.listening)return;
    this.listening=false;
    window.removeEventListener('online',this.wake);
    window.removeEventListener('pageshow',this.wake);
    document.removeEventListener('visibilitychange',this.wake);
  }
  private reportCallbackFailure():void {try{this.events.error('A room connection update could not be displayed.');}catch{}}
  private removeAll():void {
    const ids=[...this.peers];this.peers.clear();
    if(!ids.length)return;
    if(this.events.removeMany){try{this.events.removeMany(ids);}catch{this.reportCallbackFailure();}return;}
    for(const id of ids){try{this.events.remove(id);}catch{this.reportCallbackFailure();}}
  }

  constructor(private endpoints:string[],private events:Events) {
    if(endpoints.length===0)throw new RoomError('Signaling service is unreachable.');
  }

  async create(): Promise<string> {
    this.reset();
    const generation=this.generation;
    const abort=new AbortController();this.createAbort=abort;
    let roomData: Awaited<ReturnType<typeof requestRoom>> | null=null;
    let usedIndex=0;
    let lastError:unknown;

    for(let i=0;i<this.endpoints.length;i++){
      try{
        roomData=await requestRoom(this.endpoints[i],fetch,abort.signal);
        usedIndex=i;
        break;
      }catch(error){
        lastError=error;
        if(generation!==this.generation)break;
      }
    }
    if(this.createAbort===abort)this.createAbort=null;
    if(generation!==this.generation)throw Error('Session cancelled.');

    if(!roomData)throw lastError instanceof Error?lastError:new RoomError('Signaling service is unreachable.');
    if(generation!==this.generation)throw Error('Session cancelled.');

    this.connection={room:roomData.room,token:roomData.host,role:'host',endpointIndex:usedIndex};
    await this.openInitial(this.connection,generation);

    const link=new URL(location.href);
    link.hash=`join=${roomData.room}.${roomData.guest}`;
    return link.toString();
  }

  async join(room:string,token:string):Promise<void> {
    if(!validRoomToken(room)||!validRoomToken(token))throw new RoomError('Invalid room capability.');
    this.reset();
    const generation=this.generation;
    this.connection={room,token,role:'guest',endpointIndex:0};
    let attempt=0,lastError:unknown;
    while(generation===this.generation && attempt<10){
      try{
        await this.openInitial(this.connection,generation);
        return;
      }catch(error){
        lastError=error;
        if(generation!==this.generation)throw new RoomError('Room join was cancelled.');
        if(error instanceof RoomAttemptError && !error.retryable)throw error;
        attempt++;
        if(attempt>=10)break;
        const delay=reconnectDelay(attempt);
        this.events.status(`Room connection is temporarily unavailable. Retrying in ${Math.ceil(delay/1000)}s…`);
        await new Promise<void>(resolve=>{
          const timer=window.setTimeout(()=>{this.cancelJoinDelay=null;resolve();},delay);
          this.cancelJoinDelay=()=>{window.clearTimeout(timer);this.cancelJoinDelay=null;resolve();};
        });
      }
    }
    if(generation!==this.generation)throw new RoomError('Room join was cancelled.');
    if(lastError instanceof RoomError)throw new RoomError(`Could not join after automatic retries. ${lastError.message}`);
    throw new RoomError('Could not join after automatic retries.');
  }

  async restoreHost(room:string,token:string):Promise<void> {
    if(!validRoomToken(room)||!validRoomToken(token))throw new RoomError('Invalid host recovery capability.');
    this.reset();
    const generation=this.generation;
    this.connection={room,token,role:'host',endpointIndex:0};
    await this.openInitial(this.connection,generation);
  }

  connectionInfo():Readonly<Omit<Connection,'endpointIndex'>>|null {
    return this.connection?{room:this.connection.room,token:this.connection.token,role:this.connection.role}:null;
  }

  private async openInitial(connection:Connection,generation:number):Promise<void> {
    let lastError:unknown;
    const start=connection.endpointIndex;
    for(let offset=0;offset<this.endpoints.length;offset++){
      if(generation!==this.generation)throw new RoomError('Session cancelled.');
      connection.endpointIndex=(start+offset)%this.endpoints.length;
      try{
        await this.open(connection,generation,false);
        return;
      }catch(error){
        if(generation!==this.generation)throw new RoomError('Session cancelled.');
        lastError=error;
      }
    }
    throw lastError instanceof Error?lastError:new RoomError('Room WebSocket connection or authentication failed.');
  }

  private ensurePeer(id:string):void {
    if(this.peers.has(id))return;
    this.peers.add(id);
    this.events.peer(id,'Cloudflare relay connected',true);
  }

  private clearReconnect():void {
    if(this.reconnectTimer!==null){
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer=null;
    }
  }

  private scheduleReconnect(generation:number,overrideDelay?:number):void {
    if(generation!==this.generation || !this.connection || this.reconnectTimer!==null)return;

    this.reconnectAttempt=Math.min(this.reconnectAttempt+1,Number.MAX_SAFE_INTEGER);
    const attempt=this.reconnectAttempt;
    const delay=overrideDelay??reconnectDelay(attempt);
    const connection=this.connection;
    connection.endpointIndex=(connection.endpointIndex+1)%this.endpoints.length;
    const seconds=Math.ceil(delay/1000);
    const phase=attempt<=10?`fast retry ${attempt}/10`:attempt<=30?'background retry':'long-term retry';
    try{this.events.status(`Connection interrupted. Automatic ${phase} in ${seconds}s…`);}catch{}

    this.reconnectTimer=window.setTimeout(()=>{
      this.reconnectTimer=null;
      if(generation!==this.generation || !this.connection)return;
      void this.open(this.connection,generation,true).catch(()=>{
        if(generation===this.generation)this.scheduleReconnect(generation);
      });
    },delay);
  }

  private open(connection:Connection,generation:number,reconnecting:boolean):Promise<void> {
    this.listen();
    try{this.events.status(reconnecting?'Reconnecting to Cloudflare room…':'Connecting to Cloudflare room…');}catch{this.reportCallbackFailure();}
    const endpoint=this.endpoints[connection.endpointIndex];
    const url=new URL(`${endpoint}/rooms/${connection.room}/socket`);
    url.protocol=url.protocol==='https:'?'wss:':'ws:';

    let ws:WebSocket;
    try{ws=new WebSocket(url);}catch{return Promise.reject(new RoomAttemptError('Room WebSocket connection or authentication failed.',true));}
    this.ws=ws;

    return new Promise((resolve,reject)=>{
      let settled=false;
      let authenticated=false;
      let heartbeat=false, nextPing=0, pendingPing:number|null=null;
      let handshakeTimer:number|null=null, heartbeatTimer:number|null=null;
      const clearTimers=()=>{
        if(handshakeTimer!==null)window.clearTimeout(handshakeTimer);
        if(heartbeatTimer!==null)window.clearTimeout(heartbeatTimer);
        handshakeTimer=null;heartbeatTimer=null;
      };
      const active=()=>this.ws===ws && generation===this.generation;
      const finish=(retry:boolean)=>{
        if(!active())return;
        this.ws=null;clearTimers();this.cancelOpen=null;this.wakeConnection=null;
        try{ws.close();}catch{}
        try{this.removeAll();}finally{
          if(!authenticated)rejectInitial('Room WebSocket connection or authentication failed.');
          else if(retry)this.scheduleReconnect(generation);
        }
      };
      this.cancelOpen=()=>finish(false);
      const ping=()=>{
        if(!active()||!authenticated||!heartbeat)return;
        if(heartbeatTimer!==null)window.clearTimeout(heartbeatTimer);
        const id=nextPing;nextPing=(nextPing+1)%Number.MAX_SAFE_INTEGER;pendingPing=id;
        try{ws.send(JSON.stringify({type:'ping',id}));}catch{finish(true);return;}
        heartbeatTimer=window.setTimeout(()=>{
          if(document.visibilityState==='hidden'){pendingPing=null;heartbeatTimer=window.setTimeout(ping,HEARTBEAT_INTERVAL);return;}
          if(pendingPing===id)finish(true);
        },HEARTBEAT_TIMEOUT);
      };
      const startHandshakeTimer=()=>{
        if(handshakeTimer!==null)window.clearTimeout(handshakeTimer);
        handshakeTimer=window.setTimeout(()=>{
          if(document.visibilityState==='hidden'){startHandshakeTimer();return;}
          finish(true);
        },HANDSHAKE_TIMEOUT);
      };
      this.wakeConnection=()=>{if(!authenticated)startHandshakeTimer();else if(heartbeat){pendingPing=null;ping();}};
      startHandshakeTimer();

      const rejectInitial=(message:string,retryable=true)=>{
        if(settled)return;
        settled=true;
        reject(new RoomAttemptError(message,retryable));
      };
      const closeForRetry=()=>{
        finish(true);
      };

      ws.onmessage=(event)=>{
        if(this.ws!==ws || generation!==this.generation)return;
        let msg:{type?:unknown;id?:unknown;from?:unknown;role?:unknown;code?:unknown;data?:unknown;checkpoints?:unknown;checkpoint?:unknown;heartbeat?:unknown};
        try{msg=JSON.parse(String(event.data));}
        catch{
          if(!authenticated)rejectInitial('Room WebSocket returned an invalid message.');
          else this.events.error('Room WebSocket returned an invalid message.');
          closeForRetry();
          return;
        }

        if(msg.type==='authenticate'){
          try{ws.send(JSON.stringify({type:'auth',role:connection.role,token:connection.token}));}
          catch{
            rejectInitial('Room WebSocket connection or authentication failed.');
            closeForRetry();
          }
          return;
        }

        if(msg.type==='ready' && !authenticated){
          authenticated=true;
          if(handshakeTimer!==null)window.clearTimeout(handshakeTimer);
          handshakeTimer=null;
          heartbeat=msg.heartbeat===true;
          if(heartbeat)heartbeatTimer=window.setTimeout(ping,HEARTBEAT_INTERVAL);
          settled=true;
          this.reconnectAttempt=0;
          if(reconnecting)this.qaReconnectCount++;
          this.clearReconnect();
          resolve();
          try{
            if(connection.role==='guest')this.ensurePeer('host');
            this.events.status(reconnecting?'Cloudflare room reconnected.':'Cloudflare room connected.');
          }catch{this.reportCallbackFailure();}
          return;
        }

        if(msg.type==='pong' && authenticated && heartbeat && Number.isSafeInteger(msg.id) && Number(msg.id)>=0){
          if(msg.id===pendingPing){pendingPing=null;if(heartbeatTimer!==null)window.clearTimeout(heartbeatTimer);heartbeatTimer=window.setTimeout(ping,HEARTBEAT_INTERVAL);}
          return;
        }

        if(msg.type==='join' && connection.role==='host' && validPeerId(msg.id) && msg.id!=='host'){
          this.ensurePeer(msg.id);
          return;
        }

        if(msg.type==='leave' && connection.role==='host' && validPeerId(msg.id)){
          this.remove(msg.id);
          return;
        }

        if(msg.type==='checkpoint-list'&&connection.role==='host'&&Array.isArray(msg.checkpoints)&&msg.checkpoints.every(validMeta)){
          this.events.checkpoints?.(msg.checkpoints as CheckpointMeta[]);
          return;
        }

        if(msg.type==='checkpoint-data'&&connection.role==='host'){
          const value=msg.checkpoint as Partial<StoredCheckpoint>|null;
          if(value&&typeof value.id==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(value.id)&&Number.isSafeInteger(value.revision)&&Number.isSafeInteger(value.round)&&Number.isSafeInteger(value.savedAt)&&typeof value.data==='string'&&new TextEncoder().encode(value.data).length<=MAX_CHECKPOINT_DATA){
            this.events.checkpoint?.(value as StoredCheckpoint);
            return;
          }
          this.events.error('Saved game data was invalid.');
          return;
        }

        if((msg.type==='checkpoint-saved'||msg.type==='checkpoint-cleared')&&connection.role==='host')return;
        if(msg.type==='checkpoint-error'&&connection.role==='host'){this.events.error('Saved game checkpoint could not be processed.');return;}

        if(msg.type==='relay' && validPeerId(msg.from) && typeof msg.data==='string'){
          if(new TextEncoder().encode(msg.data).length>MAX_RELAY_DATA){
            this.events.error('Room relay message exceeded the safe size limit.');
            closeForRetry();
            return;
          }
          if(connection.role==='guest' && msg.from!=='host'){
            this.events.error('Room relay source was invalid.');
            closeForRetry();
            return;
          }
          if(connection.role==='host' && msg.from==='host'){
            this.events.error('Room relay source was invalid.');
            closeForRetry();
            return;
          }
          this.ensurePeer(msg.from);
          this.events.message(msg.from,msg.data);
          return;
        }

        if(msg.type==='error'){
          if(!authenticated){
            const failure=joinError(msg.code);
            rejectInitial(failure.message,failure.retryable);
          } else this.events.error('Room WebSocket connection was interrupted.');
          closeForRetry();
          return;
        }

        if(!authenticated)rejectInitial('Room WebSocket returned an invalid message.');
        else this.events.error('Room WebSocket returned an invalid message.');
        closeForRetry();
      };

      ws.onerror=()=>{if(active())finish(true);};
      ws.onclose=()=>{if(active())finish(true);};
    });
  }

  private sendControl(value:unknown):void {
    const ws=this.ws;
    if(!ws||ws.readyState!==WebSocket.OPEN||this.connection?.role!=='host')throw new Error('Host room connection is unavailable.');
    ws.send(JSON.stringify(value));
  }

  saveCheckpoint(data:string,revision:number,round:number,replace=false):void {
    if(new TextEncoder().encode(data).length>MAX_CHECKPOINT_DATA)throw new Error('Saved game checkpoint is too large.');
    this.sendControl({type:'checkpoint-save',revision,round,replace,data});
  }

  requestCheckpoints():void {this.sendControl({type:'checkpoint-list'});}
  clearCheckpoints():void {this.sendControl({type:'checkpoint-clear'});}
  loadCheckpoint(id:string):void {
    if(!/^[A-Za-z0-9_-]{1,80}$/.test(id))throw new Error('Invalid saved game ID.');
    this.sendControl({type:'checkpoint-load',id});
  }

  qaDropConnection():void {
    const ws=this.ws;
    if(ws?.readyState===WebSocket.OPEN)ws.close(4000,'qa-reconnect');
  }

  qaReconnects():number {
    return this.qaReconnectCount;
  }

  send(id:string,text:string):void {
    const ws=this.ws;
    if(!ws || ws.readyState!==WebSocket.OPEN || !this.peers.has(id)){
      throw Error('Cloudflare room relay is reconnecting.');
    }
    if(new TextEncoder().encode(text).length>MAX_RELAY_DATA){
      throw Error('Room relay message is too large.');
    }
    ws.send(JSON.stringify({type:'relay',to:id,data:text}));
  }

  private remove(id:string):void {
    if(!this.peers.delete(id))return;
    this.events.remove(id);
  }

  reset():void {
    this.cancelOpen?.();
    this.cancelJoinDelay?.();
    this.createAbort?.abort();this.createAbort=null;
    this.generation++;
    this.clearReconnect();
    this.unlisten();
    this.reconnectAttempt=0;
    this.qaReconnectCount=0;
    this.connection=null;
    const ws=this.ws;
    this.ws=null;
    ws?.close();
    this.removeAll();
  }
}
