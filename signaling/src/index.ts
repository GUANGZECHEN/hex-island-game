import { allowedOrigin, authorize, canRoute, hash, MAX_MESSAGE, MAX_ROOM_CONNECTIONS, ROOM_TTL_MS, parseRoomControl, parseRoutedMessage, randomToken, validToken, type Role } from './protocol';

interface Env { ROOMS: DurableObjectNamespace }
type Member = { id: string; role: Role };
type RoomInfo = { hostHash: string; guestHash: string; expires: number };
type SavedCheckpoint = { id:string; revision:number; round:number; savedAt:number; data:string };
type SavedCheckpointMeta = Omit<SavedCheckpoint,'data'> & { latest:boolean };

const json = (value: unknown, status=200) => Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
const cors = (r: Response, origin: string) => {
  const h = new Headers(r.headers);
  h.set('Access-Control-Allow-Origin',origin);
  h.set('Vary','Origin');
  return new Response(r.body,{status:r.status,headers:h});
};

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const origin=req.headers.get('Origin');
    if (!allowedOrigin(origin)) return json({error:'origin-denied'},403);

    if (req.method === 'OPTIONS') {
      return new Response(null,{
        status:204,
        headers:{
          'Access-Control-Allow-Origin':origin!,
          'Access-Control-Allow-Methods':'POST, GET, OPTIONS',
          'Access-Control-Allow-Headers':'Content-Type',
          'Vary':'Origin',
        },
      });
    }

    const url=new URL(req.url);
    if (url.pathname === '/rooms' && req.method === 'POST') {
      const room=randomToken(), host=randomToken(), guest=randomToken(), expires=Date.now()+ROOM_TTL_MS;
      const stub=env.ROOMS.get(env.ROOMS.idFromName(room));
      const init=await stub.fetch('https://room.internal/init',{
        method:'POST',
        body:JSON.stringify({hostHash:await hash(host),guestHash:await hash(guest),expires}),
      });
      if (!init.ok) return cors(json({error:'creation-failed'},500),origin!);
      return cors(json({room,host,guest,expires},201),origin!);
    }

    const match=/^\/rooms\/([A-Za-z0-9_-]{43})\/socket$/.exec(url.pathname);
    if (match && req.method === 'GET' && req.headers.get('Upgrade')?.toLowerCase()==='websocket') {
      return env.ROOMS.get(env.ROOMS.idFromName(match[1])).fetch('https://room.internal/socket',req);
    }

    return cors(json({error:'not-found'},404),origin!);
  },
};

export class Room {
  constructor(private state: DurableObjectState) {}

  async fetch(req: Request): Promise<Response> {
    const path=new URL(req.url).pathname;

    if (path==='/init' && req.method==='POST') {
      if (await this.state.storage.get('info')) return json({error:'exists'},409);
      const data=await req.json() as RoomInfo;
      await this.state.storage.put('info',data);
      await this.state.storage.setAlarm(data.expires);
      return json({ok:true});
    }

    if (path!=='/socket' || req.headers.get('Upgrade')?.toLowerCase()!=='websocket') {
      return json({error:'not-found'},404);
    }

    const info=await this.state.storage.get<RoomInfo>('info');
    if (!info || Date.now()>=info.expires) return json({error:'expired'},410);
    if (this.state.getWebSockets().length>=MAX_ROOM_CONNECTIONS) return json({error:'busy'},429);

    const pair=new WebSocketPair();
    const [client,server]=Object.values(pair);
    server.serializeAttachment(null);
    this.state.acceptWebSocket(server);
    server.send(JSON.stringify({type:'authenticate'}));
    return new Response(null,{status:101,webSocket:client});
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string' || new TextEncoder().encode(message).length>MAX_MESSAGE) {
      ws.close(1008,'invalid');
      return;
    }

    let member=ws.deserializeAttachment() as Member | null;
    if (!member) {
      await this.state.blockConcurrencyWhile(async()=>{
        let x: {type?:unknown;role?:unknown;token?:unknown};
        try{x=JSON.parse(message)}catch{ws.close(1008,'invalid');return}

        if (
          !x ||
          Object.keys(x).sort().join(',')!=='role,token,type' ||
          x.type!=='auth' ||
          (x.role!=='host' && x.role!=='guest') ||
          !validToken(x.token)
        ) {
          ws.close(1008,'invalid');
          return;
        }

        const info=await this.state.storage.get<RoomInfo>('info');
        if(!info){ws.close(1008,'expired');return}

        const members=this.members();
        const role=x.role;
        const error=authorize(
          role,
          await hash(x.token),
          role==='host'?info.hostHash:info.guestHash,
          info.expires,
          Date.now(),
          members.some(m=>m.member.role==='host'),
          members.length,
        );
        if(error){
          ws.send(JSON.stringify({type:'error',code:error}));
          ws.close(1008,error);
          return;
        }

        member={id:role==='host'?'host':randomToken(),role};
        ws.serializeAttachment(member);
        ws.send(JSON.stringify({type:'ready',id:member.id,role,expires:info.expires}));
        if(role==='guest') this.sendTo('host',{type:'join',id:member.id});
      });
      return;
    }

    const info=await this.state.storage.get<RoomInfo>('info');
    if(!info || Date.now()>=info.expires){
      ws.close(1008,'expired');
      return;
    }

    const control=parseRoomControl(message);
    if(control){
      if(member.role!=='host'){ws.close(1008,'invalid');return;}
      if(control.type==='checkpoint-save'){await this.saveCheckpoint(ws,control.revision,control.round,control.replace,control.data);return;}
      if(control.type==='checkpoint-list'){await this.listCheckpoints(ws);return;}
      if(control.type==='checkpoint-load'){await this.loadCheckpoint(ws,control.id);return;}
    }

    const routed=parseRoutedMessage(message);
    const guests=this.members().filter(x=>x.member.role==='guest').map(x=>x.member.id);
    if(!routed || !canRoute(member.role,routed.to,guests)){
      ws.close(1008,'invalid');
      return;
    }

    this.sendTo(routed.to,{type:'relay',from:member.id,data:routed.data});
  }

  private async history():Promise<SavedCheckpoint[]> {
    const values=await Promise.all([0,1,2].map(index=>this.state.storage.get<SavedCheckpoint>(`checkpoint:history:${index}`)));
    return values.filter((value):value is SavedCheckpoint=>!!value);
  }

  private async writeHistory(values:SavedCheckpoint[]):Promise<void> {
    for(let index=0;index<3;index++){
      const key=`checkpoint:history:${index}`;
      const value=values[index];
      if(value)await this.state.storage.put(key,value);else await this.state.storage.delete(key);
    }
  }

  private async saveCheckpoint(ws:WebSocket,revision:number,round:number,replace:boolean,data:string):Promise<void> {
    const latest=await this.state.storage.get<SavedCheckpoint>('checkpoint:latest');
    if(latest&&!replace&&revision<latest.revision){ws.send(JSON.stringify({type:'checkpoint-error',code:'stale'}));return;}
    let history=await this.history();
    if(latest&&latest.round>0&&latest.round!==round){
      history=[latest,...history.filter(item=>item.round!==latest.round&&item.round!==round)].slice(0,3);
    } else {
      history=history.filter(item=>item.round!==round);
    }
    const saved:SavedCheckpoint={id:`cp_${Date.now().toString(36)}_${revision}_${randomToken().slice(0,8)}`,revision,round,savedAt:Date.now(),data};
    await this.state.storage.put('checkpoint:latest',saved);
    await this.writeHistory(history);
    ws.send(JSON.stringify({type:'checkpoint-saved',checkpoint:this.meta(saved,true)}));
  }

  private meta(value:SavedCheckpoint,latest:boolean):SavedCheckpointMeta {
    const {data:_data,...rest}=value;return {...rest,latest};
  }

  private async listCheckpoints(ws:WebSocket):Promise<void> {
    const latest=await this.state.storage.get<SavedCheckpoint>('checkpoint:latest');
    const history=await this.history();
    const checkpoints:SavedCheckpointMeta[]=[...(latest?[this.meta(latest,true)]:[]),...history.map(value=>this.meta(value,false))];
    ws.send(JSON.stringify({type:'checkpoint-list',checkpoints}));
  }

  private async loadCheckpoint(ws:WebSocket,id:string):Promise<void> {
    const latest=await this.state.storage.get<SavedCheckpoint>('checkpoint:latest');
    const history=await this.history();
    const checkpoint=[...(latest?[latest]:[]),...history].find(value=>value.id===id);
    if(!checkpoint){ws.send(JSON.stringify({type:'checkpoint-error',code:'not-found'}));return;}
    ws.send(JSON.stringify({type:'checkpoint-data',checkpoint}));
  }

  private members(): {socket:WebSocket;member:Member}[] {
    return this.state.getWebSockets()
      .map(socket=>({socket,member:socket.deserializeAttachment() as Member | null}))
      .filter((x): x is {socket:WebSocket;member:Member}=>!!x.member);
  }

  private sendTo(id:string,data:unknown): void {
    for(const x of this.members()) {
      if(x.member.id===id) {
        try{x.socket.send(JSON.stringify(data))}catch{}
      }
    }
  }

  async webSocketClose(ws:WebSocket):Promise<void> {
    const m=ws.deserializeAttachment() as Member|null;
    ws.serializeAttachment(null);
    if(!m)return;
    if(m.role==='guest') {
      this.sendTo('host',{type:'leave',id:m.id});
    } else {
      for(const x of this.members()) {
        try{
          x.socket.send(JSON.stringify({type:'error',code:'host-unavailable'}));
          x.socket.close(1000,'host-unavailable');
        }catch{}
      }
    }
  }

  async webSocketError(ws:WebSocket):Promise<void> {
    await this.webSocketClose(ws);
  }

  async alarm():Promise<void> {
    for(const ws of this.state.getWebSockets()) {
      try{ws.close(1000,'expired')}catch{}
    }
    await this.state.storage.deleteAll();
  }
}
