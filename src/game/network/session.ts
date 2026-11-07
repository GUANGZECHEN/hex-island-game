import { createGame } from '../rules/state.ts';
import { HostAuthority } from './authority.ts';
import { parseSessionRecovery, recoveryRound, type SessionRecovery } from './recovery.ts';

export interface LobbySeat { id:string; connected:boolean; ready:boolean }
interface Seat extends LobbySeat { peer:string | null; token:string }
type Send = (peer:string, message:string)=>void;

/** Host-only session. Credentials must be generated with cryptographically secure randomness. */
export class HostSession {
 private seats:Seat[]; private authority:HostAuthority|null=null; private gameId=''; private recovering=false;
 constructor(privateSend:Send, privatePublish:(value:unknown)=>void, privateToken:()=>string, privateRandom:()=>number, options: { qaTwoPlayers?: boolean } = {}) {
  this.send=privateSend;this.publish=privatePublish;this.token=privateToken;this.random=privateRandom;this.qaTwoPlayers=options.qaTwoPlayers === true;
  this.seats=[{id:'Player 1',connected:true,ready:false,peer:null,token:''}];
 }
 private qaTwoPlayers:boolean; private send:Send; private publish:(value:unknown)=>void; private token:()=>string; private random:()=>number;

 static fromRecovery(privateSend:Send,privatePublish:(value:unknown)=>void,privateToken:()=>string,privateRandom:()=>number,value:unknown):HostSession {
  const recovery=parseSessionRecovery(value);
  const host=new HostSession(privateSend,privatePublish,privateToken,privateRandom,{qaTwoPlayers:recovery.qaTwoPlayers});
  host.restoreRecovery(recovery,true);
  host.announce();
  return host;
 }

 lobby():LobbySeat[]{return this.seats.map(({id,connected,ready})=>({id,connected,ready}));}
 isRecovering():boolean{return this.recovering;}
 allSeatsConnected():boolean{return this.seats.length>0&&this.seats.every(seat=>seat.connected);}
 recovery():SessionRecovery {
  if(!this.authority)throw new Error('Game not started.');
  return {version:1,authority:this.authority.checkpoint(),seats:this.seats.map(({id,token})=>({id,token})),qaTwoPlayers:this.qaTwoPlayers};
 }
 private output(peer:string,type:string,data:unknown){this.send(peer,JSON.stringify({protocol:1,type,data}));}
 private announce(){const lobby={seats:this.lobby(),qaTwoPlayers:this.qaTwoPlayers,recovering:this.recovering};this.publish({type:'lobby',lobby});for(const seat of this.seats)if(seat.peer)this.output(seat.peer,'lobby',lobby);}
 private emitCheckpoint(replace=false){if(!this.authority)return;const data=this.recovery();this.publish({type:'checkpoint',data,revision:data.authority.revision,round:recoveryRound(data.authority.state),replace});}
 private restoreRecovery(value:SessionRecovery,paused:boolean){
  const currentPeers=new Map(this.seats.map(seat=>[seat.id,seat.peer]));
  this.qaTwoPlayers=value.qaTwoPlayers;
  this.gameId=value.authority.gameId;
  this.authority=HostAuthority.fromRecovery(value.authority,this.random);
  this.seats=value.seats.map((seat,index)=>({id:seat.id,token:seat.token,peer:currentPeers.get(seat.id)??null,connected:index===0||(currentPeers.get(seat.id)!=null),ready:false}));
  this.seats[0].connected=true;this.seats[0].peer=null;
  this.recovering=paused;
 }
 disconnect(peer:string){const seat=this.seats.find(s=>s.peer===peer);if(seat){seat.peer=null;seat.connected=false;seat.ready=false;this.announce();}}
 receive(peer:string,text:string){
  if(typeof text!=='string'||new TextEncoder().encode(text).length>16384)return;
  let msg:{protocol?:unknown;type?:unknown;token?:unknown;ready?:unknown;command?:unknown};try{msg=JSON.parse(text);}catch{return;}
  if(!msg||typeof msg!=='object'||Array.isArray(msg)||msg.protocol!==1||typeof msg.type!=='string')return;
  if(msg.type==='hello'){
   if(this.seats.some(s=>s.peer===peer))return;
   let seat:Seat|undefined;
   if(typeof msg.token==='string' && msg.token) seat=this.seats.find(s=>s.token===msg.token);
   else if ((msg.token === undefined || msg.token === '') && !this.authority) {
    const vacant = this.seats.find((s,index) => index > 0 && !s.connected);
    if (vacant || this.seats.length < (this.qaTwoPlayers ? 2 : 4)) {
     const credential=this.token();
     if(!/^[A-Za-z0-9_-]{43}$/.test(credential)||this.seats.some(s=>s.token===credential))throw new Error('Invalid seat credential.');
     if(vacant){seat=vacant;seat.token=credential;seat.ready=false;}
     else {seat={id:`Player ${this.seats.length+1}`,connected:true,ready:false,peer:null,token:credential};this.seats.push(seat);}
    }
   }
   if(!seat){this.output(peer,'error','Seat unavailable.');return;}
   const stalePeer=seat.peer;
   seat.peer=peer;seat.connected=true;seat.ready=false;
   this.output(peer,'seat',{id:seat.id,token:seat.token});this.announce();
   if(stalePeer&&stalePeer!==peer){/* delayed stale disconnect is harmless because disconnect matches the current peer */}
   if(this.authority&&!this.recovering)this.output(peer,'snapshot',this.authority.snapshot(seat.id));
   return;
  }
  const seat=this.seats.find(s=>s.peer===peer&&s.connected);if(!seat)return;
  if(msg.type==='ready' && !this.authority && typeof msg.ready==='boolean'){seat.ready=msg.ready;this.announce();return;}
  if(msg.type==='sync' && this.authority && !this.recovering){this.output(peer,'snapshot',this.authority.snapshot(seat.id));return;}
  if(msg.type==='command' && this.authority && typeof msg.command==='string'){
   if(this.recovering){this.output(peer,'rejection',{ok:false,code:'recovery-pending',revision:this.authority.currentRevision()});return;}
   const result=this.authority.receive(seat.id,msg.command);
   if(!result.ok)this.output(peer,'rejection',result);else{this.emitCheckpoint();this.broadcast();}
  }
 }
 setHostReady(ready:boolean){if(this.authority)throw new Error('Game started.');this.seats[0].ready=ready;this.announce();}
 start(seed:number){
  const countValid=this.qaTwoPlayers ? this.seats.length===2 : this.seats.length>=3 && this.seats.length<=4;
  if(this.authority||!countValid||this.seats.some(s=>!s.connected||!s.ready))throw new Error(this.qaTwoPlayers ? 'Two connected, ready players are required in QA mode.' : 'Three or four connected, ready players are required.');
  this.gameId=this.token();const state=createGame(seed,this.seats.map(s=>s.id),this.random,{qaTwoPlayers:this.qaTwoPlayers});this.authority=new HostAuthority(this.gameId,state,this.random);this.recovering=false;this.emitCheckpoint();this.broadcast();
 }
 resume(value:unknown){
  if(!this.recovering)throw new Error('No saved game is waiting to resume.');
  if(!this.allSeatsConnected())throw new Error('All original players must reconnect before resuming.');
  const recovery=parseSessionRecovery(value);
  const current=this.recovery();
  if(recovery.authority.gameId!==current.authority.gameId||recovery.qaTwoPlayers!==current.qaTwoPlayers||recovery.seats.length!==current.seats.length||recovery.seats.some((seat,index)=>seat.id!==current.seats[index].id||seat.token!==current.seats[index].token))throw new Error('Saved game does not belong to this room session.');
  const peers=new Map(this.seats.map(seat=>[seat.id,seat.peer]));
  this.restoreRecovery(recovery,false);
  for(const seat of this.seats){seat.peer=peers.get(seat.id)??null;seat.connected=seat.id==='Player 1'||seat.peer!==null;}
  for(const seat of this.seats)if(seat.peer)this.output(seat.peer,'resume',{gameId:recovery.authority.gameId,revision:recovery.authority.revision});
  this.announce();this.emitCheckpoint(true);this.broadcast();
 }
 submit(command:Record<string,unknown>,commandId:string,revision:number){
  if(!this.authority)throw new Error('Game not started.');
  if(this.recovering)throw new Error('Saved game is waiting to resume.');
  const message=JSON.stringify({protocol:1,gameId:this.gameId,revision,commandId,sender:'Player 1',command:{...command,playerId:'Player 1'}});
  const result=this.authority.receive('Player 1',message);if(result.ok){this.emitCheckpoint();this.broadcast();}return result;
 }
 private broadcast(){if(!this.authority||this.recovering)return;this.publish({type:'snapshot',data:this.authority.snapshot('Player 1')});for(const seat of this.seats)if(seat.peer)this.output(seat.peer,'snapshot',this.authority.snapshot(seat.id));}
}
