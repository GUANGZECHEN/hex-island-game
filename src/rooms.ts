import { formatCandidates } from './candidates';
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
type Entry = {
  pc: RTCPeerConnection;
  channel: RTCDataChannel | null;
  pending: RTCIceCandidateInit[];
  chain: Promise<void>;
  restartTimer: number | null;
  restarted: boolean;
};

const ICE_SERVERS: RTCIceServer[] = [{
  urls: [
    'stun:stun.l.google.com:19302',
    'stun:stun.cloudflare.com:3478',
  ],
}];

export class RoomClient {
  private ws: WebSocket | null = null;
  private peers = new Map<string,Entry>();
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

  private connect(room:string,token:string,role:Role):Promise<void> {
    this.role=role;
    this.events.status('Connecting to signaling…');
    const url=new URL(`${this.endpoint}/rooms/${room}/socket`);
    url.protocol=url.protocol==='https:'?'wss:':'ws:';
    const ws=new WebSocket(url);
    this.ws=ws;

    return new Promise((resolve,reject)=>{
      let settled=false;
      const fail=(message:string)=>{
        if(!settled){settled=true;reject(new RoomError(message));}
        else this.events.error(message);
      };

      ws.onmessage=(event)=>{
        if(this.ws!==ws)return;
        let msg: {type:string;id?:string;from?:string;code?:string;data?:unknown};
        try{msg=JSON.parse(String(event.data));}
        catch{fail('Signaling WebSocket connection or authentication failed.');return;}

        if(msg.type==='authenticate'){
          ws.send(JSON.stringify({type:'auth',role,token}));
          return;
        }
        if(msg.type==='ready'){
          settled=true;
          this.events.status('Room connected. Waiting for peers…');
          resolve();
          return;
        }
        if(msg.type==='error'){
          fail('Signaling WebSocket connection or authentication failed.');
          return;
        }
        if(msg.type==='join' && role==='host' && msg.id){
          const id=msg.id;
          this.queue(id,async e=>{
            const ch=e.pc.createDataChannel('messages');
            this.bind(id,e,ch);
            await e.pc.setLocalDescription(await e.pc.createOffer());
            this.signal('offer',id,e.pc.localDescription?.sdp);
          });
          return;
        }
        if(msg.type==='leave' && msg.id){
          this.remove(msg.id);
          return;
        }
        if(msg.from && ['offer','answer','candidate'].includes(msg.type)){
          const id=msg.from;
          this.queue(id,async e=>{
            if(msg.type==='offer' && role==='guest' && id==='host' && typeof msg.data==='string'){
              await e.pc.setRemoteDescription({type:'offer',sdp:msg.data});
              await this.flush(e);
              await e.pc.setLocalDescription(await e.pc.createAnswer());
              this.signal('answer',id,e.pc.localDescription?.sdp);
            } else if(msg.type==='answer' && role==='host' && typeof msg.data==='string'){
              await e.pc.setRemoteDescription({type:'answer',sdp:msg.data});
              await this.flush(e);
              this.scheduleIceRestart(id,e);
            } else if(msg.type==='candidate' && msg.data && typeof msg.data==='object'){
              const c=msg.data as RTCIceCandidateInit;
              if(e.pc.remoteDescription) await e.pc.addIceCandidate(c);
              else e.pending.push(c);
            }
          });
        }
      };

      ws.onerror=()=>fail('Signaling WebSocket connection or authentication failed.');
      ws.onclose=()=>{
        if(this.ws!==ws)return;
        this.ws=null;
        for(const id of [...this.peers.keys()])this.remove(id);
        fail('Signaling WebSocket connection or authentication failed.');
        this.events.status('Disconnected');
      };
    });
  }

  private entry(id:string):Entry {
    let e=this.peers.get(id);
    if(e)return e;

    const pc=new RTCPeerConnection({iceServers:ICE_SERVERS});
    e={pc,channel:null,pending:[],chain:Promise.resolve(),restartTimer:null,restarted:false};
    this.peers.set(id,e);
    const current=e;

    const update=()=>{
      if(this.peers.get(id)!==current)return;
      this.events.peer(
        id,
        `${pc.connectionState}; ice ${pc.iceConnectionState}; gathering ${pc.iceGatheringState}; channel ${current.channel?.readyState ?? 'waiting'}; local ${formatCandidates(pc.localDescription?.sdp)}; remote ${formatCandidates(pc.remoteDescription?.sdp)}`,
        current.channel?.readyState==='open',
      );
    };

    pc.onicecandidate=event=>{
      if(event.candidate)this.signal('candidate',id,event.candidate.toJSON());
      update();
    };
    pc.onconnectionstatechange=update;
    pc.onicegatheringstatechange=update;
    pc.oniceconnectionstatechange=()=>{
      update();
      if(pc.iceConnectionState==='failed')this.restartIce(id,current);
    };
    pc.ondatachannel=event=>this.bind(id,current,event.channel);
    update();
    return current;
  }

  private scheduleIceRestart(id:string,e:Entry):void {
    if(this.role!=='host' || e.restarted || e.restartTimer!==null || e.channel?.readyState==='open')return;
    e.restartTimer=window.setTimeout(()=>{
      e.restartTimer=null;
      this.restartIce(id,e);
    },8000);
  }

  private restartIce(id:string,e:Entry):void {
    if(this.role!=='host' || this.peers.get(id)!==e || e.restarted || e.channel?.readyState==='open')return;
    e.restarted=true;
    if(e.restartTimer!==null){
      window.clearTimeout(e.restartTimer);
      e.restartTimer=null;
    }
    this.events.status('Retrying direct peer connection…');
    this.queue(id,async current=>{
      if(current.channel?.readyState==='open')return;
      current.pc.restartIce();
      await current.pc.setLocalDescription(await current.pc.createOffer({iceRestart:true}));
      this.signal('offer',id,current.pc.localDescription?.sdp);
    });
  }

  private bind(id:string,e:Entry,ch:RTCDataChannel):void {
    e.channel=ch;
    const update=()=>{
      this.events.peer(
        id,
        `${e.pc.connectionState}; ice ${e.pc.iceConnectionState}; gathering ${e.pc.iceGatheringState}; channel ${ch.readyState}; local ${formatCandidates(e.pc.localDescription?.sdp)}; remote ${formatCandidates(e.pc.remoteDescription?.sdp)}`,
        ch.readyState==='open',
      );
    };
    ch.onopen=()=>{
      if(e.restartTimer!==null){
        window.clearTimeout(e.restartTimer);
        e.restartTimer=null;
      }
      update();
    };
    ch.onclose=update;
    ch.onerror=()=>this.events.error('Data channel error.');
    ch.onmessage=event=>{if(typeof event.data==='string')this.events.message(id,event.data);};
    update();
  }

  private queue(id:string,task:(e:Entry)=>Promise<void>):void {
    const e=this.entry(id);
    e.chain=e.chain.then(()=>task(e)).catch(()=>this.events.error('WebRTC signaling failed.'));
  }

  private async flush(e:Entry):Promise<void>{
    for(const c of e.pending)await e.pc.addIceCandidate(c);
    e.pending=[];
  }

  private signal(type:string,to:string,data:unknown):void {
    if(this.ws?.readyState===WebSocket.OPEN)this.ws.send(JSON.stringify({type,to,data}));
  }

  send(id:string,text:string):void {
    const ch=this.peers.get(id)?.channel;
    if(ch?.readyState!=='open')throw Error('Data channel is not open.');
    ch.send(text);
  }

  private remove(id:string):void {
    const e=this.peers.get(id);
    if(!e)return;
    this.peers.delete(id);
    if(e.restartTimer!==null)window.clearTimeout(e.restartTimer);
    e.channel?.close();
    e.pc.close();
    this.events.remove(id);
  }

  reset():void {
    this.generation++;
    const ws=this.ws;
    this.ws=null;
    ws?.close();
    for(const id of [...this.peers.keys()])this.remove(id);
  }
}
