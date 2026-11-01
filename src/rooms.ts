import { formatCandidates } from './candidates';
type Role = 'host' | 'guest';
type Events = { status: (s:string)=>void; error: (s:string)=>void; peer: (id:string, status:string, open:boolean)=>void; remove: (id:string)=>void; message: (id:string,text:string)=>void };
type Entry = { pc: RTCPeerConnection; channel: RTCDataChannel | null; pending: RTCIceCandidateInit[]; chain: Promise<void> };
export class RoomClient {
 private ws: WebSocket | null = null; private peers = new Map<string,Entry>(); private role: Role = 'guest'; private generation = 0;
 constructor(private endpoint:string,private events:Events) {}
 async create(): Promise<string> {
  this.reset(); const generation=this.generation;
  const response=await fetch(`${this.endpoint}/rooms`,{method:'POST',headers:{'Content-Type':'application/json'}}); if(!response.ok) throw Error('Room creation failed.');
  const room=await response.json() as {room:string;host:string;guest:string}; if(generation!==this.generation) throw Error('Session cancelled.');
  await this.connect(room.room,room.host,'host');
  const link=new URL(location.href); link.hash=`join=${room.room}.${room.guest}`; return link.toString();
 }
 async join(room:string,token:string):Promise<void> { this.reset(); await this.connect(room,token,'guest'); }
 private connect(room:string,token:string,role:Role):Promise<void> {
  this.role=role; this.events.status('Connecting to signaling…');
  const url=new URL(`${this.endpoint}/rooms/${room}/socket`); url.protocol=url.protocol==='https:'?'wss:':'ws:';
  const ws=new WebSocket(url); this.ws=ws;
  return new Promise((resolve,reject)=>{ let settled=false; const fail=(message:string)=>{if(!settled){settled=true;reject(Error(message));}else this.events.error(message);};
   ws.onmessage=(event)=>{ if(this.ws!==ws)return; let msg: {type:string;id?:string;from?:string;code?:string;data?:unknown}; try{msg=JSON.parse(String(event.data));}catch{fail('Invalid signaling response.');return}
    if(msg.type==='authenticate'){ws.send(JSON.stringify({type:'auth',role,token}));return;}
    if(msg.type==='ready'){settled=true;this.events.status('Room connected. Waiting for peers…');resolve();return;}
    if(msg.type==='error'){fail(`Room error: ${msg.code ?? 'unknown'}`);return;}
    if(msg.type==='join' && role==='host' && msg.id){const id=msg.id;this.queue(id,async e=>{const ch=e.pc.createDataChannel('messages');this.bind(id,e,ch);await e.pc.setLocalDescription(await e.pc.createOffer());this.signal('offer',id,e.pc.localDescription?.sdp);});return;}
    if(msg.type==='leave' && msg.id){this.remove(msg.id);return;}
    if(msg.from && ['offer','answer','candidate'].includes(msg.type)){const id=msg.from;this.queue(id,async e=>{
      if(msg.type==='offer' && role==='guest' && id==='host' && typeof msg.data==='string'){await e.pc.setRemoteDescription({type:'offer',sdp:msg.data});await this.flush(e);await e.pc.setLocalDescription(await e.pc.createAnswer());this.signal('answer',id,e.pc.localDescription?.sdp);}
      else if(msg.type==='answer' && role==='host' && typeof msg.data==='string'){await e.pc.setRemoteDescription({type:'answer',sdp:msg.data});await this.flush(e);}
      else if(msg.type==='candidate' && msg.data && typeof msg.data==='object'){const c=msg.data as RTCIceCandidateInit;if(e.pc.remoteDescription) await e.pc.addIceCandidate(c);else e.pending.push(c);}
    });}
   };
   ws.onerror=()=>fail('Signaling connection failed.'); ws.onclose=(event)=>{if(this.ws!==ws)return;this.ws=null;for(const id of [...this.peers.keys()])this.remove(id);fail(`Signaling disconnected${event.reason ? `: ${event.reason}` : '.'}`);this.events.status('Disconnected');};
  });
 }
 private entry(id:string):Entry { let e=this.peers.get(id);if(e)return e;const pc=new RTCPeerConnection({iceServers:[{urls:'stun:stun.l.google.com:19302'}]});e={pc,channel:null,pending:[],chain:Promise.resolve()};this.peers.set(id,e);const current=e;
  const update=()=>{if(this.peers.get(id)!==current)return;this.events.peer(id,`${pc.connectionState}; channel ${current.channel?.readyState ?? 'waiting'}; local ${formatCandidates(pc.localDescription?.sdp)}; remote ${formatCandidates(pc.remoteDescription?.sdp)}`,current.channel?.readyState==='open');};
  pc.onicecandidate=event=>{if(event.candidate)this.signal('candidate',id,event.candidate.toJSON());update();};pc.onconnectionstatechange=update;pc.onicegatheringstatechange=update;pc.ondatachannel=event=>this.bind(id,current,event.channel);update();return current;
 }
 private bind(id:string,e:Entry,ch:RTCDataChannel):void {e.channel=ch;const update=()=>this.events.peer(id,`${e.pc.connectionState}; channel ${ch.readyState}; local ${formatCandidates(e.pc.localDescription?.sdp)}; remote ${formatCandidates(e.pc.remoteDescription?.sdp)}`,ch.readyState==='open');ch.onopen=update;ch.onclose=update;ch.onerror=()=>this.events.error('Data channel error.');ch.onmessage=event=>{if(typeof event.data==='string')this.events.message(id,event.data);};update();}
 private queue(id:string,task:(e:Entry)=>Promise<void>):void {const e=this.entry(id);e.chain=e.chain.then(()=>task(e)).catch(()=>this.events.error('WebRTC signaling failed.'));}
 private async flush(e:Entry):Promise<void>{for(const c of e.pending)await e.pc.addIceCandidate(c);e.pending=[];}
 private signal(type:string,to:string,data:unknown):void {if(this.ws?.readyState===WebSocket.OPEN)this.ws.send(JSON.stringify({type,to,data}));}
 send(id:string,text:string):void {const ch=this.peers.get(id)?.channel;if(ch?.readyState!=='open')throw Error('Data channel is not open.');ch.send(text);}
 private remove(id:string):void {const e=this.peers.get(id);if(!e)return;this.peers.delete(id);e.channel?.close();e.pc.close();this.events.remove(id);}
 reset():void {this.generation++;const ws=this.ws;this.ws=null;ws?.close();for(const id of [...this.peers.keys()])this.remove(id);}
}
