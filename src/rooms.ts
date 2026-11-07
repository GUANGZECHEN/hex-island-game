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

const MAX_RELAY_DATA = 16384;
const validPeerId = (value:unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);

export class RoomClient {
  private ws: WebSocket | null = null;
  private peers = new Set<string>();
  private role: Role = 'guest';
  private generation = 0;

  constructor(private endpoint:string,private events:Events) {}

  async create(): Promise<string> {
    this.reset();
    const generation=this.generation;
    const room=await requestRoom(this.endpoint);
    if(generation!==this.generation) throw Error('Session cancelled.');
    await this.connect(room.room,room.host,'host');
    const link=new URL(location.href);
    link.hash=`join=${room.room}.${room.guest}`;
    return link.toString();
  }

  async join(room:string,token:string):Promise<void> {
    this.reset();
    await this.connect(room,token,'guest');
  }

  private ensurePeer(id:string):void {
    if(this.peers.has(id))return;
    this.peers.add(id);
    this.events.peer(id,'Cloudflare relay connected',true);
  }

  private connect(room:string,token:string,role:Role):Promise<void> {
    this.role=role;
    this.events.status('Connecting to Cloudflare room…');
    const url=new URL(`${this.endpoint}/rooms/${room}/socket`);
    url.protocol=url.protocol==='https:'?'wss:':'ws:';
    const ws=new WebSocket(url);
    this.ws=ws;

    return new Promise((resolve,reject)=>{
      let settled=false;
      const fail=(message:string)=>{
        if(!settled){
          settled=true;
          reject(new RoomError(message));
        }else{
          this.events.error(message);
        }
      };

      ws.onmessage=(event)=>{
        if(this.ws!==ws)return;
        let msg:{type?:unknown;id?:unknown;from?:unknown;role?:unknown;code?:unknown;data?:unknown};
        try{msg=JSON.parse(String(event.data));}
        catch{fail('Room WebSocket returned an invalid message.');return;}

        if(msg.type==='authenticate'){
          ws.send(JSON.stringify({type:'auth',role,token}));
          return;
        }

        if(msg.type==='ready'){
          settled=true;
          if(role==='guest')this.ensurePeer('host');
          this.events.status('Cloudflare room connected.');
          resolve();
          return;
        }

        if(msg.type==='join' && role==='host' && validPeerId(msg.id) && msg.id!=='host'){
          this.ensurePeer(msg.id);
          return;
        }

        if(msg.type==='leave' && role==='host' && validPeerId(msg.id)){
          this.remove(msg.id);
          return;
        }

        if(msg.type==='relay' && validPeerId(msg.from) && typeof msg.data==='string'){
          if(new TextEncoder().encode(msg.data).length>MAX_RELAY_DATA){
            fail('Room relay message exceeded the safe size limit.');
            return;
          }
          if(role==='guest' && msg.from!=='host'){
            fail('Room relay source was invalid.');
            return;
          }
          if(role==='host' && msg.from==='host'){
            fail('Room relay source was invalid.');
            return;
          }
          this.ensurePeer(msg.from);
          this.events.message(msg.from,msg.data);
          return;
        }

        if(msg.type==='error'){
          fail('Room WebSocket connection or authentication failed.');
          return;
        }

        fail('Room WebSocket returned an invalid message.');
      };

      ws.onerror=()=>fail('Room WebSocket connection or authentication failed.');
      ws.onclose=()=>{
        if(this.ws!==ws)return;
        this.ws=null;
        for(const id of [...this.peers])this.remove(id);
        fail('Room WebSocket connection or authentication failed.');
        this.events.status('Disconnected');
      };
    });
  }

  send(id:string,text:string):void {
    const ws=this.ws;
    if(!ws || ws.readyState!==WebSocket.OPEN || !this.peers.has(id)){
      throw Error('Cloudflare room relay is not open.');
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
    const ws=this.ws;
    this.ws=null;
    ws?.close();
    for(const id of [...this.peers])this.remove(id);
  }
}
