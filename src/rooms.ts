import { requestRoom, RoomError } from './room-request';
export { RoomError } from './room-request';

type Role = 'host' | 'guest';
type Events = {
  status: (s:string)=>void;
  error: (s:string)=>void;
  peer: (id:string, status:string, open:boolean)=>void;
  remove: (id:string)=>void;
  message: (id:string,text:string)=>void;
};
type Connection = { room:string; token:string; role:Role };

const MAX_RELAY_DATA = 16384;
const MAX_RECONNECT_ATTEMPTS = 10;
const validPeerId = (value:unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);
const reconnectDelay = (attempt:number) => Math.min(500 * 2 ** Math.max(0,attempt-1), 8000);

export class RoomClient {
  private ws: WebSocket | null = null;
  private peers = new Set<string>();
  private role: Role = 'guest';
  private generation = 0;
  private connection: Connection | null = null;
  private reconnectTimer: number | null = null;
  private reconnectAttempt = 0;

  constructor(private endpoint:string,private events:Events) {}

  async create(): Promise<string> {
    this.reset();
    const generation=this.generation;
    const room=await requestRoom(this.endpoint);
    if(generation!==this.generation) throw Error('Session cancelled.');
    this.connection={room:room.room,token:room.host,role:'host'};
    await this.open(this.connection,generation,false);
    const link=new URL(location.href);
    link.hash=`join=${room.room}.${room.guest}`;
    return link.toString();
  }

  async join(room:string,token:string):Promise<void> {
    this.reset();
    const generation=this.generation;
    this.connection={room,token,role:'guest'};
    await this.open(this.connection,generation,false);
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

  private scheduleReconnect(generation:number):void {
    if(generation!==this.generation || !this.connection || this.reconnectTimer!==null)return;
    if(this.reconnectAttempt>=MAX_RECONNECT_ATTEMPTS){
      this.events.status('Automatic reconnect paused. Use Rejoin previous room to retry.');
      return;
    }
    const attempt=++this.reconnectAttempt;
    const delay=reconnectDelay(attempt);
    this.events.status(`Connection interrupted. Reconnecting automatically (${attempt}/${MAX_RECONNECT_ATTEMPTS})…`);
    this.reconnectTimer=window.setTimeout(()=>{
      this.reconnectTimer=null;
      const connection=this.connection;
      if(!connection || generation!==this.generation)return;
      void this.open(connection,generation,true).catch(()=>{
        if(generation===this.generation)this.scheduleReconnect(generation);
      });
    },delay);
  }

  private open(connection:Connection,generation:number,reconnecting:boolean):Promise<void> {
    this.role=connection.role;
    this.events.status(reconnecting?'Reconnecting to Cloudflare room…':'Connecting to Cloudflare room…');
    const url=new URL(`${this.endpoint}/rooms/${connection.room}/socket`);
    url.protocol=url.protocol==='https:'?'wss:':'ws:';
    const ws=new WebSocket(url);
    this.ws=ws;

    return new Promise((resolve,reject)=>{
      let settled=false;
      let authenticated=false;
      const rejectInitial=(message:string)=>{
        if(settled)return;
        settled=true;
        reject(new RoomError(message));
      };
      const closeForRetry=()=>{
        try{ws.close();}catch{}
      };

      ws.onmessage=(event)=>{
        if(this.ws!==ws || generation!==this.generation)return;
        let msg:{type?:unknown;id?:unknown;from?:unknown;role?:unknown;code?:unknown;data?:unknown};
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

        if(msg.type==='ready'){
          authenticated=true;
          settled=true;
          this.reconnectAttempt=0;
          this.clearReconnect();
          if(connection.role==='guest')this.ensurePeer('host');
          this.events.status(reconnecting?'Cloudflare room reconnected.':'Cloudflare room connected.');
          resolve();
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
          if(!authenticated)rejectInitial('Room WebSocket connection or authentication failed.');
          else this.events.error('Room WebSocket connection was interrupted.');
          closeForRetry();
          return;
        }

        if(!authenticated)rejectInitial('Room WebSocket returned an invalid message.');
        else this.events.error('Room WebSocket returned an invalid message.');
        closeForRetry();
      };

      ws.onerror=()=>{
        if(this.ws!==ws || generation!==this.generation)return;
        if(!authenticated)rejectInitial('Room WebSocket connection or authentication failed.');
      };

      ws.onclose=()=>{
        if(this.ws!==ws || generation!==this.generation)return;
        this.ws=null;
        for(const id of [...this.peers])this.remove(id);
        if(!settled){
          rejectInitial('Room WebSocket connection or authentication failed.');
          return;
        }
        this.scheduleReconnect(generation);
      };
    });
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
    this.generation++;
    this.clearReconnect();
    this.reconnectAttempt=0;
    this.connection=null;
    const ws=this.ws;
    this.ws=null;
    ws?.close();
    for(const id of [...this.peers])this.remove(id);
  }
}
